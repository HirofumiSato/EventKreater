"""題・場所・時刻から「催しの型」を取り出す契約。

型は活動・モチーフ・会場・人物方針・光の 5 つ。具体的な小道具（ツリー、鍋、
ステージの内装）は固定しない。固定すると、別の催しが同じ絵へ吸い込まれる。
外部 API は呼ばない。
"""

from __future__ import annotations

from src.domain.layout_prompts import must_depict_hint
from src.domain.models import RainPolicy, SemanticTheme, TemplateId
from src.domain.prompt_payload import build_prompt_payload
from src.domain.visual_hints import (
    MOTIF_CONSTRAINTS,
    ActivityFamily,
    EnergyFamily,
    LightingFamily,
    MotifFamily,
    PeoplePolicy,
    SettingFamily,
    scene_brief,
    visual_hints,
)
from tests.support import make_request


def test_holiday_body_performance_keeps_every_slot() -> None:
    # 行事名（モチーフ）と身体の公演（活動）が同居する。どちらも落とさない。
    request = make_request(
        title="クリスマス ダンスパフォーマンス",
        location="北沢タウンホール 世田谷区",
        rain_policy=RainPolicy.INDOOR,
        event_time="18:00〜20:30",
    )
    brief = scene_brief(request)

    assert brief.activities == (ActivityFamily.BODY_PERFORMANCE,)
    assert brief.motifs == (MotifFamily.HOLIDAY,)
    assert brief.setting is SettingFamily.PERFORMANCE_SPACE
    assert brief.people is PeoplePolicy.ATMOSPHERE
    assert brief.lighting is LightingFamily.NIGHT_PERFORMANCE


def test_must_depict_keeps_activity_motif_and_setting() -> None:
    request = make_request(
        title="クリスマス ダンスパフォーマンス",
        location="北沢タウンホール 世田谷区",
        rain_policy=RainPolicy.INDOOR,
        event_time="18:00〜20:30",
    )
    line = must_depict_hint(request)

    assert line is not None
    assert line.startswith("Must clearly depict")
    # 行事の装飾だけの静物にしない。
    assert "body performance" in line
    assert "holiday decoration" in line
    assert "performance space" in line
    # 人が主役の集合写真にしない。横顔までは許すが、正面は描かない。
    assert "from behind" in line
    assert "in profile" in line
    assert "night performance lighting" in line
    # 公演をバンドシーンへ置き換えない。
    assert "band-only" not in line


def test_body_performance_survives_the_word_live() -> None:
    # 「ライブ」は音楽の型でも、身体の公演をバンドシーンで消さない。
    brief = scene_brief(make_request(title="ダンスライブ"))

    assert ActivityFamily.BODY_PERFORMANCE in brief.activities
    assert ActivityFamily.MUSIC_PERFORMANCE in brief.activities
    assert any("band-only" in subject for subject in brief.subjects)


def test_holiday_food_does_not_become_a_stage() -> None:
    # モチーフは会場を決めない。料理は公演空間へ引っ越さない。
    request = make_request(
        title="クリスマス ごはん会",
        location="公民館 世田谷区",
        rain_policy=RainPolicy.INDOOR,
        target_generation="20代から40代",
    )
    brief = scene_brief(request)

    assert brief.activities == (ActivityFamily.FOOD,)
    assert brief.motifs == (MotifFamily.HOLIDAY,)
    assert brief.setting is not SettingFamily.PERFORMANCE_SPACE
    assert brief.people is PeoplePolicy.ABSENT


def test_target_generation_never_adds_people() -> None:
    # 対象世代は、居る人の年代だけ。居ない人を増やさない。
    line = must_depict_hint(
        make_request(
            title="秋の芋煮会",
            location="川辺 世田谷区",
            target_generation="ファミリー",
        )
    )

    assert line is not None
    assert "food and drink" in line
    assert "Keep people out of the main subject" in line
    assert "as a group" not in line


def test_family_market_combines_three_roles() -> None:
    request = make_request(
        title="ハロウィン おやこマルシェ",
        location="公園 世田谷区",
        semantic_theme=SemanticTheme.CANDY,
        template_id=TemplateId.STYLE_3_VIBRANT_POP,
    )
    brief = scene_brief(request)

    assert ActivityFamily.MARKET in brief.activities
    assert brief.motifs == (MotifFamily.HOLIDAY,)
    assert brief.people is PeoplePolicy.REQUIRED
    assert brief.setting is SettingFamily.PARK


def test_city_word_is_not_read_as_a_market() -> None:
    # 「市民ホール」の 市 を市場と誤認しない。接尾辞のときだけ市を拾う。
    citizen = scene_brief(
        make_request(title="市民ホールで語る会", location="どこかの会場")
    )
    assert ActivityFamily.MARKET not in citizen.activities

    market = scene_brief(
        make_request(title="手しごとの市", location="どこかの会場")
    )
    assert ActivityFamily.MARKET in market.activities
    assert ActivityFamily.CRAFT in market.activities


def test_park_performance_stays_outdoor() -> None:
    # 公園の身体の公演を、室内ライブハウスへ引っ越さない。
    brief = scene_brief(
        make_request(
            title="公園ヨガ",
            location="代々木公園",
            rain_policy=RainPolicy.RAIN_OR_SHINE,
            event_time="10:00〜11:30",
        )
    )

    assert brief.setting is SettingFamily.PARK
    assert brief.lighting is None


def test_music_in_a_bar_uses_the_bar_setting() -> None:
    brief = scene_brief(
        make_request(title="DJナイト Vol.7", location="BAR LOOP 下北沢")
    )

    assert brief.activities == (ActivityFamily.MUSIC_PERFORMANCE,)
    assert brief.setting is SettingFamily.BAR_OR_CLUB
    assert brief.people is PeoplePolicy.ATMOSPHERE


def test_unknown_title_keeps_raw_nouns_and_no_family_line() -> None:
    request = make_request(title="秋のつどい", location="どこかの会場")
    brief = scene_brief(request)

    assert brief.activities == ()
    assert brief.motifs == ()
    assert brief.setting is None
    assert brief.title_nouns == ("秋のつどい",)
    assert must_depict_hint(request) is None


def test_visual_hints_view_returns_family_constraints() -> None:
    hints = visual_hints("ハロウィン おやこマルシェ")

    # 活動 + モチーフ + 活気（家族が居るので食卓の頂点）。
    assert len(hints.subjects) == 3
    assert MOTIF_CONSTRAINTS[MotifFamily.HOLIDAY] in hints.subjects
    assert any("market stalls" in subject for subject in hints.subjects)
    assert any("raising glasses" in subject for subject in hints.subjects)
    assert hints.title_nouns == ()


def test_payload_carries_families_and_paper_character() -> None:
    request = make_request(
        title="ハロウィン おやこマルシェ",
        location="公園 世田谷区",
        template_id=TemplateId.STYLE_3_VIBRANT_POP,
        semantic_theme=SemanticTheme.CANDY,
    )
    payload = build_prompt_payload(request)

    assert payload["activity_families"] == ["market"]
    assert payload["motif_families"] == ["holiday"]
    assert payload["setting_family"] == "park"
    assert payload["people_policy"] == "required"
    # 人が居る催しなので、活気の型も渡る。
    assert payload["energy_family"] == "shared_toast"
    assert "visual_hints" not in payload
    assert payload["paper_character"] == "にぎやかさ"
    # テーマは配色・小物・光だけを指定し、被写体も空も塗らせない。
    assert "palette, props and lighting only" in str(payload["design_direction"])
    assert "never the event subject or the sky" in str(payload["design_direction"])


def test_payload_drops_empty_family_keys() -> None:
    payload = build_prompt_payload(
        make_request(title="秋のつどい", location="どこかの会場")
    )

    assert "activity_families" not in payload
    assert "motif_families" not in payload
    assert "setting_family" not in payload
    assert "people_policy" not in payload
    assert "lighting_family" not in payload
    assert "energy_family" not in payload
    assert payload["title_nouns"] == ["秋のつどい"]


def test_dj_night_is_a_packed_floor_with_coloured_light() -> None:
    # DJ は「機材の静物」ではなく、満杯のフロアと挙がった手の瞬間。
    request = make_request(title="DJナイト Vol.7", location="BAR LOOP 下北沢")
    brief = scene_brief(request)
    line = must_depict_hint(request)

    assert brief.energy is EnergyFamily.CROWD_PEAK
    assert line is not None
    assert "packed floor" in line
    assert "hands raised" in line
    # 夜の公演なので、多色のビームまで語る。
    assert "multi-colour" in line


def test_dance_uses_modern_pop_not_a_classical_concert() -> None:
    request = make_request(title="ダンスパーティー", location="クラブ 渋谷")
    brief = scene_brief(request)
    line = must_depict_hint(request)

    assert brief.energy is EnergyFamily.DANCE_PEAK
    assert line is not None
    assert "modern pop" in line
    # クラシックの演奏会にしない。
    assert "classical" not in line
    # 卓を囲む遊びの絵にしない（PARTY が遊具の卓を主張しない）。
    assert "plays with" not in line


def test_stage_dance_applauds_instead_of_a_club_floor() -> None:
    # バレエは客席が拍手する舞台で、クラブのフロアではない。
    request = make_request(
        title="バレエ発表会",
        location="北沢タウンホール",
        rain_policy=RainPolicy.INDOOR,
    )
    brief = scene_brief(request)
    line = must_depict_hint(request)

    assert brief.energy is EnergyFamily.DANCE_PEAK
    assert line is not None
    assert "applaud" in line
    assert "club" not in line


def test_calm_body_activity_gets_no_peak() -> None:
    # 公園ヨガを、多色のビームが走るフロアへ変えない。
    request = make_request(
        title="公園ヨガ",
        location="代々木公園",
        event_time="10:00〜11:30",
    )
    brief = scene_brief(request)
    line = must_depict_hint(request)

    assert brief.energy is None
    assert line is not None
    assert "hands raised" not in line


def test_board_game_meeting_derives_a_winning_moment() -> None:
    request = make_request(title="ボードゲーム会", location="公民館 世田谷区")
    brief = scene_brief(request)
    line = must_depict_hint(request)

    assert ActivityFamily.PARTY in brief.activities
    assert brief.energy is EnergyFamily.GAME_PEAK
    assert line is not None
    assert "cheering" in line
    assert "winning" in line


def test_birthday_meeting_derives_a_celebration() -> None:
    request = make_request(title="誕生日会", location="公民館 世田谷区")
    brief = scene_brief(request)
    line = must_depict_hint(request)

    assert ActivityFamily.PARTY in brief.activities
    assert brief.energy is EnergyFamily.CELEBRATION_PEAK
    assert line is not None
    assert "cake" in line
    assert "applause" in line
    assert "crackers" in line


def test_daytime_party_is_not_a_night_stage() -> None:
    # 14 時の誕生日会を、暗いステージの照明へ変えない。
    birthday = scene_brief(
        make_request(
            title="誕生日会",
            location="公民館 世田谷区",
            event_time="14:00〜16:00",
        )
    )
    board_game = scene_brief(
        make_request(
            title="ボードゲーム会",
            location="公民館 世田谷区",
            event_time="13:00〜17:00",
        )
    )

    assert birthday.lighting is not LightingFamily.NIGHT_PERFORMANCE
    assert board_game.lighting is None


def test_absent_people_never_get_a_lively_scene() -> None:
    # 人が居ない催しに、活気の型から人を足さない。
    request = make_request(
        title="秋の芋煮会",
        location="川辺 世田谷区",
        event_time="11:00〜14:00",
    )
    brief = scene_brief(request)
    line = must_depict_hint(request)

    assert brief.people is PeoplePolicy.ABSENT
    assert brief.energy is None
    assert line is not None
    assert "raising glasses" not in line
