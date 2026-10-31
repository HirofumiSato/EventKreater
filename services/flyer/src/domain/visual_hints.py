"""題と場所から、画像に残す「催しの型」を取り出す。

題は利用者が書いた唯一の場面情報である。しかし LLM に「感情の核を 1 つの
被写体へ翻訳せよ」とだけ伝えると、複合語の題（ハロウィン おやこマルシェ）が
「秋の静物」のような無関係な 1 枚へ畳まれる。そこで題の語を、英語の場面指定
ではなく **役割の型（ファミリー）** へ決定的に写す。

型だけを決め、小道具は決めない。クリスマスツリー、ライブハウスの内装、芋煮の鍋
のような具体的な絵を契約にすると、料理教室もヨガも盆踊りも同じ型へ吸い込まれる。
具体的な見え方は、題の語を読んだ LLM が `title_nouns` と `title` から組み立てる。

役割は 6 つ。活動（何が起きるか）、モチーフ（行事の装飾）、会場（どこか）、
人物方針（人を出すか、どう写すか）、光（どの時間帯の明かりか）、活気（人が居る
ときの盛り上がりの頂点）。モチーフは会場を決めない。`クリスマス 料理教室` は
holiday × food であり、公演空間にはしない。差を付けるのは活動の型だけである。

活気は人が居るときだけ決める。`people_policy` が `absent` の催しに、盛り上がりの
型から人を足さない。DJ の満杯のフロア、勝った瞬間の歓声、ケーキを囲む拍手の
ように、活動を「静物」ではなく「その催しがいちばん動いている瞬間」へ寄せる。

辞書に無い題でも語を捨てない。`title_nouns` として原文のまま LLM へ渡し、
LLM が同じスロットへ分類する。画像モデルへ渡すのは英語の制約だけである
（日本語を渡すと、文字として描こうとするため）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import TypeVar

from src.domain.models import FlyerGenerationRequest, RainPolicy

#: 語の切れ目。題は空白・中黒・スラッシュで語を並べることが多い。
_SEPARATORS = r"\s・･/／、,，"


class ActivityFamily(str, Enum):
    """何が起きるか。1 題に複数可で、AND で重なる。"""

    BODY_PERFORMANCE = "body_performance"
    MUSIC_PERFORMANCE = "music_performance"
    FOOD = "food"
    MARKET = "market"
    CRAFT = "craft"
    FORTUNE = "fortune"
    PHOTO = "photo"
    FIRE_GATHERING = "fire_gathering"
    FESTIVAL = "festival"
    TALK_OR_CLASS = "talk_or_class"
    PARTY = "party"


class MotifFamily(str, Enum):
    """行事の装飾。活動を置き換えず、会場も変えない。"""

    HOLIDAY = "holiday"


class SettingFamily(str, Enum):
    """どこで起きるか。会場の固有名は使わない。"""

    PERFORMANCE_SPACE = "performance_space"
    BAR_OR_CLUB = "bar_or_club"
    STUDIO_OR_GALLERY = "studio_or_gallery"
    STUDIO_OR_TABLE = "studio_or_table"
    QUIET_INDOOR = "quiet_indoor"
    CAFE = "cafe"
    PARK = "park"
    WATERFRONT = "waterfront"
    MARKET_OUTDOOR = "market_outdoor"
    OUTDOOR_FESTIVAL = "outdoor_festival"
    OUTDOOR_WATER_OR_FIELD = "outdoor_water_or_field"
    DINING_OR_TABLE = "dining_or_table"
    INTIMATE_TABLE = "intimate_table"
    SOCIAL_INDOOR = "social_indoor"
    GENERIC_INDOOR = "generic_indoor"
    GENERIC_OUTDOOR = "generic_outdoor"


class PeoplePolicy(str, Enum):
    """人を出すか、出すならどう写すか。"""

    ABSENT = "absent"
    ATMOSPHERE = "atmosphere"
    REQUIRED = "required"


class LightingFamily(str, Enum):
    """活動の時間帯の光。テーマの既定の光より強い。"""

    NIGHT_PERFORMANCE = "night_performance"
    NIGHT_INDOOR = "night_indoor"


class EnergyFamily(str, Enum):
    """人が居るときの盛り上がりの頂点。人が居ない催しでは決めない。"""

    CROWD_PEAK = "crowd_peak"
    DANCE_PEAK = "dance_peak"
    GAME_PEAK = "game_peak"
    CELEBRATION_PEAK = "celebration_peak"
    SHARED_TOAST = "shared_toast"


#: 型の英語制約。具体的な小道具名は書かない。題が決める。
ACTIVITY_CONSTRAINTS: dict[ActivityFamily, str] = {
    ActivityFamily.BODY_PERFORMANCE: (
        "a live body performance as the main subject, with people moving on a stage or floor"
    ),
    ActivityFamily.MUSIC_PERFORMANCE: (
        "live music being performed in the same frame, with instruments or a booth visible"
    ),
    ActivityFamily.FOOD: "food and drink laid out for sharing as the main subject",
    ActivityFamily.MARKET: "market stalls with goods, crates and canopies as the main subject",
    ActivityFamily.CRAFT: "handmade craft work, tools and a work table as the main subject",
    ActivityFamily.FORTUNE: (
        "fortune-telling props laid out on a table as the main subject"
    ),
    ActivityFamily.PHOTO: (
        "a photography set with camera, lights and an empty backdrop as the main subject"
    ),
    ActivityFamily.FIRE_GATHERING: "an outdoor fire gathering with flames and embers",
    ActivityFamily.FESTIVAL: "a festive outdoor gathering with lanterns and stalls",
    ActivityFamily.TALK_OR_CLASS: "a quiet talk or class setting with seating and notes",
    ActivityFamily.PARTY: "a social gathering with drinks and shared food",
}

#: 活動が重なるときの特別な言い方。音楽が身体の公演を消さない。
_MUSIC_UNDER_BODY: str = (
    "live music as part of the scene, without replacing the body performance "
    "with a band-only shot"
)

MOTIF_CONSTRAINTS: dict[MotifFamily, str] = {
    MotifFamily.HOLIDAY: (
        "seasonal holiday decoration that fits the holiday named in the title, "
        "kept as decoration around the activity"
    ),
}

SETTING_CONSTRAINTS: dict[SettingFamily, str] = {
    SettingFamily.PERFORMANCE_SPACE: (
        "a darkened performance space with a stage and stage lighting"
    ),
    SettingFamily.BAR_OR_CLUB: (
        "a small bar or club interior with dim light and a low ceiling"
    ),
    SettingFamily.STUDIO_OR_GALLERY: "a bright studio or gallery room with plain walls",
    SettingFamily.STUDIO_OR_TABLE: "a workroom with a large table and tools",
    SettingFamily.QUIET_INDOOR: "a quiet indoor room with seating and soft light",
    SettingFamily.CAFE: "a small cafe interior with tables and warm light",
    SettingFamily.PARK: "an open park with trees and sky",
    SettingFamily.WATERFRONT: "a riverside or waterside open space",
    SettingFamily.MARKET_OUTDOOR: "an outdoor market street with stalls",
    SettingFamily.OUTDOOR_FESTIVAL: "an outdoor festival ground with lanterns and stalls",
    SettingFamily.OUTDOOR_WATER_OR_FIELD: "an open field or campsite outdoors",
    SettingFamily.DINING_OR_TABLE: "a dining room with a shared table",
    SettingFamily.INTIMATE_TABLE: "a small private table in a calm room",
    SettingFamily.SOCIAL_INDOOR: "a party room with a long table",
    SettingFamily.GENERIC_INDOOR: "an indoor room",
    SettingFamily.GENERIC_OUTDOOR: "an outdoor open space",
}

PEOPLE_CONSTRAINTS: dict[PeoplePolicy, str] = {
    PeoplePolicy.ATMOSPHERE: (
        "people only as atmosphere, seen from behind, in three-quarter view or in profile "
        "against the light, never facing the camera, faces not identifiable, no close-ups"
    ),
    PeoplePolicy.REQUIRED: (
        "people as a group, including adults and children where the title says so, "
        "seen from behind, in three-quarter view or in profile, faces not identifiable, "
        "no close-ups"
    ),
    PeoplePolicy.ABSENT: (
        "Keep people out of the main subject: no crowd, no faces, no portraits."
    ),
}

LIGHTING_CONSTRAINTS: dict[LightingFamily, str] = {
    LightingFamily.NIGHT_PERFORMANCE: (
        "night performance lighting: a dark room with stage or coloured light as the key light"
    ),
    LightingFamily.NIGHT_INDOOR: "evening indoor light, warm and low",
}

#: 活気の型の英語制約。活動の置き換えではなく、活動がいちばん動いている瞬間。
#:
#: 「立ったままの人」「整列した集合写真」「空の会場」を活動の絵にしないための型。
#: 光の色は `lighting` が夜の公演を指すときだけ語る（昼の屋外フェスに多色のビームを
#: 足さない）。
ENERGY_CONSTRAINTS: dict[EnergyFamily, str] = {
    EnergyFamily.CROWD_PEAK: (
        "the peak of the activity: a packed floor of people dancing close together, "
        "a mass of backs, shoulders and side profiles, arms up and hands raised toward "
        "the light, no one standing still or posing"
    ),
    EnergyFamily.DANCE_PEAK: (
        "the peak of the activity: a floor of people moving together to modern pop or "
        "hip-hop beats, bodies mid-motion in the same rhythm, arms raised, "
        "a lively floor rather than a seated audience"
    ),
    EnergyFamily.GAME_PEAK: (
        "the peak of the activity: players around a table cheering a winning move, "
        "arms thrown up, bodies leaning in over the table, boards, cards, pieces and "
        "dice spread across it"
    ),
    EnergyFamily.CELEBRATION_PEAK: (
        "the peak of the activity: a birthday cake with lit candles on the table while "
        "everyone turns toward it, applause and pulled party crackers with paper "
        "streamers in the air"
    ),
    EnergyFamily.SHARED_TOAST: (
        "the peak of the activity: people leaning in over shared dishes and raising "
        "glasses together, heads close and laughing, plates and drinks being passed"
    ),
}

#: 夜の公演でだけ足す光の句。昼の屋外にビームを持ち込まない。
_NIGHT_ENERGY_LIGHT: str = (
    "saturated multi-coloured light beams cutting through haze with strong contrast"
)

#: 舞台の舞踊でだけ足す光の句。客席は拍手する側で、クラブのフロアではない。
_STAGE_ENERGY_LIGHT: str = "warm stage light with a lit backdrop behind the dancers"

#: 舞台の舞踊の制約。`DANCE_PEAK` をクラブの絵へ流さない。
_STAGE_DANCE_CONSTRAINT: str = (
    "the peak of the activity: a dancer mid-performance on a lit stage while the "
    "audience in the foreground leans in and applauds, moving bodies rather than "
    "a still pose"
)

#: 活動 → 既定の会場。場所が種別を言わないときだけ使う。
_ACTIVITY_SETTING: dict[ActivityFamily, SettingFamily] = {
    ActivityFamily.BODY_PERFORMANCE: SettingFamily.PERFORMANCE_SPACE,
    ActivityFamily.MUSIC_PERFORMANCE: SettingFamily.PERFORMANCE_SPACE,
    ActivityFamily.FOOD: SettingFamily.DINING_OR_TABLE,
    ActivityFamily.MARKET: SettingFamily.MARKET_OUTDOOR,
    ActivityFamily.CRAFT: SettingFamily.STUDIO_OR_TABLE,
    ActivityFamily.FORTUNE: SettingFamily.INTIMATE_TABLE,
    ActivityFamily.PHOTO: SettingFamily.STUDIO_OR_GALLERY,
    ActivityFamily.FIRE_GATHERING: SettingFamily.OUTDOOR_WATER_OR_FIELD,
    ActivityFamily.FESTIVAL: SettingFamily.OUTDOOR_FESTIVAL,
    ActivityFamily.TALK_OR_CLASS: SettingFamily.QUIET_INDOOR,
    ActivityFamily.PARTY: SettingFamily.SOCIAL_INDOOR,
}

#: 活動 → 人物方針。複数あるときは強い方を採る。
_ACTIVITY_PEOPLE: dict[ActivityFamily, PeoplePolicy] = {
    ActivityFamily.BODY_PERFORMANCE: PeoplePolicy.ATMOSPHERE,
    ActivityFamily.MUSIC_PERFORMANCE: PeoplePolicy.ATMOSPHERE,
    ActivityFamily.FOOD: PeoplePolicy.ABSENT,
    ActivityFamily.MARKET: PeoplePolicy.ABSENT,
    ActivityFamily.CRAFT: PeoplePolicy.ABSENT,
    ActivityFamily.FORTUNE: PeoplePolicy.ABSENT,
    ActivityFamily.PHOTO: PeoplePolicy.ABSENT,
    ActivityFamily.FIRE_GATHERING: PeoplePolicy.ABSENT,
    ActivityFamily.FESTIVAL: PeoplePolicy.ATMOSPHERE,
    ActivityFamily.TALK_OR_CLASS: PeoplePolicy.ABSENT,
    ActivityFamily.PARTY: PeoplePolicy.ATMOSPHERE,
}

_PEOPLE_RANK: dict[PeoplePolicy, int] = {
    PeoplePolicy.ABSENT: 0,
    PeoplePolicy.ATMOSPHERE: 1,
    PeoplePolicy.REQUIRED: 2,
}

#: 活動 → 既定の活気。人が居るときだけ使う。先に見つかった活動を優先する。
_ACTIVITY_ENERGY: dict[ActivityFamily, EnergyFamily] = {
    ActivityFamily.MUSIC_PERFORMANCE: EnergyFamily.CROWD_PEAK,
    ActivityFamily.FESTIVAL: EnergyFamily.CROWD_PEAK,
    ActivityFamily.BODY_PERFORMANCE: EnergyFamily.DANCE_PEAK,
    ActivityFamily.PARTY: EnergyFamily.SHARED_TOAST,
    ActivityFamily.FOOD: EnergyFamily.SHARED_TOAST,
    ActivityFamily.MARKET: EnergyFamily.SHARED_TOAST,
    ActivityFamily.CRAFT: EnergyFamily.SHARED_TOAST,
}

#: 題の語 → 活動。語彙は増やしてよいが、型は増やさない。
_ACTIVITY_WORDS: dict[ActivityFamily, tuple[str, ...]] = {
    ActivityFamily.BODY_PERFORMANCE: (
        "ダンス",
        "ダンスパフォーマンス",
        "踊り",
        "おどり",
        "舞踊",
        "盆踊り",
        "バレエ",
        "ヒップホップ",
        "フラメンコ",
        "ヨガ",
        "演劇",
        "パフォーマンス",
        "体操",
    ),
    ActivityFamily.MUSIC_PERFORMANCE: (
        "ライブ",
        "コンサート",
        "ジャズ",
        "DJ",
        "ディージェイ",
        "バンド",
        "セッション",
        "音楽",
        "弾き語り",
        "オーケストラ",
    ),
    ActivityFamily.FOOD: (
        "ごはん",
        "ご飯",
        "炊飯",
        "芋煮",
        "タコパ",
        "たこ焼き",
        "タコ焼き",
        "料理",
        "食事",
        "宴会",
        "鍋",
        "カフェ会",
        "ランチ",
        "ディナー",
        "パン",
        "スイーツ",
        "お茶会",
    ),
    ActivityFamily.MARKET: (
        "マルシェ",
        "マーケット",
        "フリマ",
        "蚤の市",
        "市場",
    ),
    ActivityFamily.CRAFT: (
        "手しごと",
        "ワークショップ",
        "工房",
        "手芸",
        "クラフト",
        "工作",
    ),
    ActivityFamily.FORTUNE: ("占い", "タロット", "星読み"),
    ActivityFamily.PHOTO: ("撮影会", "写真撮影", "写真展", "展示会", "展示"),
    ActivityFamily.FIRE_GATHERING: ("焚き火", "焚火", "たき火", "キャンプ"),
    ActivityFamily.FESTIVAL: ("フェス", "祭", "まつり", "縁日"),
    ActivityFamily.TALK_OR_CLASS: (
        "読書会",
        "講座",
        "教室",
        "トーク",
        "勉強会",
        "セミナー",
        "勉強",
        "語る会",
        "座談会",
    ),
    ActivityFamily.PARTY: (
        "パーティー",
        "パーティ",
        "交流会",
        "懇親会",
        "披露宴",
        "誕生日",
        "誕生会",
        "バースデー",
        "二次会",
        "忘年会",
        "新年会",
        "ボードゲーム",
        "ゲーム会",
        "カードゲーム",
        "麻雀",
        "TRPG",
    ),
}

#: 題の語 → モチーフ。行事名は装飾であって活動ではない。
_MOTIF_WORDS: dict[MotifFamily, tuple[str, ...]] = {
    MotifFamily.HOLIDAY: (
        "クリスマス",
        "ハロウィン",
        "ハロウィーン",
        "正月",
        "お正月",
        "お盆",
        "七夕",
        "バレンタイン",
        "ひな祭り",
        "こどもの日",
        "大晦日",
        "年末年始",
        "イースター",
    ),
}

#: 題の語 → 人物。家族は人を必須にする。
_FAMILY_WORDS: tuple[str, ...] = (
    "おやこ",
    "親子",
    "こども",
    "子供",
    "子ども",
    "キッズ",
    "ファミリー",
)

#: 題の語 → 活気。活動の既定より先に見る（誕生日会は PARTY の既定より祝い）。
_ENERGY_WORDS: dict[EnergyFamily, tuple[str, ...]] = {
    EnergyFamily.CELEBRATION_PEAK: (
        "誕生日",
        "誕生会",
        "バースデー",
        "お祝い",
        "記念パーティ",
    ),
    EnergyFamily.GAME_PEAK: (
        "ボードゲーム",
        "ゲーム会",
        "カードゲーム",
        "麻雀",
        "TRPG",
        "すごろく",
        "クイズ大会",
    ),
}

#: 静かな催しの語。身体の活動でも盛り上がりの型を付けない。
_CALM_WORDS: tuple[str, ...] = (
    "ヨガ",
    "ピラティス",
    "ストレッチ",
    "瞑想",
    "呼吸",
)

#: 舞台の舞踊の語。クラブのフロアではなく、客席が拍手する舞台にする。
_STAGE_DANCE_WORDS: tuple[str, ...] = (
    "バレエ",
    "フラメンコ",
    "日本舞踊",
    "舞踊",
    "盆踊り",
    "演劇",
    "オペラ",
)

#: 場所の語 → 会場。上から順に見る（固有の語を先に）。
_SETTING_WORDS: tuple[tuple[SettingFamily, tuple[str, ...]], ...] = (
    (
        SettingFamily.PERFORMANCE_SPACE,
        ("ライブハウス", "ライヴハウス", "ホール", "会館", "劇場", "シアター", "公会堂"),
    ),
    (SettingFamily.BAR_OR_CLUB, ("BAR", "バー", "クラブ", "酒場", "スナック")),
    (SettingFamily.STUDIO_OR_GALLERY, ("ギャラリー", "美術館", "展示場")),
    (SettingFamily.STUDIO_OR_TABLE, ("スタジオ", "工房", "アトリエ")),
    (SettingFamily.QUIET_INDOOR, ("図書館", "公民館", "集会所", "会議室")),
    (SettingFamily.CAFE, ("カフェ", "喫茶")),
    (SettingFamily.DINING_OR_TABLE, ("レストラン", "食堂", "ダイニング", "居酒屋")),
    (SettingFamily.SOCIAL_INDOOR, ("ホテル", "宴会場")),
    (SettingFamily.INTIMATE_TABLE, ("サロン", "個室")),
    (SettingFamily.PARK, ("公園", "広場", "庭園")),
    (SettingFamily.WATERFRONT, ("川辺", "河原", "川原", "海辺", "湖畔", "水辺")),
    (SettingFamily.MARKET_OUTDOOR, ("商店街", "朝市", "市場通り")),
    (SettingFamily.OUTDOOR_FESTIVAL, ("神社", "境内", "校庭", "グラウンド", "境内")),
    (
        SettingFamily.OUTDOOR_WATER_OR_FIELD,
        ("キャンプ場", "高原", "農園", "畑"),
    ),
)

#: 野外の会場。活動の既定より場所を優先する。
_OUTDOOR_SETTINGS: frozenset[SettingFamily] = frozenset(
    {
        SettingFamily.PARK,
        SettingFamily.WATERFRONT,
        SettingFamily.MARKET_OUTDOOR,
        SettingFamily.OUTDOOR_FESTIVAL,
        SettingFamily.OUTDOOR_WATER_OR_FIELD,
        SettingFamily.GENERIC_OUTDOOR,
    }
)

_TOKEN_END = f"(?=$|[{_SEPARATORS}])"


FamilyT = TypeVar("FamilyT", ActivityFamily, MotifFamily, EnergyFamily)


def _compile(words: tuple[str, ...], *, token_end: bool = False) -> re.Pattern[str]:
    body = "|".join(re.escape(word) for word in words)
    suffix = _TOKEN_END if token_end else ""
    return re.compile(f"(?:{body}){suffix}", re.IGNORECASE)


_ACTIVITY_PATTERNS: tuple[tuple[ActivityFamily, re.Pattern[str]], ...] = tuple(
    (family, _compile(words)) for family, words in _ACTIVITY_WORDS.items()
) + ((ActivityFamily.MARKET, _compile(("市",), token_end=True)),)

_MOTIF_PATTERNS: tuple[tuple[MotifFamily, re.Pattern[str]], ...] = tuple(
    (family, _compile(words)) for family, words in _MOTIF_WORDS.items()
)

_FAMILY_PATTERN: re.Pattern[str] = _compile(_FAMILY_WORDS)

_ENERGY_PATTERNS: tuple[tuple[EnergyFamily, re.Pattern[str]], ...] = tuple(
    (family, _compile(words)) for family, words in _ENERGY_WORDS.items()
)

_CALM_PATTERN: re.Pattern[str] = _compile(_CALM_WORDS)
_STAGE_DANCE_PATTERN: re.Pattern[str] = _compile(_STAGE_DANCE_WORDS)

_SETTING_PATTERNS: tuple[tuple[SettingFamily, re.Pattern[str]], ...] = tuple(
    (family, _compile(words)) for family, words in _SETTING_WORDS
)

_ALL_PATTERNS: tuple[re.Pattern[str], ...] = (
    tuple(pattern for _, pattern in _ACTIVITY_PATTERNS)
    + tuple(pattern for _, pattern in _MOTIF_PATTERNS)
    + tuple(pattern for _, pattern in _ENERGY_PATTERNS)
    + (_FAMILY_PATTERN,)
)


@dataclass(frozen=True)
class VisualHints:
    """題だけから見た視覚要素（互換のためのビュー）。"""

    #: 画像に必ず入れる英語の制約。題に現れた順。
    subjects: tuple[str, ...]
    #: 辞書に無かった語。LLM に原文のまま渡す。
    title_nouns: tuple[str, ...]


@dataclass(frozen=True)
class SceneBrief:
    """催しの型。具体的な小道具は持たない。"""

    activities: tuple[ActivityFamily, ...]
    motifs: tuple[MotifFamily, ...]
    setting: SettingFamily | None
    people: PeoplePolicy | None
    lighting: LightingFamily | None
    energy: EnergyFamily | None
    title_nouns: tuple[str, ...]
    #: 活気の言い方を細かく決めるための題そのもの（舞台か、静かな催しか）。
    title: str = ""

    @property
    def has_families(self) -> bool:
        """辞書で型を 1 つでも取れたか。"""
        return bool(
            self.activities
            or self.motifs
            or self.setting
            or self.people
            or self.energy
        )

    @property
    def subjects(self) -> tuple[str, ...]:
        """画像へ渡す英語の制約（活動・モチーフ・会場・活気）。"""
        items: list[str] = [
            _activity_constraint(activity, self.activities)
            for activity in self.activities
        ]
        items.extend(MOTIF_CONSTRAINTS[motif] for motif in self.motifs)
        if self.setting is not None:
            items.append(SETTING_CONSTRAINTS[self.setting])
        if self.energy is not None:
            items.append(
                energy_constraint(
                    self.energy,
                    title=self.title,
                    lighting=self.lighting,
                )
            )
        return tuple(items)


def _tokens(title: str) -> list[str]:
    return [token for token in re.split(f"[{_SEPARATORS}]+", title) if token]


def _is_covered(token: str) -> bool:
    return any(pattern.search(token) for pattern in _ALL_PATTERNS)


def _matched_families(
    text: str,
    patterns: tuple[tuple[FamilyT, re.Pattern[str]], ...],
) -> tuple[FamilyT, ...]:
    """型を、題に現れた位置の順で返す。同じ型は 1 回だけ。"""
    found: list[tuple[int, FamilyT]] = []
    for family, pattern in patterns:
        match = pattern.search(text)
        if match is not None:
            found.append((match.start(), family))
    found.sort(key=lambda item: item[0])
    return tuple(dict.fromkeys(family for _, family in found))


def _families(title: str) -> tuple[tuple[ActivityFamily, ...], tuple[MotifFamily, ...], bool]:
    activities = _matched_families(title, _ACTIVITY_PATTERNS)
    motifs = _matched_families(title, _MOTIF_PATTERNS)
    has_family = _FAMILY_PATTERN.search(title) is not None
    return activities, motifs, has_family


def _activity_constraint(
    activity: ActivityFamily,
    activities: tuple[ActivityFamily, ...],
) -> str:
    if activity is ActivityFamily.MUSIC_PERFORMANCE and (
        ActivityFamily.BODY_PERFORMANCE in activities
    ):
        return _MUSIC_UNDER_BODY
    return ACTIVITY_CONSTRAINTS[activity]


def energy_constraint(
    energy: EnergyFamily,
    *,
    title: str = "",
    lighting: LightingFamily | None = None,
) -> str:
    """活気の型を英語の制約へ変える。題と光で言い方だけを調整する。

    舞台の舞踊は客席が拍手する側で、クラブのフロアではない。多色のビームは夜の
    公演でだけ語る（昼の屋外フェスへ持ち込まない）。
    """
    if energy is EnergyFamily.DANCE_PEAK and _STAGE_DANCE_PATTERN.search(title):
        base = _STAGE_DANCE_CONSTRAINT
        light = _STAGE_ENERGY_LIGHT if lighting is not None else ""
    else:
        base = ENERGY_CONSTRAINTS[energy]
        night = energy in {EnergyFamily.CROWD_PEAK, EnergyFamily.DANCE_PEAK}
        light = (
            _NIGHT_ENERGY_LIGHT
            if night and lighting is LightingFamily.NIGHT_PERFORMANCE
            else ""
        )
    return f"{base}, {light}" if light else base


def _setting_from_location(location: str) -> SettingFamily | None:
    for family, pattern in _SETTING_PATTERNS:
        if pattern.search(location) is not None:
            return family
    return None


def _default_setting(activities: tuple[ActivityFamily, ...]) -> SettingFamily | None:
    for activity in activities:
        setting = _ACTIVITY_SETTING.get(activity)
        if setting is not None:
            return setting
    return None


def _setting(
    location: str,
    activities: tuple[ActivityFamily, ...],
    rain_policy: RainPolicy,
    *,
    known: bool,
) -> SettingFamily | None:
    """会場の型を決める。場所が言う種別を優先し、無ければ活動の既定。"""
    found = _setting_from_location(location)
    if found is not None:
        return found
    default = _default_setting(activities)
    if default is not None:
        return default
    if not known:
        return None
    # 活動もモチーフも無いが、屋内・屋外だけは決められる場合。
    if rain_policy is RainPolicy.INDOOR:
        return SettingFamily.GENERIC_INDOOR
    return SettingFamily.GENERIC_OUTDOOR


def _people(
    activities: tuple[ActivityFamily, ...],
    has_family: bool,
) -> PeoplePolicy | None:
    if not activities and not has_family:
        return None
    policy = PeoplePolicy.ABSENT
    for activity in activities:
        candidate = _ACTIVITY_PEOPLE[activity]
        if _PEOPLE_RANK[candidate] > _PEOPLE_RANK[policy]:
            policy = candidate
    if has_family:
        policy = PeoplePolicy.REQUIRED
    return policy


def _energy(
    title: str,
    activities: tuple[ActivityFamily, ...],
    people: PeoplePolicy | None,
) -> EnergyFamily | None:
    """盛り上がりの頂点を決める。人が居ない催しでは決めない。

    題に活気の語（誕生日・ボードゲーム）があれば活動の既定より先に採る。
    静かな催し（ヨガ等）の身体の活動には付けない。付けられる型が無ければ None。
    """
    if people is None or people is PeoplePolicy.ABSENT:
        return None
    if ActivityFamily.BODY_PERFORMANCE in activities and _CALM_PATTERN.search(title):
        return None
    named = _matched_families(title, _ENERGY_PATTERNS)
    if named:
        return named[0]
    for activity in activities:
        energy = _ACTIVITY_ENERGY.get(activity)
        if energy is not None:
            return energy
    return None


def _start_hour(event_time: str) -> int | None:
    match = re.search(r"(\d{1,2}):(\d{2})", event_time)
    if match is None:
        return None
    return int(match.group(1))


def _lighting(
    activities: tuple[ActivityFamily, ...],
    setting: SettingFamily | None,
    event_time: str,
) -> LightingFamily | None:
    """催しの光を決める。夜の公演だけステージの光にする。

    PARTY は公演ではない。14 時の誕生日会やボードゲーム会を、暗いステージの
    多色照明へ変えない（祝いの活気は `energy` が受け持つ）。
    """
    hour = _start_hour(event_time)
    if hour is None:
        return None
    performance = any(
        activity
        in {
            ActivityFamily.BODY_PERFORMANCE,
            ActivityFamily.MUSIC_PERFORMANCE,
        }
        for activity in activities
    )
    if hour >= 18:
        return (
            LightingFamily.NIGHT_PERFORMANCE
            if performance
            else LightingFamily.NIGHT_INDOOR
        )
    if performance and setting is not None and setting not in _OUTDOOR_SETTINGS:
        return LightingFamily.NIGHT_PERFORMANCE
    return None


def visual_hints(title: str) -> VisualHints:
    """題だけから、英語の型制約と辞書外の名詞を返す（互換のビュー）。"""
    text = title.strip()
    if not text:
        return VisualHints(subjects=(), title_nouns=())

    activities, motifs, has_family = _families(text)
    subjects: list[str] = [
        _activity_constraint(activity, activities) for activity in activities
    ]
    subjects.extend(MOTIF_CONSTRAINTS[motif] for motif in motifs)
    energy = _energy(text, activities, _people(activities, has_family))
    if energy is not None:
        subjects.append(energy_constraint(energy, title=text))

    nouns = tuple(token for token in _tokens(text) if not _is_covered(token))
    return VisualHints(subjects=tuple(subjects), title_nouns=nouns)


def scene_brief(request: FlyerGenerationRequest) -> SceneBrief:
    """題・場所・雨天・時刻から、催しの型を組む。純粋関数。"""
    title = request.title.strip()
    activities, motifs, has_family = _families(title)
    setting = _setting(
        request.location,
        activities,
        request.rain_policy,
        known=bool(activities or motifs or has_family),
    )
    people = _people(activities, has_family)
    # 型が 1 つも取れない題では、時刻だけから光を決めない（題の解釈を縛らない）。
    lighting = (
        _lighting(activities, setting, request.event_time)
        if activities or motifs or setting is not None or people is not None
        else None
    )
    nouns = tuple(token for token in _tokens(title) if not _is_covered(token))
    return SceneBrief(
        activities=activities,
        motifs=motifs,
        setting=setting,
        people=people,
        lighting=lighting,
        energy=_energy(title, activities, people),
        title_nouns=nouns,
        title=title,
    )


__all__ = [
    "ACTIVITY_CONSTRAINTS",
    "ENERGY_CONSTRAINTS",
    "LIGHTING_CONSTRAINTS",
    "MOTIF_CONSTRAINTS",
    "PEOPLE_CONSTRAINTS",
    "ActivityFamily",
    "EnergyFamily",
    "LightingFamily",
    "MotifFamily",
    "PeoplePolicy",
    "SceneBrief",
    "SettingFamily",
    "VisualHints",
    "energy_constraint",
    "scene_brief",
    "visual_hints",
]
