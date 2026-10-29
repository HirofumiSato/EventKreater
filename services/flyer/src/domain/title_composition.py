"""チラシのタイトルを、意味の区切りで行に分ける。

幅に収めるだけなら 1 文字ずつ詰めれば足りる。しかし「焚火とシチューの / 夕べ」
のように語の切れ目で分けないと、「べ」だけが最終行に落ちて読みにくくなる。

ここが決めるのは「どこで切ると読みやすいか」だけ。実際に何 px に収まるかは
`adapters/renderer/layout_calculator.py` が、色は `semantic_theme.py` が決める。
Pillow も外部 SDK も import しない純粋な関数だけを置く。
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations

#: 行末に置くと句が切れて読める助詞。
_PARTICLES = "のとやはがをにでへもか"

#: 行頭に置くと読みにくい文字（句読点・閉じ括弧・長音符）。
_NO_LINE_START = "、。，．・：；！？!?）)」』】〉》〕｝}〜~ー…‥"

#: 行末に来たら、そこで句が終わっている文字。
_PUNCTUATION = "、。，．・：；！？!?〜…‥"

#: 行末に置くと読みにくい文字（開き括弧）。
_NO_LINE_END = "（(「『【〈《〔｛{"

#: 小さく書く仮名。行頭に来ると前の語から切り離されて見える。
_SMALL_KANA = "ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ"

#: 題の結びとして効く語。行頭に来たら「題の終わり」として立てる。
_TAIL_WORDS = (
    "フェスティバル",
    "パーティー",
    "上映会",
    "展示会",
    "発表会",
    "交流会",
    "忘年会",
    "新年会",
    "前夜祭",
    "セッション",
    "ナイト",
    "ライブ",
    "パーティ",
    "祭り",
    "まつり",
    "フェス",
    "夕べ",
    "の夜",
)

#: 語の切れ目としての加点。数値は「この切り方をどれだけ勧めるか」の相対値。
_SPACE_BONUS = 3.0
_PARTICLE_BONUS = 2.5
_PUNCTUATION_BONUS = 3.0
_TAIL_WORD_BONUS = 2.5
#: 末尾の語だけが最終行に残る形（ぶら下げ）を勧める加点。
_TAIL_LINE_BONUS = 2.5
#: 助詞から行を始める切り方の減点。「の夕べ」で始まる行を作らない。
_PARTICLE_HEAD_PENALTY = 1.5
#: 行頭・行末に置けない文字を跨ぐ切り方の目印。候補から外す。
_FORBIDDEN = -100.0
#: 行の長さの偏り 1 文字あたりの減点。
_IMBALANCE_PENALTY = 0.6
#: 2 行より多い案 1 行あたりの減点。行数が同じなら意味で選ぶ。
_EXTRA_LINE_PENALTY = 0.5

#: 最終行に残ってよい最小文字数。
_MIN_TAIL_CHARS = 2
#: 最終行以外の最小文字数。2 文字だけの途中の行を作らない。
_MIN_BODY_CHARS = 3

#: `title_splits` が返す案の上限。フォントサイズの探索に使うので絞る。
_MAX_CANDIDATES = 12

#: 文字種が変わる位置の加点。英字との境目は語の切れ目であることが多い。
_SCRIPT_BONUS: dict[tuple[str, str], float] = {
    ("kanji", "katakana"): 0.9,
    ("katakana", "kanji"): 0.9,
    ("kanji", "hiragana"): 0.8,
    ("hiragana", "kanji"): 0.8,
    ("hiragana", "katakana"): 0.7,
    ("katakana", "hiragana"): 0.7,
    ("latin", "hiragana"): 1.4,
    ("hiragana", "latin"): 1.4,
    ("latin", "katakana"): 1.4,
    ("katakana", "latin"): 1.4,
    ("latin", "kanji"): 1.4,
    ("kanji", "latin"): 1.4,
}


@dataclass(frozen=True)
class TitleSplit:
    """意味の区切りで分けた 1 案。"""

    lines: tuple[str, ...]
    #: 大きいほど読みやすい切り方。
    score: float
    #: 助詞・句読点・末尾語・文字種の変わり目という根拠があるか。
    semantic: bool
    #: すべての切れ目が語の区切り（空白・句読点・助詞・末尾語）で説明できるか。
    #: 文字種の変わり目だけで切った案（「川辺の焚 / き火ナイト」）は False。
    phrase_only: bool = False


def _script_of(char: str) -> str:
    """文字種。切り方の手がかりにだけ使う。"""
    if char.isascii():
        return "latin" if char.isalnum() else "other"
    code = ord(char)
    if 0x3040 <= code <= 0x309F:
        return "hiragana"
    if 0x30A0 <= code <= 0x30FF or 0xFF66 <= code <= 0xFF9F:
        return "katakana"
    if 0x3400 <= code <= 0x4DBF or 0x4E00 <= code <= 0x9FFF:
        return "kanji"
    if char.isdigit() or char.isalpha():
        return "latin"
    return "other"


def _is_kanji(char: str) -> bool:
    """漢字か。末尾語が複合語の一部になっているかの判定に使う。"""
    return _script_of(char) == "kanji"


def _tail_word_at(text: str, index: int) -> bool:
    """`index` から始まる部分が題の結びの語か。"""
    remainder = text[index:].lstrip()
    if not remainder:
        return False
    return any(remainder.startswith(word) for word in _TAIL_WORDS)


@dataclass(frozen=True)
class _Cut:
    """切り目 1 か所の評価。"""

    score: float
    #: 意味の根拠があるか。文字種の変わり目も含む。
    semantic: bool
    #: 語の区切りとして説明できるか。文字種の変わり目だけの切り目は False。
    phrase: bool


def _boundary(text: str, index: int) -> _Cut:
    """`index` の直前で改行したときの評価。"""
    left = text[index - 1]
    right = text[index]
    if left.isspace() or right.isspace():
        return _Cut(_SPACE_BONUS, True, True)
    if left in _NO_LINE_END or right in _NO_LINE_START:
        return _Cut(_FORBIDDEN, False, False)
    score = 0.0
    semantic = False
    phrase = False
    if left in _PARTICLES:
        score += _PARTICLE_BONUS
        semantic = True
        phrase = True
    if left in _PUNCTUATION:
        # 句読点のあとは、そこで句が終わっている。
        score += _PUNCTUATION_BONUS
        semantic = True
        phrase = True
    if right in _PARTICLES:
        score -= _PARTICLE_HEAD_PENALTY
    if right in _SMALL_KANA:
        # 小書き仮名から行を始めると、前の語から切り離されて見える。
        return _Cut(_FORBIDDEN, False, False)
    left_script = _script_of(left)
    right_script = _script_of(right)
    if left_script != right_script:
        score += _SCRIPT_BONUS.get((left_script, right_script), 0.3)
        semantic = True
    # 漢字に直接つながる語（「焚き火ナイト」の「ナイト」）は、まだ複合語の
    # 途中であることが多い。そこを切れ目として勧めない。
    if _tail_word_at(text, index) and not _is_kanji(left):
        score += _TAIL_WORD_BONUS
        semantic = True
        phrase = True
    return _Cut(score, semantic, phrase)


def _lines_for(text: str, cuts: tuple[int, ...]) -> tuple[str, ...] | None:
    """切る位置から行を作る。短すぎる行になる切り方は採らない。"""
    bounds = (0, *cuts, len(text))
    lines = tuple(
        text[bounds[index]:bounds[index + 1]].strip()
        for index in range(len(bounds) - 1)
    )
    last = len(lines) - 1
    for index, line in enumerate(lines):
        minimum = _MIN_TAIL_CHARS if index == last else _MIN_BODY_CHARS
        if len(line) < minimum:
            return None
    return lines


def _score_lines(
    text: str,
    cuts: tuple[int, ...],
    lines: tuple[str, ...],
) -> tuple[float, bool, bool] | None:
    """切り方 1 つの評価。行頭・行末に置けない切り方なら None。

    返すのは (点, 意味の根拠があるか, 語の区切りだけで切れているか)。
    """
    total = 0.0
    semantic = False
    phrase_only = True
    for cut in cuts:
        boundary = _boundary(text, cut)
        if boundary.score <= _FORBIDDEN:
            return None
        total += boundary.score
        semantic = semantic or boundary.semantic
        phrase_only = phrase_only and boundary.phrase
    lengths = [len(line) for line in lines]
    average = sum(lengths) / len(lengths)
    imbalance = sum(abs(length - average) for length in lengths) / len(lengths)
    total -= _IMBALANCE_PENALTY * imbalance
    total -= _EXTRA_LINE_PENALTY * (len(lines) - 2)
    # 末尾の語だけが最終行に残る形は、紙面では右へぶら下げる。2 行のときだけ勧める。
    # 漢字に直接つながる語は複合語の途中なので、ここでも勧めない。
    first_cut = cuts[0]
    if (
        len(lines) == 2
        and lines[1] in _TAIL_WORDS
        and not _is_kanji(text[first_cut - 1])
    ):
        total += _TAIL_LINE_BONUS
        semantic = True
    return (total, semantic, phrase_only)


def title_splits(text: str, max_lines: int = 3) -> list[TitleSplit]:
    """意味の区切りで分けた案を、読みやすい順に返す。

    1 行に収まるかどうかは見ない（収まるなら改行しないのは呼び出し側の判断）。
    1 文字だけの行になる案は返さない。これが「べ」だけが折り返される状態を防ぐ。
    """
    normalized = " ".join(text.split())
    if len(normalized) < 2:
        return []
    limit = max(2, min(max_lines, 3))
    positions = tuple(range(1, len(normalized)))
    best: dict[tuple[str, ...], TitleSplit] = {}
    for line_count in range(2, limit + 1):
        for cuts in combinations(positions, line_count - 1):
            lines = _lines_for(normalized, cuts)
            if lines is None:
                continue
            scored = _score_lines(normalized, cuts, lines)
            if scored is None:
                continue
            score, semantic, phrase_only = scored
            known = best.get(lines)
            if known is not None and known.score >= score:
                continue
            best[lines] = TitleSplit(
                lines=lines,
                score=score,
                semantic=semantic,
                phrase_only=phrase_only,
            )
    ranked = sorted(best.values(), key=lambda item: item.score, reverse=True)
    return ranked[:_MAX_CANDIDATES]


__all__ = ["TitleSplit", "title_splits"]
