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
//
// もう 1 つ、`.next` の作りが食い違ったときの失敗がある。git で枝を切り替えたり
// マージしたあと、Turbopack が覚えている解決の表だけが古く残り、ディスクにある
// ファイルを「無い」と言い続ける。これも再起動だけでは直らず、`.next` を消す必要がある。
// ただし「無い」と言われた import が本当に無いなら手元の誤りなので、そこは見分ける。

import { join } from "node:path";

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

/**
 * `.next` の作りが食い違ったときだけ出る行。
 *
 * どれも「コードは正しいのにビルドキャッシュが古い」失敗で、`.next` を消して
 * 起動し直すまで直らない。構文や import の誤りでは出ないので、再起動してよい。
 */
const STALE_CACHE_PATTERNS = [
  // Turbopack で作った `.next` を Webpack で（またはその逆で）起動したとき。
  /Cannot find module '\.\.\/chunks\/ssr\/\[turbopack\]_runtime\.js'/,
  // 世代の違うチャンクが混ざったとき（React の vendor だけ古い、など）。
  /Cannot read properties of null \(reading 'useContext'\)/,
  /Cannot read property 'useContext' of null/,
];

/** その行が、`.next` を作り直せば直る失敗か。 */
export function isStaleCacheLine(line) {
  if (typeof line !== "string" || line === "") return false;
  return STALE_CACHE_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * `Module not found: Can't resolve 'X'` の `X` を取り出す。
 * Webpack の `Cannot find module 'X'` も同じ形で扱う。
 */
export function unresolvedSpecifier(line) {
  if (typeof line !== "string") return null;
  const match = /(?:Can't resolve|Cannot find module) '([^']+)'/.exec(line);
  return match ? match[1] : null;
}

/**
 * `@/foo/bar` を、実際に置かれているはずのパスへ開く。
 *
 * パッケージ名（`react` など）と相対パスは、ここでは見ない。前者は `.next` ではなく
 * `node_modules` の話で、後者は基準のディレクトリが行からは決まらないため。
 */
export function resolveCandidates(specifier, root) {
  if (typeof specifier !== "string" || !specifier.startsWith("@/")) return [];
  const base = join(root, "src", specifier.slice(2));
  return [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
}

/**
 * 「解決できない」と言われた import が、実際にはディスクにあるか。
 *
 * あるなら、Turbopack が覚えている解決の表が古いだけ（git の切り替えやマージのあとに
 * 起きやすい）。`.next` を消して起動し直せば直る。無いなら、本当に import の誤りか
 * ファイルの作り忘れなので、再起動せずにエラーをそのまま見せる。
 */
export function isStaleResolution(line, { root, exists }) {
  const specifier = unresolvedSpecifier(line);
  const candidates = resolveCandidates(specifier, root);
  if (candidates.length === 0) return false;
  return candidates.some((file) => exists(file));
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
