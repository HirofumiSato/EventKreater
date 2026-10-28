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


def _tail_word_at(text: str, index: int) -> bool:
    """`index` から始まる部分が題の結びの語か。"""
    remainder = text[index:].lstrip()
    if not remainder:
        return False
    return any(remainder.startswith(word) for word in _TAIL_WORDS)


def _boundary(text: str, index: int) -> tuple[float, bool]:
    """`index` の直前で改行したときの評価。返すのは (加点, 意味の根拠があるか)。"""
    left = text[index - 1]
    right = text[index]
    if left.isspace() or right.isspace():
        return (_SPACE_BONUS, True)
    if left in _NO_LINE_END or right in _NO_LINE_START:
        return (_FORBIDDEN, False)
    score = 0.0
    semantic = False
    if left in _PARTICLES:
        score += _PARTICLE_BONUS
        semantic = True
    if left in _PUNCTUATION:
        # 句読点のあとは、そこで句が終わっている。
        score += _PUNCTUATION_BONUS
        semantic = True
    if right in _PARTICLES:
        score -= _PARTICLE_HEAD_PENALTY
    if right in _SMALL_KANA:
        # 小書き仮名から行を始めると、前の語から切り離されて見える。
        return (_FORBIDDEN, False)
    left_script = _script_of(left)
    right_script = _script_of(right)
    if left_script != right_script:
        score += _SCRIPT_BONUS.get((left_script, right_script), 0.3)
        semantic = True
    if _tail_word_at(text, index):
        score += _TAIL_WORD_BONUS
        semantic = True
    return (score, semantic)


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
) -> tuple[float, bool] | None:
    """切り方 1 つの評価。行頭・行末に置けない切り方なら None。"""
    total = 0.0
    semantic = False
    for cut in cuts:
        score, is_semantic = _boundary(text, cut)
        if score <= _FORBIDDEN:
            return None
        total += score
        semantic = semantic or is_semantic
    lengths = [len(line) for line in lines]
    average = sum(lengths) / len(lengths)
    imbalance = sum(abs(length - average) for length in lengths) / len(lengths)
    total -= _IMBALANCE_PENALTY * imbalance
    total -= _EXTRA_LINE_PENALTY * (len(lines) - 2)
    # 末尾の語だけが最終行に残る形は、紙面では右へぶら下げる。2 行のときだけ勧める。
    if len(lines) == 2 and lines[1] in _TAIL_WORDS:
        total += _TAIL_LINE_BONUS
        semantic = True
    return (total, semantic)


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
            score, semantic = scored
            known = best.get(lines)
            if known is not None and known.score >= score:
                continue
            best[lines] = TitleSplit(lines=lines, score=score, semantic=semantic)
    ranked = sorted(best.values(), key=lambda item: item.score, reverse=True)
    return ranked[:_MAX_CANDIDATES]


__all__ = ["TitleSplit", "title_splits"]
