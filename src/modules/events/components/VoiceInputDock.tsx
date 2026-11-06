"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ChevronLeft, ChevronsRight, Mic, Square, X } from "lucide-react";
import type { VoiceStepApi } from "@/modules/events/components/EventStepForm";
import {
  audioContextConstructor,
  concatSamples,
  isPcmCaptureSupported,
  isRecordingSupported,
  MAX_RECORDING_MS,
  PCM_SAMPLE_RATE,
  pickRecorderMimeType,
  PRE_ROLL_MS,
  tailSamples,
} from "@/modules/events/lib/voice/audio";
import {
  applyVoicePatch,
  applyVoicePatches,
  describeFieldValue,
  fieldForDomId,
  firstNeededField,
  nextNeededField,
  previousField,
  shouldAskGenderBeforePricing,
  startFieldFor,
  voiceSlotById,
} from "@/modules/events/lib/voice/fields";
import {
  BATCH_PROMPT,
  batchExampleSentence,
  batchPlan,
  batchTargets,
  defaultVoiceMode,
  type VoiceMode,
} from "@/modules/events/lib/voice/batch-guide";
import { trackEvent } from "@/lib/analytics";
import {
  fieldScrollDelta,
  panelBoxFor,
  type VoicePanelBox,
} from "@/modules/events/lib/voice/panel";
import {
  circleSpotlightClipPath,
  spotlightClipPath,
  spotlightFor,
  type VoiceSpotlight,
} from "@/modules/events/lib/voice/spotlight";
import { firstIncompleteMandatoryStep } from "@/modules/events/lib/steps";
import { fetchVoiceMockEnabled, transcribeVoiceClip } from "@/modules/events/lib/voice/transcribe";
import { transcribeVoiceUtterance } from "@/modules/events/lib/voice/utterance-client";
import { isLongVoiceField, shouldAutoConfirm } from "@/modules/events/lib/voice/confirm";
import { assignUtterance } from "@/modules/events/lib/voice/utterance";
import { dismissVoiceGuide, isVoiceGuideDismissed } from "@/modules/events/lib/voice/guide";
import { lookupPostalCode } from "@/modules/events/lib/postal-code-search";
import { encodeWav, resampleLinear } from "@/modules/events/lib/voice/pcm";
import { Dialog } from "@/components/ui/Dialog";
import type {
  VoiceFieldKey,
  VoiceFieldScope,
  VoicePatch,
  VoiceSlot,
  VoiceSlotId,
} from "@/modules/events/lib/voice/types";
import {
  createScheduleDraft,
  MAX_EVENT_OPTIONS,
  withGenderPricing,
  type EventFormValues,
} from "@/modules/events/types";

type VoicePhase = "armed" | "listening" | "transcribing";

/**
 * モック（`VOICE_TRANSCRIBE_MOCK=1`）の疑似録音の間合い。
 *
 * マイクを使わないので、待つ長さで「録音中 → テキスト変換中」の移り変わりを作る。
 * 実機より短くして、欄を巡回する様子を最後まで目で追えるようにしてある。
 */
const MOCK_RECORDING_MS = 1200;
const MOCK_TRANSCRIBE_MS = 350;

/** 文字起こしを確定する前に置く確認。`slotId` は確認しているあいだに値が変わっても引き直せる。 */
interface VoicePending {
  slotId: VoiceSlotId;
  /** 聞き取ったままの文字。確認の下に残して、編集した箇所と見比べられるようにする。 */
  text: string;
  /** 確認で編集している途中の文字。確定はこの文字で `parse` する。 */
  draft: string;
}

/** 「まとめて話す」の確認 1 行。 */
interface VoiceBatchRow {
  slotId: VoiceSlotId;
  label: string;
  /** 編集できる文字。確定時にこの文字で `parse` し直す。 */
  text: string;
  /** 取り込むか。既定はオン。 */
  include: boolean;
}

interface VoiceBatchState {
  rows: VoiceBatchRow[];
  /** どの欄にも当たらなかった節。 */
  unassigned: string[];
  /** 空欄だったのに、割当が付かなかった欄の名前。 */
  missed: string[];
}

/** 自動確定の知らせを出しておく長さ。次の欄の録音が始まっても読み終えられる長さにする。 */
const AUTO_MESSAGE_MS = 3_000;

/**
 * 入力完了の表示を出しておく長さ。
 *
 * 「必須項目の入力完了！」に添える案内（テーマとチラシ）を読み終えられる長さにする。
 * 3 秒だと 1 行を読み切る前にパネルが閉じる。
 */
const COMPLETE_HOLD_MS = 5_000;

/**
 * 入力完了の見出しと、次にすることを 1 行で返す。
 *
 * 音声で埋められる欄が尽きた時点で、必須がそろっているとは限らない
 * （スキップで飛ばせるため）。そろっていないのに「完了」とは言わない。
 * テーマとチラシは音声では選べないので、最後に画面からの操作へ渡す。
 */
function completionCopy(requiredComplete: boolean): { prompt: string; note: string } {
  return requiredComplete
    ? {
        prompt: "必須項目の入力完了！",
        note: "テーマを選び、チラシを作ると仕上がります。",
      }
    : {
        prompt: "必須の入力が残っています",
        note: "ステップを開いて、残りを入れてください。",
      };
}

/** 中止（`AbortController`）で止めた通信か。利用者がやめた操作は知らせない。 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

type VoiceBranchKind = "schedule" | "gender";

/** 分岐の質問（日時の群を出る瞬間・費用の入口）。回答後に元のマスを引き直すため `slotId` を持つ。 */
interface VoiceBranchQuestion {
  kind: VoiceBranchKind;
  slotId: VoiceSlotId;
}

/** 日時の群。この欄を最後に触ったとき、最終行が埋まっていれば「別の日時」を尋ねる。 */
const SCHEDULE_KEYS: ReadonlySet<VoiceFieldKey> = new Set([
  "scheduleDate",
  "scheduleStart",
  "scheduleEnd",
]);

/**
 * 日時の群を出る瞬間に「別の日程」を出すか。特定の欄ではなく「群から出る瞬間」で見る。
 * 開始時刻の範囲発話のように 1 つの発話で終了時刻まで埋まることがあるため、
 * 最後に触った欄の種類と、最終行の埋まり具合だけで決める。
 *
 * 男女別の質問は費用の入口（プラン名の直前）で出す。`advanceFrom` が見る。
 */
function branchAfter(
  slot: VoiceSlot,
  value: EventFormValues,
  next: VoiceSlot | null,
): VoiceBranchKind | null {
  const nextKey = next?.key ?? null;

  if (SCHEDULE_KEYS.has(slot.key) && !(nextKey && SCHEDULE_KEYS.has(nextKey))) {
    const last = value.schedules[value.schedules.length - 1];
    const filled = Boolean(last?.eventDate && last?.startTime && last?.endTime);
    if (filled && value.schedules.length < MAX_EVENT_OPTIONS) return "schedule";
  }

  // 男女別は費用の入口（プラン名の直前）で尋ねる。ここは群から出る瞬間だけを見る。
  return null;
}

interface VoiceInputDockProps {
  value: EventFormValues;
  onChange: (value: EventFormValues) => void;
  api: VoiceStepApi;
  /**
   * 未登録の幹事にだけ主催者名を聞く。公開には会員登録が要るようになったため
   * 作成画面からは渡さないが、欄そのものは残す（音声の対象を決める側が持つ）。
   */
  showOrganizerName?: boolean;
  disabled?: boolean;
  /**
   * 初回ガイド（スポットライトツアー）が終わるまで、この音声ガイドを待たせる。
   * 2 つを同時に出すと、どちらを先に読むのか分からなくなる。
   */
  guideDeferred?: boolean;
}

/**
 * 右下に固定する音声入力の入口。
 *
 * 押すと音声モードに入り、そのまま録音を始める。直前に選んでいた入力欄があれば
 * その欄から、無ければ上から順に空欄へ「見た目だけのフォーカス」を当てる。
 * 入力欄の DOM フォーカスは動かさない。日付・時刻の入力欄に実フォーカスを当てると
 * OS のピッカーが開き、マイクを止めてしまうためである。
 * 入力できる欄が尽きたら「必須項目の入力完了！」と、テーマ・チラシへ進む案内を出し、
 * 5 秒後に音声モードを抜ける。
 */
export function VoiceInputDock({
  value,
  onChange,
  api,
  showOrganizerName = false,
  disabled = false,
  guideDeferred = false,
}: VoiceInputDockProps) {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>("armed");
  const [cursor, setCursor] = useState<VoiceSlotId | null>(null);
  const [touched, setTouched] = useState<ReadonlySet<VoiceFieldKey>>(new Set());
  // 空欄でよい欄（補足・雨天時・定員・期限）まで聞くか。始めるときに話し方で決める
  // （まとめては既定で外す。話す量が増えるほど、途中で言い直す手間も増える）。
  // 開いているあいだに切り替えれば、そのセッションではその値を使う。
  const [includeOptional, setIncludeOptional] = useState(true);
  // 1 欄入れたら次の欄へ移るか。既定はオン。オフなら同じ欄に留めて言い直しを待つ。
  const [autoAdvance, setAutoAdvance] = useState(true);
  // 入力できる欄が尽きた印。完了の表示を出してから 5 秒で音声モードを抜ける。
  const [complete, setComplete] = useState(false);
  // 録音の印を止めた瞬間だけ少し縮ませる。押した手応えを残すため。
  const [statusStopping, setStatusStopping] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // 住所の補完に失敗したときの 1 行。補完のあと次の欄の録音が始まると `message` は
  // 空になるので、次の値を入れるまで残るよう別に持つ。
  const [addressNote, setAddressNote] = useState<string | null>(null);
  // 郵便番号から住所を引いているあいだの印。待ちの間は録音を始めさせない。
  const [searching, setSearching] = useState(false);
  // パネルの置き場所。そのセッションで最後に測った、強調中の欄のすぐ下。
  // null になるのは音声モードに入った直後（まだ一度も測れていない）だけ。
  const [panelBox, setPanelBox] = useState<VoicePanelBox | null>(null);
  // 覆いからくり抜く位置。対象の欄が見つからないときは null で、覆いを出さない。
  const [spotlight, setSpotlight] = useState<VoiceSpotlight | null>(null);
  // 文字起こしはすぐ確定せず、いったん確認に置く。読み取り違いを、話し直す前に見せる。
  const [pending, setPending] = useState<VoicePending | null>(null);
  // 文字起こしの途中経過。質問は消さず、その下に 1 行だけ足す。
  const [interim, setInterim] = useState("");
  // 話し方（まとめて／1つずつ）。null はまだ選ばれていない（既定に従う）。
  const [modeChoice, setModeChoice] = useState<VoiceMode | null>(null);
  const [batch, setBatch] = useState<VoiceBatchState | null>(null);
  // まとめて話すときに、聞き取れてマスが埋まった欄。値はまだ確定していない。
  // 話している間に増えるのはこの集合だけで、文字と値は止めたあとの確認で出す。
  const [readCells, setReadCells] = useState<ReadonlySet<VoiceSlotId>>(new Set());
  // 群から出る瞬間の分岐。答えるまでカーソルは最後の欄に残す。
  const [branch, setBranch] = useState<VoiceBranchQuestion | null>(null);
  // 初回ガイド。開いているかどうかだけを持つ。自動表示を止めたかは保存先が覚える。
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideClip, setGuideClip] = useState<string | null>(null);
  // モック（ローカル専用）なら録音を省き、欄の入力例をそのまま入れる。
  const [mock, setMock] = useState(false);

  // 非同期のコールバック（録音停止・住所検索）から最新値を読むための控え。
  const valueRef = useRef(value);
  const cursorRef = useRef<VoiceSlotId | null>(null);
  const touchedRef = useRef<ReadonlySet<VoiceFieldKey>>(new Set());
  const includeOptionalRef = useRef(includeOptional);
  const autoAdvanceRef = useRef(autoAdvance);
  // 音声を押す前に選んでいた入力欄。あればその欄から始める。
  const lastFocusedIdRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // PCM（16kHz WAV）で録るときのサンプル。pre-roll は録音の開始前に溜める直近 400ms。
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const preRollRef = useRef<Float32Array[]>([]);
  const recordingRef = useRef(false);
  const wavRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const timerRef = useRef<number | null>(null);
  const completeTimerRef = useRef<number | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  // 自動確定の知らせだけを消すタイマー。録音・完了の待ちとは別に持つ。
  const autoMessageTimerRef = useRef<number | null>(null);
  // 途中経過の累積。`onDelta` は増分を返すので、呼ばれるたびに足す。
  const interimRef = useRef("");
  // いま走っている文字起こし。戻る・スキップ・終了・新しい録音で止める。
  const abortRef = useRef<AbortController | null>(null);
  const batchModeRef = useRef(false);
  // 確認の一覧は、音声モードを抜けるときに「取り込まなかった」として数える。effect を増やさず読む。
  const batchRef = useRef<VoiceBatchState | null>(null);
  // モックの疑似録音の待ち。実の録音の `timerRef` とは別に持つ（同時には片方しか使わない）。
  const mockTimerRef = useRef<number | null>(null);
  // モックでマスを 1 つずつ塗るための待ち。疑似録音の待ちとは別に片付ける。
  const mockCellTimersRef = useRef<number[]>([]);
  const mockRef = useRef(false);
  // モックかどうかのサーバーからの返事。届く前に押されても、録音の直前で待てるようにする。
  const mockAnswerRef = useRef<Promise<boolean> | null>(null);
  // 録音の開始は await を挟む。二度押しや自動遷移が重なると getUserMedia が二重に走り、
  // 先に掴んだストリームが止まらないまま残る。開始の間だけ立てる印で、後から来た呼び出しは捨てる。
  const startingRef = useRef(false);
  // 開始の世代。開始の途中で音声モードを抜けたら、遅れて届いた結果を捨てる
  // （閉じたのにマイクが開きっぱなしになるのを防ぐ）。
  const startAttemptRef = useRef(0);
  // 指示は 1 行に収める。収まる中でいちばん大きい字を選ぶ。
  const promptRef = useRef<HTMLParagraphElement | null>(null);
  // 録音の開始は commit からも呼ぶ。互いを依存に持つと循環するので控えを挟む。
  const startRecordingRef = useRef<() => void>(() => {});
  const mountedRef = useRef(true);
  // 初回ガイドを 1 回だけ出すための印（再描画で開き直さない）。
  const guideShownRef = useRef(false);
  /** 直前の描画でツアーを待っていたか。待ちが明けた瞬間を、自動表示の合図に使う。 */
  const guideDeferredRef = useRef(guideDeferred);
  // 男女別の費用を聞いたか。1 セッション 1 回だけ聞く（「共通のまま」のあと聞き直さない）。
  const genderAskedRef = useRef(false);
  // ダイアログが開いているあいだは、音声モードの Esc を止める。
  const dialogOpenRef = useRef(false);
  // パネルの上端。切り抜きの下端をここより上へ収める。
  const panelRef = useRef<HTMLElement | null>(null);
  const fabRef = useRef<HTMLButtonElement | null>(null);
  // 入力完了の印。測り直しの effect からも読むので控える
  // （状態を依存に入れると、完了のたびに測り直しを張り直してしまう）。
  const completeRef = useRef(false);

  // 巡回の指定と、まとめて話すときの対象・案内。描画ごとに作り直さない。
  const scope = useMemo<VoiceFieldScope>(
    () => ({ showOrganizerName, includeOptional, touched }),
    [showOrganizerName, includeOptional, touched],
  );
  const blankTargets = useMemo(() => batchTargets(value, scope), [value, scope]);
  // 話す順と見本は 1 本の並び。札と例を別々に作ると数も位置も合わない。
  const cells = useMemo(() => batchPlan(blankTargets), [blankTargets]);
  // まとめて話す 1 文の例。マスの名前だけでは、値として何を言えばよいか分からない。
  const exampleSentence = useMemo(() => batchExampleSentence(cells), [cells]);
  // まだ選ばれていなければ、空欄の数で既定を決める。セッションの途中で選ばれたらそれを優先する。
  const defaultMode = defaultVoiceMode(blankTargets, value);
  const batchMode = (modeChoice ?? defaultMode) === "batch";

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    touchedRef.current = touched;
  }, [touched]);

  useEffect(() => {
    includeOptionalRef.current = includeOptional;
  }, [includeOptional]);

  useEffect(() => {
    autoAdvanceRef.current = autoAdvance;
  }, [autoAdvance]);

  useEffect(() => {
    mockRef.current = mock;
  }, [mock]);

  useEffect(() => {
    batchModeRef.current = batchMode;
  }, [batchMode]);

  useEffect(() => {
    batchRef.current = batch;
  }, [batch]);

  useEffect(() => {
    completeRef.current = complete;
  }, [complete]);

  // モックの可否はサーバーの環境変数が決める。画面が勝手に決めないよう、開いたときに 1 度だけ聞く。
  // 聞けなければ false に倒れるので、実の録音のままになる。
  // 返事は控えておき、届く前に押されても録音の直前で待てるようにする。
  useEffect(() => {
    let cancelled = false;
    const answer = fetchVoiceMockEnabled();
    mockAnswerRef.current = answer;
    void answer.then((enabled) => {
      if (!cancelled) setMock(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    dialogOpenRef.current = pending !== null || branch !== null || batch !== null;
  }, [batch, branch, pending]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const scopeNow = useCallback(
    (): VoiceFieldScope => ({
      showOrganizerName,
      includeOptional: includeOptionalRef.current,
      touched: touchedRef.current,
    }),
    [showOrganizerName],
  );

  /**
   * マイクと PCM の取り込みを片付ける。音声モードを抜けるとき・画面の破棄・
   * マイク取得の失敗のときだけ呼ぶ。
   *
   * 欄を移るとき（戻る・スキップ）は呼ばない。掴み直すと、許可の待ちと立ち上がりの
   * 数十 ms が録音の頭に乗り、話し始めを落とすためである。
   */
  const releaseAudio = useCallback(() => {
    recordingRef.current = false;
    workletRef.current?.disconnect();
    workletRef.current = null;
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context) {
      // 閉じたあとの `close` は失敗する。片付けなので握りつぶす。
      void context.close().catch(() => {});
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    wavRef.current = false;
    pcmChunksRef.current = [];
    preRollRef.current = [];
  }, []);

  /** 走っている文字起こしを止め、途中経過を消す。中止は利用者向けのエラーにしない。 */
  const abortTranscription = useCallback(() => {
    interimRef.current = "";
    setInterim("");
    const controller = abortRef.current;
    if (!controller) return;
    abortRef.current = null;
    controller.abort();
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearCompleteTimer = useCallback(() => {
    if (completeTimerRef.current !== null) {
      window.clearTimeout(completeTimerRef.current);
      completeTimerRef.current = null;
    }
  }, []);

  const clearStatusTimer = useCallback(() => {
    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
  }, []);

  const clearAutoMessageTimer = useCallback(() => {
    if (autoMessageTimerRef.current !== null) {
      window.clearTimeout(autoMessageTimerRef.current);
      autoMessageTimerRef.current = null;
    }
  }, []);

  /** 自動確定の知らせを 3 秒だけ出す。次の欄の録音が始まっても消さない。 */
  const showAutoMessage = useCallback(
    (text: string) => {
      clearAutoMessageTimer();
      setMessage(text);
      autoMessageTimerRef.current = window.setTimeout(() => {
        autoMessageTimerRef.current = null;
        setMessage(null);
      }, AUTO_MESSAGE_MS);
    },
    [clearAutoMessageTimer],
  );

  const clearMockTimer = useCallback(() => {
    if (mockTimerRef.current !== null) {
      window.clearTimeout(mockTimerRef.current);
      mockTimerRef.current = null;
    }
    for (const timer of mockCellTimersRef.current) window.clearTimeout(timer);
    mockCellTimersRef.current = [];
  }, []);

  /**
   * まとめて話すときに、読めたマスを 1 つ塗る。
   *
   * 値は入れない。文字化の間に見せるのは「どこまで聞き取れたか」だけで、
   * 確定値は録音を止めたあとの確認で出す（途中の値を確定値として見せない）。
   */
  const markCellRead = useCallback((slotId: VoiceSlotId) => {
    setReadCells((current) => {
      if (current.has(slotId)) return current;
      const next = new Set(current);
      next.add(slotId);
      return next;
    });
  }, []);

  const markTouched = useCallback((key: VoiceFieldKey) => {
    const next = new Set(touchedRef.current);
    next.add(key);
    touchedRef.current = next;
    setTouched(next);
  }, []);

  /**
   * いまの録音を捨てる。戻る・スキップで欄を移るときに使う。
   *
   * `onstop` を外してから止めるので、捨てた録音が文字化へ流れることはない。
   * 音声モードは抜けない（`stopSession` はこのあとに続けて片付ける）。
   */
  const discardRecording = useCallback(() => {
    // 開始の途中で捨てたら、遅れて届くマイクの結果を捨てる（次の開始は塞がない）。
    startAttemptRef.current += 1;
    startingRef.current = false;
    clearTimer();
    clearCompleteTimer();
    clearStatusTimer();
    clearMockTimer();
    setStatusStopping(false);
    // 途中の認識も捨てる。止めたあとに古い結果が届いても、値は入れない。
    abortTranscription();
    recordingRef.current = false;
    pcmChunksRef.current = [];
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    // マイクと AudioContext は残す（次に録るときに掴み直さない）。
    setPhase("armed");
  }, [
    abortTranscription,
    clearCompleteTimer,
    clearMockTimer,
    clearStatusTimer,
    clearTimer,
  ]);

  /** 音声モードを抜ける。録音・完了の待ち・強調をすべて戻す。 */
  const stopSession = useCallback(() => {
    discardRecording();
    // 音声が開いたステップの保護を解く。次にステップが埋まったときは通常どおり畳む。
    api.releaseStep?.();
    // マイクは音声モードを抜けるまで保持した。ここが唯一の解放口になる。
    releaseAudio();
    clearAutoMessageTimer();
    // 次のセッションでは、もう一度だけ男女別を聞ける。
    genderAskedRef.current = false;
    setActive(false);
    setComplete(false);
    setMessage(null);
    setAddressNote(null);
    // 待ちの途中で抜けても印は必ず戻す。次に開いたとき、待ちの見た目のまま始めない。
    setSearching(false);
    setPending(null);
    setBranch(null);
    // 取り込まずに閉じた一覧は、迷った回として数える（発話内容と値は送らない）。
    if (batchRef.current) {
      trackEvent("voice_batch_abandoned", {
        rows: batchRef.current.rows.length,
        unassigned: batchRef.current.unassigned.length,
      });
      batchRef.current = null;
    }
    setBatch(null);
    // 話し方はセッションごとに選び直す。次は空欄の数で既定を決める。
    setModeChoice(null);
    // 塗ったマスも捨てる。次に開いたとき、前のセッションの塗りを残さない。
    setReadCells(new Set());
    cursorRef.current = null;
    setCursor(null);
    // 位置も捨てる。次に開いたとき、古い位置で 1 フレーム見せないため。
    setPanelBox(null);
  }, [api, clearAutoMessageTimer, discardRecording, releaseAudio]);

  /**
   * 入力できる欄が尽きたとき。完了の表示を `COMPLETE_HOLD_MS` だけ見せてから音声モードを抜ける。
   *
   * 必須がそろっていない（スキップで飛ばした）ときは、完了と言わずに残りを手で入れるよう案内する。
   */
  const finishSession = useCallback(() => {
    cursorRef.current = null;
    setCursor(null);
    setComplete(true);
    setPhase("armed");
    setStatusStopping(false);
    setMessage(null);
    setAddressNote(null);
    clearStatusTimer();
    clearMockTimer();
    clearAutoMessageTimer();
    const requiredComplete = firstIncompleteMandatoryStep(valueRef.current) === null;
    api.announce(
      requiredComplete
        ? "必須項目の入力がそろいました。テーマとチラシは画面から選べます。5秒後に音声入力を終了します。"
        : "音声で入力できる欄がなくなりました。必須の入力が残っています。5秒後に音声入力を終了します。",
    );
    clearCompleteTimer();
    completeTimerRef.current = window.setTimeout(() => {
      completeTimerRef.current = null;
      stopSession();
    }, COMPLETE_HOLD_MS);
  }, [api, clearAutoMessageTimer, clearCompleteTimer, clearMockTimer, clearStatusTimer, stopSession]);

  /**
   * 郵便番号が入ったら、既存の検索 API で住所を補完する。カーソルは動かさない。
   * 呼び出し元が補完後の値を見て次の欄を決める。
   *
   * 補完は補助なので失敗しても手入力に任せるが、黙って進むと住所が入ったものと
   * 思われるため、結果を返して呼び出し側に 1 行だけ知らせられるようにする。
   */
  const fillAddressFromPostalCode = useCallback(
    async (postalCode: string): Promise<"filled" | "not-found" | "failed"> => {
      try {
        const found = await lookupPostalCode(postalCode);
        const first = found[0];
        if (!first) return "not-found";
        if (!mountedRef.current) return "failed";
        const nextValue: EventFormValues = {
          ...valueRef.current,
          prefecture: first.prefecture,
          city: first.city,
          town: first.town,
        };
        valueRef.current = nextValue;
        onChange(nextValue);
        return "filled";
      } catch {
        // 住所の補完は補助。取れなくても郵便番号だけで保存できる。
        return "failed";
      }
    },
    [onChange],
  );

  /** 次の空欄へ移る。行の追加や分岐の「いいえ」からも同じ動きを使う。 */
  const advanceFrom = useCallback(
    (slot: VoiceSlot, spoken?: string) => {
      const next = nextNeededField(valueRef.current, slot.id, scopeNow());
      // 費用の入口（プラン名の直前）で男女別を尋ねる。金額を聞いたあとではなく、
      // プラン名から金額へ進む流れを作り直せるここで 1 セッション 1 回だけ聞く。
      if (
        next?.key === "planName" &&
        next.row === 0 &&
        !genderAskedRef.current &&
        shouldAskGenderBeforePricing(valueRef.current)
      ) {
        // 答えるまでカーソルは直前に埋めた欄に残す。
        cursorRef.current = slot.id;
        setCursor(slot.id);
        setMessage(null);
        genderAskedRef.current = true;
        setBranch({ kind: "gender", slotId: slot.id });
        return;
      }
      cursorRef.current = next?.id ?? null;
      setCursor(next?.id ?? null);
      if (!next) {
        finishSession();
        return;
      }
      setMessage(null);
      const said = spoken ? `${spoken}次は${next.label}です。` : `次は${next.label}です。`;
      api.announce(said);
      // 次の欄へ移ったら、その瞬間から録音を始める。もう一度押させない。
      startRecordingRef.current();
    },
    [api, finishSession, scopeNow],
  );

  const commit = useCallback(
    async (slot: VoiceSlot, text: string) => {
      const field = slot.field;
      const context = { now: new Date(), value: valueRef.current, row: slot.row };
      const patch = field.parse(text, context);
      if (!patch) {
        setMessage(
          `「${text}」は${slot.label}として読めませんでした。もう一度話すか、手で入力してください。`,
        );
        return false;
      }
      const nextValue = applyVoicePatch(valueRef.current, patch);
      valueRef.current = nextValue;
      onChange(nextValue);
      markTouched(field.key);
      // 前の欄で出した住所の知らせは、次の値が入った時点で役目を終える。
      setAddressNote(null);

      // 郵便番号は住所の補完を待ってから次の欄を決める。先に進めると、
      // 補完で埋まった都道府県・市区町村をもう一度聞いてしまう。
      if (field.key === "postalCode" && patch.postalCode) {
        setSearching(true);
        setMessage(null);
        // 画面を見ずに話している人にも、待ちの理由を音声で伝える。
        api.announce("住所を調べています。");
        try {
          const outcome = await fillAddressFromPostalCode(patch.postalCode);
          if (!mountedRef.current) return false;
          if (outcome !== "filled") {
            // このあと次の欄へ移って録音が始まり、`message` は空になる。
            // 黙って進んだように見せないよう、次の値を入れるまで別に残す。
            // 失敗すると住所は空のままで次の欄は都道府県になるため、「番地」とは書かない。
            setAddressNote("住所を調べられませんでした。手で入力してください。");
          }
        } finally {
          // 待ちの途中で音声モードを抜けていても、印は必ず戻す。
          if (mountedRef.current) setSearching(false);
        }
      }

      // 自動遷移が外れているときは同じ欄に留める。録音は止めて、言い直しを待つ。
      if (!autoAdvanceRef.current) {
        cursorRef.current = slot.id;
        setCursor(slot.id);
        setMessage(`「${text}」で入力しました。続けて直すときは「言い直す」を押してください。`);
        api.announce(`${slot.label}を「${text}」で入力しました。`);
        return true;
      }

      const next = nextNeededField(valueRef.current, slot.id, scopeNow());
      const kind = branchAfter(slot, valueRef.current, next);
      if (kind) {
        // 質問に答えるまで、カーソルは最後の欄に残す。
        cursorRef.current = slot.id;
        setCursor(slot.id);
        setMessage(null);
        api.announce(`${slot.label}を「${text}」で入力しました。`);
        setBranch({ kind, slotId: slot.id });
        return true;
      }

      advanceFrom(slot, `${slot.label}を「${text}」で入力しました。`);
      return true;
    },
    [advanceFrom, api, fillAddressFromPostalCode, markTouched, onChange, scopeNow],
  );

  /** 録音の印を止めた瞬間だけ少し縮ませる。押した手応えを残すため。 */
  const flashStopping = useCallback(() => {
    clearStatusTimer();
    setStatusStopping(true);
    statusTimerRef.current = window.setTimeout(() => {
      statusTimerRef.current = null;
      setStatusStopping(false);
    }, 200);
  }, [clearStatusTimer]);

  /**
   * 聞き取った文字を、確認するか、そのまま入れるかへ振り分ける。
   *
   * 形が閉じている欄（`confirm: "auto"`）は、`parse` が通った時点で入れる。
   * 読めなかったときは自動にせず、生の文字を入れた確認を出す（直してから確定できる）。
   */
  const presentTranscript = useCallback(
    (target: VoiceSlot, text: string) => {
      const context = { now: new Date(), value: valueRef.current, row: target.row };
      const patch = target.field.parse(text, context);
      if (shouldAutoConfirm(target.field, patch)) {
        void commit(target, text).then((ok) => {
          if (!ok || !mountedRef.current) return;
          showAutoMessage(`${target.label}を「${text}」で入力しました`);
        });
        return;
      }
      setPending({ slotId: target.id, text, draft: text });
    },
    [commit, showAutoMessage],
  );

  /** まとめて話すの割当を、確認の 1 枚に並べる。当たらなかった節も 1 行で残す。 */
  const presentBatch = useCallback(
    (result: {
      assignments: readonly { slotId: VoiceSlotId; text: string }[];
      unassigned: readonly string[];
    }) => {
      const rows: VoiceBatchRow[] = [];
      for (const item of result.assignments) {
        const target = voiceSlotById(item.slotId, valueRef.current, scopeNow());
        if (!target) continue;
        rows.push({ slotId: target.id, label: target.label, text: item.text, include: true });
      }
      if (rows.length === 0) {
        setMessage("読み取れた欄がありませんでした。もう一度話すか、手で入力してください。");
        return;
      }
      // 空欄だったのに割当が付かなかった欄を、確認の先頭で名指しする。
      // 話した言葉（未割当の節）は並べない。同じ失敗を「言葉」と「欄の名前」の
      // 2 行で言うことになり、どちらが欄の名前か分からなくなるため。
      // 未割当の数は計測（`voice_batch_applied`）にだけ残す。
      const assigned = new Set(result.assignments.map((item) => item.slotId));
      const missed = batchTargets(valueRef.current, scopeNow())
        .filter((target) => !assigned.has(target.id))
        .map((target) => target.label);
      setMessage(null);
      setBatch({ rows, unassigned: [...result.unassigned], missed });
    },
    [scopeNow],
  );

  /** 録音を送って文字にする。PCM の WAV と MediaRecorder の両方がここへ来る。 */
  const sendRecording = useCallback(
    async (blob: Blob) => {
      recorderRef.current = null;
      if (!mountedRef.current) return;
      if (blob.size === 0) {
        setPhase("armed");
        setMessage("録音が空でした。マイクに向かって話してから、もう一度お試しください。");
        return;
      }

      const key = cursorRef.current;
      const slot = key ? voiceSlotById(key, valueRef.current, scopeNow()) : null;
      if (!slot && !batchModeRef.current) {
        setPhase("armed");
        finishSession();
        return;
      }

      // 途中経過はこの録音のものだけ。新しい録音・戻る・終了で止める。
      const controller = new AbortController();
      abortRef.current = controller;
      interimRef.current = "";
      setInterim("");

      try {
        if (batchModeRef.current) {
          // まとめて話す: 1 回の録音をそのまま送り、欄ごとの割当を受ける。
          // 録音を止めたあと、聞き取れた節ごとに `cell` が届くので、マスだけを先に塗る。
          const result = await transcribeVoiceUtterance({
            blob,
            value: valueRef.current,
            scope: scopeNow(),
            onCell: (slotId) => {
              if (!mountedRef.current) return;
              markCellRead(slotId);
            },
            signal: controller.signal,
          });
          if (!mountedRef.current || controller.signal.aborted) return;
          setPhase("armed");
          presentBatch(result);
          return;
        }
        if (!slot) {
          setPhase("armed");
          finishSession();
          return;
        }
        // 行と入力済みの催し名・会場名を、当て字の手掛かりとして添える。
        // 欄そのものの現在値は送らない（そのまま復唱され、言い直しが効かなくなる）。
        const result = await transcribeVoiceClip({
          blob,
          field: slot.key,
          context: {
            row: slot.row,
            title: valueRef.current.title,
            venueName: valueRef.current.venueName,
          },
          // 増分を足して 1 行にする。質問は消さず、その下に出す。
          onDelta: (text) => {
            if (!mountedRef.current) return;
            interimRef.current += text;
            setInterim(interimRef.current);
          },
          signal: controller.signal,
        });
        if (!mountedRef.current || controller.signal.aborted) return;
        setPhase("armed");
        presentTranscript(slot, result.text);
      } catch (error) {
        // 戻る・スキップ・終了で止めたときは、利用者が自分でやめた操作なので知らせない。
        if (isAbortError(error) || controller.signal.aborted) return;
        if (!mountedRef.current) return;
        setPhase("armed");
        setMessage(
          error instanceof Error
            ? error.message
            : "音声を文字にできませんでした。手で入力してください。",
        );
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        interimRef.current = "";
        if (mountedRef.current) setInterim("");
      }
    },
    [finishSession, markCellRead, presentBatch, presentTranscript, scopeNow],
  );

  /** MediaRecorder 経路（webm/opus）の録音を送る。`onstop` から呼ぶ。 */
  const finishRecording = useCallback(
    async (mimeType: string) => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      await sendRecording(blob);
    },
    [sendRecording],
  );

  /** PCM 経路の録音を、16kHz mono の WAV にして送る。 */
  const finishWavRecording = useCallback(async () => {
    recordingRef.current = false;
    setPhase("transcribing");
    flashStopping();

    const chunks = pcmChunksRef.current;
    pcmChunksRef.current = [];
    const rate = audioContextRef.current?.sampleRate ?? PCM_SAMPLE_RATE;
    // pre-roll: 録音の印が出る直前に溜めた直近 400ms を先頭へ足す。
    // 押してから話し始めるまでの間隔を捨てず、話し始めの子音を落とさない。
    const pre = tailSamples(preRollRef.current, Math.ceil((rate * PRE_ROLL_MS) / 1000));
    const samples = concatSamples([pre, ...chunks]);
    if (samples.length === 0) {
      setPhase("armed");
      setMessage("録音が空でした。マイクに向かって話してから、もう一度お試しください。");
      return;
    }
    // 端末が 16kHz を返せないことがある（48kHz のまま等）。送る前に必ず 16kHz へ落とす。
    const pcm = rate === PCM_SAMPLE_RATE ? samples : resampleLinear(samples, rate, PCM_SAMPLE_RATE);
    const wav = encodeWav(pcm, PCM_SAMPLE_RATE);
    // TypeScript の `Uint8Array<ArrayBufferLike>` は BlobPart に直接渡せない。
    // 符号化結果は専用の ArrayBuffer を持つので、その範囲だけを切り出して渡す。
    const wavBuffer = wav.buffer.slice(
      wav.byteOffset,
      wav.byteOffset + wav.byteLength,
    ) as ArrayBuffer;
    await sendRecording(new Blob([wavBuffer], { type: "audio/wav" }));
  }, [flashStopping, sendRecording]);

  /**
   * モックの「まとめて話す」の 1 文。巡回する欄の入力例を `、` でつなぐ。
   *
   * サーバーの `mockBatchTranscript` と同じ作りにしてある。画面から外部へは送らず、
   * 端末の中だけで割り当てる（マイクも外部も使わない方針）。
   */
  const mockBatchText = useCallback((): string => {
    const seen = new Set<string>();
    const examples: string[] = [];
    for (const target of batchTargets(valueRef.current, scopeNow())) {
      const example = target.field.example;
      if (seen.has(example)) continue;
      seen.add(example);
      examples.push(example);
    }
    return examples.join("、");
  }, [scopeNow]);

  /**
   * モックの疑似録音を止め、入力例を実の経路と同じ振り分けへ渡す（ローカル専用）。
   *
   * マイクを使わないので、デバイスの無い PC でも「録音中 → 確認 → 次の欄」を
   * 最後まで追える。入れる文は認識結果と同じ扱い（`slot.field.example`）にして、
   * 自動確定する欄・確認を挟む欄の分かれ方も実の経路と変えない。
   */
  const applyMockRecording = useCallback(() => {
    clearTimer();
    clearMockTimer();
    const key = cursorRef.current;
    if (!key) {
      finishSession();
      return;
    }
    setPhase("transcribing");
    flashStopping();
    // 疑似でもマスを 1 つずつ塗る。実の経路（`cell`）と同じ順に見せるため、
    // 文字化の待ちをマスの数で割って、見えている順に塗る。
    const cellsToRead: VoiceSlotId[] = batchModeRef.current
      ? batchPlan(batchTargets(valueRef.current, scopeNow())).map((cell) => cell.id)
      : [];
    cellsToRead.forEach((slotId, index) => {
      const timer = window.setTimeout(
        () => markCellRead(slotId),
        Math.round((MOCK_TRANSCRIBE_MS * (index + 1)) / (cellsToRead.length + 1)),
      );
      mockCellTimersRef.current.push(timer);
    });
    mockTimerRef.current = window.setTimeout(() => {
      mockTimerRef.current = null;
      const slot = voiceSlotById(key, valueRef.current, scopeNow());
      if (!slot && !batchModeRef.current) {
        setPhase("armed");
        finishSession();
        return;
      }
      // 実の経路と同じく、値を入れる前に録音の印を戻す。
      setPhase("armed");
      if (batchModeRef.current) {
        const result = assignUtterance({
          text: mockBatchText(),
          value: valueRef.current,
          now: new Date(),
          scope: scopeNow(),
          targets: batchTargets(valueRef.current, scopeNow()),
        });
        presentBatch(result);
        return;
      }
      if (!slot) {
        finishSession();
        return;
      }
      presentTranscript(slot, slot.field.example);
    }, MOCK_TRANSCRIBE_MS);
  }, [
    clearMockTimer,
    clearTimer,
    finishSession,
    flashStopping,
    markCellRead,
    mockBatchText,
    presentBatch,
    presentTranscript,
    scopeNow,
  ]);

  /**
   * 録音の入り口を用意する。音声モードのあいだは掴んだままにする。
   *
   * 16kHz の PCM を AudioWorklet で拾えるなら WAV で送る。拾えない端末は
   * 従来どおり MediaRecorder（webm/opus）に落とす。どちらの経路でも、停止時に
   * pre-roll 400ms を足すため、マイクは最初の録音で 1 度だけ開く。
   */
  const ensureAudioPipeline = useCallback(async (): Promise<"wav" | "media"> => {
    if (streamRef.current) return wavRef.current ? "wav" : "media";

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        // 通話向けの打ち消しは、短い数字・固有名詞を削ることがある。ASR 向けに切る。
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;

    const AudioContextClass = audioContextConstructor();
    if (!isPcmCaptureSupported() || !AudioContextClass) {
      wavRef.current = false;
      return "media";
    }

    let context: AudioContext | null = null;
    try {
      context = new AudioContextClass({ sampleRate: PCM_SAMPLE_RATE });
      const audioContext = context;
      await audioContext.audioWorklet.addModule("/voice/pcm-worklet.js");
      const source = audioContext.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(audioContext, "pcm-capture");
      // 音を鳴らさずに処理を回す。`destination` へ繋がないと worklet が動かない端末がある。
      const mute = audioContext.createGain();
      mute.gain.value = 0;
      source.connect(node).connect(mute).connect(audioContext.destination);

      // pre-roll: 録音の印（`listening`）が出る前から溜めつづけ、停止時に直近 400ms を足す。
      // 録音中は pre-roll を更新しない（録音した区間と二重に重ならないようにする）。
      const bufferRate = audioContext.sampleRate;
      node.port.onmessage = (event: MessageEvent) => {
        const data = event.data;
        if (!(data instanceof Float32Array)) return;
        if (recordingRef.current) {
          pcmChunksRef.current.push(data);
          return;
        }
        preRollRef.current.push(data);
        const limit = Math.ceil((bufferRate * PRE_ROLL_MS) / 1000);
        let total = 0;
        for (const part of preRollRef.current) total += part.length;
        while (total > limit && preRollRef.current.length > 0) {
          const first = preRollRef.current[0];
          const excess = total - limit;
          if (first.length <= excess) {
            preRollRef.current.shift();
            total -= first.length;
          } else {
            preRollRef.current[0] = first.subarray(excess);
            total -= excess;
          }
        }
      };

      audioContextRef.current = audioContext;
      workletRef.current = node;
      sourceNodeRef.current = source;
      wavRef.current = true;
      return "wav";
    } catch {
      // worklet を読み込めない環境は webm に落とす。開いた AudioContext はその場で閉じる。
      if (context) void context.close().catch(() => {});
      wavRef.current = false;
      return "media";
    }
  }, []);

  const stopRecording = useCallback(() => {
    clearTimer();
    // モックは録音していないので、押されたら即座に文字化へ移る。
    if (mockTimerRef.current !== null) {
      applyMockRecording();
      return;
    }
    if (wavRef.current) {
      void finishWavRecording();
      return;
    }
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setPhase("transcribing");
    flashStopping();
    recorder.stop();
  }, [applyMockRecording, clearTimer, finishWavRecording, flashStopping]);

  const startRecording = useCallback(async (options?: { keepMessage?: boolean }) => {
    // 入力完了の待ちに入っていたら、もう録音しない。
    if (completeTimerRef.current !== null) return;
    // 開始の途中なら重ねない。マイクの許可待ちのあいだに押されても、掴むのは 1 本だけにする。
    if (startingRef.current) return;
    // すでに録音しているなら始めない。始め直すときは、いったん止める。
    if (mockTimerRef.current !== null) return;
    const current = recorderRef.current;
    if (current && current.state !== "inactive") return;
    if (recordingRef.current) return;
    // 新しく録るなら、前の発話の途中経過と、走っている認識は捨てる。
    abortTranscription();
    if (!cursorRef.current) {
      finishSession();
      return;
    }
    const attempt = startAttemptRef.current + 1;
    startAttemptRef.current = attempt;
    startingRef.current = true;
    try {
      // モックかどうかは、まだ返事が届いていなければここで待つ（待っても数ミリ秒）。
      const mockEnabled = mockRef.current || (await mockAnswerRef.current) === true;
      // 待っている間に音声モードを抜けていたら、始めない。
      if (attempt !== startAttemptRef.current) return;
      if (mockEnabled) {
        // モックはマイクを掴まない。開いた瞬間から「録音中」にして、少し待ってから入力例を入れる。
        // 直前に出した案内（まとめてのあとの「1つずつ話します」）は、消さずに読み終えさせる。
        if (!options?.keepMessage) setMessage(null);
        clearStatusTimer();
        setStatusStopping(false);
        setPhase("listening");
        clearMockTimer();
        mockTimerRef.current = window.setTimeout(applyMockRecording, MOCK_RECORDING_MS);
        return;
      }
      if (!isRecordingSupported()) {
        setMessage("このブラウザは録音に対応していません。手で入力してください。");
        return;
      }
      // 自動確定の知らせは、次の録音が始まっても読み終えるまで残す。
      if (!options?.keepMessage && autoMessageTimerRef.current === null) setMessage(null);
      clearStatusTimer();
      setStatusStopping(false);
      try {
        const mode = await ensureAudioPipeline();
        // 待っている間に抜けた・別の開始に追い越されたなら、掴んだマイクをその場で離す。
        if (!mountedRef.current || attempt !== startAttemptRef.current) {
          releaseAudio();
          return;
        }
        if (mode === "wav") {
          pcmChunksRef.current = [];
          recordingRef.current = true;
          setPhase("listening");
          timerRef.current = window.setTimeout(() => stopRecording(), MAX_RECORDING_MS);
          return;
        }

        const stream = streamRef.current;
        if (!stream) throw new Error("no microphone");
        const mimeType = pickRecorderMimeType() ?? "";
        const options: MediaRecorderOptions = { audioBitsPerSecond: 128_000 };
        if (mimeType) options.mimeType = mimeType;
        const recorder = new MediaRecorder(stream, options);
        chunksRef.current = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data);
        };
        recorder.onstop = () => {
          const type = recorder.mimeType || mimeType || "audio/webm";
          void finishRecording(type);
        };
        recorderRef.current = recorder;
        recorder.start();
        setPhase("listening");
        timerRef.current = window.setTimeout(() => stopRecording(), MAX_RECORDING_MS);
      } catch {
        // 追い越された・抜けたあとの失敗は、いまの開始に触れない（新しい録音のマイクを離さない）。
        if (attempt !== startAttemptRef.current) return;
        releaseAudio();
        if (!mountedRef.current) return;
        setPhase("armed");
        setMessage(
          "マイクを使えませんでした。ブラウザの設定でマイクを許可するか、手で入力してください。",
        );
      }
    } finally {
      // 追い越されていたら、新しい開始の印は消さない。
      if (attempt === startAttemptRef.current) startingRef.current = false;
    }
  }, [
    abortTranscription,
    applyMockRecording,
    clearMockTimer,
    clearStatusTimer,
    ensureAudioPipeline,
    finishRecording,
    finishSession,
    releaseAudio,
    stopRecording,
  ]);

  useEffect(() => {
    startRecordingRef.current = () => {
      void startRecording();
    };
  }, [startRecording]);

  // 音声を押す前に選んでいた欄を覚える。音声モード中は DOM フォーカスを動かさないので、
  // ここで控えた最後の欄が、そのまま「どこから始めるか」になる。
  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event.target as HTMLElement | null)?.id;
      if (!id) return;
      const field = fieldForDomId(id, valueRef.current, scopeNow());
      if (field) lastFocusedIdRef.current = id;
    };
    document.addEventListener("focusin", handler);
    return () => document.removeEventListener("focusin", handler);
  }, [scopeNow]);

  useEffect(() => () => {
    clearTimer();
    clearCompleteTimer();
    clearStatusTimer();
    clearMockTimer();
    clearAutoMessageTimer();
    // 画面が消えるので、途中の認識は知らせずに止める（状態は更新しない）。
    const controller = abortRef.current;
    abortRef.current = null;
    controller?.abort();
    interimRef.current = "";
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    releaseAudio();
  }, [
    clearAutoMessageTimer,
    clearCompleteTimer,
    clearMockTimer,
    clearStatusTimer,
    clearTimer,
    releaseAudio,
  ]);

  const startSession = useCallback((mode?: VoiceMode) => {
    if (disabled) return;
    // まとめて話すときは、任意の欄を既定で外す。話す量が増えるほど、途中で
    // 言い直す手間も増えるため。どの欄を話すかは、その値で決まる。
    const requiredScope: VoiceFieldScope = {
      showOrganizerName,
      includeOptional: false,
      touched: new Set<VoiceFieldKey>(),
    };
    // 話し方は、初回ガイドで選ばれたもの → 必須の空欄の数から決めた既定、の順に使う。
    // まとめては任意の欄を外すので、任意を数えて「まとめて」にすると、話す欄が
    // 2 つしかないのに 1 回で聞くことになる。必須だけで数える。
    const chosen =
      mode ??
      defaultVoiceMode(
        batchTargets(valueRef.current, requiredScope),
        valueRef.current,
      );
    const wantOptional = chosen !== "batch";
    includeOptionalRef.current = wantOptional;
    setIncludeOptional(wantOptional);
    const sessionScope: VoiceFieldScope = {
      ...requiredScope,
      includeOptional: wantOptional,
    };
    // 直前に選んでいた欄があればそこから。無ければ最初の空欄から。
    const first = startFieldFor(valueRef.current, sessionScope, lastFocusedIdRef.current);
    setModeChoice(chosen);
    batchModeRef.current = chosen === "batch";
    touchedRef.current = new Set();
    setTouched(new Set());
    // 男女別はセッションごとに 1 回だけ聞く。前のセッションの返事を引き継がない。
    genderAskedRef.current = false;
    // 位置はセッションの開始で捨てる。前のセッションの位置を引き継ぐと、
    // まだ測れていない 1 フレームだけ古い場所に出てしまう。
    setPanelBox(null);
    setActive(true);
    setPhase("armed");
    setComplete(false);
    // 前のセッションの住所の知らせと待ちの印は引き継がない。
    setAddressNote(null);
    setSearching(false);
    // 前のセッションの確認・途中経過・知らせも残さない。
    batchRef.current = null;
    setBatch(null);
    setReadCells(new Set());
    setInterim("");
    interimRef.current = "";
    clearAutoMessageTimer();
    clearCompleteTimer();
    clearStatusTimer();
    setStatusStopping(false);
    cursorRef.current = first?.id ?? null;
    setCursor(first?.id ?? null);
    setMessage(
      first
        ? null
        : "空欄がありません。手で直したい欄を押すと、その欄を音声で入れ直せます。",
    );
    if (first) {
      api.announce(`音声入力を始めます。${first.prompt}`);
      // 音声モードに入ったら、そのまま録音を始める。もう一度押させない。
      void startRecording();
    }
    api.openStep(first?.step ?? "basic");
    // 入口を数える。どちらの話し方で入ったかだけを送り、発話内容は送らない。
    trackEvent("voice_start", { mode: chosen });
  }, [
    api,
    clearAutoMessageTimer,
    clearCompleteTimer,
    clearStatusTimer,
    disabled,
    showOrganizerName,
    startRecording,
  ]);

  // 強調する欄を画面の上寄り（35%）へ寄せる。DOM フォーカスは動かさない。
  // 画面全体の中央へ寄せる `scrollIntoView` は使わない。パネルは欄のすぐ下に置くため、
  // 中央に寄せると下にパネルと固定の帯の居場所が残らない。
  useEffect(() => {
    // まとめて話すときは 1 つの欄を強調しない。話す順はパネルに出す。
    if (!active || batchMode) return;
    const slot = cursor ? voiceSlotById(cursor, valueRef.current, scopeNow()) : null;
    if (!slot) return;
    api.openStep(slot.step);
    const id = slot.domId(valueRef.current);
    if (!id) return;

    let cancelled = false;
    let element: HTMLElement | null = null;
    let tries = 0;

    const apply = () => {
      if (cancelled) return;
      const found = document.getElementById(id);
      if (!found) {
        if (tries < 20) {
          tries += 1;
          window.setTimeout(apply, 50);
        }
        return;
      }
      element = found;
      found.setAttribute("data-voice-target", "true");
      const reduced =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // 欄の中心をビューポートの上寄り（35%）へ置き、下にパネルの居場所を残す。
      // 基準は欄の矩形だけで決める。パネルの上端を基準にすると、パネルが欄の下へ
      // 動くぶんだけ基準も動き、測り直すたびに位置が発振する。
      const rect = found.getBoundingClientRect();
      const delta = fieldScrollDelta(rect, window.innerHeight);
      if (Math.abs(delta) > 1) {
        window.scrollBy({ top: delta, behavior: reduced ? "auto" : "smooth" });
      }
    };
    apply();

    return () => {
      cancelled = true;
      element?.removeAttribute("data-voice-target");
    };
  }, [active, api, batchMode, cursor, scopeNow]);

  // 音声モードの間、いま聞いている欄だけを残して画面全体を覆う。
  // 覆いはそのまま操作を止めるので、スクロールやステップの開閉に合わせて穴を追いかける。
  // 追いかけは毎フレームではなく、位置が動く合図（スクロール・リサイズ・DOM の変化）でだけ測り直す。
  // 穴の高さは固定し（spotlightFor）、スクロールで欄の中央を穴の中央へ寄せる。幅だけ欄に合わせる。
  useEffect(() => {
    if (!active) {
      setSpotlight(null);
      setPanelBox(null);
      return;
    }
    // まとめて話すときは 1 つの欄をくり抜かない。覆いを出すと全体が押せなくなり、
    // 複数のステップを見ながら話せないためである。
    if (batchMode) {
      setSpotlight(null);
      return;
    }

    let frame = 0;
    let retries = 0;
    let previous = "";
    // 監視している要素。測る相手ではなく、ResizeObserver の付け替えを見るためだけに持つ。
    let observed: HTMLElement | null = null;
    let cancelled = false;

    /**
     * いま強調している欄を測り直す。
     *
     * 対象は毎回 DOM から引き直す。控えた要素を使い回すと、ステップを開き直して
     * ノードが差し替わったときに、切り離された要素（矩形がすべて 0）を測り続ける。
     */
    const measure = () => {
      if (cancelled) return;
      const target = document.querySelector<HTMLElement>('[data-voice-target="true"]');
      if (!target) {
        // ステップを開いた直後は、まだ欄が描画されていないことがある。少しだけ待つ。
        if (retries < 40) {
          retries += 1;
          frame = window.requestAnimationFrame(retry);
        } else if (completeRef.current) {
          if (observed) resizeObserver?.unobserve(observed);
          observed = null;
          previous = "";
          // 覆いを消すのは、入力できる欄が尽きて完了の表示を出したときだけ。
          // それ以外で欄が見つからないとき（音声が開いたステップの欄が DOM から
          // 一時的に消えたとき）は最後の穴を残す。消すと、パネルだけが操作できない
          // 画面の上に浮いたままになる。
          setSpotlight(null);
        }
        return;
      }
      // 見つかったら待ち直しの残りを戻す。次に欄が消えたときも同じだけ待てる。
      retries = 0;
      if (observed !== target) {
        if (observed) resizeObserver?.unobserve(observed);
        observed = target;
        resizeObserver?.observe(target);
      }
      const rect = target.getBoundingClientRect();
      // パネルは欄のすぐ下へ置く。右下の FAB と重ねないよう、FAB の左端で幅を止める。
      const fabLeft = fabRef.current?.getBoundingClientRect().left;
      const box = panelBoxFor(rect, fabLeft);
      setPanelBox((current) =>
        current &&
        current.top === box.top &&
        current.left === box.left &&
        current.width === box.width
          ? current
          : box,
      );
      // 高さは固定。欄の中央がビューポートの中央に来るよう穴を置く（画面端ではクランプ）。
      // パネルは欄の下に出るので、穴の下端をパネルで止める必要はない。
      const next = spotlightFor(rect, window.innerHeight);
      const key = `${next.top}:${next.left}:${next.width}:${next.height}`;
      if (key !== previous) {
        previous = key;
        setSpotlight(next);
      }
    };

    /**
     * 待ち直しの 1 フレーム。
     *
     * `frame` を 0 に戻してから測る。戻さないと「実行済みの rAF の ID」が残り、
     * `schedule` の入口で弾かれ続けて、スクロールしても穴が動かなくなる。
     */
    function retry() {
      frame = 0;
      measure();
    }

    /** 1 フレームに 1 回だけ測る。スクロール中に何度も呼ばれてもまとめる。 */
    const schedule = () => {
      if (cancelled || frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    const resizeObserver =
      typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    // 強調する欄が差し替わったことも、位置が動く合図として拾う。
    const mutationObserver =
      typeof MutationObserver === "function" ? new MutationObserver(schedule) : null;

    measure();
    resizeObserver?.observe(document.body);
    // パネルの置き場所は欄と FAB の位置だけで決まる。FAB は画面下の帯の高さで
    // 上へずれる（body の大きさは変わらない）ので、FAB 自身の変化も拾う。
    if (fabRef.current) resizeObserver?.observe(fabRef.current);
    mutationObserver?.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-voice-target"],
      subtree: true,
    });
    // 入れ子のスクロール領域も拾うため capture で待つ。
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    // 滑らかなスクロールの止まった位置でもう一度測る。最後の scroll が
    // 1px 手前で coalesce されても、穴が欄の中央に残るようにする。
    window.addEventListener("scrollend", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);

    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("scrollend", schedule, true);
      window.removeEventListener("resize", schedule);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      // 測り直しの後片付けでは位置を捨てない。捨てると、カーソルが変わって
      // effect を張り直した 1 フレームのあいだ `is-placing` でパネルが消える。
      setSpotlight(null);
    };
  }, [active, batchMode, cursor]);

  // 手で入力欄を押したら、その欄を言い直す対象にする。
  useEffect(() => {
    if (!active) return;
    const handler = (event: Event) => {
      // ダイアログを閉じると、開く前に触っていた欄へ焦点が戻る。その focusin で
      // カーソルを戻さない（答えた直後に進んだ先を打ち消してしまう）。
      if (dialogOpenRef.current) return;
      const target = event.target as HTMLElement | null;
      const id = target?.id;
      if (!id) return;
      const slot = fieldForDomId(id, valueRef.current, scopeNow());
      if (!slot || slot.id === cursorRef.current) return;
      cursorRef.current = slot.id;
      setCursor(slot.id);
      setMessage(null);
    };
    document.addEventListener("focusin", handler);
    return () => document.removeEventListener("focusin", handler);
  }, [active, scopeNow]);

  // Esc でいつでも抜けられる。確認・分岐のダイアログが開いているあいだは、
  // ダイアログ自身が Esc を受けるので、こちらは止める（1 回で両方が閉じないように）。
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || dialogOpenRef.current) return;
      event.stopPropagation();
      stopSession();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [active, stopSession]);

  const slot = cursor ? voiceSlotById(cursor, value, scope) : null;
  const field = slot?.field ?? null;
  const previous = slot ? previousField(value, slot.id, scope) : null;
  const currentValue = slot ? describeFieldValue(slot.field, value, slot.row) : null;
  // 確認のあいだも欄の名前を出せるよう、id から引き直す（行が消えていれば null）。
  const pendingTarget = pending ? voiceSlotById(pending.slotId, value, scope) : null;
  const pendingLong = pendingTarget ? isLongVoiceField(pendingTarget.field.key) : false;
  const listening = phase === "listening";
  const transcribing = phase === "transcribing";
  // まとめて話すときの 30px の行は固定の指示にする。1 つの欄の話ではないので、
  // 質問（「イベント名は？」）を進めると、いま何を話すのかが 1 行ごとに変わってしまう。
  // 進み具合はマスの塗りだけで示し、値の形は主ボタンの上の 1 文の例で見せる。
  const completion = completionCopy(firstIncompleteMandatoryStep(value) === null);
  const promptText = complete
    ? completion.prompt
    : searching
      ? "住所を調べています"
      : batchMode
        ? BATCH_PROMPT
        : transcribing
          ? "テキスト変換中"
          : (slot?.prompt ?? "入力できる欄がすべて埋まりました。内容を確認してください。");
  const showStatus = listening || statusStopping;
  // パネルに出す 1 行。住所の補完の失敗は、値が入った知らせより先に伝える
  // （補完できていないのに「入りました」だけを見せない）。住所の知らせは次の値で消える。
  const notice = addressNote ?? message;
  const talkLabel = listening
    ? "録音を停止"
    : batchMode
      ? "まとめて話す"
      : currentValue
        ? "言い直す"
        : "話す";
  // 待ちのあいだは主ボタンを置かない（押しても始められない的を残さない）。
  const showTalk = !transcribing && !searching;

  // パネルの位置は測った値で決める。隠すのは「まだ一度も測れていない」1 フレームだけ
  // （音声モードに入った直後）。まとめて話すときは画面下寄りに固定するので使わない。
  const panelStyle =
    panelBox && !batchMode
      ? ({
          "--voice-panel-top": `${panelBox.top}px`,
          "--voice-panel-left": `${panelBox.left}px`,
          "--voice-panel-width": `${panelBox.width}px`,
        } as CSSProperties)
      : undefined;

  // 指示は 1 行に収める。収まる中でいちばん大きい字を選び、短い文ほど大きく見せる。
  // 幅は CSS で 1 行に固定してあるので、はみ出すかどうかだけで判定できる。
  const fitPrompt = useCallback(() => {
    const element = promptRef.current;
    if (!element) return;
    // 変換中と住所検索中は短い待ちの合図なので、質問と同じ大きさにしない。
    let size = transcribing || searching ? 16 : 36;
    element.style.fontSize = `${size}px`;
    while (size > 15 && element.scrollWidth > element.clientWidth + 1) {
      size -= 1;
      element.style.fontSize = `${size}px`;
    }
  }, [searching, transcribing]);

  useEffect(() => {
    if (!active) return;
    let frame = window.requestAnimationFrame(fitPrompt);
    const onResize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(fitPrompt);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, [active, currentValue, fitPrompt, panelBox?.width, promptText]);

  const goPrevious = () => {
    if (!previous) return;
    // 録音中なら、いまの録音は捨てる。戻った欄でそのまま録り直す。
    if (listening) discardRecording();
    // 走っている認識も止める（戻った先の欄に、前の欄の結果が入らないようにする）。
    abortTranscription();
    clearAutoMessageTimer();
    cursorRef.current = previous.id;
    setCursor(previous.id);
    setMessage(null);
    api.announce(`${previous.label}に戻りました。${previous.prompt}`);
    startRecordingRef.current();
  };

  /**
   * いまの欄を飛ばす。次の欄へ移り、その場で録音を始める。
   *
   * 録音中なら、いまの録音は捨てる（飛ばした欄の音声は使わない）。
   * 費用の入口へ入るときの男女別の質問は、`advanceFrom` が見る。
   */
  const skip = () => {
    if (!cursor) return;
    if (listening) discardRecording();
    abortTranscription();
    clearAutoMessageTimer();
    const current = voiceSlotById(cursor, valueRef.current, scopeNow());
    if (!current) {
      cursorRef.current = null;
      setCursor(null);
      finishSession();
      return;
    }
    const next = nextNeededField(valueRef.current, current.id, scopeNow());
    const kind = branchAfter(current, valueRef.current, next);
    if (kind) {
      cursorRef.current = current.id;
      setCursor(current.id);
      setMessage(null);
      setBranch({ kind, slotId: current.id });
      return;
    }
    advanceFrom(current);
  };

  /** 覆いは操作を止めるだけなので、押されたら抜け方を伝える。 */
  const explainScrim = () => {
    setMessage(
      "音声モード中は、いま聞いている欄のまわりだけ操作できます。右上の×か Esc で元に戻ります。",
    );
    api.announce("音声モード中です。終了するには、右上の閉じるボタンかエスケープキーを押してください。");
  };

  /** 確認で編集している文字を差し替える。確定はこの文字で `parse` する。 */
  const updatePendingDraft = useCallback((draft: string) => {
    setPending((current) => (current ? { ...current, draft } : current));
  }, []);

  /** 確認のモーダルを閉じる。カーソルは動かさず、同じ欄に留まる。 */
  const closePending = useCallback(() => {
    setPending(null);
  }, []);

  /** 編集後の文字で確定する。読めなければ閉じてから既存の「読めませんでした」を出す。 */
  const confirmPending = useCallback(() => {
    const item = pending;
    if (!item) return;
    const text = item.draft.trim();
    // 空にしたまま確定させない（消したいときは閉じるか、再録音する）。
    if (!text) return;
    setPending(null);
    const target = voiceSlotById(item.slotId, valueRef.current, scopeNow());
    if (!target) {
      finishSession();
      return;
    }
    cursorRef.current = target.id;
    setCursor(target.id);
    void commit(target, text);
  }, [commit, finishSession, pending, scopeNow]);

  /** 同じ欄で録り直す。モーダルを閉じて、そのまま録音を始める。 */
  const reRecordPending = useCallback(() => {
    const item = pending;
    if (!item) return;
    setPending(null);
    cursorRef.current = item.slotId;
    setCursor(item.slotId);
    setMessage(null);
    void startRecording();
  }, [pending, startRecording]);

  /** まとめて話した内容の確認を閉じる。カーソルは動かさず、同じ欄に留まる。 */
  const closeBatch = useCallback(() => {
    if (batch) {
      trackEvent("voice_batch_abandoned", {
        rows: batch.rows.length,
        unassigned: batch.unassigned.length,
      });
    }
    setBatch(null);
  }, [batch]);

  /** 確認の 1 行（値・取り込むか）を差し替える。 */
  const updateBatchRow = useCallback(
    (slotId: VoiceSlotId, patch: Partial<Omit<VoiceBatchRow, "slotId">>) => {
      setBatch((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((row) =>
                row.slotId === slotId ? { ...row, ...patch } : row,
              ),
            }
          : current,
      );
    },
    [],
  );

  /**
   * チェックの入った行だけを、1 回の `onChange` にまとめて反映する。
   *
   * 編集された行は、いまの文字で `parse` し直す。読めない行は入れない（黙って別の値を入れない）。
   * 郵便番号を入れたときは、1 欄ずつ入れたときと同じく住所を補ってから、まとめて反映する。
   * 反映したら最初の未入力欄へ移り、その場で録音を始める。
   */
  const applyBatch = useCallback(async () => {
    const state = batch;
    if (!state) return;
    const base = valueRef.current;
    const now = new Date();
    const patches: VoicePatch[] = [];
    const keys = new Set<VoiceFieldKey>();

    for (const row of state.rows) {
      if (!row.include) continue;
      const text = row.text.trim();
      if (!text) continue;
      const target = voiceSlotById(row.slotId, base, scopeNow());
      if (!target) continue;
      const patch = target.field.parse(text, { now, value: base, row: target.row });
      if (!patch) continue;
      patches.push(patch);
      keys.add(target.key);
    }

    if (patches.length === 0) {
      setMessage("入力できる行がありませんでした。値を見直してください。");
      return;
    }

    // 確認は閉じ、住所の補完だけを待つ（次の録音はまだ始めない）。
    setBatch(null);
    setMessage(null);

    let nextValue = applyVoicePatches(base, patches);
    const postal = patches.find((patch) => patch.postalCode)?.postalCode;
    if (postal) {
      setSearching(true);
      try {
        const found = await lookupPostalCode(postal);
        const first = found[0];
        if (first) {
          nextValue = {
            ...nextValue,
            prefecture: first.prefecture,
            city: first.city,
            town: first.town,
          };
        } else {
          setAddressNote("住所を調べられませんでした。手で入力してください。");
        }
      } catch {
        setAddressNote("住所を調べられませんでした。手で入力してください。");
      } finally {
        if (mountedRef.current) setSearching(false);
      }
      if (!mountedRef.current) return;
    }

    valueRef.current = nextValue;
    onChange(nextValue);
    for (const key of keys) markTouched(key);
    // 取り込んだ行数と、読み取れなかった節の数だけを送る。値と発話内容は送らない。
    trackEvent("voice_batch_applied", {
      rows: patches.length,
      unassigned: state.unassigned.length,
    });

    const nextScope = scopeNow();
    // 残りの必須が 2 つ以上なら、もう一度まとめて話した方が速い。
    const remainingRequired = batchTargets(nextValue, nextScope).filter(
      (target) => !target.field.optional,
    );
    const next = firstNeededField(nextValue, nextScope);
    if (!next) {
      finishSession();
      return;
    }
    cursorRef.current = next.id;
    setCursor(next.id);

    if (remainingRequired.length >= 2) {
      // まとめてのまま閉じる。録音は自動で始めず、話す準備ができてから押してもらう。
      batchModeRef.current = true;
      setModeChoice("batch");
      setMessage(`あと${remainingRequired.length}つ。続けて話せます。`);
      api.announce(`あと${remainingRequired.length}つです。続けて話せます。`);
      return;
    }

    // 残りが 1 つ以下なら、1 欄ずつ聞いた方が確実。理由を 1 行だけ添える。
    batchModeRef.current = false;
    setModeChoice("single");
    setMessage("残りの欄は1つずつ話します。");
    api.announce(`${next.label}を話してください。`);
    // 理由の 1 行は読み終えるまで残す（録音の開始で消さない）。
    void startRecording({ keepMessage: true });
  }, [api, batch, finishSession, markTouched, onChange, scopeNow, startRecording]);

  /** まとめて話した内容を録り直す。確認を閉じて、同じモードのまま録音を始める。 */
  const reRecordBatch = useCallback(() => {
    if (batch) {
      trackEvent("voice_batch_abandoned", {
        rows: batch.rows.length,
        unassigned: batch.unassigned.length,
      });
    }
    setBatch(null);
    setMessage(null);
    // 録り直すので、塗ったマスも一度消す（読めた数が増える様子を見せる）。
    setReadCells(new Set());
    void startRecording();
  }, [batch, startRecording]);

  /** 追加した行の欄へカーソルを移し、その場で録音を始める。 */
  const moveTo = useCallback(
    (target: VoiceSlot) => {
      cursorRef.current = target.id;
      setCursor(target.id);
      setMessage(null);
      api.announce(`${target.label}を話してください。`);
      void startRecording();
    },
    [api, startRecording],
  );

  /** 分岐の質問に答える。追加するときだけ行を増やし、それ以外は通常の遷移と同じ。 */
  const answerBranch = useCallback(
    (add: boolean) => {
      const question = branch;
      if (!question) return;
      setBranch(null);

      const source = voiceSlotById(question.slotId, valueRef.current, scopeNow());
      if (!source) return;
      if (!add) {
        advanceFrom(source);
        return;
      }

      if (question.kind === "schedule") {
        const schedules = [...valueRef.current.schedules, createScheduleDraft()];
        const nextValue: EventFormValues = { ...valueRef.current, schedules };
        valueRef.current = nextValue;
        onChange(nextValue);
        const id = `scheduleDate:${schedules.length - 1}` as VoiceSlotId;
        const target = voiceSlotById(id, nextValue, scopeNow());
        if (!target) {
          advanceFrom(source);
          return;
        }
        moveTo(target);
        return;
      }

      // 男女別にする。行を分けたあとも、費用の入口（プラン名）から順に進める。
      const pricePlans = withGenderPricing(valueRef.current.pricePlans);
      const nextValue: EventFormValues = { ...valueRef.current, pricePlans };
      valueRef.current = nextValue;
      onChange(nextValue);
      advanceFrom(source);
    },
    [advanceFrom, branch, moveTo, onChange, scopeNow],
  );

  /** ガイドを閉じる。閉じたことは覚え、次に開いたときの自動表示は止める。
   *  マイクを手で押したときは記憶に関係なく開くので、入口は塞がない。 */
  const closeGuide = useCallback(() => {
    dismissVoiceGuide();
    setGuideOpen(false);
  }, []);

  /** パネルの 2 択。選ばれたら、そのセッションでは既定より優先する。 */
  const chooseMode = useCallback(
    (mode: VoiceMode) => {
      if ((batchModeRef.current ? "batch" : "single") === mode) return;
      setModeChoice(mode);
      batchModeRef.current = mode === "batch";
      // 任意の欄は、まとめてでは既定で外し、1 つずつなら聞く。話したあとに
      // 付け外しはできるが、話し方を変えたら、その話し方の既定に戻す。
      const wantOptional = mode !== "batch";
      includeOptionalRef.current = wantOptional;
      setIncludeOptional(wantOptional);
      setMessage(null);
      // マスの並びが変わるので、塗りは捨てる（別の話し方の塗りを引き継がない）。
      setReadCells(new Set());
      // どちらが選ばれたかだけを送る。発話内容と値は送らない。
      trackEvent("voice_mode_selected", { mode, default: mode === defaultMode });
    },
    [defaultMode],
  );

  /** 初回ガイドの 2 択。選んだ話し方で、そのまま音声モードに入る。 */
  const chooseGuideMode = useCallback(
    (mode: VoiceMode) => {
      closeGuide();
      startSession(mode);
    },
    [closeGuide, startSession],
  );

  // 操作できる状態になり、音声モードでなく、まだ閉じていないときだけ 1 回出す。
  // 初回ガイド（スポットライトツアー）が出ている間は待つ。閉じたら `guideDeferred` が
  // false になってこの effect が走り直し、続けて音声の案内を出す。
  useEffect(() => {
    const wasDeferred = guideDeferredRef.current;
    guideDeferredRef.current = guideDeferred;
    if (guideShownRef.current || disabled || active) return;
    if (guideDeferred) return;
    // ツアーが閉じた直後は、自動表示を止めた記憶より先に出す。
    // ツアーの続きとして読む案内なので、ここだけ記憶を無視する。
    // 手で FAB を押したときも同じ（下の onClick）。
    if (!wasDeferred && isVoiceGuideDismissed()) return;
    guideShownRef.current = true;
    setGuideOpen(true);
  }, [active, disabled, guideDeferred]);

  // FAB の矩形を測って、その丸のぶんだけ黒い面をくり抜く。スクロール・リサイズで測り直す。
  // FAB は position: fixed だが、画面下に固定する帯の高さ（`--final-bar-h`）が
  // ログイン状態の読み込みで変わると上へずれる。スクロールもリサイズも起きないため、
  // 大きさと属性の変化（body のクラス）も合図に加える。
  useEffect(() => {
    if (!guideOpen) {
      setGuideClip(null);
      return;
    }
    let previous = "";
    let frame = 0;
    const measure = () => {
      frame = 0;
      const fab = fabRef.current;
      if (!fab) return;
      const rect = fab.getBoundingClientRect();
      // ボタンは丸（角丸 999px の正方形）なので、穴も同じ丸にする。
      // 縁の 1px が黒い面の縁取りで暗くならないよう、2px だけ外へ広げる。
      const pad = 2;
      const next = circleSpotlightClipPath({
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      });
      if (next === previous) return;
      previous = next;
      setGuideClip(next);
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    const resizeObserver =
      typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    // クラスの付け替えで帯の高さが変わっても、リサイズの合図は出ない。
    const mutationObserver =
      typeof MutationObserver === "function" ? new MutationObserver(schedule) : null;

    measure();
    resizeObserver?.observe(document.body);
    if (fabRef.current) resizeObserver?.observe(fabRef.current);
    mutationObserver?.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [guideOpen]);

  // ガイドも Esc で閉じる。音声モードの Esc と取り合わないよう、こちらで止める。
  useEffect(() => {
    if (!guideOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeGuide();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [closeGuide, guideOpen]);

  return (
    <>
      {active && spotlight && (
        <div
          className="voice-scrim"
          aria-hidden="true"
          style={{ clipPath: spotlightClipPath(spotlight) }}
          onClick={explainScrim}
        />
      )}
      {/* 初回ガイド。FAB だけを切り抜いた黒い面と、使い方を添える吹き出し。
          吹き出しは面の子にしない（clip-path で一緒に切り抜かれてしまうため）。 */}
      {guideOpen && !active && (
        <>
          <div
            className="voice-guide"
            aria-hidden="true"
            style={guideClip ? { clipPath: guideClip } : undefined}
            onClick={closeGuide}
          />
          <div className="voice-guide__bubble">
            {/* ガイドは focus を奪わないので、出たことを読み上げで知らせる。
                見出しは「何の機能か」と「手軽さ」を 1 行で言う。何の話かだけを
                書くと、初めて触る人には身構える機能の説明に見えてしまう。
                「ラクちん」は端末のマイクに向かって話すだけ、という軽さを伝える語。
                見出しだけは下線で目を引く（CSS の `.voice-guide__title`）。 */}
            <p className="voice-guide__title" role="status">
              ラクちん音声入力
            </p>
            <p className="voice-guide__body">話し方を選ぶと、録音が始まります。</p>
            {/* 話し方は入口で決める。押した方はそのまま音声モードに入る。
                どの催しに向くかは、話し方の名前の下へ札として添える。札もボタンの中なので、
                札を押しても同じ話し方で録音が始まる。名前を span で包むのは、
                題と札で文字の大きさと太さを分けるため。 */}
            <div className="voice-guide__modes">
              <button
                type="button"
                className="btn btn--sm btn--block"
                onClick={() => chooseGuideMode("batch")}
              >
                <span className="voice-guide__name">まとめて話す</span>
                <span className="voice-guide__label">シンプルなイベント向け</span>
              </button>
              <button
                type="button"
                className="btn btn--sm btn--block"
                onClick={() => chooseGuideMode("single")}
              >
                <span className="voice-guide__name">1つずつ</span>
                <span className="voice-guide__label">複数日程・費用男女別向け</span>
              </button>
            </div>
          </div>
        </>
      )}
      <button
        ref={fabRef}
        type="button"
        className={`voice-fab${active ? " voice-fab--active" : ""}`}
        aria-label={active ? "音声入力を終了" : "音声入力を開始"}
        title={active ? "音声入力を終了" : "音声入力を開始"}
        aria-pressed={active}
        disabled={disabled}
        onClick={() => {
          // 録音中なら、押したら終える（ボタンの印も × に変わっている）。
          if (active) {
            stopSession();
            return;
          }
          // 押すたびに案内の吹き出しを出す。話し方はこの 2 択で決めてから録音を始める。
          // 自動表示を止めた記憶は自動表示にだけ使い、手で押したときは必ず出す。
          guideShownRef.current = true;
          setGuideOpen(true);
        }}
      >
        {active ? (
          <X className="icon" aria-hidden="true" size={22} />
        ) : (
          <Mic className="icon" aria-hidden="true" size={22} />
        )}
      </button>

      {active && (
        <section
          ref={panelRef}
          className={[
            "voice-panel",
            batchMode ? "voice-panel--batch" : "",
            listening ? "is-listening" : "",
            transcribing ? "is-transcribing" : "",
            // まとめて話すときは測った位置を使わない（画面下寄りに固定する）。
            batchMode || panelBox ? "" : "is-placing",
          ]
            .filter(Boolean)
            .join(" ")}
          style={panelStyle}
          aria-label="音声入力"
        >
          <div className="voice-panel__head">
            {/* 録音中かどうかは文字ではなく印で示す。質問文は録音中も消さない。
                何を話すかを目で追いながら話せるようにするため。 */}
            {showStatus && (
              <p
                className={`voice-panel__status${statusStopping ? " is-stopping" : ""}`}
                role="status"
              >
                <span className="voice-rec" aria-hidden="true">
                  <span className="voice-rec__dot" />
                  REC
                </span>
                <span className="voice-panel__state">録音中</span>
              </p>
            )}
            {/* 質問と例は 1 行に並べる。例は質問の隣に置き、目を戻さずに読めるようにする。
                まとめて話すときのマスは折り返せる別の行へ置く（1 行に詰めると切れる）。 */}
            <div className="voice-panel__ask">
              <p className="voice-panel__prompt" aria-live="polite" ref={promptRef}>
                {promptText}
              </p>
              {!complete && !searching && !batchMode && field && (
                <p className="voice-panel__hint">例: {field.example}</p>
              )}
            </div>
            {/* まとめて話すときのマス。話す順を欄の名前で並べ、読めたマスから点と縁が変わる。
                塗るのは聞き取れた印だけで、値は止めたあとの確認まで出さない。 */}
            {!complete && batchMode && cells.length > 0 && (
              <ol className="voice-cells" aria-label="話す順">
                {cells.map((cell) => {
                  const isRead = readCells.has(cell.id);
                  return (
                    <li
                      className={`voice-cell${isRead ? " is-read" : ""}`}
                      key={cell.id}
                    >
                      <span className="voice-cell__mark" aria-hidden="true" />
                      <span className="voice-cell__label">{cell.label}</span>
                    </li>
                  );
                })}
              </ol>
            )}
            {/* 認識の途中経過は質問の下に 1 行だけ出す。質問は消さない
                （何を話すかを目で追いながら、聞き取れた分を確かめられる）。 */}
            {!complete && interim && (
              <p className="voice-panel__interim" aria-live="polite">
                {interim}
              </p>
            )}
            {!complete && !batchMode && field && currentValue && !searching && (
              <p className="voice-panel__current">いまの値: {currentValue}</p>
            )}
            {/* 完了のあとに残るのは、音声では選べないテーマとチラシ。質問の行とは
                別の行にして、質問の字を小さくしないまま次にすることを 1 行で渡す。 */}
            {complete && <p className="voice-panel__finish">{completion.note}</p>}
            <button
              type="button"
              className="voice-panel__close"
              aria-label="音声入力を終了"
              title="音声入力を終了"
              onClick={stopSession}
            >
              <X className="icon" aria-hidden="true" />
            </button>
          </div>

          {notice && (
            <p className="voice-panel__message" role="status">
              {notice}
            </p>
          )}

          {/* 何を話すかを 1 文で見せる。マスの名前だけでは、値として何を
              言えばよいか分からない。話し方の指示は上の 30px の行に固定で出して
              あるので、ここは値の形（例）だけを置く。 */}
          {!complete && batchMode && exampleSentence && (
            <div className="voice-panel__example">
              <p className="voice-panel__example-text">
                <span className="voice-panel__example-key">例</span>{" "}
                {exampleSentence}
              </p>
            </div>
          )}

          {/* 押しても動かない的は置かない。まとめて話すときは戻る・スキップを使わないので、
              止めて置くのではなく、そもそも出さない（主操作も 1 つに絞られる）。
              文字化・住所検索の待ちのあいだは主ボタンを出さない。 */}
          {!complete && (showTalk || !batchMode) && (
            <div className="voice-panel__actions">
              {/* 録音中だけ、止め方を主ボタンの下に添える。丸い停止の印だけでは、
                  話し終えたあとに何を押すかが分かりにくいため。 */}
              {showTalk && (
                <div className="voice-panel__talk-wrap">
                  {/* 文字ではなくアイコンで置き、意味は aria-label と title で補う。 */}
                  <button
                    type="button"
                    className="voice-icon-btn voice-icon-btn--primary"
                    data-state={listening ? "stop" : "mic"}
                    aria-label={talkLabel}
                    title={talkLabel}
                    onClick={listening ? stopRecording : () => void startRecording()}
                  >
                    {listening ? (
                      <Square className="icon" aria-hidden="true" />
                    ) : (
                      <Mic className="icon" aria-hidden="true" />
                    )}
                  </button>
                  {listening && (
                    <p className="voice-panel__talk">
                      話し終わったら
                      <br />
                      タップ
                    </p>
                  )}
                </div>
              )}
              {/* 録音中でも戻る・スキップは押せる。いまの録音は捨て、移った欄で録り直す。
                  戻り先が無いときは、押せない丸を残さず場所だけ空ける（並びを動かさない）。 */}
              {!batchMode && previous && (
                <button
                  type="button"
                  className="voice-icon-btn"
                  aria-label="戻る"
                  title="戻る"
                  onClick={goPrevious}
                >
                  <ChevronLeft className="icon" aria-hidden="true" />
                </button>
              )}
              {!batchMode && !previous && (
                <span className="voice-panel__slot" aria-hidden="true" />
              )}
              {!batchMode && (
                <div className="voice-panel__talk-wrap">
                  <button
                    type="button"
                    className="voice-icon-btn"
                    aria-label="スキップ"
                    title="スキップ"
                    onClick={skip}
                  >
                    <ChevronsRight className="icon" aria-hidden="true" />
                  </button>
                  {/* 丸い印だけでは意味が分かりにくいので、下に同じ大きさ・色で名前を出す。 */}
                  <p className="voice-panel__talk">スキップ</p>
                </div>
              )}
            </div>
          )}

          {!complete && (
            <div className="voice-panel__options">
              {/* 話し方は入口の 2 択。まとめて話すときも、録音の途中で切り替えられる
                  （録った音声は同じで、停止したあとの送り先だけが変わる）。 */}
              <div className="voice-panel__mode" role="radiogroup" aria-label="話し方">
                <label className="voice-mode">
                  <input
                    type="radio"
                    name="voice-mode"
                    value="batch"
                    checked={batchMode}
                    onChange={() => chooseMode("batch")}
                  />
                  まとめて
                </label>
                <label className="voice-mode">
                  <input
                    type="radio"
                    name="voice-mode"
                    value="single"
                    checked={!batchMode}
                    onChange={() => chooseMode("single")}
                  />
                  1つずつ
                </label>
              </div>
              <div className="voice-panel__toggles">
                <label className="check voice-panel__optional">
                  <input
                    type="checkbox"
                    checked={includeOptional}
                    onChange={(event) => setIncludeOptional(event.target.checked)}
                  />
                  任意の項目も聞く
                </label>
                {/* まとめて話すときは 1 欄ずつ進まないので、切り替え自体を出さない。 */}
                {!batchMode && (
                  <label className="check voice-panel__optional">
                    <input
                      type="checkbox"
                      checked={autoAdvance}
                      onChange={(event) => setAutoAdvance(event.target.checked)}
                    />
                    答えたら次へ
                  </label>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 録音のあとは、聞き取った値をそのまま入れず、一度見せる。
          読み取り違いを話し直す前に気づけるようにするため。
          値はその場で直せる。確定は編集後の文字で parse し直す
          （空にしたままでは確定できない）。 */}
      {pending && (
        <Dialog
          title="入力内容の確認"
          titleId="voice-confirm-title"
          onClose={closePending}
          actions={
            <div className="voice-confirm__actions">
              <button
                type="button"
                className="btn btn--primary btn--block"
                disabled={pending.draft.trim().length === 0}
                onClick={confirmPending}
              >
                確定
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={reRecordPending}
              >
                再録音
              </button>
            </div>
          }
        >
          <div className="voice-confirm">
            <p className="voice-confirm__ask">
              {pendingTarget
                ? `${pendingTarget.label}に入れる内容です。直してから確定できます。`
                : "入れる内容です。直してから確定できます。"}
            </p>
            <label className="voice-confirm__field">
              <span className="voice-confirm__label">
                {pendingTarget?.label ?? "値"}
              </span>
              {pendingLong ? (
                <textarea
                  className="voice-confirm__input"
                  rows={3}
                  value={pending.draft}
                  onChange={(event) => updatePendingDraft(event.target.value)}
                />
              ) : (
                <input
                  type="text"
                  className="voice-confirm__input"
                  value={pending.draft}
                  onChange={(event) => updatePendingDraft(event.target.value)}
                />
              )}
            </label>
            <p className="voice-confirm__raw">話した内容: 「{pending.text}」</p>
          </div>
        </Dialog>
      )}

      {/* まとめて話した内容を、欄ごとの 1 行に並べる。
          値はその場で直せ、取り込む行はチェックで外せる。
          「すべて入力」で 1 回の更新にまとめて反映する。 */}
      {batch && (
        <Dialog
          title="まとめて入力します"
          titleId="voice-batch-title"
          onClose={closeBatch}
          actions={
            <>
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => void applyBatch()}
              >
                すべて入力
              </button>
              <button type="button" className="btn btn--ghost btn--block" onClick={reRecordBatch}>
                再録音
              </button>
            </>
          }
        >
          <div className="voice-batch">
            <p className="voice-batch__summary">{batch.rows.length}つの欄に入れます。</p>
            {batch.missed.length > 0 && (
              <p className="voice-batch__missed">
                入らなかった欄: {batch.missed.join("、")}
              </p>
            )}
            {batch.rows.map((row) => (
              <div className="voice-batch__row" key={row.slotId}>
                <input
                  type="checkbox"
                  className="voice-batch__include"
                  aria-label={`${row.label}を取り込む`}
                  checked={row.include}
                  onChange={(event) =>
                    updateBatchRow(row.slotId, { include: event.target.checked })
                  }
                />
                <label className="voice-batch__label" htmlFor={`voice-batch-${row.slotId}`}>
                  {row.label}
                </label>
                <input
                  id={`voice-batch-${row.slotId}`}
                  type="text"
                  className="voice-batch__input"
                  value={row.text}
                  onChange={(event) =>
                    updateBatchRow(row.slotId, { text: event.target.value })
                  }
                />
              </div>
            ))}
          </div>
        </Dialog>
      )}

      {/* 日時の群を出る瞬間と、費用の入口にだけ尋ねる。
          背景・×・Esc は「追加しない」と同じ扱いにする。 */}
      {branch?.kind === "schedule" && (
        <Dialog
          title="別の日程も追加しますか？"
          titleId="voice-branch-schedule-title"
          onClose={() => answerBranch(false)}
          closeLabel="追加しない"
          actions={
            <>
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => answerBranch(true)}
              >
                追加する
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={() => answerBranch(false)}
              >
                追加しない
              </button>
            </>
          }
        />
      )}

      {branch?.kind === "gender" && (
        <Dialog
          title="男女別の費用を設定しますか"
          titleId="voice-branch-gender-title"
          onClose={() => answerBranch(false)}
          closeLabel="共通のまま"
          actions={
            <>
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => answerBranch(true)}
              >
                男女別にする
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={() => answerBranch(false)}
              >
                共通のまま
              </button>
            </>
          }
        >
          <p className="dialog__body">男性と女性で金額を分けられます。</p>
        </Dialog>
      )}
    </>
  );
}
