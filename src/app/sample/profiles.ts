import type { OrganizerProfileContent } from "@/modules/organizers/types";

/**
 * 見本の主催者プロフィール（SCR-PUB-18）。
 *
 * `/sample` の一覧からだけ辿れる、架空の主催者 6 人。DB を読まず、`/organizers/[userId]`
 * と同じ `OrganizerProfileView` に渡す形（`OrganizerProfileContent`）をそのまま持つ。
 * 本物の公開プロフィールと同じ部品で描くので、主催者が自分のプロフィールを公開したときの
 * 見え方を、作る前に確かめられる。
 *
 * 値は `src/modules/organizers/types.ts` の上限に収める。長さ・ジャンル・リンク先は
 * `tests/unit/sample-profiles.test.ts` が固定する。
 * 見本であることは画面の帯（`SampleBand`）と、本文末の注記が示す。
 */
export interface SampleProfile {
  /** URL の末尾（`/sample/profile/<slug>`）。 */
  slug: string;
  /** 一覧のカードで、名前より先に読む札。どんな主催者か。 */
  kind: string;
  name: string;
  profile: OrganizerProfileContent;
}

/** 一覧に並べる順。個人（昼）→ 個人（夜）→ 演者 → 店の順に、場面を変えて見せる。 */
export const SAMPLE_PROFILES: SampleProfile[] = [
  {
    slug: "day",
    kind: "個人（昼）",
    name: "佐藤 みのり",
    profile: {
      isPublished: true,
      headline: "公園と手しごとで、親子の午前をつくる",
      bio: "子どもが生まれてから、近所の公園で小さな集まりを開いています。工作、読み聞かせ、季節の野菜をゆでるだけの会。準備は 1 時間で終わるものだけにして、参加する人も主催する私も、帰りに余力を残せるようにしています。初めての人が 1 人でも座れる席を、いつも端に空けておきます。",
      area: "東京都・世田谷区の公園と公民館",
      tags: ["LOCAL", "LEARNING", "OTHER"],
      links: [
        { kind: "X", label: "X", url: "https://x.com/sample_minori" },
        { kind: "INSTAGRAM", label: "Instagram", url: "https://www.instagram.com/sample_minori" },
      ],
      stats: { eventCount: 32, sinceYear: 2019 },
      avatarUrl: null,
      headerUrl: null,
      themeId: "sage",
    },
  },
  {
    slug: "night",
    kind: "個人（夜）",
    name: "高橋 直樹",
    profile: {
      isPublished: true,
      headline: "仕事帰りの 1 杯に、小さな音楽を",
      bio: "普段は会社員で、月に一度だけ、知り合いの店を借りて演奏会を開いています。20 時開始、22 時終了。終電に間に合うことを、出演者にもお客さんにも約束しています。音量は小さめ、椅子は多め。話しながら聴ける夜が好きなので、静かにしろとは言いません。",
      area: "東京都・新宿区と中野区の小さな店",
      tags: ["MUSIC", "FOOD"],
      links: [
        { kind: "X", label: "X", url: "https://x.com/sample_naoki" },
        { kind: "INSTAGRAM", label: "Instagram", url: "https://www.instagram.com/sample_naoki" },
      ],
      stats: { eventCount: 18, sinceYear: 2021 },
      avatarUrl: null,
      headerUrl: null,
      themeId: "dusk",
    },
  },
  {
    slug: "band",
    kind: "バンドマン",
    name: "川辺 ユウ",
    profile: {
      isPublished: true,
      headline: "街の小さな箱で、音を鳴らしています",
      bio: "3 人組で、年に 10 本ほどのライブを組んでいます。会場は 50 人まで入る箱ばかり。物販より、終わったあとに話せる時間を長く取りたいので、転換は 15 分で切り上げます。共演者を募集するときは、ここから先に声をかけます。",
      area: "東京・神奈川・埼玉のライブハウス",
      tags: ["MUSIC", "LOCAL"],
      links: [
        { kind: "X", label: "X", url: "https://x.com/sample_yu" },
        { kind: "INSTAGRAM", label: "Instagram", url: "https://www.instagram.com/sample_yu" },
      ],
      stats: { eventCount: 41, sinceYear: 2017 },
      avatarUrl: null,
      headerUrl: null,
      themeId: "neon",
    },
  },
  {
    slug: "dancer",
    kind: "ダンサー",
    name: "森 あかり",
    profile: {
      isPublished: true,
      headline: "からだで遊ぶ、週末のワークショップ",
      bio: "踊りを教えるというより、動きながら自分の癖に気づく時間を作っています。経験は問いません。裸足になれる格好と、飲み物だけ持ってきてください。2 時間のうち、最後の 30 分は好きに動いて、そのまま終わります。",
      area: "東京都・渋谷区と目黒区のスタジオ",
      tags: ["STAGE", "LEARNING"],
      links: [
        { kind: "X", label: "X", url: "https://x.com/sample_akari" },
        { kind: "INSTAGRAM", label: "Instagram", url: "https://www.instagram.com/sample_akari" },
      ],
      stats: { eventCount: 27, sinceYear: 2020 },
      avatarUrl: null,
      headerUrl: null,
      themeId: "candy",
    },
  },
  {
    slug: "bar",
    kind: "バー",
    name: "井上 健",
    profile: {
      isPublished: true,
      headline: "カウンター越しに、人がつながる夜",
      bio: "12 席のバーを 1 人で回しています。月に 2 回、テーマを決めない集まりを開きます。お酒が飲めなくても大丈夫です。ノンアルコールの一杯も、同じ値段で用意しています。初めての人は、いちばん奥の席を空けておきます。",
      area: "大阪市・天満の 12 席の店",
      tags: ["FOOD", "LOCAL", "MUSIC"],
      links: [
        { kind: "X", label: "X", url: "https://x.com/sample_ken" },
        { kind: "INSTAGRAM", label: "Instagram", url: "https://www.instagram.com/sample_ken" },
      ],
      stats: { eventCount: 56, sinceYear: 2015 },
      avatarUrl: null,
      headerUrl: null,
      themeId: "modern-slate",
    },
  },
  {
    slug: "restaurant",
    kind: "飲食店",
    name: "山本 千夏",
    profile: {
      isPublished: true,
      headline: "季節のごはんで、集まる理由をつくる",
      bio: "8 席の小さな食堂です。旬の食材で、月に一度だけ、決まった献立の会を開いています。アレルギーと苦手なものは、申し込むときに書いてもらえれば、同じ席で違う一皿を出します。食べ終わったあとに長居できるよう、19 時開始の回だけにしています。",
      area: "京都市・西陣の 8 席の食堂",
      tags: ["FOOD", "LOCAL"],
      links: [
        { kind: "X", label: "X", url: "https://x.com/sample_chinatsu" },
        { kind: "INSTAGRAM", label: "Instagram", url: "https://www.instagram.com/sample_chinatsu" },
      ],
      stats: { eventCount: 23, sinceYear: 2018 },
      avatarUrl: null,
      headerUrl: null,
      themeId: "washi",
    },
  },
];

/** slug から 1 人を引く。知らない slug は undefined（画面は 404 にする）。 */
export function findProfile(slug: string): SampleProfile | undefined {
  return SAMPLE_PROFILES.find((profile) => profile.slug === slug);
}
