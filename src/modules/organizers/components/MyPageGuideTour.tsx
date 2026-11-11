"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import {
  MYPAGE_GUIDE_ACTION_COPY,
  MYPAGE_GUIDE_STEPS,
  guidePathMatches,
  guidePathNeedsEventId,
  guidePathWithEventId,
  myPageGuideIndex,
  myPageGuideStep,
  type MyPageGuidePath,
  type MyPageGuideStep,
} from "@/modules/organizers/lib/tour/steps";
import {
  clearMyPageGuideSession,
  readMyPageGuideSession,
  writeMyPageGuideSession,
} from "@/modules/organizers/lib/tour/session";
import { dismissMyPageGuide, isMyPageGuideDismissed } from "@/modules/organizers/lib/tour/memory";
import { setSiteUserMenuOpen } from "@/lib/site-user-menu";
import { isImeEscape } from "@/lib/ime";
import {
  anchorForBubble,
  clampHole,
  fitHoleToBubble,
  GUIDE_REVEAL_HOLD_MS,
  GUIDE_SETTLE_COUNT,
  GUIDE_SETTLE_MIN_DISTANCE,
  GUIDE_TRAVEL_DELAY_MS,
  GUIDE_TRAVEL_HOLD_MS,
  GUIDE_TRAVEL_MIN_DISTANCE,
  guideClipPath,
  placeBubble,
  planScroll,
  travelDuration,
  unionRect,
  type GuideBubblePlacement,
  type GuideHole,
  type GuideRect,
} from "@/modules/events/lib/tour/place";

/**
 * 主催者マイページの操作ガイド（スポットライトツアー）。
 *
 * 骨格はイベント作成のガイド（`EventGuideTour`）と同じ。黒い面で対象だけをくり抜き、
 * その脇に説明の紙を置く。違うのは 2 点で、案内が画面をまたぐこと（`/mypage` と
 * `/organizer/events`）と、初回だけでなく右上の「使い方」から開き直せること。
 * どちらも `props` と `sessionStorage` だけで決める（画面側は状態を持たない）。
 *
 * 描く場所は `document.body` の直下（ポータル）。`.deco` の傾きや `transform` を持つ
 * 祖先の内側に置くと `position: fixed` の基準が変わり、穴と対象がずれる。
 */

interface MyPageGuideTourProps {
  /** 対象を測ってよいか。紹介の取得など、画面の骨格がそろうまで待つ。 */
  ready: boolean;
  /** 初回の自動表示を許すか。主催者だけが真にする。 */
  autoStart: boolean;
  /** 値を変えると 1 枚目から開き直す（右上の「使い方」）。初回マウントは動かさない。 */
  startSignal?: number;
  /** 閉じたことを画面へ伝える。記憶の書き込みはこの部品の中で済ませる。 */
  onClose?: () => void;
}

/** 焦点を移してよい要素。Tab の循環に使う（`Dialog` と同じ並び）。 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * 対象が見つからないまま待つ長さ。メニューを開く 1 枚は、開いた結果が
 * 次の描画で DOM に出るまで対象が測れない。その待ちを覆う。
 */
const MISSING_TIMEOUT_MS = 1200;

/**
 * 開いた直後に測り続ける長さ。メニューや折りたたみが開く動きと、
 * 横スクロールの移動（約 300ms）を覆う。
 */
const SETTLE_MS = 900;

/**
 * 枚を進めるときの段（`EventGuideTour` と同じ考え方）。
 *
 * - `prepare` … 開いたメニュー・折りたたみが落ち着くまで待つ。待たずに送ると、
 *   開く途中の高さを基準に目的地を決めてしまい、ずれる。
 * - `scroll` … 黒い面と紙を外し、朱の枠だけを残して目的地まで送る。
 * - `idle` … 黒い面・穴・紙を出す。初回と、移動が済んだあとの段。
 */
type GuidePhase = "idle" | "prepare" | "scroll";

/** 対象の要素を集める。同じ要素が 2 回入っても外接矩形は変わらない。 */
function collectTargets(selectors: readonly string[]): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const selector of selectors) {
    document.querySelectorAll<HTMLElement>(selector).forEach((node) => found.push(node));
  }
  return found;
}

/**
 * 枚の画面のパス。催しの画面（`[id]`）は id が決まっていないので、最初の催しの名簿で開く。
 * 開ける催しが無い・一覧を読めないときは `null` を返し、呼び出し元がその枚を飛ばす
 * （名簿の無い主催者に、空の名簿を見せない）。
 */
async function resolveStepPath(template: MyPageGuidePath): Promise<string | null> {
  if (!guidePathNeedsEventId(template)) return template;
  try {
    const res = await fetch("/api/v1/organizer/events");
    if (!res.ok) return null;
    const body = (await res.json()) as { events?: { id?: string }[] };
    const first = body.events?.find((event) => typeof event.id === "string" && event.id !== "");
    return first?.id ? guidePathWithEventId(template, first.id) : null;
  } catch {
    return null;
  }
}

function toRect(element: Element): GuideRect {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/** 幅も高さも 0 の要素は、`display: none` の対象。測れたことにしない。 */
function isMeasurable(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * その場で位置を合わせる。`behavior: "auto"` では足りない。
 *
 * `base.css` の `html { scroll-behavior: smooth }` に従わせると、毎フレームの
 * `scrollTo` がブラウザのスムーススクロールに置き換わり、送り終わりに
 * 溜まった移動が一気に詰まる。`"instant"` でこちらの計算どおりに動かす。
 */
function jumpTo(top: number): void {
  window.scrollTo({ top, behavior: "instant" });
}

/** ページの端を越えないよう、送る距離を丸める。 */
function boundedDelta(delta: number): number {
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const from = window.scrollY;
  const to = Math.max(0, Math.min(from + delta, maxScroll));
  return to - from;
}

/**
 * 画面下に固定している帯の高さ。
 *
 * 主催一覧（`/organizer/events`）の `.action-dock` と、作成画面の `.form-final` は
 * スクロールで動かない。穴と紙の計算では「見えている下端」を帯の上端まで引き上げる。
 * 広い画面では帯が本文の中にあるため 0 になる。
 */
function fixedBottomInset(): number {
  let inset = 0;
  for (const selector of [".action-dock", ".form-final"]) {
    document.querySelectorAll<HTMLElement>(selector).forEach((bar) => {
      if (window.getComputedStyle(bar).position !== "fixed") return;
      const rect = bar.getBoundingClientRect();
      inset = Math.max(inset, Math.max(0, window.innerHeight - rect.top));
    });
  }
  return inset;
}

/** 固定していない要素だけ、画面の外なら中央付近へ送る。 */
function isFixed(element: Element): boolean {
  return window.getComputedStyle(element).position === "fixed";
}

/**
 * 横に送れる節（`.subnav__inner`）の中の対象を、真ん中まで寄せる。
 *
 * 主催一覧・公開プロフは幅の狭い端末で帯の外へはみ出す。縦のスクロールでは
 * 見えないので、帯の中だけ横に動かす。動かし終えた位置で次の計測が走る。
 */
function revealInSubnav(element: HTMLElement): void {
  const scroller = element.closest<HTMLElement>(".subnav__inner");
  if (!scroller) return;
  const rect = element.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  const delta = rect.left - box.left - (box.width - rect.width) / 2;
  if (Math.abs(delta) < 1) return;
  scroller.scrollLeft += delta;
}

/**
 * 折りたたみ（`details`）の中の対象を開く。
 *
 * 対象は `article.event-card` の中の `details.event-card__more` にあり、
 * 畳んだままだと大きさが 0 で測れない。対象にいちばん近い `details` を開く。
 */
function openNearestDetails(element: HTMLElement): void {
  const nearest =
    element.closest("details") ??
    element.closest("article.event-card")?.querySelector("details");
  if (nearest instanceof HTMLDetailsElement && !nearest.open) nearest.open = true;
}

/**
 * 紙が出るまでを数える輪。右上に置き、`GUIDE_REVEAL_HOLD_MS` かけて 1 周する。
 * 止まった画面をただ待たせると「固まった」と見えるため、待ちの長さを見せる。
 */
function GuideCount() {
  return (
    <span className="guide-count" aria-hidden="true">
      <svg className="guide-count__ring" viewBox="0 0 36 36" focusable="false">
        <circle className="guide-count__track" cx="18" cy="18" r="15" />
        <circle
          className="guide-count__bar"
          cx="18"
          cy="18"
          r="15"
          style={{ "--guide-count-ms": `${GUIDE_REVEAL_HOLD_MS}ms` } as CSSProperties}
        />
      </svg>
    </span>
  );
}

export function MyPageGuideTour({ ready, autoStart, startSignal, onClose }: MyPageGuideTourProps) {
  const pathname = usePathname();
  const router = useRouter();

  /** いま出している枚。`null` は閉じている（何も描かない）。 */
  const [index, setIndex] = useState<number | null>(null);
  const [phase, setPhase] = useState<GuidePhase>("idle");
  /** 紙を出したあと、読み込みで対象がずれて送り直している最中か。 */
  const [settling, setSettling] = useState(false);
  /** 送りが止まって、紙を出す前の「見る時間」の最中か。 */
  const [holding, setHolding] = useState(false);
  const [holes, setHoles] = useState<GuideHole[]>([]);
  const [placement, setPlacement] = useState<GuideBubblePlacement | null>(null);

  const bubbleRef = useRef<HTMLDivElement | null>(null);
  /** 位置が決まって焦点を移したか。1 回だけ動かす（枚を変えても焦点は保つ）。 */
  const focusedRef = useRef(false);
  /** 閉じる道は毎回作り直される。計測の effect を張り直さないよう ref 経由で呼ぶ。 */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  /** 枚を移している最中か。催しの id を問い合わせている間に、二度押しを重ねない。 */
  const movingRef = useRef(false);

  const active = index !== null;
  const step: MyPageGuideStep | null = index === null ? null : MYPAGE_GUIDE_STEPS[index] ?? null;

  /**
   * 初回だけ起動の判断をする。`ready` が偽のあいだは何もしない。
   * 文書と対象は `steps.ts`、続きは `session.ts` が持つ。
   */
  const decided = useRef(false);
  /** 「使い方」で 1 枚目から開き直す約束。`ready` 待ちのあいだに来た分も拾う。 */
  const pendingStart = useRef(false);
  /** 初回マウントの `startSignal` では開き直さない（前回値を覚えて比べる）。 */
  const signalRef = useRef(startSignal);

  /** 1 枚目から開き直す。右上の「使い方」と、その待ち合わせから呼ぶ。 */
  const startFresh = useCallback(() => {
    decided.current = true;
    pendingStart.current = false;
    clearMyPageGuideSession();
    focusedRef.current = false;
    setPhase("idle");
    setSettling(false);
    setHolding(false);
    setHoles([]);
    setPlacement(null);
    setIndex(0);
  }, []);

  /**
   * 閉じる。×・Esc・「ガイドをスキップ」・最終枚の「わかった」から呼ぶ。
   * 続きを捨て、初回の自動表示を止め、画面へ知らせる。
   */
  const close = useCallback(() => {
    clearMyPageGuideSession();
    dismissMyPageGuide();
    setPhase("idle");
    setSettling(false);
    setHolding(false);
    setHoles([]);
    setPlacement(null);
    setIndex(null);
    onCloseRef.current?.();
  }, []);

  /**
   * 1 枚を開く。画面が違えば移り、移った先で同じ部品が続きから出す。
   *
   * 催しの画面（`[id]`）は、進む向きに沿って最初の催しで開く。開ける催しが無い枚は
   * 飛ばし、そのまま次（前）を見る。飛ばす向きは進む向きにそろえる（戻るで先へ飛ばさない）。
   */
  const move = useCallback(
    async (from: number, direction: 1 | -1) => {
      // 続けて押されても、2 枚ぶん進めない（id の問い合わせが返る前に次が来る）。
      if (movingRef.current) return;
      movingRef.current = true;
      try {
        for (let i = from; i >= 0 && i < MYPAGE_GUIDE_STEPS.length; i += direction) {
          const target = MYPAGE_GUIDE_STEPS[i];
          const path = await resolveStepPath(target.path);
          if (path === null) continue;
          writeMyPageGuideSession(target.key);
          if (!guidePathMatches(target.path, pathname)) {
            setIndex(null);
            router.push(path);
            return;
          }
          setPhase("prepare");
          setIndex(i);
          return;
        }
        // 開ける枚がもう無い（最後まで来た・戻る先が無い）。閉じる。
        close();
      } finally {
        movingRef.current = false;
      }
    },
    [pathname, router, close],
  );

  const goNext = useCallback(() => {
    if (index === null) return;
    const current = MYPAGE_GUIDE_STEPS[index];
    if (current.final) {
      close();
      return;
    }
    void move(index + 1, 1);
  }, [index, close, move]);

  /** 前の枚へ。同じく、画面が違えば移ってから続きを出す。 */
  const goBack = useCallback(() => {
    if (index === null || index === 0) return;
    void move(index - 1, -1);
  }, [index, move]);

  /** 対象が見つからないまま待ちきれなかったときも、同じ「次へ」を使う。 */
  const goNextRef = useRef(goNext);
  goNextRef.current = goNext;
  const closeRef = useRef(close);
  closeRef.current = close;

  // マウント時の起動。セッションの枚がこの画面のものなら続きから、
  // そうでなければ（/mypage だけ）初回の自動表示を確かめる。
  // 別の画面のセッションは捨てる。勝手に前の画面へ引き戻さないため。
  useEffect(() => {
    if (!ready || decided.current) return;
    // 「使い方」からの再開が控えている。こちらでは決めない。
    if (pendingStart.current) return;
    decided.current = true;

    const session = readMyPageGuideSession();
    if (session) {
      const resumed = myPageGuideStep(session.step);
      if (guidePathMatches(resumed.path, pathname)) {
        setIndex(myPageGuideIndex(session.step));
        return;
      }
      clearMyPageGuideSession();
    }

    if (pathname === MYPAGE_GUIDE_STEPS[0].path && autoStart && !isMyPageGuideDismissed()) {
      setIndex(0);
    }
  }, [ready, pathname, autoStart]);

  // 右上の「使い方」。値が変わったらセッションを捨てて 1 枚目から。
  // 初回マウントの値では動かさない（`signalRef` の初期値と同じため）。
  useEffect(() => {
    if (startSignal === undefined) return;
    if (signalRef.current === startSignal) return;
    signalRef.current = startSignal;
    if (!ready || pathname !== MYPAGE_GUIDE_STEPS[0].path) {
      pendingStart.current = true;
      return;
    }
    startFresh();
  }, [startSignal, ready, pathname, startFresh]);

  // 待っていた再開。`ready` になった時点で 1 枚目から。
  useEffect(() => {
    if (!ready || !pendingStart.current) return;
    pendingStart.current = false;
    if (pathname === MYPAGE_GUIDE_STEPS[0].path) startFresh();
  }, [ready, pathname, startFresh]);

  // 枚ごとの下ごしらえ。閉じたとき（枚が変わったとき）に元へ戻す。
  useEffect(() => {
    if (!active || !step?.openUserMenu) return;
    setSiteUserMenuOpen(true);
    return () => setSiteUserMenuOpen(false);
  }, [active, step]);

  // 折りたたみの中の対象は、開かないと測れない。対象の札だけを開く。
  useEffect(() => {
    if (!active || !step?.openDetails) return;
    for (const element of collectTargets(step.targets)) openNearestDetails(element);
  }, [active, step]);

  // 開いているあいだの印。ヘッダーのメニューは、これがあるあいだ外側クリックで閉じない。
  useEffect(() => {
    if (!active) return;
    document.body.dataset.guideActive = "true";
    return () => {
      delete document.body.dataset.guideActive;
    };
  }, [active]);

  // 対象を測り、穴と吹き出しの位置を決める。スクロール・リサイズ・属性の変化で測り直す。
  // 枚を進めるときは `prepare` → `scroll` → `idle` の順に段を上げる。
  useEffect(() => {
    if (!active || !step) return;

    const startedAt = performance.now();
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let measured = false;
    let previous = "";
    let scrollPending = false;
    let lastScrollY = window.scrollY;
    let stillFrames = 0;
    let travelFrame = 0;
    let travelTimer = 0;
    let revealTimer = 0;
    let travelDone = false;
    let travelStarted = false;
    let legs = 0;
    let follows = 0;
    /** 横に送れる節の中の対象は、1 回だけ真ん中へ寄せる。 */
    let subnavRevealed = false;

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(run);
    };

    /** 穴と吹き出しの位置を決めて state に入れる。同じ位置なら入れ替えない。 */
    const commitHoles = (
      rects: readonly GuideRect[],
      viewport: { width: number; height: number },
      bubble: { width: number; height: number },
      safeBottom: number,
    ): boolean => {
      const union = unionRect(rects);
      if (!union) return false;
      // 穴が高い枚は、そのままだと紙が穴の上端を覆う。下に置ける高さまで縮めてから置く。
      const nextHoles = [
        fitHoleToBubble(
          clampHole(union, viewport, { reservedBottom: safeBottom }),
          viewport,
          bubble,
          safeBottom,
        ),
      ];
      const anchor = anchorForBubble(nextHoles, viewport, bubble, safeBottom);
      if (!anchor) return false;

      const nextPlacement = placeBubble(anchor, viewport, bubble, safeBottom);
      const key = [
        nextPlacement.top,
        nextPlacement.left,
        ...nextHoles.flatMap((hole) => [hole.top, hole.left, hole.width, hole.height]),
      ].join(":");
      if (key !== previous) {
        previous = key;
        setHoles(nextHoles);
        setPlacement(nextPlacement);
      }
      return true;
    };

    /** 一定の速さで送る。ブラウザの `smooth` は距離で速さが変わるので使わない。 */
    const glide = (distance: number, onDone: () => void): boolean => {
      const from = window.scrollY;
      const to = from + boundedDelta(distance);
      if (to === from) return false;

      const duration = reducedMotion ? 0 : travelDuration(to - from);
      const began = performance.now();
      const tick = (now: number) => {
        const progress = duration === 0 ? 1 : Math.min(1, (now - began) / duration);
        const eased =
          progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        jumpTo(from + (to - from) * eased);
        if (progress < 1) {
          travelFrame = window.requestAnimationFrame(tick);
        } else {
          travelFrame = 0;
          onDone();
        }
      };
      travelFrame = window.requestAnimationFrame(tick);
      return true;
    };

    /** 紙を出したあとのずれを、紙を隠してから詰め直す。 */
    const settleTarget = (
      rect: GuideRect,
      viewport: { width: number; height: number },
      safeBottom: number,
      bubble: { width: number; height: number },
    ) => {
      if (scrollPending || travelFrame) return;
      if (follows >= GUIDE_SETTLE_COUNT) return;
      const delta = planScroll(rect, viewport, { reservedBottom: safeBottom, bubble });
      if (delta === null) return;

      const distance = boundedDelta(delta);
      if (Math.abs(distance) < GUIDE_SETTLE_MIN_DISTANCE) return;

      follows += 1;
      scrollPending = true;
      setSettling(true);
      lastScrollY = window.scrollY;
      stillFrames = 0;
      glide(distance, () => {
        scrollPending = false;
        setSettling(false);
        schedule();
      });
    };

    /** 移動が終わったら、最後の位置で測り直してから紙を出す。 */
    const finishTravel = () => {
      frame = 0;
      if (legs < GUIDE_SETTLE_COUNT) {
        legs += 1;
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const elements = collectTargets(step.targets).filter(isMeasurable);
        const box = bubbleRef.current?.getBoundingClientRect();
        const scrollRect = unionRect(elements.filter((element) => !isFixed(element)).map(toRect));
        const delta =
          scrollRect && box && box.height > 0
            ? planScroll(scrollRect, viewport, {
                reservedBottom: fixedBottomInset(),
                bubble: { width: box.width, height: box.height },
              })
            : null;
        if (delta !== null && Math.abs(delta) >= GUIDE_SETTLE_MIN_DISTANCE) {
          animateTo(delta, finishTravel);
          return;
        }
      }
      travelDone = true;
      run(performance.now());
      // 止まった位置を目で見る時間を置いてから、黒い面と紙を同時に出す。
      if (reducedMotion) {
        setPhase("idle");
        return;
      }
      setHolding(true);
      revealTimer = window.setTimeout(() => {
        revealTimer = 0;
        setHolding(false);
        setPhase("idle");
      }, GUIDE_REVEAL_HOLD_MS);
    };

    /**
     * `distance` だけ送る。動く距離が無い枚でも、朱の枠を一度見せてから次を出す。
     */
    const animateTo = (distance: number, onDone: () => void) => {
      const delta = boundedDelta(distance);
      if (Math.abs(delta) < GUIDE_TRAVEL_MIN_DISTANCE) {
        jumpTo(window.scrollY + delta);
        if (reducedMotion) {
          onDone();
          return;
        }
        travelTimer = window.setTimeout(onDone, GUIDE_TRAVEL_HOLD_MS);
        return;
      }
      if (!glide(delta, onDone)) onDone();
    };

    const run = (now: number) => {
      frame = 0;
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const elements = collectTargets(step.targets).filter(isMeasurable);
      const bubble = bubbleRef.current;
      const box = bubble?.getBoundingClientRect();

      if (elements.length === 0 || !box || box.height === 0) {
        // 対象が無い枚は前方へ飛ばす。後退しないので、最後の枚なら閉じる。
        if (!measured && now - startedAt > MISSING_TIMEOUT_MS) {
          goNextRef.current();
          return;
        }
        schedule();
        return;
      }

      // 横に送れる節の中の対象は、測る前に真ん中へ寄せる（縦のスクロールでは届かない）。
      if (!subnavRevealed) {
        subnavRevealed = true;
        for (const element of elements) revealInSubnav(element);
      }

      const safeBottom = fixedBottomInset();
      const bubbleSize = { width: box.width, height: box.height };
      const rects = elements.map(toRect).filter((rect) => rect.width > 0 && rect.height > 0);
      // 固定した帯はスクロールで動かないので、寄せる対象から外す。
      const scrollRect = unionRect(elements.filter((element) => !isFixed(element)).map(toRect));

      const committed = commitHoles(rects, viewport, bubbleSize, safeBottom);
      if (!committed) {
        schedule();
        return;
      }
      measured = true;

      if (phase === "prepare") {
        if (now - startedAt < GUIDE_TRAVEL_DELAY_MS) {
          schedule();
          return;
        }
        setPhase("scroll");
        return;
      }

      if (phase === "scroll") {
        if (travelDone || travelStarted) return;
        const delta = scrollRect
          ? planScroll(scrollRect, viewport, { reservedBottom: safeBottom, bubble: bubbleSize })
          : null;
        travelStarted = true;
        animateTo(delta ?? 0, finishTravel);
        return;
      }

      // スムーススクロールの途中で測った位置を残さない。3 描画ぶん動かなくなったら落ち着いたと見る。
      if (window.scrollY !== lastScrollY) {
        lastScrollY = window.scrollY;
        stillFrames = 0;
      } else {
        stillFrames += 1;
      }
      if (scrollPending && stillFrames >= 3) scrollPending = false;

      if (scrollRect) settleTarget(scrollRect, viewport, safeBottom, bubbleSize);

      if (now - startedAt < SETTLE_MS || scrollPending) schedule();
    };

    schedule();

    const resizeObserver =
      typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    resizeObserver?.observe(document.body);
    if (bubbleRef.current) resizeObserver?.observe(bubbleRef.current);
    for (const element of collectTargets(step.targets)) resizeObserver?.observe(element);

    // 帯の高さは body のクラス（`--final-bar-h` など）で変わる。幅・高さの変化は出ない。
    // 属性の変化も拾って測り直す（対象は毎描画で取り直す）。
    const mutationObserver =
      typeof MutationObserver === "function" ? new MutationObserver(schedule) : null;
    mutationObserver?.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (travelFrame) window.cancelAnimationFrame(travelFrame);
      if (travelTimer) window.clearTimeout(travelTimer);
      if (revealTimer) window.clearTimeout(revealTimer);
      setSettling(false);
      setHolding(false);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [active, step, phase, index]);

  // 移動のあいだは、指でも wheel でも画面を動かせない。動かすのはアニメーションだけ。
  useEffect(() => {
    if (!active || (phase === "idle" && !settling)) return;
    const block = (event: Event) => event.preventDefault();
    window.addEventListener("wheel", block, { passive: false });
    window.addEventListener("touchmove", block, { passive: false });
    return () => {
      window.removeEventListener("wheel", block);
      window.removeEventListener("touchmove", block);
    };
  }, [active, phase, settling]);

  // 位置が決まってから吹き出しへ焦点を移す。決まる前は visibility: hidden なので入らない。
  useEffect(() => {
    if (!placement || focusedRef.current) return;
    focusedRef.current = true;
    bubbleRef.current?.focus();
  }, [placement]);

  // 閉じたら、開く前に触っていた要素へ焦点を戻す。
  const restoreRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    return () => {
      const restore = restoreRef.current;
      restoreRef.current = null;
      if (restore && restore.isConnected) restore.focus();
    };
  }, [active]);

  // Esc で閉じ、Tab は吹き出しの中で循環させる。ヘッダーの Esc より先に受ける（capture）。
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // 変換中の Escape は IME に渡す。ここで閉じると変換の取り消しが効かない。
        if (isImeEscape(event)) return;
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = bubbleRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null,
      );
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel)
      ) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [active]);

  // 閉じているときは何も描かない。SSR でも同じ（`document` を触らない）。
  if (!active || !step) return null;
  if (typeof document === "undefined") return null;

  const copy = step.copy;
  // 穴が決まるまでは、画面全体を黒くして操作を止める（穴 0 個＝全面を覆う）。
  const clip = guideClipPath(holes);
  /**
   * 黒い面・穴・紙を出すのは、送りが終わって止まった段階だけ。送っているあいだは
   * 黒い面を外し、朱の枠だけを残して「どこへ移ったか」を見せる。
   */
  const resting = phase === "idle" && !settling;
  const showPaper = resting && placement !== null;
  const traveling = !resting;

  const content = (
    <>
      {resting ? (
        <div
          className={step.scrim === false ? "guide-scrim guide-scrim--clear" : "guide-scrim"}
          aria-hidden="true"
          style={{ clipPath: clip }}
        />
      ) : null}
      {resting
        ? holes.map((hole, holeIndex) => (
            <div key={`hole-${holeIndex}`} aria-hidden="true">
              <div
                className="guide-ring"
                style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
              />
              {/* 穴は原則として押せない。`clip-path` は当たり判定にも効くので、
                  穴の内側だけを別に塞ぐ（誤操作で対象の値が変わらないように）。 */}
              <div
                className="guide-blocker"
                style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
              />
            </div>
          ))
        : null}
      {traveling ? (
        <div className="guide-travel" role="status" aria-live="polite">
          <span className="guide-travel__label">
            {holding ? "使い方ガイド表示中" : "次の説明へ移動しています"}
          </span>
          {holding ? <GuideCount /> : null}
        </div>
      ) : null}
      {/* 吹き出しは黒い面の子にしない。子にすると親の clip-path で一緒に切り抜かれる。 */}
      <div
        ref={bubbleRef}
        className="guide-bubble guide-bubble--paper"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mypage-guide-title"
        aria-describedby={copy.body ? "mypage-guide-body" : copy.bullets ? "mypage-guide-list" : undefined}
        tabIndex={-1}
        style={
          showPaper && placement
            ? { top: placement.top, left: placement.left }
            : placement
              ? { top: placement.top, left: placement.left, opacity: 0, pointerEvents: "none" }
              : { top: 0, left: 0, visibility: "hidden" }
        }
      >
        <p className="guide-bubble__step">
          {index + 1} / {MYPAGE_GUIDE_STEPS.length}
        </p>
        <p id="mypage-guide-title" className="guide-bubble__title">
          {copy.title}
        </p>
        {copy.bullets ? (
          <ul id="mypage-guide-list" className="guide-bubble__list">
            {copy.bullets.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {copy.body ? (
          <p id="mypage-guide-body" className="guide-bubble__body">
            {copy.body}
          </p>
        ) : null}
        {copy.note ? <p className="guide-bubble__note">{copy.note}</p> : null}
        {/* 枚が変わったことを読み上げへ流す。焦点は動かさない。 */}
        <p className="visually-hidden" role="status">
          {index + 1} / {MYPAGE_GUIDE_STEPS.length}。{copy.title}
        </p>
        <div className="guide-bubble__actions">
          {/* 最終枚は「わかった」だけ。途中だけ、やめる道と戻る道を添える。
              記憶はしない（閉じたときに `dismissMyPageGuide` が行う）。 */}
          {!step.final ? (
            <button type="button" className="guide-bubble__skip" onClick={close}>
              {MYPAGE_GUIDE_ACTION_COPY.skip}
            </button>
          ) : null}
          {index > 0 && !step.final ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={goBack}>
              {MYPAGE_GUIDE_ACTION_COPY.back}
            </button>
          ) : null}
          <button type="button" className="btn btn--primary btn--sm" onClick={goNext}>
            {step.final ? MYPAGE_GUIDE_ACTION_COPY.done : MYPAGE_GUIDE_ACTION_COPY.next}
          </button>
        </div>
        <button
          type="button"
          className="guide-bubble__close"
          aria-label={MYPAGE_GUIDE_ACTION_COPY.close}
          title={MYPAGE_GUIDE_ACTION_COPY.close}
          onClick={close}
        >
          <X className="icon" aria-hidden="true" size={18} />
        </button>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
