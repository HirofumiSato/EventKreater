/** 画面のキー操作が見る、IME の状態。React の合成イベントと素の KeyboardEvent の両方を受ける。 */
export interface ImeKeyLike {
  key?: string;
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}

/** IME がそのキーを処理したか。 */
export function isImeComposing(event: ImeKeyLike): boolean {
  const native = event.nativeEvent ?? event;
  return Boolean(native.isComposing) || native.keyCode === 229;
}

/**
 * 変換確定の Enter。
 * 229 は「IME が処理したキー」の印なので、Enter のときだけ見る
 * （無条件に見ると、IME 有効時に Escape が効かなくなる）。
 */
export function isImeEnter(event: ImeKeyLike): boolean {
  return event.key === "Enter" && isImeComposing(event);
}

/** 変換取り消しの Escape。Enter と同じく、Escape のときだけ 229 を見る。 */
export function isImeEscape(event: ImeKeyLike): boolean {
  return event.key === "Escape" && isImeComposing(event);
}
