import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { ProblemDetailException } from "@/lib/exceptions";
import type { GenerateFlyerInput } from "@/lib/schemas";
import { RAIN_POLICY_LABELS } from "@/modules/events/types";
import type { FlyerCandidate, FlyerCandidateKind } from "@/modules/flyers/types";

const FLYER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function flyerApiBase(): string {
  return (process.env.FLYER_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
}

export function flyerCapacityLabel(capacity: number | null | undefined): string | null {
  if (capacity == null) return null;
  const label = `先着${capacity}名`;
  return label.length <= 20 ? label : null;
}

export function toFlyerPayload(input: GenerateFlyerInput) {
  return {
    title: input.title,
    event_date: input.eventDate,
    event_time: input.eventTime,
    price: input.price,
    location: input.location,
    rain_policy: RAIN_POLICY_LABELS[input.rainPolicy],
    capacity: flyerCapacityLabel(input.capacity),
    template_id: input.templateId,
    layout_id: input.layoutId ?? "classic",
  };
}

function storageDir(): string {
  return path.join(process.cwd(), "storage", "flyers");
}

export function assertFlyerAssetId(id: string): string {
  if (!FLYER_ID.test(id)) {
    throw new ProblemDetailException({
      status: 404,
      title: "Not Found",
      detail: "チラシが見つかりません。",
    });
  }
  return id;
}

function imagePath(id: string): string {
  return path.join(storageDir(), `${assertFlyerAssetId(id)}.jpg`);
}

export async function saveFlyerImage(id: string, bytes: Buffer): Promise<void> {
  await mkdir(storageDir(), { recursive: true });
  await writeFile(imagePath(id), bytes);
}

export async function readFlyerImage(id: string): Promise<Buffer> {
  try {
    return await readFile(imagePath(id));
  } catch {
    throw new ProblemDetailException({
      status: 404,
      title: "Not Found",
      detail: "チラシが見つかりません。",
    });
  }
}

export async function removeFlyerImage(id: string): Promise<void> {
  await rm(imagePath(id), { force: true });
}

interface FlyerGenerateResponse {
  status: string;
  generation_id: string;
  image_url: string;
}

async function readFlyerMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (body.message) return body.message;
  } catch {
    // 生成サービスが JSON 以外を返したときは、下の汎用文を使う。
  }
  return "チラシを生成できませんでした。";
}

/** 生成サービスの 4xx はそのまま通し、それ以外は 502 にまとめる。 */
function problemFromService(status: number, detail: string): ProblemDetailException {
  const passthrough = status === 400 || status === 403 || status === 404 || status === 422;
  const mapped = passthrough ? status : 502;
  return new ProblemDetailException({
    status: mapped,
    title:
      mapped === 404
        ? "Candidate Expired"
        : mapped === 422
          ? "Validation Error"
          : mapped === 400
            ? "Validation Error"
            : "Flyer Unavailable",
    detail,
  });
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export interface FlyerCandidateDto {
  candidate_id: string;
  kind: FlyerCandidateKind;
  label: string;
  description: string;
  image_url: string;
  template_id: string;
  layout_id: string;
  palette_id: string;
  accent_color: string;
  overlay_alpha: number;
}

function serializeCandidate(dto: FlyerCandidateDto): FlyerCandidate {
  return {
    candidateId: dto.candidate_id,
    kind: dto.kind,
    label: dto.label,
    description: dto.description,
    imageUrl: `/api/v1/flyers/candidates/${dto.candidate_id}`,
    templateId: dto.template_id,
    layoutId: dto.layout_id,
    paletteId: dto.palette_id,
    accentColor: dto.accent_color,
    overlayAlpha: dto.overlay_alpha,
  };
}

async function postCandidateRequest(path: string, body: unknown): Promise<FlyerCandidate[]> {
  const base = flyerApiBase();
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new ProblemDetailException({
      status: 502,
      title: "Flyer Unavailable",
      detail: "チラシ生成サービスに接続できません。flyer を起動しているか確認してください。",
    });
  }
  if (!response.ok) {
    throw problemFromService(response.status, await readFlyerMessage(response));
  }
  const payload = (await response.json()) as { candidates?: FlyerCandidateDto[] };
  if (!Array.isArray(payload.candidates) || payload.candidates.length === 0) {
    throw new ProblemDetailException({
      status: 502,
      title: "Flyer Unavailable",
      detail: "チラシ生成サービスの応答が不正です。",
    });
  }
  return payload.candidates.map(serializeCandidate);
}

/** ステップ 1。3 テンプレートの完成イメージ。 */
export async function proposeTypeCandidates(input: GenerateFlyerInput): Promise<FlyerCandidate[]> {
  return postCandidateRequest("/api/v1/flyers/candidates/types", toFlyerPayload(input));
}

/** ステップ 2。選んだタイプの背景タイル。 */
export async function proposeBackgroundCandidates(
  input: GenerateFlyerInput,
  count: number,
): Promise<FlyerCandidate[]> {
  return postCandidateRequest("/api/v1/flyers/candidates", {
    ...toFlyerPayload(input),
    count,
  });
}

/** ステップ 3。同じ背景で 4 通りの文字配置。 */
export async function proposeLayoutCandidates(candidateId: string): Promise<FlyerCandidate[]> {
  assertFlyerAssetId(candidateId);
  return postCandidateRequest(`/api/v1/flyers/candidates/${candidateId}/layouts`, {});
}

/** ステップ 4。選んだ配置のまま 4 通りの配色。 */
export async function proposePaletteCandidates(candidateId: string): Promise<FlyerCandidate[]> {
  assertFlyerAssetId(candidateId);
  return postCandidateRequest(`/api/v1/flyers/candidates/${candidateId}/palettes`, {});
}

/** 候補画像をブラウザへ中継するために、サービスの JPEG を取得する。 */
export async function readCandidateImage(candidateId: string): Promise<Buffer> {
  const id = assertFlyerAssetId(candidateId);
  const base = flyerApiBase();
  let response: Response;
  try {
    response = await fetch(`${base}/api/v1/flyers/candidates/${id}`, {
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ProblemDetailException({
      status: 502,
      title: "Flyer Unavailable",
      detail: "候補画像を取得できませんでした。",
    });
  }
  if (!response.ok) {
    throw problemFromService(response.status, await readFlyerMessage(response));
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || !isJpeg(bytes)) {
    throw new ProblemDetailException({
      status: 502,
      title: "Flyer Unavailable",
      detail: "候補画像の形式が不正です。",
    });
  }
  return bytes;
}

export async function generateFlyerImage(
  input: GenerateFlyerInput,
  candidateId?: string,
): Promise<{
  generationId: string;
  bytes: Buffer;
  status: string;
}> {
  const base = flyerApiBase();
  let generated: Response;
  try {
    generated = await fetch(`${base}/api/v1/flyers/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...toFlyerPayload(input),
        ...(candidateId ? { candidate_id: candidateId } : {}),
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new ProblemDetailException({
      status: 502,
      title: "Flyer Unavailable",
      detail: "チラシ生成サービスに接続できません。flyer を起動しているか確認してください。",
    });
  }

  if (!generated.ok) {
    throw problemFromService(generated.status, await readFlyerMessage(generated));
  }

  const payload = (await generated.json()) as FlyerGenerateResponse;
  const generationId = payload.generation_id;
  if (!FLYER_ID.test(generationId) || payload.image_url !== `/api/v1/flyers/${generationId}`) {
    throw new ProblemDetailException({
      status: 502,
      title: "Flyer Unavailable",
      detail: "チラシ生成サービスの応答が不正です。",
    });
  }

  let image: Response;
  try {
    image = await fetch(`${base}${payload.image_url}`, {
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ProblemDetailException({
      status: 502,
      title: "Flyer Unavailable",
      detail: "生成したチラシ画像を取得できませんでした。",
    });
  }

  if (!image.ok) {
    throw new ProblemDetailException({
      status: 502,
      title: "Flyer Unavailable",
      detail: "生成したチラシ画像を取得できませんでした。",
    });
  }

  const bytes = Buffer.from(await image.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || !isJpeg(bytes)) {
    throw new ProblemDetailException({
      status: 502,
      title: "Flyer Unavailable",
      detail: "生成したチラシ画像の形式が不正です。",
    });
  }

  return { generationId, bytes, status: payload.status };
}
