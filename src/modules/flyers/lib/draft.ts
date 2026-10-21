const PREFIX = "flyer:draft:";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // 古い Safari 向け。UUID v4 の形だけ満たせばよい。
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * 下書きの識別子。1 つのフォームで 3 回まで、を数える単位。
 * サーバーに置かず localStorage に持つ。ログイン前に作り始めても、
 * 下書きを開き直したときに同じ枠へ戻れる。
 */
export function readFlyerDraftKey(scope: string): string {
  if (typeof window === "undefined") return createKey();
  const storageKey = `${PREFIX}${scope}`;
  const stored = window.localStorage.getItem(storageKey);
  if (stored && UUID.test(stored)) return stored;
  const created = createKey();
  window.localStorage.setItem(storageKey, created);
  return created;
}

/** 3 回を使い切ったあと「新しい下書きで作り直す」で枠を戻す。 */
export function resetFlyerDraftKey(scope: string): string {
  const created = createKey();
  if (typeof window !== "undefined") {
    window.localStorage.setItem(`${PREFIX}${scope}`, created);
  }
  return created;
}
