// @vitest-environment jsdom
//
// 管理コンソールで権限を失ったときの受け皿（`AdminAccessDenied`）の再発防止。
//
// 管理者権限を外された会員は、共通ヘッダーを持たない管理画面から一般の画面へ
// 戻れなくなる。ここで見るのは 2 つ。
//   1. 主催者マイページと参加者ホームへの道を持つ
//   2. 共通ヘッダーが覚えている役割を取り直させる

import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminAccessDenied } from "@/modules/admin/components/AdminAccessDenied";

const invalidateViewer = vi.hoisted(() => vi.fn());

// `next/link` は Router の文脈を要求する。ここでは行き先だけを見たいので素の `<a>` にする。
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

vi.mock("@/lib/viewer-store", () => ({ invalidateViewer }));

afterEach(() => {
  cleanup();
  invalidateViewer.mockClear();
});

describe("管理者でない会員の管理コンソール", () => {
  it("主催者マイページと参加者ホームへの道を持つ", () => {
    render(<AdminAccessDenied />);

    expect(screen.getByRole("link", { name: "主催者マイページへ" }).getAttribute("href")).toBe("/mypage");
    expect(screen.getByRole("link", { name: "参加者ホームへ" }).getAttribute("href")).toBe("/participant");
  });

  it("共通ヘッダーの役割を取り直させる", () => {
    render(<AdminAccessDenied />);

    expect(invalidateViewer).toHaveBeenCalledTimes(1);
  });
});
