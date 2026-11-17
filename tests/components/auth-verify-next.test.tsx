// @vitest-environment jsdom
//
// 確認画面（`/auth/verify`）の戻り先の再発防止。
//
// 確認メールの URL には、登録を始めた画面（`next`）が載っている。
// ここで見るのは 4 つ。
//   1. 電話番号の確認へ、確認メールの `next` を保ったまま進む
//   2. `audience` が無くても、`next` が参加者の画面なら参加者の入口へ送る
//   3. `replaceState` でクエリを消したあとも、リンクの `next` が消えない
//   4. `next` が無ければ、これまでどおりクエリを付けない

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VerifyPage from "@/app/auth/verify/page";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

const navigation = vi.hoisted(() => ({ search: new URLSearchParams("") }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => navigation.search,
}));

// `next/link` は Router の文脈を要求する。行き先だけを見たいので素の `<a>` にする。
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const fetchMock = vi.fn();

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  navigation.search = new URLSearchParams("");
  router.push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse({ verified: true, next: "phone" }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("電話番号の確認への引き継ぎ", () => {
  it("確認メールの next を保ったまま、電話番号の確認へ進む", async () => {
    navigation.search = new URLSearchParams(
      "token=abcdefghijklmnopqrstuvwx&next=%2Forganizer%2Fevents%2Fnew%3Fref%3Dabc",
    );

    render(<VerifyPage />);
    fireEvent.click(screen.getByRole("button", { name: "確認を完了する" }));

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        "/auth/register?step=phone&next=%2Forganizer%2Fevents%2Fnew%3Fref%3Dabc",
      ),
    );
  });

  it("audience が無くても、next が参加者の画面なら参加者の入口へ送る", async () => {
    navigation.search = new URLSearchParams(
      "token=abcdefghijklmnopqrstuvwx&next=%2Fparticipant%2Fevents%2Fabc",
    );

    render(<VerifyPage />);
    fireEvent.click(screen.getByRole("button", { name: "確認を完了する" }));

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        "/participant/login?step=phone&next=%2Fparticipant%2Fevents%2Fabc",
      ),
    );
  });

  it("replaceState でクエリを消したあとも、リンクの next を保つ", async () => {
    navigation.search = new URLSearchParams(
      "token=abcdefghijklmnopqrstuvwx&next=%2Forganizer%2Fevents%2Fnew",
    );

    render(<VerifyPage />);
    fireEvent.click(screen.getByRole("button", { name: "確認を完了する" }));

    // 確認が終わると `?token=` を履歴から消す。リンクは state に固定した next から作る。
    const link = await screen.findByRole("link", { name: "電話番号の確認へ" });
    expect(link.getAttribute("href")).toBe(
      "/auth/register?step=phone&next=%2Forganizer%2Fevents%2Fnew",
    );
  });
});

describe("next が無いとき", () => {
  it("電話番号の確認へはクエリを付けず、ログインの入口も変えない", async () => {
    navigation.search = new URLSearchParams("token=abcdefghijklmnopqrstuvwx");

    render(<VerifyPage />);
    expect(screen.getByRole("link", { name: "ログイン画面へ" }).getAttribute("href")).toBe(
      "/auth/register?mode=login",
    );

    fireEvent.click(screen.getByRole("button", { name: "確認を完了する" }));

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/auth/register?step=phone"),
    );
  });
});
