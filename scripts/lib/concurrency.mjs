// 撮影を同時に開く数。純関数だけを置く（os は呼び出し側で読む）。
//
// 画面 1 枚は「開く・待つ・写す」の待ちが多く、CPU はほとんど使わない。
// そのため論理コアの数より少し少ない数を上限にする。増やしすぎると
// ブラウザと Next の応答が詰まり、1 枚あたりの待ちが伸びる。
//
// 16 論理コアの環境で 4 / 6 / 8 を比べた（16 画面）。
//   撮影あり（本番ビルド）   … 4: 11.7s / 6: 10.5s / 8: 11.9s
//   撮影あり（開発サーバー） … 4: 15.2s / 6: 16.5s / 8: 15.8s
//   撮影なし                 … 4 が 1 秒ほど速い
// 差はどれも 1 割前後で、どの値も一貫して最速ではない。コミット前の全体同期
// （撮影あり）で最も速かった 6 を既定にし、上限も 6 にする。

/** 同時に開く数の下限。1 枚ずつでも動くが、待ちのぶんだけ遅い。 */
export const MIN_CONCURRENCY = 4;

/** 同時に開く数の上限。これ以上は待ちが重なって遅くなる（計測で確認済み）。 */
export const MAX_CONCURRENCY = 6;

/**
 * 同時に開く数を決める。
 *
 * `requested` は `--concurrency=` の値。正の数ならそのまま採る（明示指定が最優先）。
 * 未指定・不正な値なら、論理コアの数 `parallelism` から決める。
 * `parallelism` は呼び出し側が `os.availableParallelism()` で渡す。
 */
export function resolveConcurrency(requested, parallelism = MIN_CONCURRENCY) {
  const value = Number(requested);
  if (Number.isFinite(value) && value > 0) return Math.max(1, Math.floor(value));

  const cores = Number(parallelism);
  if (!Number.isFinite(cores) || cores <= 0) return MIN_CONCURRENCY;
  return Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, cores - 1));
}
