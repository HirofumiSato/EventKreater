/**
 * パスワードマネージャへの保存を頼む。
 *
 * Chrome はフォームの送信（画面遷移）を合図に「パスワードを保存」を出す。この画面は
 * `fetch` で送るため遷移が起きず、保存の合図が無い。認証が通った時点で
 * `navigator.credentials.store()` を明示的に呼ぶ。
 *
 * 保存できない環境（非 HTTPS・未対応のブラウザ・利用者が断った）でも認証は止めない。
 */

/** `lib.dom.d.ts` に `PasswordCredential` が無いため、使う形だけをここに書く。 */
interface PasswordCredentialInit {
  /** ユーザー名として保存する値。この画面ではメールアドレス。 */
  id: string;
  password: string;
  /** 保存の一覧に出す名前。 */
  name?: string;
}

/** 保存する資格情報。`PasswordCredential` が作る値で、ここでは中身を見ない。 */
type StoredCredential = object;

type PasswordCredentialConstructor = new (init: PasswordCredentialInit) => StoredCredential;

interface CredentialsContainerLike {
  store?: (credential: StoredCredential) => Promise<unknown>;
}

/**
 * 参照するコンテナ。既定は `window` と `navigator` を 1 つにまとめたもの。
 * テストでは `{ isSecureContext, PasswordCredential, credentials }` を渡して差し替える。
 */
export interface PasswordCredentialContainer {
  /** `window.isSecureContext`。`http://localhost` か HTTPS でだけ true。 */
  isSecureContext?: boolean;
  /** `window.PasswordCredential`。未対応のブラウザには無い。 */
  PasswordCredential?: PasswordCredentialConstructor | null;
  /** `navigator.credentials`。`store` を持たない実装もある。 */
  credentials?: CredentialsContainerLike | null;
}

export interface PasswordCredentialInput {
  email: string;
  password: string;
  /** 名前欄がある登録フォームだけ渡す。ログインでは渡さない。 */
  name?: string | null;
}

function defaultContainer(): PasswordCredentialContainer {
  if (typeof window === "undefined") return { isSecureContext: false };
  const scope = window as unknown as {
    isSecureContext?: boolean;
    PasswordCredential?: PasswordCredentialConstructor;
  };
  const container = navigator as unknown as { credentials?: CredentialsContainerLike };
  return {
    isSecureContext: scope.isSecureContext === true,
    PasswordCredential: scope.PasswordCredential ?? null,
    credentials: container.credentials ?? null,
  };
}

/**
 * パスワードの保存をブラウザへ頼む。保存できた（頼めた）ときだけ true。
 * 例外は投げない。呼び出し側は戻り値を見ずに登録・ログインを続けてよい。
 */
export async function savePasswordCredential(
  input: PasswordCredentialInput,
  container: PasswordCredentialContainer = defaultContainer(),
): Promise<boolean> {
  if (container.isSecureContext !== true) return false;
  const Constructor = container.PasswordCredential;
  if (typeof Constructor !== "function") return false;
  const credentials = container.credentials;
  const store = credentials?.store;
  if (!credentials || typeof store !== "function") return false;

  try {
    const init: PasswordCredentialInit = input.name
      ? { id: input.email, password: input.password, name: input.name }
      : { id: input.email, password: input.password };
    // 取り出した `store` をそのまま呼ぶと `this` を失う実装があるため、コンテナに結び付ける。
    await store.call(credentials, new Constructor(init));
    return true;
  } catch {
    return false;
  }
}
