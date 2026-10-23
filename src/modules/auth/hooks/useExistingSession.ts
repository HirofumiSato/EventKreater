"use client";

import { useEffect, useState } from "react";
import type { LandingRole } from "@/modules/auth/lib/auth-landing";

export interface ExistingSessionUser {
  id: string;
  name: string;
  phoneVerified: boolean;
  platformRole: LandingRole;
}

/**
 * `checking` のあいだは入口のフォームを描かない。ログイン済みなら
 * 一瞬だけフォームが出て消える、というちらつきを避けるため。
 * 判定できないとき（通信失敗・401）は `anonymous` に落として通常表示へ戻す。
 */
export type ExistingSessionState = "checking" | "authenticated" | "anonymous";

export interface ExistingSession {
  state: ExistingSessionState;
  user: ExistingSessionUser | null;
  /** 確認番号の入力を待っているチャレンジがある。別の会員で入り直す途中。 */
  pendingChallenge: boolean;
}

const ANONYMOUS: ExistingSession = { state: "anonymous", user: null, pendingChallenge: false };

export function useExistingSession(enabled: boolean): ExistingSession {
  const [session, setSession] = useState<ExistingSession>(
    enabled ? { state: "checking", user: null, pendingChallenge: false } : ANONYMOUS,
  );

  useEffect(() => {
    if (!enabled) {
      setSession(ANONYMOUS);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/v1/auth/session", { cache: "no-store" });
        if (!active) return;
        if (!res.ok) {
          setSession(ANONYMOUS);
          return;
        }
        const body = (await res.json()) as {
          user?: Partial<ExistingSessionUser>;
          pendingChallenge?: boolean;
        };
        const user = body.user;
        if (!user || typeof user.id !== "string") {
          setSession(ANONYMOUS);
          return;
        }
        setSession({
          state: "authenticated",
          user: {
            id: user.id,
            name: typeof user.name === "string" ? user.name : "",
            phoneVerified: user.phoneVerified === true,
            platformRole: user.platformRole === "ADMIN" ? "ADMIN" : "MEMBER",
          },
          pendingChallenge: body.pendingChallenge === true,
        });
      } catch {
        if (active) setSession(ANONYMOUS);
      }
    })();
    return () => {
      active = false;
    };
  }, [enabled]);

  return session;
}
