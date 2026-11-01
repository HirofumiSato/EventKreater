// @vitest-environment jsdom
//
// 画面が失敗したときの受け皿（`src/app/error.tsx`）の再発防止。
//
// ここが無いと、利用者には Next.js の英語の画面が出るだけで、戻る道が無い。
// 見るのは 3 つ。
//   1. 何が起きたかを日本語で出し、失敗の中身（例外の文面）は出さない
//   2. 主操作は「もう一度読み込む」1 つで、押すと `reset` を呼ぶ
//   3. サーバーの例外に付く `digest` だけは、問い合わせの手掛かりとして出す

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AppError from "@/app/error";

// `next/link` は Router の文脈を要求する。ここでは行き先だけを見たいので素の `<a>` にする。
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

afterEach(() => {
  cleanup();
});

/** 例外の文面は画面に出さない。`digest` はサーバーのログとの突き合わせに使う。 */
function failure(digest?: string) {
  const error = Object.assign(new Error("database connection refused"), { digest });
  vi.spyOn(console, "error").mockImplementation(() => {});
  return error as Error & { digest?: string };
}

describe("error.tsx（画面の受け皿）", () => {
  it("何が起きたかと、どうすればよいかを日本語で出す", () => {
    render(<AppError error={failure()} reset={() => {}} />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("画面を開けませんでした");
    expect(screen.getByText("一時的な不具合のことがあります。もう一度読み込んでください。")).toBeTruthy();
  });

  it("失敗の中身（例外の文面）は出さない", () => {
    render(<AppError error={failure()} reset={() => {}} />);

    expect(document.body.textContent).not.toContain("database connection refused");
  });

  it("主操作は「もう一度読み込む」1 つで、押すと reset を呼ぶ", () => {
    const reset = vi.fn();
    render(<AppError error={failure()} reset={reset} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe("もう一度読み込む");

    fireEvent.click(buttons[0]);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("トップへ戻る道を持つ", () => {
    render(<AppError error={failure()} reset={() => {}} />);

    expect(screen.getByRole("link", { name: "トップへ" }).getAttribute("href")).toBe("/");
  });

  it("digest があるときだけ、問い合わせ用の番号を出す", () => {
    render(<AppError error={failure("1234567890")} reset={() => {}} />);
    expect(screen.getByText(/1234567890/)).toBeTruthy();

    cleanup();
    render(<AppError error={failure()} reset={() => {}} />);
    expect(document.body.textContent).not.toContain("問い合わせのときは");
  });
});
