import { beforeEach, describe, expect, it } from "vitest";
import {
  detectImageKind,
  imageContentType,
  MAX_IMAGE_BYTES,
} from "@/modules/flyers/lib/upload";
import {
  consumeUploadAttempt,
  FLYER_UPLOAD_LIMIT,
  FLYER_UPLOAD_WINDOW_MS,
  resetUploadAttempts,
} from "@/modules/flyers/lib/upload-limit";

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

describe("detectImageKind", () => {
  it("JPEG / PNG / WebP を見分ける", () => {
    expect(detectImageKind(jpeg)).toBe("jpeg");
    expect(detectImageKind(png)).toBe("png");
    expect(detectImageKind(webp)).toBe("webp");
  });

  it("GIF と短すぎるバイト列は受け付けない", () => {
    expect(detectImageKind(gif)).toBeNull();
    expect(detectImageKind(Uint8Array.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageKind(new Uint8Array())).toBeNull();
  });

  it("MIME は許可した 3 形式だけを返す", () => {
    expect(imageContentType("jpeg")).toBe("image/jpeg");
    expect(imageContentType("png")).toBe("image/png");
    expect(imageContentType("webp")).toBe("image/webp");
  });

  it("上限は 8MB", () => {
    expect(MAX_IMAGE_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe("consumeUploadAttempt", () => {
  beforeEach(() => {
    resetUploadAttempts();
  });

  it("同じ端末は 10 分に 5 回まで", () => {
    const now = 1_000_000;
    for (let i = 0; i < FLYER_UPLOAD_LIMIT; i += 1) {
      expect(() => consumeUploadAttempt("owner-a", now)).not.toThrow();
    }

    let error: unknown;
    try {
      consumeUploadAttempt("owner-a", now);
    } catch (cause) {
      error = cause;
    }
    expect(error).toMatchObject({ status: 429 });
  });

  it("窓が過ぎれば再び使える", () => {
    const now = 1_000_000;
    for (let i = 0; i < FLYER_UPLOAD_LIMIT; i += 1) {
      consumeUploadAttempt("owner-a", now);
    }
    expect(() =>
      consumeUploadAttempt("owner-a", now + FLYER_UPLOAD_WINDOW_MS + 1),
    ).not.toThrow();
  });

  it("端末が違えば数え合わない", () => {
    const now = 1_000_000;
    for (let i = 0; i < FLYER_UPLOAD_LIMIT; i += 1) {
      consumeUploadAttempt("owner-a", now);
    }
    expect(() => consumeUploadAttempt("owner-b", now)).not.toThrow();
  });
});
