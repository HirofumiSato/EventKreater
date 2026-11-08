import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingForm,
  readPendingForm,
  savePendingForm,
  takePendingForm,
  type PendingFormStorage,
} from "@/modules/events/lib/pending-form";
import { EMPTY_EVENT_FORM, createPricePlanDraft } from "@/modules/events/types";

/** ブラウザの `sessionStorage` の代わり。テストは Node で動くため自前で持つ。 */
function memoryStorage(initial: Record<string, string> = {}): PendingFormStorage & {
  entries: Map<string, string>;
} {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

function filledForm() {
  return {
    ...EMPTY_EVENT_FORM,
    title: "秋のご飯会",
    venueName: "テスト会場",
    pricePlans: [createPricePlanDraft({ audience: "ANY", name: "一般", amount: "3000" })],
  };
}

describe("登録前の入力の退避", () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it("保存した内容を、チラシの絵と保存時刻つきで読み戻せる", () => {
    const form = filledForm();
    savePendingForm(form, "https://example.com/flyer.png", storage);

    const pending = readPendingForm(storage);
    expect(pending?.form.title).toBe("秋のご飯会");
    expect(pending?.form.venueName).toBe("テスト会場");
    expect(pending?.flyerPreview).toBe("https://example.com/flyer.png");
    expect(typeof pending?.savedAt).toBe("string");
  });

  it("チラシが無いときは null を持つ", () => {
    savePendingForm(filledForm(), null, storage);
    expect(readPendingForm(storage)?.flyerPreview).toBeNull();
  });

  it("取り出すと 1 回で消える（別の用事で開いたときに古い内容を出さない）", () => {
    savePendingForm(filledForm(), null, storage);
    expect(takePendingForm(storage)?.form.title).toBe("秋のご飯会");
    expect(readPendingForm(storage)).toBeNull();
  });

  it("明示的に消せる", () => {
    savePendingForm(filledForm(), null, storage);
    clearPendingForm(storage);
    expect(readPendingForm(storage)).toBeNull();
  });

  it("壊れた JSON は捨てる", () => {
    storage.setItem("event:pending-form", "{ 壊れている");
    expect(readPendingForm(storage)).toBeNull();
  });

  it("形の違う値は捨てる（フォームだけ入っていても復元しない）", () => {
    storage.setItem("event:pending-form", JSON.stringify({ form: filledForm() }));
    expect(readPendingForm(storage)).toBeNull();
  });

  it("保存先が無い環境でも落ちない", () => {
    expect(() => savePendingForm(filledForm(), null, null)).not.toThrow();
    expect(readPendingForm(null)).toBeNull();
    expect(takePendingForm(null)).toBeNull();
    expect(() => clearPendingForm(null)).not.toThrow();
  });

  it("保存に失敗しても例外を投げない（入力は画面に残っているため）", () => {
    const broken: PendingFormStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    expect(() => savePendingForm(filledForm(), null, broken)).not.toThrow();
  });
});

describe("概要の復元", () => {
  it("概要を足す前に退避した内容は、summary を空文字にそろえて復元する", () => {
    // 概要の列を足す前のブラウザが書いた退避データ。`summary` のキー自体が無い。
    const { summary: _summary, ...legacyForm } = filledForm();
    const storage = memoryStorage({
      "event:pending-form": JSON.stringify({
        form: legacyForm,
        flyerPreview: null,
        savedAt: new Date().toISOString(),
      }),
    });

    const pending = readPendingForm(storage);
    expect(pending?.form.title).toBe("秋のご飯会");
    expect(pending?.form.summary).toBe("");
  });

  it("概要つきの退避データは、概要を保ったまま復元する", () => {
    const summary = "<b>河原で炊きます。</b><br>鍋を囲みましょう。";
    const storage = memoryStorage();
    savePendingForm({ ...filledForm(), summary }, null, storage);

    expect(readPendingForm(storage)?.form.summary).toBe(summary);
  });
});
