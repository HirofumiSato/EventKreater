import { z } from "zod";
import { normalizePostalCode } from "@/lib/postal-code";
import { parseRsvpDeadline, TIME_PATTERN } from "@/lib/serializers";
import { SEMANTIC_THEME_IDS } from "@/lib/semantic-themes";
import { FLYER_LAYOUT_IDS, FLYER_TEMPLATE_IDS, MAX_EVENT_OPTIONS } from "@/modules/events/types";
import { profileUrlProblem } from "@/modules/organizers/lib/profile";
import { MAX_PROFILE_TAGS, PROFILE_TAGS } from "@/modules/organizers/types";
import { isAllowedCheckoutReturnTo } from "@/modules/billing/lib/checkout-return";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export { MAX_EVENT_OPTIONS };

const eventDateSchema = z
  .string()
  .regex(datePattern, "日付形式(YYYY-MM-DD)が不正です")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "実在する日付を入力してください");

const timeSchema = (label: string) =>
  z.string().trim().regex(TIME_PATTERN, `${label}は HH:mm 形式で入力してください`);

const scheduleInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    eventDate: eventDateSchema,
    startTime: timeSchema("開始時刻"),
    endTime: timeSchema("終了時刻"),
  })
  .superRefine((value, ctx) => {
    if (value.startTime === value.endTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "終了時刻は開始時刻と別にしてください",
      });
    }
  });

const pricePlanInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "プラン名を入力してください").max(50),
  audience: z.enum(["ANY", "MALE", "FEMALE"]).default("ANY"),
  amount: z
    .number({ invalid_type_error: "金額は数字で入力してください" })
    .int("金額は整数の円で入力してください")
    .min(0, "金額は0円以上にしてください")
    .max(9_999_999, "金額は9,999,999円以下にしてください"),
  note: z
    .string()
    .trim()
    .max(100, "補足は100文字以内にしてください")
    // 空の補足はクライアントが null で送る。undefined だけを許すと保存が 400 になる。
    .nullish()
    .transform((value) => (value ? value : null)),
});

/** 割引 1 件。すべての費用プランに適用する。参加者が申込時に選ぶ。 */
const discountInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "割引の名前を入力してください").max(50),
  amount: z
    .number({ invalid_type_error: "値引き額は数字で入力してください" })
    .int("値引き額は整数の円で入力してください")
    .min(1, "値引き額は1円以上にしてください")
    .max(9_999_999, "値引き額は9,999,999円以下にしてください"),
  note: z
    .string()
    .trim()
    .max(100, "補足は100文字以内にしてください")
    .nullish()
    .transform((value) => (value ? value : null)),
});

function refineEventOptions(
  value: {
    schedules: { eventDate: string; startTime: string; endTime: string }[];
    pricePlans: { name: string; audience: string }[];
    discounts?: { name: string }[];
  },
  ctx: z.RefinementCtx,
) {
  const dates = new Set<string>();
  for (const row of value.schedules) {
    const key = `${row.eventDate}\u0000${row.startTime}\u0000${row.endTime}`;
    if (dates.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["schedules"],
        message: "同じ開催日・開始時刻・終了時刻の組み合わせは重複できません",
      });
      break;
    }
    dates.add(key);
  }
  const names = new Set<string>();
  for (const row of value.pricePlans) {
    const key = `${row.audience}\u0000${row.name}`;
    if (names.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pricePlans"],
        message: "同じ対象のプラン名は重複できません",
      });
      break;
    }
    names.add(key);
  }
  // 割引名は 1 イベントの中で重複させない。参加者が選ぶときの見分けが付かなくなる。
  const discountNames = new Set<string>();
  for (const row of value.discounts ?? []) {
    const name = row.name.trim();
    if (name === "") continue;
    if (discountNames.has(name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discounts"],
        message: "同じ名前の割引は重複できません",
      });
      break;
    }
    discountNames.add(name);
  }
}

function refineAttendanceChoice(
  value: {
    status: "ATTENDING" | "DECLINED" | "WAITLISTED";
    gender?: "MALE" | "FEMALE";
    scheduleId?: string;
    pricePlanId?: string;
  },
  ctx: z.RefinementCtx,
) {
  if (value.status !== "ATTENDING") return;
  if (!value.scheduleId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scheduleId"],
      message: "出席する日時を選んでください",
    });
  }
  if (!value.pricePlanId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pricePlanId"],
      message: "費用プランを選んでください",
    });
  }
}

export const GenerateFlyerSchema = z.object({
  title: z.string().trim().min(2, "チラシの名前は2文字以上40文字以内です").max(40, "チラシの名前は40文字以内です"),
  eventDate: z
    .string()
    .regex(datePattern, "日付形式(YYYY-MM-DD)が不正です")
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }, "実在する日付を入力してください"),
  eventTime: z.string().trim().min(4, "開催時間は4文字以上30文字以内です").max(30, "チラシの開催時間は30文字以内です"),
  price: z.string().trim().min(1, "費用を入力してください").max(30, "チラシの費用は30文字以内です"),
  location: z.string().trim().min(2, "開催場所は2文字以上60文字以内です").max(60, "チラシの場所は60文字以内です"),
  rainPolicy: z.enum(["RAIN_OR_SHINE", "CANCEL_ON_RAIN", "POSTPONE_ON_RAIN", "INDOOR"]),
  capacity: z.number().int().positive().nullable().optional(),
  /** 告知ページのテーマ。背景の雰囲気を揃えるためにサービスへ渡す。null は標準。 */
  themeId: z
    .enum(SEMANTIC_THEME_IDS, {
      errorMap: () => ({ message: "選べないテーマです。" }),
    })
    .nullable()
    .optional(),
  /** 想定する参加者の世代。背景の人物像と光の当て方を寄せるためにサービスへ渡す。 */
  targetGeneration: z
    .string()
    .trim()
    .max(50, "想定する世代は50文字以内です")
    .nullable()
    .optional(),
  templateId: z.enum(FLYER_TEMPLATE_IDS),
  layoutId: z.enum(FLYER_LAYOUT_IDS).default("classic"),
  /** タイトルの文字色。null は「自動」で、背景の明るさからサービスが決める。 */
  titleColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "文字色は#RRGGBBで指定してください")
    .nullable()
    .optional(),
});

/** ウィザードのステップ 1・2。下書き ID はブラウザが localStorage に持つ。 */
export const ProposeCandidatesSchema = GenerateFlyerSchema.extend({
  draftKey: z.string().uuid("下書きIDが不正です"),
  /** 保存済みイベントを編集しているときの対象。新規作成では省略する。 */
  eventId: z.string().uuid("イベントIDが不正です").nullish(),
  count: z.number().int().min(1).max(16).optional(),
});

/** ウィザードのステップ 2（自分の写真）。multipart のフォーム項目を検証する。 */
export const UploadFlyerBackgroundSchema = GenerateFlyerSchema.extend({
  draftKey: z.string().uuid("下書きIDが不正です"),
  eventId: z.string().uuid("イベントIDが不正です").nullish(),
});

/**
 * ウィザードの確定。選んだ候補と、記録用の配置・配色を受け取る。
 * 画面は配置を選ばないので `layoutId` は常に `classic`、`paletteId` は候補の値。
 */
export const SelectFlyerCandidateSchema = GenerateFlyerSchema.extend({
  draftKey: z.string().uuid("下書きIDが不正です"),
  eventId: z.string().uuid("イベントIDが不正です").nullish(),
  candidateId: z.string().uuid("候補IDが不正です"),
  paletteId: z.string().trim().min(1).max(32),
});

const rsvpDeadlineSchema = z
  .union([
    z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "申し込み期限は YYYY-MM-DDTHH:mm です"),
    z.literal(""),
    z.null(),
  ])
  .optional()
  .transform((value) => (value ? value : null))
  .refine((value) => value === null || parseRsvpDeadline(value) !== null, "実在する申し込み期限を入力してください");

/** 空文字は NULL として扱う任意の住所項目。 */
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    // 空欄はクライアントが null で送ってくる（undefined だけでは弾かれる）。
    .nullish()
    .transform((value) => (value ? value : null));

const postalCodeSchema = z
  .string()
  .trim()
  .nullish()
  .transform((value) => (value ? normalizePostalCode(value) : null))
  .refine(
    (value) => value === null || /^\d{7}$/.test(value),
    "郵便番号は7桁の数字で入力してください",
  );

const eventBodySchema = z.object({
  title: z.string().trim().min(1, "イベント名を入力してください").max(100),
  schedules: z.array(scheduleInputSchema).min(1, "開催日時を1件以上入力してください").max(MAX_EVENT_OPTIONS),
  pricePlans: z.array(pricePlanInputSchema).min(1, "費用プランを1件以上入力してください").max(MAX_EVENT_OPTIONS),
  /** 参加者が申込時に選べる割引。任意で、省略した既存クライアントは 0 件として扱う。 */
  discounts: z.array(discountInputSchema).max(MAX_EVENT_OPTIONS).default([]),
  /** 旧・自由入力の開催場所。構造化住所が無いときだけ使う。 */
  location: z.string().trim().max(255, "開催場所は255文字以内です").optional(),
  postalCode: postalCodeSchema,
  prefecture: optionalText(20, "都道府県は20文字以内です"),
  city: optionalText(100, "市区町村は100文字以内です"),
  town: optionalText(100, "町域は100文字以内です"),
  addressLine: optionalText(200, "番地は200文字以内です"),
  building: optionalText(150, "建物名は150文字以内です"),
  venueName: optionalText(150, "会場名は150文字以内です"),
  rainPolicy: z.enum(["RAIN_OR_SHINE", "CANCEL_ON_RAIN", "POSTPONE_ON_RAIN", "INDOOR"]),
  capacity: z.number().int().positive().nullable().optional(),
  /** 想定する参加者の世代。空欄は NULL で、告知ページに出さない。 */
  targetGeneration: optionalText(50, "対象世代は50文字以内です"),
  /** 告知ページのセマンティックテーマ。null は標準の見た目。未知の ID は 400。 */
  themeId: z
    .enum(SEMANTIC_THEME_IDS, {
      errorMap: () => ({ message: "選べないテーマです。" }),
    })
    .nullable()
    .default(null),
  flyerAssetId: z.string().uuid().nullable().optional(),
  rsvpDeadline: rsvpDeadlineSchema,
});

function refineEventAddress(
  value: {
    location?: string;
    prefecture: string | null;
    city: string | null;
    town: string | null;
    addressLine: string | null;
    building: string | null;
    venueName: string | null;
  },
  ctx: z.RefinementCtx,
) {
  const hasStructured = Boolean(
    value.prefecture || value.city || value.town || value.addressLine || value.building,
  );
  if (hasStructured) {
    if (!value.prefecture) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["prefecture"],
        message: "都道府県を入力してください",
      });
    }
    if (!value.city) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["city"],
        message: "市区町村を入力してください",
      });
    }
    if (!value.addressLine) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["addressLine"],
        message: "番地を入力してください",
      });
    }
    return;
  }
  // オンライン・場所未定でも、会場名か従来の場所のどちらかがあれば保存できる。
  if (!value.venueName && !value.location) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["location"],
      message: "開催場所を入力してください",
    });
  }
}

export const CreateEventSchema = eventBodySchema
  .extend({
    /** 告知ページの勧誘から来たときの参照元。存在しない・削除済みなら保存時に捨てる。 */
    referrerEventId: z.string().uuid().nullish(),
    /**
     * 作成中に使ったチラシ回数の下書き ID。公開時にイベントへ付け替え、
     * 共同主催者を含めた 3 回の枠に引き継ぐ。保存はしない。
     */
    flyerDraftKey: z.string().uuid().nullish(),
    /** 未登録の幹事が公開ページに出す名前。会員のときは無視する。 */
    organizerDisplayName: z
      .string()
      .trim()
      .max(50, "主催者名は50文字以内です")
      .nullish()
      .transform((value) => (value ? value : null)),
    /**
     * 作成時の公開状態。枠が無いときに下書きとして保存し、購入後に公開する。
     * 未指定は従来どおり即公開。Zod は未定義キーを捨てるため、ここで明示する。
     */
    status: z.enum(["DRAFT", "PUBLISHED"]).default("PUBLISHED"),
  })
  .superRefine(refineEventAddress)
  .superRefine(refineEventOptions);

export const UpdateEventSchema = eventBodySchema
  .extend({
    status: z.enum(["DRAFT", "PUBLISHED", "CLOSED"]).optional(),
  })
  .superRefine(refineEventAddress)
  .superRefine(refineEventOptions);

/**
 * 作成画面からの下書き保存。
 * 下書きの時点では定員・申し込み期限・チラシが空でもよい（`eventBodySchema` が元から任意）。
 * 作成中に使ったチラシ回数を引き継ぐ `flyerDraftKey` は保存しない。
 */
export const SaveEventDraftSchema = UpdateEventSchema.and(
  z.object({
    flyerDraftKey: z.string().uuid().nullish(),
  }),
);

export const OrganizerParticipantSchema = z
  .object({
    name: z.string().trim().min(1, "名前を入力してください").max(50),
    status: z.enum(["ATTENDING", "DECLINED", "WAITLISTED"]),
    gender: z.enum(["MALE", "FEMALE"]).optional(),
    comment: z.string().trim().max(500).optional(),
    scheduleId: z.string().uuid().optional(),
    pricePlanId: z.string().uuid().optional(),
    /**
     * 幹事が名簿から割引を選び直すときだけ送る。省略したら今の割引をそのまま残す
     * （名前だけの修正で、参加者が選んだ割引を消さない）。
     */
    discountIds: z.array(z.string().uuid()).max(MAX_EVENT_OPTIONS).optional(),
  })
  .superRefine(refineAttendanceChoice);

export const LifecycleSchema = z.object({
  // `close`（受付停止）と `reopen`（公開の再開）は対で使う。`delete` は論理削除。
  action: z.enum(["close", "reopen", "delete"]),
});

export const IssueReceiptSchema = z.object({
  addressee: z.string().trim().min(1, "宛名を入力してください").max(100),
  amount: z.number().int("金額は整数の円です").positive("金額は1円以上にしてください").max(9_999_999),
  description: z.string().trim().min(1, "但し書きを入力してください").max(100),
});

export const SubmitRsvpSchema = z
  .object({
    name: z.string().trim().min(1, "名前を入力してください").max(50),
    status: z.enum(["ATTENDING", "DECLINED", "WAITLISTED"]),
    gender: z.enum(["MALE", "FEMALE"]).optional(),
    comment: z.string().trim().max(500).optional(),
    scheduleId: z.string().uuid().optional(),
    pricePlanId: z.string().uuid().optional(),
    /** 申込時に選んだ割引。出席のときだけ使う。省略したクライアントは 0 件として扱う。 */
    discountIds: z.array(z.string().uuid()).max(MAX_EVENT_OPTIONS).default([]),
  })
  .superRefine(refineAttendanceChoice);

export const AcquireLockSchema = z.object({
  holderName: z.string().trim().min(1).max(50).optional(),
  currentLockToken: z.string().min(1).optional(),
  forceTakeover: z.boolean().optional().default(false),
  release: z.boolean().optional().default(false),
  lockToken: z.string().min(1).optional(),
});

export const HydrateSchema = z.object({}).strip();

export const VerifySessionSchema = z.object({
  sessionId: z.string().min(1),
});

/**
 * Checkout を開いた画面と、復元する下書き。
 * `returnTo` は購入後に戻るパスで、許可した画面だけを受け付ける。
 */
export const CheckoutIntentSchema = z.object({
  draftId: z.string().uuid("下書き ID の形式が不正です").optional(),
  returnTo: z
    .string()
    .max(200)
    .refine(isAllowedCheckoutReturnTo, "戻り先の指定が不正です")
    .optional(),
});

export type CheckoutIntent = z.infer<typeof CheckoutIntentSchema>;

/** 定額プランの申込。プランを省略したときは公開し放題として扱う。 */
export const SubscriptionCheckoutSchema = CheckoutIntentSchema.extend({
  plan: z.enum(["MONTHLY_8", "UNLIMITED"]).optional(),
});

export type SubscriptionCheckout = z.infer<typeof SubscriptionCheckoutSchema>;

export const AdminLoginSchema = z.object({
  email: z.string().trim().email("メールアドレスの形式が不正です").max(255),
  password: z.string().min(1, "パスワードを入力してください").max(128),
});

export const AdminRoleSchema = z.object({
  platformRole: z.enum(["MEMBER", "ADMIN"]),
});

export const AuthAudienceSchema = z.enum(["organizer", "participant"]);

export const AuthSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("register"),
    email: z.string().trim().email("メールアドレスの形式が不正です").max(255),
    password: z.string().min(8, "パスワードは8文字以上にしてください").max(128),
    name: z.string().trim().min(1, "名前を入力してください").max(50),
    /// 登録を始めた入口。確認メール後の着地を分ける。
    audience: AuthAudienceSchema.optional(),
  }),
  z.object({
    action: z.literal("login"),
    email: z.string().trim().email("メールアドレスの形式が不正です").max(255),
    password: z.string().min(1, "パスワードを入力してください").max(128),
    /// 参加者入口からのログインなら participant。既定は主催者（MEMBER）。
    audience: AuthAudienceSchema.optional(),
  }),
]);

export const LoginChallengeDeliverSchema = z.object({
  channel: z.enum(["SMS", "EMAIL"]),
});

export const LoginChallengeConfirmSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "確認番号は6桁です"),
});

// ---- マイページのアカウント設定 ----

/** 再認証（確認番号）の発行。channel を省略すると、電話があればSMS、無ければメール。 */
export const AccountReauthSchema = z.object({
  channel: z.enum(["SMS", "EMAIL"]).optional(),
});

export const UpdateProfileSchema = z.object({
  name: z.string().trim().min(1, "表示名を入力してください").max(50, "表示名は50文字以内です"),
});

/** メールアドレス変更。確認番号を検証したうえで、新しいアドレスへリンクを送る。 */
export const EmailChangeStartSchema = z.object({
  newEmail: z.string().trim().email("メールアドレスの形式が不正です").max(255),
  code: z.string().trim().regex(/^\d{6}$/, "確認番号は6桁です").optional(),
});

export const EmailChangeConfirmSchema = z.object({
  token: z.string().trim().min(10, "確認リンクが不正です").max(200),
});

/** 電話番号変更。パスワードを持つ会員はパスワード、持たない会員は確認番号で本人確認する。 */
export const PhoneChangeStartSchema = z.object({
  phone: z.string().trim().min(8, "電話番号を入力してください").max(20),
  password: z.string().max(128).optional(),
  code: z.string().trim().regex(/^\d{6}$/, "確認番号は6桁です").optional(),
});

export const PhoneChangeConfirmSchema = z.object({
  phone: z.string().trim().min(8, "電話番号を入力してください").max(20),
  code: z.string().trim().regex(/^\d{6}$/, "確認番号は6桁です"),
});

export const PasswordChangeSchema = z.object({
  currentPassword: z.string().max(128).optional(),
  newPassword: z.string().min(8, "パスワードは8文字以上にしてください").max(128),
  code: z.string().trim().regex(/^\d{6}$/, "確認番号は6桁です").optional(),
});

/** 退会。パスワード（または確認番号）と、確認のための「退会」入力を求める。 */
export const WithdrawSchema = z.object({
  password: z.string().max(128).optional(),
  code: z.string().trim().regex(/^\d{6}$/, "確認番号は6桁です").optional(),
  phrase: z.literal("退会", { errorMap: () => ({ message: "確認のため「退会」と入力してください" }) }),
});

/**
 * 価格キャンペーンの入力。日時は画面の datetime-local（JST）をそのまま受け、
 * campaigns.ts で +09:00 として解釈する。
 */
export const PricingCampaignSchema = z.object({
  name: z.string().trim().min(1, "名前を入力してください").max(100),
  target: z.enum([
    "ONE_TIME",
    "SUBSCRIPTION",
    "SUBSCRIPTION_8",
    "SUBSCRIPTION_UNLIMITED",
    "BOTH",
  ]),
  discountKind: z.enum(["PERCENT", "FREE"]),
  percent: z.number().int().min(1, "割引率は1以上にしてください").max(100),
  startsAt: z.string().trim().min(1, "開始日時を入力してください").max(40),
  endsAt: z.string().trim().min(1, "終了日時を入力してください").max(40),
  priority: z.number().int().min(0).max(1000).optional(),
  isEnabled: z.boolean().optional(),
  freePerUserLimit: z.number().int().min(1).max(10).optional(),
});

export const PricingCampaignUpdateSchema = PricingCampaignSchema;

// ---- 主催者の公開プロフィール ----

/** 未入力を null に寄せる。空欄は「まだ書いていない」として扱う。 */
function optionalProfileText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label}は${max}文字以内です`)
    .optional()
    .transform((value): string | null => {
      const normalized = value?.replace(/\r\n/g, "\n").trim() ?? "";
      return normalized === "" ? null : normalized;
    });
}

/** URL は https だけを通し、ホストを限定する。未入力は null。 */
function optionalProfileUrl(label: string, hosts: readonly string[]) {
  return z
    .string()
    .trim()
    .max(200, `${label}のURLは200文字以内です`)
    .optional()
    .transform((value): string | null => (value ? value : null))
    .superRefine((value, ctx) => {
      if (value === null) return;
      const problem = profileUrlProblem(value, hosts, label);
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    });
}

/**
 * 公開プロフィールの入力。公開ページに出る項目だけを受け取り、
 * 表示名（`users.name`）はここでは変えない。
 */
export const OrganizerProfileSchema = z
  .object({
    isPublished: z.boolean().default(false),
    headline: optionalProfileText(60, "肩書き"),
    bio: optionalProfileText(400, "自己紹介"),
    area: optionalProfileText(50, "活動エリア"),
    tags: z
      .array(z.enum(PROFILE_TAGS))
      .max(MAX_PROFILE_TAGS, `活動ジャンルは${MAX_PROFILE_TAGS}つまで選べます`)
      .default([])
      .transform((tags) => [...new Set(tags)]),
    xUrl: optionalProfileUrl("X", ["x.com", "twitter.com"]),
    instagramUrl: optionalProfileUrl("Instagram", ["instagram.com"]),
    websiteUrl: optionalProfileUrl("Webサイト", []),
    lineUrl: optionalProfileUrl("LINE", ["lin.ee", "line.me"]),
    showStats: z.boolean().default(false),
    /**
     * 公開ページのテーマ。null は標準の見た目。
     * 未知の ID は 400 にする（DB には既知の値しか入れない）。
     */
    themeId: z
      .enum(SEMANTIC_THEME_IDS, {
        errorMap: () => ({ message: "選べないテーマです。" }),
      })
      .nullable()
      .default(null),
  })
  .strict();

export type OrganizerProfileFormInput = z.infer<typeof OrganizerProfileSchema>;

// ---- 主催者へのアプリ内通知 ----

/**
 * 既読にする通知。`all: true` なら未読をすべて、`ids` なら指定した分だけを既読にする。
 * どちらも無い要求は 400（画面の不具合を黙って通さない）。
 */
export const MarkNotificationsSchema = z
  .object({
    all: z.boolean().optional(),
    ids: z.array(z.string().uuid("通知の ID が不正です")).max(100).optional(),
  })
  .refine((value) => value.all === true || (value.ids?.length ?? 0) > 0, {
    message: "既読にする通知を指定してください。",
    path: ["ids"],
  });

export type MarkNotificationsInput = z.infer<typeof MarkNotificationsSchema>;

export type GenerateFlyerInput = z.infer<typeof GenerateFlyerSchema>;
export type ProposeCandidatesInput = z.infer<typeof ProposeCandidatesSchema>;
export type UploadFlyerBackgroundInput = z.infer<typeof UploadFlyerBackgroundSchema>;
export type SelectFlyerCandidateInput = z.infer<typeof SelectFlyerCandidateSchema>;
export type CreateEventInput = z.infer<typeof CreateEventSchema>;
export type UpdateEventInput = z.infer<typeof UpdateEventSchema>;
export type SaveEventDraftInput = z.infer<typeof SaveEventDraftSchema>;
