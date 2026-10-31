"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isRegisterRequired,
  isSessionExpired,
  problemMessage,
  readProblemBody,
} from "@/lib/problem";
import { FLYER_TEMPLATE_IDS } from "@/modules/events/types";
import type { FlyerFormPayload } from "@/modules/flyers/lib/form";
import { flyerQuotaLabel } from "@/modules/flyers/lib/quota-label";
import { MAX_IMAGE_BYTES, UPLOAD_ACCEPT } from "@/modules/flyers/lib/upload";
import type {
  FlyerCandidate,
  FlyerQuota,
  FlyerWizardStep,
} from "@/modules/flyers/types";
import { Alert } from "@/components/ui";

const STEP_TITLES: Record<FlyerWizardStep, string> = {
  1: "背景",
  2: "紙面の性格",
};

const STEP_HINTS: Record<FlyerWizardStep, string> = {
  1: "背景を選んでください。題と場所から、何が起きるイベントか、どの場かを残して絵柄を決めます。題の語は落としません。人が出るときは後ろ姿や横顔で、顔は描きません。対象世代は居る人の年代の手がかりで、空でも題が人を含めば出ます。1枚ずつ作り、気に入らなければ作り直せます。",
  2: "同じ写真の上で、書体と余白の取り方を比べます。紙も差し色も 3 枚で同じです。選んだ内容でチラシを保存します。",
};

/**
 * ステップ 1 で一度に出す背景の枚数。
 * AI 生成は 1 枚でも課金が起きるため、1 枚ずつ出して作り直させる。
 */
const BACKGROUND_COUNT = 1;

const EMPTY_STEPS: Record<FlyerWizardStep, FlyerCandidate[]> = {
  1: [],
  2: [],
};

const EMPTY_SELECTION: Record<FlyerWizardStep, FlyerCandidate | null> = {
  1: null,
  2: null,
};

interface FlyerCandidateModalProps {
  open: boolean;
  draftKey: string;
  /** 保存済みイベントの ID。共同主催者と回数枠を共有する。 */
  eventId?: string | null;
  base: FlyerFormPayload;
  onClose: () => void;
  onGenerated: (asset: { id: string; imageUrl: string }, status: string) => void;
  onQuotaChange: (quota: FlyerQuota) => void;
}

interface CandidateResponse {
  candidates?: FlyerCandidate[];
  quota?: FlyerQuota;
  /** AI で背景を作れず、テーマの下地へ落ちたか。背景のステップだけ立つ。 */
  aiFallback?: boolean;
}

export function FlyerCandidateModal({
  open,
  draftKey,
  eventId = null,
  base,
  onClose,
  onGenerated,
  onQuotaChange,
}: FlyerCandidateModalProps) {
  const [step, setStep] = useState<FlyerWizardStep>(1);
  const [candidates, setCandidates] =
    useState<Record<FlyerWizardStep, FlyerCandidate[]>>(EMPTY_STEPS);
  const [selected, setSelected] =
    useState<Record<FlyerWizardStep, FlyerCandidate | null>>(EMPTY_SELECTION);
  const [quota, setQuota] = useState<FlyerQuota | null>(null);
  const [aiFallback, setAiFallback] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<FlyerCandidate | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registerRequired, setRegisterRequired] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setStep(1);
    setCandidates(EMPTY_STEPS);
    setSelected(EMPTY_SELECTION);
    setQuota(null);
    setError(null);
    setAiFallback(false);
    setRegisterRequired(false);
    setSessionExpired(false);
    setSaving(false);
    setUploading(false);
    setUploaded(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  /** 候補を 1 ステップ分取りに行く。呼び出し時点の選択を親にする。 */
  const load = useCallback(
    async (target: FlyerWizardStep, current: Record<FlyerWizardStep, FlyerCandidate | null>) => {
      setLoading(true);
      setError(null);
      setSessionExpired(false);
      try {
        let url = "";
        let body: Record<string, unknown> = {};
        if (target === 1) {
          url = "/api/v1/flyers/candidates";
          body = {
            ...base,
            draftKey,
            eventId,
            // この段の書体は仮。次の段で同じ背景の上に 3 種を焼き直す。
            templateId: FLYER_TEMPLATE_IDS[0],
            layoutId: "classic",
            count: BACKGROUND_COUNT,
          };
        } else {
          const background = current[1];
          if (!background) return;
          url = `/api/v1/flyers/candidates/${background.candidateId}/types`;
        }
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const problem = await readProblemBody(response);
          if (isRegisterRequired(problem)) setRegisterRequired(true);
          if (isSessionExpired(problem)) setSessionExpired(true);
          throw new Error(problemMessage(problem, "候補を作れませんでした"));
        }
        const data = (await response.json()) as CandidateResponse;
        const next = data.candidates ?? [];
        if (next.length === 0) {
          throw new Error("候補が返ってきませんでした。もう一度お試しください。");
        }
        setCandidates((prev) => ({ ...prev, [target]: next }));
        setSelected((prev) => ({ ...prev, [target]: next[0] }));
        setAiFallback(target === 1 && data.aiFallback === true);
        setStep(target);
        if (data.quota) {
          setQuota(data.quota);
          onQuotaChange(data.quota);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "候補を作れませんでした");
      } finally {
        setLoading(false);
      }
    },
    [base, draftKey, eventId, onQuotaChange],
  );

  /** 自分の写真を 1 枚だけ背景候補にする。成功したらその 1 枚を選択状態にする。 */
  const uploadPhoto = async (file: File) => {
    if (uploading) return;
    setUploadError(null);
    if (file.size > MAX_IMAGE_BYTES) {
      setUploadError("画像は8MB以下にしてください。");
      return;
    }

    const form = new FormData();
    form.append("file", file);
    form.append("draftKey", draftKey);
    if (eventId) form.append("eventId", eventId);
    form.append("title", base.title);
    form.append("eventDate", base.eventDate);
    form.append("eventTime", base.eventTime);
    form.append("price", base.price);
    form.append("location", base.location);
    form.append("rainPolicy", base.rainPolicy);
    if (base.capacity != null) form.append("capacity", String(base.capacity));
    if (base.themeId) form.append("themeId", base.themeId);
    if (base.targetGeneration) form.append("targetGeneration", base.targetGeneration);
    form.append("templateId", selected[1]?.templateId ?? FLYER_TEMPLATE_IDS[0]);
    form.append("layoutId", "classic");

    setUploading(true);
    try {
      const response = await fetch("/api/v1/flyers/uploads", {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        const problem = await readProblemBody(response);
        if (isRegisterRequired(problem)) setRegisterRequired(true);
        if (isSessionExpired(problem)) setSessionExpired(true);
        throw new Error(problemMessage(problem, "写真を読み込めませんでした"));
      }
      const data = (await response.json()) as {
        candidate: FlyerCandidate;
        quota?: FlyerQuota;
      };
      setUploaded(data.candidate);
      setSelected((prev) => ({ ...prev, 1: data.candidate, 2: null }));
      setCandidates((prev) => ({ ...prev, 2: [] }));
      setStep(1);
      setError(null);
      if (data.quota) {
        setQuota(data.quota);
        onQuotaChange(data.quota);
      }
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : "写真を読み込めませんでした");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // 開いたら毎回ステップ 1 から。前回の選択を持ち越さない。
  // `base` は親の再描画ごとに新しい object になるので、effect の依存に入れず ref で渡す。
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    if (!open) return;
    reset();
    void loadRef.current(1, EMPTY_SELECTION);
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, saving, onClose]);

  const choose = (target: FlyerWizardStep, candidate: FlyerCandidate) => {
    setSelected((prev) => {
      const next = { ...prev, [target]: candidate };
      for (let later = target + 1; later <= 2; later += 1) {
        next[later as FlyerWizardStep] = null;
      }
      return next;
    });
    // 後続ステップは親が変われば作り直す。残しておくと別の背景の候補が混ざる。
    setCandidates((prev) => {
      const next = { ...prev };
      for (let later = target + 1; later <= 2; later += 1) {
        next[later as FlyerWizardStep] = [];
      }
      return next;
    });
  };

  const goNext = () => {
    const current = selected[step];
    if (!current) {
      setError("候補を 1 つ選んでください。");
      return;
    }
    if (step === 2) {
      void confirm();
      return;
    }
    const target = (step + 1) as FlyerWizardStep;
    if (candidates[target].length > 0) {
      setStep(target);
      setError(null);
      return;
    }
    void load(target, selected);
  };

  const goBack = () => {
    if (step === 1) return;
    setError(null);
    setStep((step - 1) as FlyerWizardStep);
  };

  const confirm = async () => {
    const chosen = selected[2];
    if (!chosen || saving) return;
    setSaving(true);
    setError(null);
    setSessionExpired(false);
    try {
      const response = await fetch("/api/v1/flyers/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...base,
          draftKey,
          eventId,
          candidateId: chosen.candidateId,
          templateId: chosen.templateId,
          layoutId: chosen.layoutId,
          paletteId: chosen.paletteId,
          titleColor: chosen.titleColor,
        }),
      });
      if (!response.ok) {
        const problem = await readProblemBody(response);
        if (isRegisterRequired(problem)) setRegisterRequired(true);
        if (isSessionExpired(problem)) setSessionExpired(true);
        throw new Error(problemMessage(problem, "チラシを保存できませんでした"));
      }
      const data = (await response.json()) as {
        flyerAsset: { id: string; imageUrl: string };
        generationStatus: string;
        quota?: FlyerQuota;
      };
      if (data.quota) {
        setQuota(data.quota);
        onQuotaChange(data.quota);
      }
      onGenerated(data.flyerAsset, data.generationStatus);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "チラシを保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  const busy = loading || saving || uploading;
  const visible = useMemo(() => candidates[step], [candidates, step]);
  const uploadSelected = Boolean(
    uploaded && selected[1]?.candidateId === uploaded.candidateId,
  );
  // 背景の供給元と、AI であと何枚作れるか。作り直しボタンの表示に使う。
  const backgroundCandidate = candidates[1][0] ?? null;
  const backgroundFromAi = backgroundCandidate?.source === "ai";
  const aiRemaining = backgroundCandidate?.aiRemaining ?? null;
  const aiExhausted = aiRemaining === 0;

  if (!open) return null;

  return (
    <div className="modal modal--open" role="presentation">
      <button
        type="button"
        className="modal__backdrop"
        aria-label="閉じる"
        onClick={() => {
          if (!saving) onClose();
        }}
      />
      <div
        className="wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="flyer-wizard-title"
      >
        <div className="wizard__head">
          <div className="wizard__title-row">
            <h2 id="flyer-wizard-title" className="wizard__title">
              チラシを作る
            </h2>
            {quota && (
              <p className="wizard__quota">
                {flyerQuotaLabel(quota, { eventScoped: Boolean(eventId) })}
              </p>
            )}
          </div>
          <ol className="wizard__steps">
            {([1, 2] as FlyerWizardStep[]).map((value) => (
              <li
                key={value}
                className={[
                  "wizard__step",
                  value === step ? "wizard__step--active" : "",
                  value < step ? "wizard__step--done" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-current={value === step ? "step" : undefined}
              >
                {value}. {STEP_TITLES[value]}
              </li>
            ))}
          </ol>
        </div>

        <div className="wizard__body">
          <p className="wizard__hint">{STEP_HINTS[step]}</p>

          {step === 1 && (
            <section
              className={`candidate-upload${uploadSelected ? " candidate-upload--selected" : ""}`}
              aria-label="自分の写真を背景にする"
            >
              <div className="candidate-upload__preview">
                {uploaded ? (
                  <img src={uploaded.imageUrl} alt={uploaded.label} />
                ) : (
                  <span className="candidate-upload__empty" aria-hidden="true">
                    A4
                  </span>
                )}
              </div>
              <div className="candidate-upload__body">
                <p className="candidate-upload__title">自分の写真</p>
                <p className="candidate-upload__hint">
                  {uploaded
                    ? "中央をA4縦で切り抜いた範囲が、そのまま背景になります。"
                    : "JPEG / PNG / WebP、8MBまで。中央をA4縦で切り抜きます。"}
                </p>
                <div className="candidate-upload__actions">
                  {uploaded && !uploadSelected && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busy}
                      onClick={() => choose(1, uploaded)}
                    >
                      この写真を選ぶ
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading
                      ? "読み込んでいます…"
                      : uploaded
                        ? "別の写真に差し替える"
                        : "自分の写真を使う"}
                  </button>
                  {uploadSelected && (
                    <span className="candidate-upload__badge">選択中</span>
                  )}
                </div>
                {uploadError && <Alert tone="error">{uploadError}</Alert>}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={UPLOAD_ACCEPT}
                className="visually-hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadPhoto(file);
                }}
              />
            </section>
          )}

          {loading ? (
            <div className="candidate-grid" aria-busy="true" aria-label="候補を準備しています">
              {Array.from({ length: step === 2 ? 3 : BACKGROUND_COUNT }).map(
                (_, index) => (
                  <div key={index} className="candidate-skeleton" />
                ),
              )}
            </div>
          ) : (
            <div className="candidate-grid">
              {visible.map((candidate) => {
                const active = selected[step]?.candidateId === candidate.candidateId;
                return (
                  <button
                    key={candidate.candidateId}
                    type="button"
                    className={`candidate-tile${active ? " candidate-tile--selected" : ""}`}
                    aria-pressed={active}
                    onClick={() => choose(step, candidate)}
                  >
                    <span className="candidate-tile__frame">
                      <img
                        src={candidate.imageUrl}
                        alt={candidate.label}
                        loading="lazy"
                        decoding="async"
                      />
                      {active && <span className="candidate-tile__check">選択中</span>}
                      {candidate.recommended && (
                        <span className="candidate-tile__badge candidate-tile__badge--recommend">
                          このテーマに合う
                        </span>
                      )}
                      {candidate.source === "ai" && (
                        <span className="candidate-tile__badge">AI生成</span>
                      )}
                    </span>
                    <span className="candidate-tile__label">{candidate.label}</span>
                    {candidate.description && (
                      <span className="candidate-tile__desc">{candidate.description}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {step === 1 && aiFallback && !uploadSelected && (
            <Alert tone="warning">
              {aiExhausted
                ? "AIの作成回数の上限です。テーマの下地で表示しています。"
                : "AIで背景を作れませんでした。テーマの下地で表示しています。作り直せます。"}
            </Alert>
          )}

          {step === 1 && !loading && (
            <div className="candidate-retry">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={busy || aiExhausted}
                onClick={() => void load(1, selected)}
              >
                別の背景を作る
              </button>
              {aiExhausted ? (
                <span className="candidate-retry__note">
                  AIで作れるのは1時間に3枚までです。しばらく待つと回復します。
                </span>
              ) : (
                backgroundFromAi &&
                aiRemaining !== null && (
                  <span className="candidate-retry__note">
                    AIで作れるのはあと{aiRemaining}枚です
                  </span>
                )
              )}
            </div>
          )}

          {error && <Alert tone="error">{error}</Alert>}
          {sessionExpired && (
            <Alert tone="warning">
              ログインの有効期限が切れています。
              <a href="/auth/login">ログインし直す</a>
            </Alert>
          )}
          {registerRequired && (
            <Alert tone="warning">
              未ログインで作れるチラシは 1 回までです。
              <a href="/auth/register?mode=register">会員登録して続ける</a>
            </Alert>
          )}
        </div>

        <div className="wizard__foot">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              if (saving) return;
              onClose();
            }}
          >
            やめる
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={step === 1 || busy}
            onClick={goBack}
          >
            戻る
          </button>
          <button
            type="button"
            className="btn btn--sm"
            disabled={busy || !selected[step]}
            onClick={() => void goNext()}
          >
            {saving
              ? "保存しています…"
              : loading
                ? "準備しています…"
                : step === 2
                  ? "このデザインで保存"
                  : "次へ"}
          </button>
        </div>
      </div>
    </div>
  );
}
