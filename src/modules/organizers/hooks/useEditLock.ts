"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isRegisterRequired, readProblem, sendToRegisterRequired } from "@/lib/problem";

const REVALIDATE_MS = 30_000;
const CONFLICT_RETRY_MS = 15_000;

export interface LockConflict {
  holderName: string;
}

interface LockSuccess {
  lockToken: string;
  holderName: string;
}

interface LockFailure {
  holderName?: string;
  detail?: string;
}

export function useEditLock(eventId: string, holderName: string, enabled: boolean) {
  const [lockToken, setLockToken] = useState<string | null>(null);
  const [conflict, setConflict] = useState<LockConflict | null>(null);
  const [status, setStatus] = useState<"idle" | "acquiring" | "held" | "conflict" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const holderRef = useRef(holderName);
  holderRef.current = holderName;

  const applyConflict = useCallback((data: LockFailure) => {
    tokenRef.current = null;
    setLockToken(null);
    setConflict({
      holderName: data.holderName || "他の幹事",
    });
    setStatus("conflict");
  }, []);

  const acquire = useCallback(
    async (options?: { forceTakeover?: boolean; silent?: boolean }) => {
      if (!holderRef.current) return;
      if (!options?.silent) {
        setStatus((current) => (current === "held" ? "held" : "acquiring"));
        setError(null);
      }
      const requestToken = tokenRef.current;
      const res = await fetch(`/api/v1/organizer/events/${eventId}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holderName: holderRef.current,
          currentLockToken: requestToken ?? undefined,
          forceTakeover: options?.forceTakeover ?? false,
        }),
      });
      const data = (await res.json()) as LockSuccess & LockFailure & { error?: string };
      if (res.status === 409) {
        // 古いトークンで送ったリクエストの遅延応答は、現在の保持状態を壊さない。
        if (requestToken !== tokenRef.current) return;
        applyConflict(data);
        return;
      }
      if (res.status === 403 && isRegisterRequired(data)) {
        // 未登録の幹事が24時間の猶予を過ぎた。編集画面には入れず、登録の案内へ送る。
        setStatus("error");
        setError("作成から24時間を過ぎました。編集を続けるには会員登録が必要です。");
        sendToRegisterRequired(eventId);
        return;
      }
      if (!res.ok) {
        if (!options?.silent) {
          setStatus("error");
          setError(data.detail || "編集権の取得に失敗しました");
        }
        return;
      }
      tokenRef.current = data.lockToken;
      setLockToken(data.lockToken);
      setConflict(null);
      setStatus("held");
    },
    [applyConflict, eventId],
  );

  const releaseAwait = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    tokenRef.current = null;
    setLockToken(null);
    await fetch(`/api/v1/organizer/events/${eventId}/lock`, {
      method: "DELETE",
      headers: { "X-Lock-Token": token },
    });
  }, [eventId]);

  const release = useCallback(() => {
    const token = tokenRef.current;
    if (!token) return;
    tokenRef.current = null;
    const blob = new Blob([JSON.stringify({ release: true, lockToken: token, holderName: holderRef.current })], {
      type: "application/json",
    });
    const url = `/api/v1/organizer/events/${eventId}/lock`;
    if (navigator.sendBeacon(url, blob)) return;
    void fetch(url, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "X-Lock-Token": token },
      body: JSON.stringify({ lockToken: token }),
      keepalive: true,
    });
  }, [eventId]);

  useEffect(() => {
    if (!enabled || !holderName) return;
    void acquire();
    // ロックは失効しないが、引き継ぎされたことを検知するために定期確認する。
    const revalidate = window.setInterval(() => {
      if (tokenRef.current) void acquire({ silent: true });
    }, REVALIDATE_MS);
    const onHide = () => release();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.clearInterval(revalidate);
      window.removeEventListener("pagehide", onHide);
      release();
    };
  }, [acquire, enabled, holderName, release]);

  useEffect(() => {
    if (status !== "conflict") return;
    // 相手が編集を終えて解放したら自動で編集権を得る。
    const retry = window.setInterval(() => {
      void acquire({ silent: true });
    }, CONFLICT_RETRY_MS);
    return () => window.clearInterval(retry);
  }, [acquire, status]);

  const forceTakeover = useCallback(async () => {
    await acquire({ forceTakeover: true });
  }, [acquire]);

  const saveWithLock = useCallback(
    async (payload: unknown) => {
      const token = tokenRef.current;
      if (!token) {
        throw new Error("編集権を保持していません。");
      }
      const res = await fetch(`/api/v1/organizer/events/${eventId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Lock-Token": token,
        },
        body: JSON.stringify(payload),
      });
      if (res.status === 409) {
        const data = (await res.json()) as LockFailure;
        applyConflict(data);
        throw new Error(data.detail || "他の幹事が編集を開始しました。");
      }
      if (res.status === 403) {
        const data = (await res.json().catch(() => ({}))) as LockFailure & { error?: string };
        if (isRegisterRequired(data)) {
          sendToRegisterRequired(eventId);
          throw new Error("作成から24時間を過ぎたため、保存には会員登録が必要です。");
        }
        throw new Error(data.detail || "保存に失敗しました");
      }
      if (!res.ok) throw new Error(await readProblem(res));
      return res.json();
    },
    [applyConflict, eventId],
  );

  return {
    lockToken,
    conflict,
    status,
    error,
    hasLock: status === "held" && Boolean(lockToken),
    forceTakeover,
    refresh: () => acquire(),
    saveWithLock,
    release,
    releaseAwait,
  };
}
