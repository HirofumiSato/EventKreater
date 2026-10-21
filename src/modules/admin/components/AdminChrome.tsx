"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

export function AdminChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const logout = async () => {
    await fetch("/api/v1/admin/session", { method: "DELETE" });
    router.replace("/console/login");
    router.refresh();
  };

  const link = (href: string, label: string) => (
    <Link href={href} className={`site-nav__link${pathname === href ? " is-current" : ""}`}>
      {label}
    </Link>
  );

  return (
    <div className="stack">
      <div className="console-bar">
        <p className="hero__eyebrow">管理コンソール</p>
        <nav className="console-bar__nav" aria-label="管理">
          {link("/console", "ホーム")}
          {link("/console/users", "会員")}
          {link("/console/events", "イベント")}
          {link("/console/payments", "決済")}
          {link("/console/pricing", "料金")}
          <button type="button" className="btn btn--outline btn--sm" onClick={() => void logout()}>
            ログアウト
          </button>
        </nav>
      </div>
      {children}
    </div>
  );
}
