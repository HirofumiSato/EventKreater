import type {
  EventPricePlanOption,
  EventScheduleOption,
  PriceAudience,
  PublicEventOrganizers,
  RainPolicy,
} from "@/modules/events/types";
import { composeEventTime, composePriceText } from "@/lib/serializers";
import type { SemanticThemeId } from "@/lib/semantic-themes";

/**
 * ホームから開く、告知ページの見本（SCR-PUB-16 / SCR-PUB-17）。
 *
 * DB を使わない。初見の幹事が「自分の催しならどう見えるか」を作る前に確かめる画面なので、
 * ログイン・API・出欠の送信を一切持たない。値は `scripts/seed-ui-demo.mjs` の
 * デモ催しと揃えてあり、チラシの画像も `public/samples/**` の実物をそのまま使う。
 *
 * 日付は固定で持つ。撮影（`npm run mock:sync`）のたびに文字が変わると、
 * モックの指紋が毎日ずれるため。見本であることは画面の帯（`SampleBand`）が示す。
 */
export interface SampleEvent {
  /** URL の末尾（`/sample/<slug>`）。 */
  slug: string;
  /** 催しの型。一覧のカードで、題より先に読む札。 */
  kind: string;
  title: string;
  /** 一覧のカードに置く 1 文。どんな集まりかを、題の次に伝える。 */
  intro: string;
  /** `public/samples/` のチラシ画像。 */
  flyerSrc: string;
  /** 告知ページのテーマ。紙面の色と書体が変わる。 */
  themeId: SemanticThemeId;
  location: string;
  venueName: string;
  rainPolicy: RainPolicy;
  capacity: number;
  /** 対象世代。告知ページのメタ情報に「対象」の行として出る。 */
  targetGeneration: string;
  attendingCount: number;
  waitlistCount: number;
  schedules: EventScheduleOption[];
  pricePlans: EventPricePlanOption[];
  organizers: PublicEventOrganizers;
}

function schedule(
  id: string,
  eventDate: string,
  startTime: string,
  endTime: string,
): EventScheduleOption {
  return {
    id,
    eventDate,
    startTime,
    endTime,
    eventTime: composeEventTime(startTime, endTime),
  };
}

function plan(
  id: string,
  name: string,
  amount: number,
  note: string | null = null,
  audience: PriceAudience = "ANY",
): EventPricePlanOption {
  return { id, name, audience, amount, note, price: composePriceText({ amount, note }) };
}

/** 見本の主催者。`userId` を null にして、公開プロフィールへのリンクにしない。 */
const HOST = { name: "佐藤 みのり", userId: null } as const;

export const SAMPLE_EVENTS: readonly SampleEvent[] = [
  {
    slug: "autumn",
    kind: "外ごはん",
    title: "秋の芋煮会",
    intro: "河原で鍋を囲む、毎年恒例の集まり。子ども連れも歓迎です。",
    flyerSrc: "/samples/flyer-autumn.jpg",
    themeId: "parchment",
    location: "河川敷公園 第2広場（東京都世田谷区）",
    venueName: "河川敷公園 第2広場",
    rainPolicy: "POSTPONE_ON_RAIN",
    capacity: 40,
    targetGeneration: "20代から40代",
    attendingCount: 24,
    waitlistCount: 0,
    schedules: [schedule("autumn-1", "2026-11-08", "11:00", "15:00")],
    pricePlans: [
      plan("autumn-adult", "大人", 1500, "1ドリンク付"),
      plan("autumn-student", "学生", 1000),
      plan("autumn-child", "子ども", 0, "小学生まで"),
    ],
    organizers: {
      owner: HOST,
      coHosts: [{ name: "高橋 直樹", userId: null }],
    },
  },
  {
    slug: "market",
    kind: "マーケット",
    title: "手しごとの市 秋の道具市",
    intro: "木の器と布の道具が並ぶ、一日だけの小さな市です。",
    flyerSrc: "/samples/flyer-craft-market.jpg",
    themeId: "washi",
    location: "旧校舎ギャラリー（東京都世田谷区）",
    venueName: "旧校舎ギャラリー",
    rainPolicy: "INDOOR",
    capacity: 60,
    targetGeneration: "30代から60代",
    attendingCount: 18,
    waitlistCount: 0,
    schedules: [schedule("market-1", "2026-11-14", "10:00", "16:00")],
    pricePlans: [plan("market-entry", "入場", 0, "どなたでも")],
    organizers: { owner: HOST, coHosts: [] },
  },
  {
    slug: "halloween",
    kind: "子ども連れ",
    title: "ハロウィン おやこマルシェ",
    intro: "仮装したまま遊べる、おやつと工作の広場です。",
    flyerSrc: "/samples/flyer-halloween.jpg",
    themeId: "candy",
    location: "世田谷公園 芝生広場（東京都世田谷区）",
    venueName: "世田谷公園 芝生広場",
    rainPolicy: "CANCEL_ON_RAIN",
    capacity: 40,
    targetGeneration: "未就学児とその家族",
    attendingCount: 31,
    waitlistCount: 2,
    schedules: [schedule("halloween-1", "2026-10-31", "11:00", "15:00")],
    pricePlans: [
      plan("halloween-snack", "おやつ付き", 500, "子どもは無料"),
      plan("halloween-child", "子ども", 0, "未就学児"),
    ],
    organizers: { owner: HOST, coHosts: [] },
  },
  {
    slug: "bonfire",
    kind: "アウトドア",
    title: "川辺の焚き火ナイト",
    intro: "薪をくべて、汁物を煮る。夜の河原で過ごす 3 時間です。",
    flyerSrc: "/samples/flyer-bonfire.jpg",
    themeId: "dusk",
    location: "河川敷公園 第2広場（東京都世田谷区）",
    venueName: "河川敷公園 第2広場",
    rainPolicy: "POSTPONE_ON_RAIN",
    capacity: 20,
    targetGeneration: "20代から40代",
    attendingCount: 12,
    waitlistCount: 0,
    schedules: [schedule("bonfire-1", "2026-11-21", "18:00", "21:00")],
    pricePlans: [plan("bonfire-general", "一般", 2500, "薪と汁物付")],
    organizers: { owner: HOST, coHosts: [] },
  },
  {
    slug: "dj",
    kind: "ナイト",
    title: "DJナイト Vol.7",
    intro: "下北沢のバーで、朝まで続くレコード中心の一夜です。",
    flyerSrc: "/samples/flyer-dj.jpg",
    themeId: "neon",
    location: "BAR LOOP 下北沢（東京都世田谷区北沢）",
    venueName: "BAR LOOP 下北沢",
    rainPolicy: "INDOOR",
    capacity: 60,
    targetGeneration: "20代〜30代",
    attendingCount: 42,
    waitlistCount: 0,
    schedules: [schedule("dj-1", "2026-11-28", "21:00", "02:00")],
    pricePlans: [plan("dj-general", "一般", 2500, "1ドリンク付")],
    organizers: { owner: HOST, coHosts: [] },
  },
];

/** slug から 1 件を引く。知らない slug は undefined（詳細は 404 にする）。 */
export function findSample(slug: string): SampleEvent | undefined {
  return SAMPLE_EVENTS.find((event) => event.slug === slug);
}
