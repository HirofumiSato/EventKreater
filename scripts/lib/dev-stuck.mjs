// 開発サーバーが「ビルドに失敗したまま」固まるのを見つける判定。
//
//   scripts/dev.mjs            … 出力を読みながら、固まったら `next dev` を立て直す
//   tests/unit/dev-stuck.test.mjs
//
// 何が起きるか。Windows の作業ツリー（このリポジトリは OneDrive の下にある）では、
// 保存した直後のファイルを OneDrive やエディタが短く掴むことがある。その瞬間に
// Tailwind が `src/**/*.tsx` を読み直すと `EBUSY`（resource busy or locked）で
// `globals.css` のビルドが落ちる。Turbopack はその失敗を覚えたままなので、
// 以後どの URL も 500 を返し続ける。ファイルを触り直しても直らず、再起動だけが効く。
//
// 起動し直すのは、この「掴まれていて読めなかった」失敗のときだけにする。
// 構文エラーなど、直すべき原因が手元にある失敗で再起動を繰り返さないため。

/** 一時的なファイルの掴み合いでビルドが落ちたことを示す行。 */
const STUCK_PATTERNS = [
  /EBUSY/,
  /resource busy or locked/i,
  /Failed to read source code from/i,
  // Node の EBUSY は os error 32。Windows の日本語表示は「別のプロセスが使用中です」。
  /os error 32\b/,
  /別のプロセスが(使用中|使っています)/,
];

/**
 * その行が「ファイルを掴まれていて読めなかった」失敗か。
 *
 * 出力は 1 行ずつ渡ってくるとは限らないので、受け取った塊に含まれるかを調べる。
 */
export function isStuckBuildLine(line) {
  if (typeof line !== "string" || line === "") return false;
  return STUCK_PATTERNS.some((pattern) => pattern.test(line));
}

/** 失敗の行を見てから、実際に立て直すまでの待ち。掴んでいた側が離すのを待つ。 */
export const STUCK_RESTART_DELAY_MS = 2500;

/** 続けて固まったときに、立て直しを繰り返さない間隔。 */
export const STUCK_RESTART_MIN_INTERVAL_MS = 30000;

/**
 * 立て直した直後に、前のプロセスの失敗を読み飛ばしておく時間。
 *
 * 止めた子の stderr には、まだ読まれていない行が残っている。それを新しい失敗と
 * 数えると、直ったのに「直らない」と案内を出してしまう。
 */
export const STUCK_RESTART_GRACE_MS = 15000;

/**
 * いま立て直してよいか。
 *
 * 最後に立て直してから `minIntervalMs` が経っていなければ見送る。同じ失敗が
 * 何度も続くときは、再起動では直らない（ディスクや設定の問題）ので、
 * 呼び出し側は代わりに手順を案内する。
 */
export function shouldRestartNow({ now, lastRestartAt, minIntervalMs = STUCK_RESTART_MIN_INTERVAL_MS }) {
  if (typeof lastRestartAt !== "number") return true;
  return now - lastRestartAt >= minIntervalMs;
}
