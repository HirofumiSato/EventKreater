// @vitest-environment jsdom
//
// 登録・ログインの入口（`AuthEntryScreen`）の再発防止。
//
// 新規登録の応答も `verificationRequired: true` を返すため、未確認ログインと
// 区別しないと、登録の成功と同時にログインのフォームへ切り替わってしまう。
// ここで見るのは 6 つ。
//   1. 登録の成功は登録のフォームのまま、確認メールの案内と再送だけを出す
//   2. 未確認のままログインしたときは、ログインフォームのまま再送を出す（FE-AUTH-17）
//   3. 「メールアドレスを直す」で登録のフォームへ戻れる
//   4. 再送の成功は、送り直した事実だけを出す（案内の本文を重ねない）
//   5. 登録とログインはタブで切り替え、題（`h1`）と地の色は変えない
//   6. 入力欄はタブの下の面にまとめ、タブと面を 1 枚の紙としてつなげる

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { passwordResetUrl } from "@/lib/auth-links";
import { AuthEntryScreen } from "@/modules/auth/components/AuthEntryScreen";

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

// 入口の判定は別の試験が持つ。ここでは常に未ログインとして、フォームを出す。
vi.mock("@/modules/auth/hooks/useExistingSession", () => ({
  useExistingSession: () => ({ state: "anonymous", user: null, pendingChallenge: false }),
}));

const fetchMock = vi.fn();

/** API が返す案内の本文。パネルの見出し・注記と重ねて出さないことを見る。 */
const VERIFICATION_NOTICE =
  "確認メールを送信しました。メールのリンクを開いてください。届かない場合は迷惑メールも確認してください。";

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

async function register(name: string, email: string, password: string) {
  fireEvent.change(screen.getByLabelText("名前"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "登録してはじめる" }));
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

describe("登録の成功", () => {
  it("登録のフォームのまま、確認メールの案内と再送を出す", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        verificationRequired: true,
        detail: "確認メールを送信しました。メールのリンクを開いてください。",
      }),
    );

    render(<AuthEntryScreen audience="organizer" />);
    await register("山田 太郎", "taro@example.com", "password123");

    expect(
      await screen.findByRole("heading", { name: "確認メールを送信しました" }),
    ).toBeTruthy();
    expect(screen.getByText("taro@example.com 宛に送りました。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "確認メールを再送する" })).toBeTruthy();
  });

  it("ログインのフォーム・パスワード欄を出さない", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        verificationRequired: true,
        detail: "確認メールを送信しました。メールのリンクを開いてください。",
      }),
    );

    render(<AuthEntryScreen audience="organizer" />);
    await register("山田 太郎", "taro@example.com", "password123");
    await screen.findByRole("heading", { name: "確認メールを送信しました" });

    // タブは登録のまま。ログインに切り替えると出る欄は無い。
    expect((screen.getByRole("radio", { name: "ログイン" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("button", { name: "ログイン" })).toBeNull();
    expect(screen.queryByLabelText("パスワード")).toBeNull();
  });

  it("同じ案内を 2 回出さない（見出しは 1 回、detail は出さない）", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ verificationRequired: true, detail: VERIFICATION_NOTICE }),
    );

    render(<AuthEntryScreen audience="organizer" />);
    await register("山田 太郎", "taro@example.com", "password123");
    await screen.findByRole("heading", { name: "確認メールを送信しました" });

    expect(screen.getAllByText(/確認メールを送信しました/)).toHaveLength(1);
    expect(screen.queryByText(VERIFICATION_NOTICE)).toBeNull();
  });
});

describe("確認メールの再送", () => {
  it("登録の確認パネルで、送り直した事実だけを出す", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ verificationRequired: true, detail: VERIFICATION_NOTICE }))
      .mockResolvedValueOnce(jsonResponse({ verificationRequired: true, detail: VERIFICATION_NOTICE }));

    render(<AuthEntryScreen audience="organizer" />);
    await register("山田 太郎", "taro@example.com", "password123");
    await screen.findByRole("heading", { name: "確認メールを送信しました" });

    fireEvent.click(screen.getByRole("button", { name: "確認メールを再送する" }));

    expect(await screen.findByText("確認メールを送り直しました。")).toBeTruthy();
    expect(screen.queryByText(VERIFICATION_NOTICE)).toBeNull();
  });

  it("未確認ログインのフォームでも、送り直した事実だけを出す", async () => {
    navigation.search = new URLSearchParams("mode=login");
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ verificationRequired: true, unverifiedEmail: true, detail: VERIFICATION_NOTICE }),
      )
      .mockResolvedValueOnce(jsonResponse({ verificationRequired: true, detail: VERIFICATION_NOTICE }));

    render(<AuthEntryScreen audience="organizer" />);
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "taro@example.com" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ログイン" }));

    await screen.findByText(VERIFICATION_NOTICE);
    fireEvent.click(screen.getByRole("button", { name: "確認メールを再送する" }));

    expect(await screen.findByText("確認メールを送り直しました。")).toBeTruthy();
    expect(screen.queryByText(VERIFICATION_NOTICE)).toBeNull();
  });
});

describe("未確認のままログインしたとき", () => {
  it("ログインフォームのまま、確認メールの案内と再送を出す", async () => {
    navigation.search = new URLSearchParams("mode=login");
    fetchMock.mockResolvedValue(
      jsonResponse({
        verificationRequired: true,
        unverifiedEmail: true,
        detail: "確認メールを送信しました。メールのリンクを開いてください。",
      }),
    );

    render(<AuthEntryScreen audience="organizer" />);
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "taro@example.com" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ログイン" }));

    expect(
      await screen.findByText("確認メールを送信しました。メールのリンクを開いてください。"),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "主催者アカウント" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ログイン" })).toBeTruthy();
    expect(screen.getByLabelText("パスワード")).toBeTruthy();
    expect(screen.getByRole("button", { name: "確認メールを再送する" })).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "確認メールを送信しました" }),
    ).toBeNull();
  });
});

describe("登録とログインの切り替え", () => {
  it("タブで切り替えても、題と role の札は変えずにカードの中身だけを入れ替える", () => {
    render(<AuthEntryScreen audience="participant" />);

    expect(screen.getByRole("heading", { name: "参加者アカウント" })).toBeTruthy();
    // 画面上部の役割の札（eyebrow）は、どの状態でも出す。
    expect(screen.getByText("参加者", { selector: ".eyebrow" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "登録して参加履歴を残す" })).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "ログイン" }));

    expect(screen.getByRole("heading", { name: "参加者アカウント" })).toBeTruthy();
    expect(screen.getByText("参加者", { selector: ".eyebrow" })).toBeTruthy();
    expect(screen.queryByLabelText("名前")).toBeNull();
    expect(screen.getByRole("button", { name: "ログイン" })).toBeTruthy();
  });

  it("入力欄はタブの下の面にまとめ、タブと面を 1 枚の紙としてつなげる", () => {
    const { container } = render(<AuthEntryScreen audience="organizer" />);

    const card = container.querySelector(".auth-card--tabs");
    // タブと面は兄弟。面の中にタブを入れると、選んだタブの下辺で面の上辺を覆えない。
    const tabs = card?.querySelector(":scope > .auth-tabs");
    const panel = card?.querySelector(":scope > .auth-card__panel");
    expect(tabs).toBeTruthy();
    expect(panel).toBeTruthy();
    expect(panel?.querySelector("form.auth-card__body")).toBeTruthy();
    expect(panel?.querySelectorAll("input").length).toBeGreaterThan(0);
    expect(panel?.querySelector(".auth-tabs")).toBeNull();
  });
});

describe("地の色の役割分け", () => {
  it("参加者の入口だけに、参加者の色を当てる目印を付ける", () => {
    const participant = render(<AuthEntryScreen audience="participant" />);
    expect(participant.container.querySelector(".page--auth--participant")).toBeTruthy();
    expect(participant.container.querySelector(".page--auth--organizer")).toBeNull();
    cleanup();

    const organizer = render(<AuthEntryScreen audience="organizer" />);
    expect(organizer.container.querySelector(".page--auth--organizer")).toBeTruthy();
    expect(organizer.container.querySelector(".page--auth--participant")).toBeNull();
  });
});

describe("メールアドレスの修正", () => {
  it("「メールアドレスを直す」で、名前・メール・パスワードのフォームへ戻る", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        verificationRequired: true,
        detail: "確認メールを送信しました。メールのリンクを開いてください。",
      }),
    );

    render(<AuthEntryScreen audience="organizer" />);
    await register("山田 太郎", "taro@example.com", "password123");
    await screen.findByRole("heading", { name: "確認メールを送信しました" });

    fireEvent.click(screen.getByRole("button", { name: "メールアドレスを直す" }));

    expect((screen.getByRole("radio", { name: "新規登録" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("名前")).toBeTruthy();
    expect(screen.getByLabelText("メールアドレス")).toBeTruthy();
    expect(screen.getByLabelText("パスワード")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "確認メールを送信しました" }),
    ).toBeNull();
  });
});

describe("パスワードを忘れたとき", () => {
  it("ログインのときだけ、パスワード欄の下にリンクを出す", () => {
    const { container } = render(<AuthEntryScreen audience="participant" />);

    // 新規登録では出さない（まだパスワードを決めていない）。
    expect(screen.queryByRole("link", { name: "パスワードを忘れた" })).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "ログイン" }));

    const link = screen.getByRole("link", { name: "パスワードを忘れた" });
    expect(link.getAttribute("href")).toBe(passwordResetUrl("participant"));
    // パスワード欄のすぐ下に置く。
    const password = screen.getByLabelText("パスワード");
    expect(password.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 主操作（朱）はログインの 1 つだけ。行き先はボタンにしない。
    expect(screen.queryByRole("button", { name: "パスワードを忘れた" })).toBeNull();
    expect(container.querySelectorAll(".btn--primary")).toHaveLength(1);
  });

  it("主催者のログインでも、主催者の依頼の画面へ送る", () => {
    navigation.search = new URLSearchParams("mode=login");

    render(<AuthEntryScreen audience="organizer" />);

    expect(screen.getByRole("link", { name: "パスワードを忘れた" }).getAttribute("href")).toBe(
      passwordResetUrl("organizer"),
    );
  });
});
