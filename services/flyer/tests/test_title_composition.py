"""タイトルの意味分割（どこで行を変えるか）の検証。"""

from __future__ import annotations

from src.domain.title_composition import TitleSplit, title_splits

#: 1 文字だけの行を作らない、という不変条件を確かめる見本。
_SAMPLES = (
    "焚火とシチューの夕べ",
    "焚火とシチューを囲む夕べ",
    "真夜中のジャズセッション",
    "秋の焚火とシチューの夕べ 夜長を楽しむ",
    "焚火、シチュー、夕べ",
    "川辺の焚き火ナイト",
    "JAZZ NIGHT SESSION",
    "あ" * 40,
)


def _with_line_count(title: str, count: int) -> list[TitleSplit]:
    """指定の行数で分けた案。`title_splits` は読みやすい順に返す。"""
    return [split for split in title_splits(title) if len(split.lines) == count]


def _best_lines(title: str, count: int = 2) -> tuple[str, ...]:
    candidates = _with_line_count(title, count)
    assert candidates, f"{title} を {count} 行に分けられません"
    return candidates[0].lines


def test_tail_word_is_cut_off_before_it() -> None:
    """「焚火とシチューの / 夕べ」。「べ」だけを最終行へ落とさない。"""
    assert _best_lines("焚火とシチューの夕べ") == ("焚火とシチューの", "夕べ")


def test_long_title_keeps_the_tail_word_together() -> None:
    assert _best_lines("焚火とシチューを囲む夕べ") == ("焚火とシチューを囲む", "夕べ")
    assert ("焚火とシチューを囲む", "夕べ") in [split.lines for split in title_splits("焚火とシチューを囲む夕べ")]


def test_one_character_line_never_appears() -> None:
    for title in _SAMPLES:
        for split in title_splits(title):
            assert all(len(line) >= 2 for line in split.lines), (title, split.lines)


def test_small_kana_and_punctuation_do_not_start_a_line() -> None:
    forbidden = "、。，．・！？!?ッョャュョっゃゅょ"
    for title in _SAMPLES:
        for split in title_splits(title):
            for line in split.lines:
                assert line[0] not in forbidden, (title, split.lines)


def test_katakana_word_is_not_split_at_the_small_kana() -> None:
    """「ジャズセッシ / ョン」のような切れ目を作らない。"""
    for split in title_splits("真夜中のジャズセッション"):
        assert "ョン" not in split.lines
        assert "シ" not in split.lines


def test_explicit_space_is_a_break_and_is_trimmed() -> None:
    for split in title_splits("秋の焚火  夕べ"):
        for line in split.lines:
            assert line == line.strip()
    assert ("秋の焚火", "夕べ") in [split.lines for split in title_splits("秋の焚火  夕べ")]


def test_long_title_stays_within_three_lines() -> None:
    for split in title_splits("あ" * 40):
        assert len(split.lines) <= 3


def test_text_without_a_usable_break_has_no_candidate() -> None:
    assert title_splits("") == []
    assert title_splits("夜") == []


def test_semantic_break_is_marked_as_such() -> None:
    """意味の根拠がある案には印が付く。文字種の変わり目だけの案と区別する。"""
    splits = title_splits("焚火とシチューを囲む夕べ")
    assert splits
    assert any(split.semantic for split in splits)
    assert all(split.score > -100.0 for split in splits)


def test_compound_word_is_not_cut_at_its_script_change() -> None:
    """「川辺の焚 / き火ナイト」より「川辺の / 焚き火ナイト」を先に返す。

    「焚き火」の漢字と仮名の変わり目は語の途中。文字種が変わるというだけで
    大きな文字のまま語を割らないよう、末尾語の加点は漢字に続く場合に止める。
    """
    assert _best_lines("川辺の焚き火ナイト") == ("川辺の", "焚き火ナイト")


def test_phrase_only_rejects_a_cut_inside_a_word() -> None:
    """語の区切りだけで切れた案にだけ印が立つ。"""
    splits = title_splits("川辺の焚き火ナイト")
    phrases = [split.lines for split in splits if split.phrase_only]
    assert ("川辺の", "焚き火ナイト") in phrases
    assert ("川辺の焚", "き火ナイト") not in phrases
    assert ("川辺の焚き火", "ナイト") not in phrases


def test_phrase_only_keeps_the_tail_word_on_its_own_line() -> None:
    """助詞のあとで切った案は語の区切りとして扱う。"""
    splits = title_splits("焚火とシチューの夕べ")
    phrases = [split.lines for split in splits if split.phrase_only]
    assert ("焚火とシチューの", "夕べ") in phrases
