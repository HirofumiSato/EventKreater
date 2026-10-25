"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, X } from "lucide-react";
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
  startFieldFor,
  voiceFieldByKey,
} from "@/modules/events/lib/voice/fields";
import { transcribeVoiceClip } from "@/modules/events/lib/voice/transcribe";
import type {
  VoiceField,
  VoiceFieldKey,
  VoiceFieldScope,
} from "@/modules/events/lib/voice/types";
import type { EventFormValues } from "@/modules/events/types";

type VoicePhase = "armed" | "listening" | "transcribing";

/** 音声モードの覆いからくり抜く矩形。ビューポート座標。 */
interface VoiceSpotlight {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 強調の枠（outline 3px + 余白 2px）が隠れないように、矩形を外側へ広げる量。 */
const SPOTLIGHT_PADDING = 6;

/**
 * 矩形の外側を覆い、内側だけをくり抜く clip-path を作る。
 * 外周を時計回り、穴を反時計回りに描くと、既定の nonzero 規則で穴になる。
 */
function spotlightClipPath({ top, left, width, height }: VoiceSpotlight): string {
  const right = left + width;
  const bottom = top + height;
  return (
    "polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, " +
    `${left}px ${top}px, ${left}px ${bottom}px, ${right}px ${bottom}px, ` +
    `${right}px ${top}px, ${left}px ${top}px)`
  );
}

interface VoiceInputDockProps {
  value: EventFormValues;
  onChange: (value: EventFormValues) => void;
  api: VoiceStepApi;
  /** 未登録の幹事にだけ主催者名を聞く。 */
  showOrganizerName: boolean;
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
  showOrganizerName,
  disabled = false,
}: VoiceInputDockProps) {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>("armed");
  const [cursor, setCursor] = useState<VoiceFieldKey | null>(null);
  const [touched, setTouched] = useState<ReadonlySet<VoiceFieldKey>>(new Set());
  const [includeOptional, setIncludeOptional] = useState(false);
  // 1 欄入れたら次の欄へ移るか。既定はオン。オフなら同じ欄に留めて言い直しを待つ。
  const [autoAdvance, setAutoAdvance] = useState(true);
  // 入力できる欄が尽きた印。「入力完了！」を出してから 3 秒で音声モードを抜ける。
  const [complete, setComplete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  // 覆いからくり抜く位置。対象の欄が見つからないときは null で、覆いを出さない。
  const [spotlight, setSpotlight] = useState<VoiceSpotlight | null>(null);

  // 非同期のコールバック（録音停止・住所検索）から最新値を読むための控え。
  const valueRef = useRef(value);
  const cursorRef = useRef<VoiceFieldKey | null>(null);
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
  // 録音の開始は commit からも呼ぶ。互いを依存に持つと循環するので控えを挟む。
  const startRecordingRef = useRef<() => void>(() => {});
  const mountedRef = useRef(true);

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

  const markTouched = useCallback((key: VoiceFieldKey) => {
    const next = new Set(touchedRef.current);
    next.add(key);
    touchedRef.current = next;
    setTouched(next);
  }, []);

  /** 音声モードを抜ける。録音・完了の待ち・強調をすべて戻す。 */
  const stopSession = useCallback(() => {
    clearTimer();
    clearCompleteTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    releaseStream();
    setActive(false);
    setPhase("armed");
    setComplete(false);
    setMessage(null);
    setTranscript(null);
    cursorRef.current = null;
    setCursor(null);
  }, [clearCompleteTimer, clearTimer, releaseStream]);

  /** 入力できる欄が尽きたとき。3 秒だけ「入力完了！」を見せてから音声モードを抜ける。 */
  const finishSession = useCallback(() => {
    cursorRef.current = null;
    setCursor(null);
    setComplete(true);
    setPhase("armed");
    setMessage(null);
    api.announce("音声で入力できる欄がすべて埋まりました。3秒後に音声入力を終了します。");
    clearCompleteTimer();
    completeTimerRef.current = window.setTimeout(() => {
      completeTimerRef.current = null;
      stopSession();
    }, 3000);
  }, [api, clearCompleteTimer, stopSession]);

  /**
   * 郵便番号が入ったら、既存の検索 API で住所を補完する。失敗しても手入力に任せる。
   * カーソルは動かさない。呼び出し元が補完後の値を見て次の欄を決める。
   */
  const fillAddressFromPostalCode = useCallback(
    async (postalCode: string) => {
      try {
        const response = await fetch(`/api/v1/geo/postal-codes/${postalCode}`);
        if (!response.ok) return;
        const body = (await response.json()) as {
          results?: { prefecture: string; city: string; town: string }[];
        };
        const first = body.results?.[0];
        if (!first || !mountedRef.current) return;
        const nextValue: EventFormValues = {
          ...valueRef.current,
          prefecture: first.prefecture,
          city: first.city,
          town: first.town,
        };
        valueRef.current = nextValue;
        onChange(nextValue);
      } catch {
        // 住所の補完は補助。取れなくても郵便番号だけで保存できる。
      }
    },
    [onChange],
  );

  const commit = useCallback(
    async (field: VoiceField, text: string) => {
      const context = { now: new Date(), value: valueRef.current };
      const patch = field.parse(text, context);
      if (!patch) {
        setMessage(
          `「${text}」は${field.label}として読めませんでした。もう一度話すか、手で入力してください。`,
        );
        return false;
      }
      const nextValue = applyVoicePatch(valueRef.current, patch);
      valueRef.current = nextValue;
      onChange(nextValue);
      markTouched(field.key);
      setTranscript(text);

      // 郵便番号は住所の補完を待ってから次の欄を決める。先に進めると、
      // 補完で埋まった都道府県・市区町村をもう一度聞いてしまう。
      if (field.key === "postalCode" && patch.postalCode) {
        await fillAddressFromPostalCode(patch.postalCode);
      }

      // 自動遷移が外れているときは同じ欄に留める。録音は止めて、言い直しを待つ。
      if (!autoAdvanceRef.current) {
        cursorRef.current = field.key;
        setCursor(field.key);
        setMessage(`「${text}」で入力しました。続けて直すときは「言い直す」を押してください。`);
        api.announce(`${field.label}を「${text}」で入力しました。`);
        return true;
      }

      const next = nextNeededField(valueRef.current, field.key, scopeNow());
      cursorRef.current = next?.key ?? null;
      setCursor(next?.key ?? null);
      if (!next) {
        finishSession();
        return true;
      }
      setMessage(null);
      api.announce(`${field.label}を「${text}」で入力しました。次は${next.label}です。`);
      // 次の欄へ移ったら、その瞬間から録音を始める。もう一度押させない。
      startRecordingRef.current();
      return true;
    },
    [api, fillAddressFromPostalCode, finishSession, markTouched, onChange, scopeNow],
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
      const field = key ? voiceFieldByKey(key) : null;
      if (!field) {
        setPhase("armed");
        finishSession();
        return;
      }

      try {
        const result = await transcribeVoiceClip({ blob, field: field.key });
        if (!mountedRef.current) return;
        setPhase("armed");
        await commit(field, result.text);
      } catch (error) {
        if (!mountedRef.current) return;
        setPhase("armed");
        setMessage(
          error instanceof Error ? error.message : "音声を文字にできませんでした。手で入力してください。",
        );
      }
    },
    [commit, finishSession, releaseStream],
  );

  const stopRecording = useCallback(() => {
    clearTimer();
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setPhase("transcribing");
    recorder.stop();
  }, [clearTimer]);

  const startRecording = useCallback(async () => {
    // 入力完了の待ちに入っていたら、もう録音しない。
    if (completeTimerRef.current !== null) return;
    if (!cursorRef.current) {
      finishSession();
      return;
    }
    if (!isRecordingSupported()) {
      setMessage("このブラウザは録音に対応していません。手で入力してください。");
      return;
    }
    setMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      if (!mountedRef.current) {
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
      releaseStream();
      if (!mountedRef.current) return;
      setPhase("armed");
      setMessage(
        "マイクを使えませんでした。ブラウザの設定でマイクを許可するか、手で入力してください。",
      );
    }
  }, [finishRecording, finishSession, releaseStream, stopRecording]);

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
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, [clearCompleteTimer, clearTimer]);

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
    setActive(true);
    setPhase("armed");
    setComplete(false);
    clearCompleteTimer();
    setTranscript(null);
    cursorRef.current = first?.key ?? null;
    setCursor(first?.key ?? null);
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
  }, [api, clearCompleteTimer, disabled, showOrganizerName, startRecording]);

  // 対象の欄を強調し、画面内へ寄せる。DOM フォーカスは動かさない。
  useEffect(() => {
    if (!active) return;
    const field = cursor ? voiceFieldByKey(cursor) : null;
    if (!field) return;
    api.openStep(field.step);
    const id = field.domId(valueRef.current);
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
      found.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    };
    apply();

    return () => {
      cancelled = true;
      element?.removeAttribute("data-voice-target");
    };
  }, [active, api, cursor]);

  // 音声モードの間、いま聞いている欄だけを残して画面全体を覆う。
  // 覆いはそのまま操作を止めるので、スクロールやステップの開閉に合わせて穴を追いかける。
  // 追いかけは毎フレームではなく、位置が動く合図（スクロール・リサイズ・DOM の変化）でだけ測り直す。
  useEffect(() => {
    if (!active) {
      setSpotlight(null);
      return;
    }

    let frame = 0;
    let retries = 0;
    let previous = "";
    let observed: HTMLElement | null = null;
    let cancelled = false;

    const measure = () => {
      if (cancelled) return;
      const target =
        observed ?? document.querySelector<HTMLElement>('[data-voice-target="true"]');
      if (!target) {
        // ステップを開いた直後は、まだ欄が描画されていないことがある。少しだけ待つ。
        if (retries < 40) {
          retries += 1;
          frame = window.requestAnimationFrame(measure);
        } else if (previous) {
          previous = "";
          setSpotlight(null);
        }
        return;
      }
      if (observed !== target) {
        observed = target;
        resizeObserver?.observe(target);
      }
      const rect = target.getBoundingClientRect();
      const next: VoiceSpotlight = {
        top: Math.max(0, rect.top - SPOTLIGHT_PADDING),
        left: Math.max(0, rect.left - SPOTLIGHT_PADDING),
        width: rect.width + SPOTLIGHT_PADDING * 2,
        height: rect.height + SPOTLIGHT_PADDING * 2,
      };
      const key = `${next.top}:${next.left}:${next.width}:${next.height}`;
      if (key !== previous) {
        previous = key;
        setSpotlight(next);
      }
    };

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
    mutationObserver?.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-voice-target"],
      subtree: true,
    });
    // 入れ子のスクロール領域も拾うため capture で待つ。
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);

    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      setSpotlight(null);
    };
  }, [active, cursor]);

  // 手で入力欄を押したら、その欄を言い直す対象にする。
  useEffect(() => {
    if (!active) return;
    const handler = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const id = target?.id;
      if (!id) return;
      const field = fieldForDomId(id, valueRef.current, scopeNow());
      if (!field || field.key === cursorRef.current) return;
      cursorRef.current = field.key;
      setCursor(field.key);
      setMessage(null);
    };
    document.addEventListener("focusin", handler);
    return () => document.removeEventListener("focusin", handler);
  }, [active, scopeNow]);

  // Esc でいつでも抜けられる。
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      stopSession();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [active, stopSession]);

  const field = cursor ? voiceFieldByKey(cursor) : null;
  const scope = useMemo<VoiceFieldScope>(
    () => ({ showOrganizerName, includeOptional, touched }),
    [showOrganizerName, includeOptional, touched],
  );
  const previous = cursor ? previousField(value, cursor, scope) : null;
  const currentValue = field ? describeFieldValue(field, value) : null;
  const listening = phase === "listening";
  const transcribing = phase === "transcribing";

  const goPrevious = () => {
    if (!previous) return;
    cursorRef.current = previous.key;
    setCursor(previous.key);
    setMessage(null);
    setTranscript(null);
    api.announce(`${previous.label}に戻りました。${previous.prompt}`);
  };

  const skip = () => {
    if (!cursor) return;
    const next = nextNeededField(valueRef.current, cursor, scopeNow());
    cursorRef.current = next?.key ?? null;
    setCursor(next?.key ?? null);
    if (next) {
      setMessage(null);
      api.announce(`次は${next.label}です。`);
    } else {
      finishSession();
    }
  };

  /** 覆いは操作を止めるだけなので、押されたら抜け方を伝える。 */
  const explainScrim = () => {
    setMessage(
      "音声モード中は、いま聞いている欄のまわりだけ操作できます。「終了」か Esc で元に戻ります。",
    );
    api.announce("音声モード中です。終了するには、終了ボタンかエスケープキーを押してください。");
  };

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
      <button
        type="button"
        className={`voice-fab${active ? " voice-fab--active" : ""}`}
        aria-label={active ? "音声入力を終了" : "音声入力を開始"}
        title={active ? "音声入力を終了" : "音声入力を開始"}
        aria-pressed={active}
        disabled={disabled}
        onClick={() => (active ? stopSession() : startSession())}
      >
        {active ? <X aria-hidden="true" size={22} /> : <Mic aria-hidden="true" size={22} />}
      </button>

      {active && (
        <section className="voice-panel" aria-label="音声入力">
          <div className="voice-panel__head">
            <p className="voice-panel__title">
              {listening ? "聞いています" : transcribing ? "文字にしています" : "音声入力"}
            </p>
            <button type="button" className="voice-panel__close" onClick={stopSession}>
              終了
            </button>
          </div>

          {complete ? (
            <>
              <p className="voice-panel__prompt" aria-live="polite">
                入力完了！
              </p>
              <p className="voice-panel__hint">3秒後に音声入力を終了します。</p>
            </>
          ) : field ? (
            <>
              <p className="voice-panel__field">{field.label}</p>
              <p className="voice-panel__prompt" aria-live="polite">
                {listening ? "話し終えたら「停止して入力」を押してください。" : field.prompt}
              </p>
              <p className="voice-panel__hint">
                例: {field.example}
                {currentValue ? ` ／ いまの値: ${currentValue}` : ""}
              </p>
            </>
          ) : (
            <p className="voice-panel__prompt" aria-live="polite">
              入力できる欄がすべて埋まりました。内容を確認してください。
            </p>
          )}

          {transcript && <p className="voice-panel__transcript">聞き取り: {transcript}</p>}
          {message && (
            <p className="voice-panel__message" role="status">
              {message}
            </p>
          )}

          <div className="voice-panel__actions">
            {listening ? (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={stopRecording}
              >
                停止して入力
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={!field || transcribing || disabled || complete}
                onClick={() => void startRecording()}
              >
                {transcribing ? "文字にしています…" : currentValue ? "言い直す" : "話す"}
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!previous || listening || transcribing || complete}
              onClick={goPrevious}
            >
              戻る
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!field || listening || transcribing || complete}
              onClick={skip}
            >
              スキップ
            </button>
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
          <p className="voice-panel__note">
            いま聞いている欄は、そのまま手で直せます。ほかの欄を直すときは、いったん終了してください。
          </p>
        </section>
      )}
    </>
  );
}
