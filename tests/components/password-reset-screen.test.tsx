// @vitest-environment jsdom
//
// パスワード再設定の画面（`/auth/password/reset`）の再発防止。
//
// `?token=` の有無で 2 つの状態を持つ。ここで見るのは 5 つ。
//   1. 依頼は成功で「リンクを送りました」に切り替わり、API の共通文面を二重に出さない
//   2. メールのリンクを開くと、メールアドレスではなく新しいパスワードの欄になる
//   3. 確認用が一致しないときは送らない（8 文字未満も同じ）
//   4. 確定の成功は「再設定しました」とログインへのボタンを出す
//   5. リンクが使えない（400）ときは、送り直しの導線を出す

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PasswordResetPage from "@/app/auth/password/reset/page";
import { loginEntryUrl, passwordResetUrl } from "@/lib/auth-links";

const navigation = vi.hoisted(() => ({ search: new URLSearchParams("") }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navigation.search,
}));

// `next/link` は Router の文脈を要求する。行き先だけを見たいので素の `<a>` にする。
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const fetchMock = vi.fn();

/** API が返す共通文面。画面の見出し・注記と重ねて出さないことを見る。 */
const RESET_NOTICE =
  "パスワード再設定のリンクを送信しました。メールのリンクを開いてください。";

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

function problemResponse(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

function fillPasswords(password: string, confirmation: string) {
  fireEvent.change(screen.getByLabelText("新しいパスワード"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("確認のためもう一度"), { target: { value: confirmation } });
}

beforeEach(() => {
  navigation.search = new URLSearchParams("");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("メールアドレスの依頼", () => {
  it("送ると「リンクを送りました」に切り替わり、共通文面を二重に出さない", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ sent: true, detail: RESET_NOTICE }));

    render(<PasswordResetPage />);
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "taro@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "リンクを送る" }));

    expect(await screen.findByRole("heading", { name: "リンクを送りました" })).toBeTruthy();
    expect(screen.getByText("taro@example.com 宛に送りました。")).toBeTruthy();
    expect(screen.queryByText(RESET_NOTICE)).toBeNull();
    // 案内は 1 回だけ。見出しと API の detail を並べない。
    expect(screen.getAllByText(/リンクを送りました/)).toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/password/reset",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      email: "taro@example.com",
      audience: "organizer",
    });
  });
});

describe("メールのリンクを開いたとき", () => {
  it("メールアドレスではなく、新しいパスワードの 2 欄になる", () => {
    navigation.search = new URLSearchParams("token=abc123");

    render(<PasswordResetPage />);

    expect(screen.getByLabelText("新しいパスワード")).toBeTruthy();
    expect(screen.getByLabelText("確認のためもう一度")).toBeTruthy();
    expect(screen.queryByLabelText("メールアドレス")).toBeNull();
    expect(screen.getByRole("button", { name: "再設定する" })).toBeTruthy();
  });

  it("確認用が一致しないときは送らない", async () => {
    navigation.search = new URLSearchParams("token=abc123");

    render(<PasswordResetPage />);
    fillPasswords("password123", "password124");
    fireEvent.click(screen.getByRole("button", { name: "再設定する" }));

    expect(await screen.findByText("パスワードが一致しません。")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("8 文字未満のときも送らない", () => {
    navigation.search = new URLSearchParams("token=abc123");

    render(<PasswordResetPage />);
    fillPasswords("short", "short");
    fireEvent.click(screen.getByRole("button", { name: "再設定する" }));

    expect(fetchMock).not.toHaveBeenCalled();
    // 案内は欄の下の 1 か所だけ。送信の失敗として重ねない。
    expect(screen.getAllByText("8文字以上で入力してください。")).toHaveLength(1);
  });

  it("確定の成功は、再設定した事実とログインへのボタンを出す", async () => {
    navigation.search = new URLSearchParams("token=abc123");
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));

    render(<PasswordResetPage />);
    fillPasswords("password123", "password123");
    fireEvent.click(screen.getByRole("button", { name: "再設定する" }));

    expect(
      await screen.findByRole("heading", { name: "パスワードを再設定しました" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "ログインへ" }).getAttribute("href")).toBe(
      loginEntryUrl("organizer"),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/password/reset/confirm",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      token: "abc123",
      newPassword: "password123",
    });
  });

  it("参加者のリンクなら、ログインも参加者の入口へ送る", async () => {
    navigation.search = new URLSearchParams("token=abc123&audience=participant");
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));

    render(<PasswordResetPage />);
    fillPasswords("password123", "password123");
    fireEvent.click(screen.getByRole("button", { name: "再設定する" }));

    expect(
      await screen.findByRole("link", { name: "ログインへ" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "ログインへ" }).getAttribute("href")).toBe(
      loginEntryUrl("participant"),
    );
  });

  it("リンクが使えない（400）ときは、送り直しの導線を出す", async () => {
    navigation.search = new URLSearchParams("token=expired");
    fetchMock.mockResolvedValue(
      problemResponse(400, {
        error: "RESET_TOKEN_INVALID",
        detail: "このリンクは使えません。",
      }),
    );

    render(<PasswordResetPage />);
    fillPasswords("password123", "password123");
    fireEvent.click(screen.getByRole("button", { name: "再設定する" }));

    expect(await screen.findByText("このリンクは使えません。")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "リンクを送り直す" }).getAttribute("href"),
    ).toBe(passwordResetUrl("organizer"));
  });
});
