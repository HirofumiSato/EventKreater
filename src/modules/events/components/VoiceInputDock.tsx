"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic } from "lucide-react";
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
  firstNeededField,
  isFieldNeeded,
  nextNeededField,
  previousField,
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
 * 押すと音声モードに入り、上から順に空欄へ「見た目だけのフォーカス」を当てる。
 * 入力欄の DOM フォーカスは動かさない。日付・時刻の入力欄に実フォーカスを当てると
 * OS のピッカーが開き、マイクを止めてしまうためである。
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
  const [message, setMessage] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);

  // 非同期のコールバック（録音停止・住所検索）から最新値を読むための控え。
  const valueRef = useRef(value);
  const cursorRef = useRef<VoiceFieldKey | null>(null);
  const touchedRef = useRef<ReadonlySet<VoiceFieldKey>>(new Set());
  const includeOptionalRef = useRef(includeOptional);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
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

  const markTouched = useCallback((key: VoiceFieldKey) => {
    const next = new Set(touchedRef.current);
    next.add(key);
    touchedRef.current = next;
    setTouched(next);
  }, []);

  /** 郵便番号が入ったら、既存の検索 API で住所を補完する。失敗しても手入力に任せる。 */
  const fillAddressFromPostalCode = useCallback(
    async (postalCode: string, from: VoiceField) => {
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
        setMessage(`住所を「${first.prefecture}${first.city}${first.town}」で入れました。`);
        // 補完で埋まった欄へカーソルが残っていたら、次の空欄へ送る。
        const currentKey = cursorRef.current;
        const currentField = currentKey ? voiceFieldByKey(currentKey) : null;
        if (currentField && !isFieldNeeded(currentField, nextValue, scopeNow())) {
          const next = nextNeededField(nextValue, currentField.key, scopeNow());
          cursorRef.current = next?.key ?? null;
          setCursor(next?.key ?? null);
        }
      } catch {
        // 住所の補完は補助。取れなくても郵便番号だけで保存できる。
      }
    },
    [onChange, scopeNow],
  );

  const commit = useCallback(
    (field: VoiceField, text: string) => {
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

      const next = nextNeededField(nextValue, field.key, scopeNow());
      cursorRef.current = next?.key ?? null;
      setCursor(next?.key ?? null);
      if (next) {
        setMessage(null);
        api.announce(`${field.label}を「${text}」で入力しました。次は${next.label}です。`);
      } else {
        setMessage("入力できる欄がすべて埋まりました。内容を確認してください。");
        api.announce("音声で入力できる欄がすべて埋まりました。");
      }

      if (field.key === "postalCode" && patch.postalCode) {
        void fillAddressFromPostalCode(patch.postalCode, field);
      }
      return true;
    },
    [api, fillAddressFromPostalCode, markTouched, onChange, scopeNow],
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
        setMessage("入力できる欄がすべて埋まりました。");
        return;
      }

      try {
        const result = await transcribeVoiceClip({ blob, field: field.key });
        if (!mountedRef.current) return;
        setPhase("armed");
        commit(field, result.text);
      } catch (error) {
        if (!mountedRef.current) return;
        setPhase("armed");
        setMessage(
          error instanceof Error ? error.message : "音声を文字にできませんでした。手で入力してください。",
        );
      }
    },
    [commit, releaseStream],
  );

  const stopRecording = useCallback(() => {
    clearTimer();
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setPhase("transcribing");
    recorder.stop();
  }, [clearTimer]);

  const startRecording = useCallback(async () => {
    if (!cursorRef.current) {
      setMessage("入力できる欄がすべて埋まりました。内容を確認してください。");
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
  }, [finishRecording, releaseStream, stopRecording]);

  const stopSession = useCallback(() => {
    clearTimer();
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
    setMessage(null);
    setTranscript(null);
    cursorRef.current = null;
    setCursor(null);
  }, [clearTimer, releaseStream]);

  useEffect(() => () => {
    clearTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, [clearTimer]);

  const startSession = useCallback(() => {
    if (disabled) return;
    const first = firstNeededField(valueRef.current, {
      showOrganizerName,
      includeOptional: includeOptionalRef.current,
      touched: new Set(),
    });
    touchedRef.current = new Set();
    setTouched(new Set());
    setActive(true);
    setPhase("armed");
    setTranscript(null);
    cursorRef.current = first?.key ?? null;
    setCursor(first?.key ?? null);
    setMessage(
      first
        ? null
        : "空欄がありません。手で直したい欄を押すと、その欄を音声で入れ直せます。",
    );
    if (first) api.announce(`音声入力を始めます。${first.prompt}`);
    api.openStep(first?.step ?? "basic");
  }, [api, disabled, showOrganizerName]);

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
    setMessage(next ? null : "入力できる欄がすべて埋まりました。内容を確認してください。");
    if (next) api.announce(`次は${next.label}です。`);
  };

  return (
    <>
      <button
        type="button"
        className={`voice-fab${active ? " voice-fab--active" : ""}`}
        aria-label={active ? "音声入力を終了" : "音声入力を開始"}
        aria-pressed={active}
        disabled={disabled}
        onClick={() => (active ? stopSession() : startSession())}
      >
        <Mic aria-hidden="true" size={22} />
        <span className="voice-fab__label">{active ? "終了" : "音声入力"}</span>
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

          {field ? (
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
              <button type="button" className="btn btn--primary btn--sm" onClick={stopRecording}>
                停止して入力
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={!field || transcribing || disabled}
                onClick={() => void startRecording()}
              >
                {transcribing ? "文字にしています…" : currentValue ? "言い直す" : "話す"}
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!previous || listening || transcribing}
              onClick={goPrevious}
            >
              戻る
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!field || listening || transcribing}
              onClick={skip}
            >
              スキップ
            </button>
          </div>

          <label className="check voice-panel__optional">
            <input
              type="checkbox"
              checked={includeOptional}
              disabled={listening || transcribing}
              onChange={(event) => setIncludeOptional(event.target.checked)}
            />
            任意の項目も聞く
          </label>
          <p className="voice-panel__note">
            音声で入れた値は、そのまま手で直せます。直したい欄を押すと、その欄を音声で入れ直せます。
          </p>
        </section>
      )}
    </>
  );
}
