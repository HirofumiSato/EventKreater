"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ChevronLeft, ChevronsRight, Loader2, Mic, Square, X } from "lucide-react";
import type { VoiceStepApi } from "@/modules/events/components/EventStepForm";
import {
  isRecordingSupported,
  MAX_RECORDING_MS,
  pickRecorderMimeType,
} from "@/modules/events/lib/voice/audio";
import {
  applyVoicePatch,
  describeFieldValue,
  fieldForDomId,
  nextNeededField,
  previousField,
  shouldAskGenderBeforePricing,
  startFieldFor,
  voiceSlotById,
} from "@/modules/events/lib/voice/fields";
import { panelBoxFor, type VoicePanelBox } from "@/modules/events/lib/voice/panel";
import {
  circleSpotlightClipPath,
  spotlightClipPath,
  spotlightFor,
  type VoiceSpotlight,
} from "@/modules/events/lib/voice/spotlight";
import { fetchVoiceMockEnabled, transcribeVoiceClip } from "@/modules/events/lib/voice/transcribe";
import { dismissVoiceGuide, isVoiceGuideDismissed } from "@/modules/events/lib/voice/guide";
import { lookupPostalCode } from "@/modules/events/lib/postal-code-search";
import { Dialog } from "@/components/ui/Dialog";
import type {
  VoiceFieldKey,
  VoiceFieldScope,
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
  text: string;
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
}

/**
 * 右下に固定する音声入力の入口。
 *
 * 押すと音声モードに入り、そのまま録音を始める。直前に選んでいた入力欄があれば
 * その欄から、無ければ上から順に空欄へ「見た目だけのフォーカス」を当てる。
 * 入力欄の DOM フォーカスは動かさない。日付・時刻の入力欄に実フォーカスを当てると
 * OS のピッカーが開き、マイクを止めてしまうためである。
 * 入力できる欄が尽きたら「入力完了！」を出し、3 秒後に音声モードを抜ける。
 */
export function VoiceInputDock({
  value,
  onChange,
  api,
  showOrganizerName = false,
  disabled = false,
}: VoiceInputDockProps) {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>("armed");
  const [cursor, setCursor] = useState<VoiceSlotId | null>(null);
  const [touched, setTouched] = useState<ReadonlySet<VoiceFieldKey>>(new Set());
  // 既定で任意の欄も聞く。空欄でよい欄まで一度に埋めたい利用者が多いため。
  const [includeOptional, setIncludeOptional] = useState(true);
  // 1 欄入れたら次の欄へ移るか。既定はオン。オフなら同じ欄に留めて言い直しを待つ。
  const [autoAdvance, setAutoAdvance] = useState(true);
  // 入力できる欄が尽きた印。「入力完了！」を出してから 3 秒で音声モードを抜ける。
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
  // 群から出る瞬間の分岐。答えるまでカーソルは最後の欄に残す。
  const [branch, setBranch] = useState<VoiceBranchQuestion | null>(null);
  // 初回ガイド。開いたかどうかと「次回から表示しない」のチェックを持つ。
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideChecked, setGuideChecked] = useState(false);
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
  const timerRef = useRef<number | null>(null);
  const completeTimerRef = useRef<number | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  // モックの疑似録音の待ち。実の録音の `timerRef` とは別に持つ（同時には片方しか使わない）。
  const mockTimerRef = useRef<number | null>(null);
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
  // 閉じるときの判定は最新のチェックを読む。effect の依存を増やさないため控える。
  const guideCheckedRef = useRef(false);
  // 男女別の費用を聞いたか。1 セッション 1 回だけ聞く（「共通のまま」のあと聞き直さない）。
  const genderAskedRef = useRef(false);
  // ダイアログが開いているあいだは、音声モードの Esc を止める。
  const dialogOpenRef = useRef(false);
  // パネルの上端。切り抜きの下端をここより上へ収める。
  const panelRef = useRef<HTMLElement | null>(null);
  const fabRef = useRef<HTMLButtonElement | null>(null);

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
    guideCheckedRef.current = guideChecked;
  }, [guideChecked]);

  useEffect(() => {
    mockRef.current = mock;
  }, [mock]);

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
    dialogOpenRef.current = pending !== null || branch !== null;
  }, [branch, pending]);

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

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
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

  const clearMockTimer = useCallback(() => {
    if (mockTimerRef.current !== null) {
      window.clearTimeout(mockTimerRef.current);
      mockTimerRef.current = null;
    }
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
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    releaseStream();
    setPhase("armed");
  }, [clearCompleteTimer, clearMockTimer, clearStatusTimer, clearTimer, releaseStream]);

  /** 音声モードを抜ける。録音・完了の待ち・強調をすべて戻す。 */
  const stopSession = useCallback(() => {
    discardRecording();
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
    cursorRef.current = null;
    setCursor(null);
    // 位置も捨てる。次に開いたとき、古い位置で 1 フレーム見せないため。
    setPanelBox(null);
  }, [discardRecording]);

  /** 入力できる欄が尽きたとき。3 秒だけ「入力完了！」を見せてから音声モードを抜ける。 */
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
    api.announce("音声で入力できる欄がすべて埋まりました。3秒後に音声入力を終了します。");
    clearCompleteTimer();
    completeTimerRef.current = window.setTimeout(() => {
      completeTimerRef.current = null;
      stopSession();
    }, 3000);
  }, [api, clearCompleteTimer, clearMockTimer, clearStatusTimer, stopSession]);

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

  const finishRecording = useCallback(
    async (mimeType: string) => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      recorderRef.current = null;
      releaseStream();

      if (!mountedRef.current) return;
      if (blob.size === 0) {
        setPhase("armed");
        setMessage("録音が空でした。マイクに向かって話してから、もう一度お試しください。");
        return;
      }

      const key = cursorRef.current;
      const slot = key ? voiceSlotById(key, valueRef.current, scopeNow()) : null;
      if (!slot) {
        setPhase("armed");
        finishSession();
        return;
      }

      try {
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
        });
        if (!mountedRef.current) return;
        setPhase("armed");
        // すぐ確定せず、聞き取った値を確認に置く。読み取り違いを話し直す前に見せる。
        // モックの疑似録音もここを通るので、確認の流れはローカルでも同じように確かめられる。
        setPending({ slotId: slot.id, text: result.text });
      } catch (error) {
        if (!mountedRef.current) return;
        setPhase("armed");
        setMessage(
          error instanceof Error ? error.message : "音声を文字にできませんでした。手で入力してください。",
        );
      }
    },
    [finishSession, releaseStream, scopeNow],
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
   * モックの疑似録音を止め、その欄の入力例を確認に置く（ローカル専用）。
   *
   * マイクを使わないので、デバイスの無い PC でも「録音中 → 確認 → 次の欄」を
   * 最後まで追える。入れる文は認識結果と同じ扱い（`slot.field.example`）にして、
   * 実の経路と分岐が変わらないようにしてある。確認を挟むのも実の経路と同じ。
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
    mockTimerRef.current = window.setTimeout(() => {
      mockTimerRef.current = null;
      const slot = voiceSlotById(key, valueRef.current, scopeNow());
      if (!slot) {
        setPhase("armed");
        finishSession();
        return;
      }
      // 実の経路と同じく、確認を出す前に録音の印を戻す。
      setPhase("armed");
      setPending({ slotId: slot.id, text: slot.field.example });
    }, MOCK_TRANSCRIBE_MS);
  }, [clearMockTimer, clearTimer, finishSession, flashStopping, scopeNow]);

  const stopRecording = useCallback(() => {
    clearTimer();
    // モックは録音していないので、押されたら即座に文字化へ移る。
    if (mockTimerRef.current !== null) {
      applyMockRecording();
      return;
    }
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setPhase("transcribing");
    flashStopping();
    recorder.stop();
  }, [applyMockRecording, clearTimer, flashStopping]);

  const startRecording = useCallback(async () => {
    // 入力完了の待ちに入っていたら、もう録音しない。
    if (completeTimerRef.current !== null) return;
    // 開始の途中なら重ねない。マイクの許可待ちのあいだに押されても、掴むのは 1 本だけにする。
    if (startingRef.current) return;
    // すでに録音しているなら始めない。始め直すときは、いったん止める。
    if (mockTimerRef.current !== null) return;
    const current = recorderRef.current;
    if (current && current.state !== "inactive") return;
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
        setMessage(null);
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
      setMessage(null);
      clearStatusTimer();
      setStatusStopping(false);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        // 待っている間に抜けた・別の開始に追い越されたなら、掴んだマイクをその場で離す。
        if (!mountedRef.current || attempt !== startAttemptRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const mimeType = pickRecorderMimeType() ?? "";
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
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
        releaseStream();
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
    applyMockRecording,
    clearMockTimer,
    clearStatusTimer,
    finishRecording,
    finishSession,
    releaseStream,
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
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, [clearCompleteTimer, clearMockTimer, clearStatusTimer, clearTimer]);

  const startSession = useCallback(() => {
    if (disabled) return;
    const scope = {
      showOrganizerName,
      includeOptional: includeOptionalRef.current,
      touched: new Set<VoiceFieldKey>(),
    };
    // 直前に選んでいた欄があればそこから。無ければ最初の空欄から。
    const first = startFieldFor(valueRef.current, scope, lastFocusedIdRef.current);
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
  }, [api, clearCompleteTimer, clearStatusTimer, disabled, showOrganizerName, startRecording]);

  // 強調する欄を画面の中央へ寄せる。DOM フォーカスは動かさない。
  // 画面全体の中央へ寄せる `scrollIntoView` は使わない。パネルは欄のすぐ下に置くため、
  // ここでは欄だけを中央に寄せ、パネルはその下に収める。
  useEffect(() => {
    if (!active) return;
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
      // 欄の中心をビューポートの中央へ置く。パネルの上端を基準にすると、
      // パネルが欄の下へ動くぶんだけ基準も動き、測り直すたびに位置が発振する。
      const usable = window.innerHeight;
      const rect = found.getBoundingClientRect();
      const delta = rect.top + rect.height / 2 - usable / 2;
      if (Math.abs(delta) > 1) {
        window.scrollBy({ top: delta, behavior: reduced ? "auto" : "smooth" });
      }
    };
    apply();

    return () => {
      cancelled = true;
      element?.removeAttribute("data-voice-target");
    };
  }, [active, api, cursor, scopeNow]);

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
        } else if (previous) {
          if (observed) resizeObserver?.unobserve(observed);
          observed = null;
          previous = "";
          // パネルは最後に測った位置のまま残す。欄が一瞬消えたときや
          // 「入力完了！」を出しているあいだに、パネルまで消えないようにする。
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
  }, [active, cursor]);

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

  const scope = useMemo<VoiceFieldScope>(
    () => ({ showOrganizerName, includeOptional, touched }),
    [showOrganizerName, includeOptional, touched],
  );
  const slot = cursor ? voiceSlotById(cursor, value, scope) : null;
  const field = slot?.field ?? null;
  const previous = slot ? previousField(value, slot.id, scope) : null;
  const currentValue = slot ? describeFieldValue(slot.field, value, slot.row) : null;
  const listening = phase === "listening";
  const transcribing = phase === "transcribing";
  const promptText = complete
    ? "入力完了！"
    : transcribing
      ? "テキスト変換中"
      : searching
        ? "住所を調べています"
        : (slot?.prompt ?? "入力できる欄がすべて埋まりました。内容を確認してください。");
  const showStatus = listening || statusStopping;
  // パネルに出す 1 行。いまの操作の知らせを優先し、無ければ住所の補完の知らせを出す。
  const notice = message ?? addressNote;
  const talkLabel = listening
    ? "録音を停止"
    : transcribing
      ? "テキスト変換中"
      : currentValue
        ? "言い直す"
        : "話す";

  // パネルの位置は測った値で決める。隠すのは「まだ一度も測れていない」1 フレームだけ
  // （音声モードに入った直後）。測り直しでは隠さず、最後に測った位置を保つ。
  const panelStyle = panelBox
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

  /** 確認のモーダルを閉じる。カーソルは動かさず、同じ欄に留まる。 */
  const closePending = useCallback(() => {
    setPending(null);
  }, []);

  /** 聞き取った値で確定する。読めなければ閉じてから既存の「読めませんでした」を出す。 */
  const confirmPending = useCallback(() => {
    const item = pending;
    if (!item) return;
    setPending(null);
    const target = voiceSlotById(item.slotId, valueRef.current, scopeNow());
    if (!target) {
      finishSession();
      return;
    }
    cursorRef.current = target.id;
    setCursor(target.id);
    void commit(target, item.text);
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

  /** ガイドを閉じる。チェックが入っていれば次回から出さない。 */
  const closeGuide = useCallback(() => {
    if (guideCheckedRef.current) dismissVoiceGuide(true);
    setGuideOpen(false);
  }, []);

  // 操作できる状態になり、音声モードでなく、まだ閉じていないときだけ 1 回出す。
  useEffect(() => {
    if (guideShownRef.current || disabled || active) return;
    if (isVoiceGuideDismissed()) return;
    guideShownRef.current = true;
    setGuideOpen(true);
  }, [active, disabled]);

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
          <div className="voice-guide__bubble" onClick={closeGuide}>
            {/* ガイドは focus を奪わないので、出たことを読み上げで知らせる。 */}
            <p className="voice-guide__title" role="status">
              音声入力でスムーズに操作
            </p>
            <label
              className="check voice-guide__check"
              onClick={(event) => event.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={guideChecked}
                onChange={(event) => {
                  // チェックした直後に閉じても取りこぼさないよう、控えも同時に更新する。
                  guideCheckedRef.current = event.target.checked;
                  setGuideChecked(event.target.checked);
                }}
              />
              次回から表示しない
            </label>
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
          // ガイドの切り抜きから直接始められる。押したらガイドを閉じてから入る。
          if (guideOpen) {
            closeGuide();
            startSession();
            return;
          }
          if (active) stopSession();
          else startSession();
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
            listening ? "is-listening" : "",
            transcribing ? "is-transcribing" : "",
            panelBox ? "" : "is-placing",
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
            {/* 質問と例は 1 行に並べる。例は質問の隣に置き、目を戻さずに読めるようにする。 */}
            <div className="voice-panel__ask">
              <p className="voice-panel__prompt" aria-live="polite" ref={promptRef}>
                {promptText}
              </p>
              {!complete && field && !searching && (
                <p className="voice-panel__hint">例: {field.example}</p>
              )}
            </div>
            {!complete && field && currentValue && !searching && (
              <p className="voice-panel__current">いまの値: {currentValue}</p>
            )}
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

          <div className="voice-panel__actions">
            {/* 録音中だけ、止め方を主ボタンの下に添える。丸い停止の印だけでは、
                話し終えたあとに何を押すかが分かりにくいため。 */}
            <div className="voice-panel__talk-wrap">
              {/* 文字ではなくアイコンで置き、意味は aria-label と title で補う。 */}
              <button
                type="button"
                className="voice-icon-btn voice-icon-btn--primary"
                data-state={listening ? "stop" : transcribing || searching ? "busy" : "mic"}
                aria-label={talkLabel}
                title={talkLabel}
                disabled={
                  !listening && (!field || transcribing || searching || disabled || complete)
                }
                onClick={listening ? stopRecording : () => void startRecording()}
              >
                {listening ? (
                  <Square className="icon" aria-hidden="true" />
                ) : transcribing || searching ? (
                  <Loader2 className="icon" aria-hidden="true" />
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
            {/* 録音中でも戻る・スキップは押せる。いまの録音は捨て、移った欄で録り直す。
                止めてよいのは、文字化・住所検索・完了の待ちのあいだだけ。 */}
            <button
              type="button"
              className="voice-icon-btn"
              aria-label="戻る"
              title="戻る"
              disabled={!previous || transcribing || searching || complete}
              onClick={goPrevious}
            >
              <ChevronLeft className="icon" aria-hidden="true" />
            </button>
            <div className="voice-panel__talk-wrap">
              <button
                type="button"
                className="voice-icon-btn"
                aria-label="スキップ"
                title="スキップ"
                disabled={!field || transcribing || searching || complete}
                onClick={skip}
              >
                <ChevronsRight className="icon" aria-hidden="true" />
              </button>
              {/* 丸い印だけでは意味が分かりにくいので、下に同じ大きさ・色で名前を出す。 */}
              <p className="voice-panel__talk">スキップ</p>
            </div>
          </div>

          <div className="voice-panel__options">
            <label className="check voice-panel__optional">
              <input
                type="checkbox"
                checked={includeOptional}
                disabled={listening || transcribing}
                onChange={(event) => setIncludeOptional(event.target.checked)}
              />
              任意の項目も聞く
            </label>
            <label className="check voice-panel__optional">
              <input
                type="checkbox"
                checked={autoAdvance}
                onChange={(event) => setAutoAdvance(event.target.checked)}
              />
              自動遷移
            </label>
          </div>
        </section>
      )}

      {/* 録音のあとは、聞き取った値をそのまま入れず、一度見せる。
          読み取り違いを話し直す前に気づけるようにするため。 */}
      {pending && (
        <Dialog
          title={
            <span className="voice-confirm">
              <span className="voice-confirm__value">「{pending.text}」</span>
              <span className="voice-confirm__ask">を入力します</span>
            </span>
          }
          titleId="voice-confirm-title"
          onClose={closePending}
          actions={
            <div className="voice-confirm__actions">
              <button
                type="button"
                className="btn btn--primary btn--block"
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
        />
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
