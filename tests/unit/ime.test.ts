import { describe, expect, it } from "vitest";
import { isImeComposing, isImeEnter, isImeEscape } from "@/lib/ime";

/**
 * `src/lib/ime.ts` の振る舞いを固定する。
 *
 * ここで守りたいのは 2 つ。変換確定・変換取り消しのキーを画面の操作にしないことと、
 * `keyCode === 229` をキーの一致で絞ること。後者を落とすと、IME を有効にしただけの
 * 状態で Escape が飲まれ、ダイアログが閉じなくなる。
 */
describe("isImeComposing", () => {
  it("変換中なら真", () => {
    expect(isImeComposing({ isComposing: true })).toBe(true);
  });

  it("229 が付いていれば、変換中でなくても真（IME が処理したキーの印）", () => {
    expect(isImeComposing({ key: "Enter", isComposing: false, keyCode: 229 })).toBe(true);
    expect(isImeComposing({ key: "Escape", keyCode: 229 })).toBe(true);
  });

  it("IME を有効にしただけ（変換中でなく 229 も無い）なら偽", () => {
    expect(isImeComposing({ key: "Escape", isComposing: false })).toBe(false);
    expect(isImeComposing({ key: "Escape", isComposing: false, keyCode: 27 })).toBe(false);
  });
});

describe("isImeEnter", () => {
  it("変換中の Enter は真", () => {
    expect(isImeEnter({ key: "Enter", isComposing: true, keyCode: 229 })).toBe(true);
    expect(isImeEnter({ key: "Enter", isComposing: true })).toBe(true);
  });

  it("確定 Enter は isComposing が false に戻っていても 229 で真（Safari の経路）", () => {
    expect(isImeEnter({ key: "Enter", isComposing: false, keyCode: 229 })).toBe(true);
  });

  it("通常の Enter は偽", () => {
    expect(isImeEnter({ key: "Enter", isComposing: false, keyCode: 13 })).toBe(false);
    expect(isImeEnter({ key: "Enter" })).toBe(false);
  });

  it("Enter 以外は 229 が付いていても偽", () => {
    expect(isImeEnter({ key: "Escape", isComposing: true, keyCode: 229 })).toBe(false);
    expect(isImeEnter({ key: "a", keyCode: 229 })).toBe(false);
    expect(isImeEnter({ keyCode: 229 })).toBe(false);
  });
});

describe("isImeEscape", () => {
  it("変換中の Escape は真", () => {
    expect(isImeEscape({ key: "Escape", isComposing: true, keyCode: 229 })).toBe(true);
    expect(isImeEscape({ key: "Escape", isComposing: true })).toBe(true);
  });

  it("IME 有効だが変換していない Escape は偽（ここを取り違えるとダイアログが閉じなくなる）", () => {
    expect(isImeEscape({ key: "Escape", isComposing: false })).toBe(false);
    expect(isImeEscape({ key: "Escape", isComposing: false, keyCode: 27 })).toBe(false);
  });

  it("Escape 以外は 229 が付いていても偽", () => {
    expect(isImeEscape({ key: "Enter", isComposing: true, keyCode: 229 })).toBe(false);
    expect(isImeEscape({ key: "Tab", keyCode: 229 })).toBe(false);
    expect(isImeEscape({ keyCode: 229 })).toBe(false);
  });
});

describe("React の合成イベント（nativeEvent 経由）", () => {
  // 画面側は `event.nativeEvent` をそのまま渡すことがある。素の KeyboardEvent と同じ結果になること。
  it("変換中の Enter は真", () => {
    expect(isImeEnter({ key: "Enter", nativeEvent: { isComposing: true, keyCode: 229 } })).toBe(true);
  });

  it("確定 Enter（isComposing は false、229 だけ残る）は真", () => {
    expect(isImeEnter({ key: "Enter", nativeEvent: { isComposing: false, keyCode: 229 } })).toBe(true);
  });

  it("通常の Enter は偽", () => {
    expect(isImeEnter({ key: "Enter", nativeEvent: { isComposing: false, keyCode: 13 } })).toBe(false);
  });

  it("変換中の Escape は真", () => {
    expect(isImeEscape({ key: "Escape", nativeEvent: { isComposing: true, keyCode: 229 } })).toBe(true);
  });

  it("IME 有効だが変換していない Escape は偽", () => {
    expect(isImeEscape({ key: "Escape", nativeEvent: { isComposing: false, keyCode: 27 } })).toBe(false);
  });

  it("key が Escape で 229 が付く仮想キーボードは真（キーで門を作っているので飲む）", () => {
    expect(isImeEscape({ key: "Escape", nativeEvent: { isComposing: false, keyCode: 229 } })).toBe(true);
    expect(isImeEnter({ key: "Enter", nativeEvent: { isComposing: false, keyCode: 229 } })).toBe(true);
  });

  it("nativeEvent があるときは nativeEvent の値を正とする", () => {
    // React の合成イベントは nativeEvent を持つ。判定の材料を 2 箇所に散らさない。
    expect(isImeEnter({ key: "Enter", isComposing: false, nativeEvent: { isComposing: true } })).toBe(true);
    expect(isImeEnter({ key: "Enter", isComposing: true, nativeEvent: { isComposing: false, keyCode: 13 } })).toBe(false);
  });
});
