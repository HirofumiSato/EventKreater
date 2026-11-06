"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { EventStepKey } from "@/modules/events/lib/steps";
import {
  EVENT_GUIDE_ACTION_COPY,
  EVENT_GUIDE_STEPS,
  guideCopy,
  type EventGuideOpenMode,
} from "@/modules/events/lib/tour/steps";
import {
  anchorForBubble,
  clampHole,
  fitHoleToBubble,
  GUIDE_SETTLE_COUNT,
  GUIDE_SETTLE_MIN_DISTANCE,
  GUIDE_TAP_STAGGER_MS,
  GUIDE_TRAVEL_DELAY_MS,
  GUIDE_TRAVEL_HOLD_MS,
  GUIDE_TRAVEL_MIN_DISTANCE,
  guideClipPath,
  placeBubble,
  planScroll,
  tapPoint,
  travelDuration,
  unionRect,
  type GuideBubblePlacement,
  type GuideHole,
  type GuideRect,
} from "@/modules/events/lib/tour/place";
import { dismissEventGuide } from "@/modules/events/lib/tour/memory";

/**
 * 新規イベント作成画面の初回ガイド（スポットライトツアー）。
 *
 * 黒い面で対象だけをくり抜き、その脇に説明の吹き出しを出す。骨格は音声入力の
 * 初回ガイド（`VoiceInputDock`）と同じだが、対象が欄ごとに変わるため、穴の位置は
 * 枚ごとに測り直す。穴は原則として押せない（誤操作で対象の値が変わらないよう、透明な層で塞ぐ）。
 * 押して確かめられる枚（アコーディオンの見出し）だけは塞がず、手の合図を出す。
 * アコーディオンは 2 枚目でいったん全部畳み、3 枚目からは全部開いたまま対象だけを移す。
 * 進むのは「次へ」だけで、閉じる道は × と Esc に限る。
 *
 * 描く場所は `document.body` の直下（ポータル）。フォームの中に置くと、`.deco` の
 * 傾きや `transform` を持つ祖先が現れたときに `position: fixed` の基準が変わり、
 * 穴と対象がずれる。読み上げの順もフォームの途中に割り込ませない。
 */

interface EventGuideTourProps {
  /** ログイン済みか。最終枚の文だけが変わる。 */
  signedIn: boolean;
  /** 画面側の状態を閉じる。記憶の書き込みはこの部品の中で済ませる。 */
  onClose: () => void;
  /**
   * ステップを開く。見出しへ実フォーカスを移さない入口を渡す。
   * ガイドは対象の欄が DOM に出てから測るため、開いてから次の描画を待つ。
   * `"closed"` は全部畳み、`"all"` は全部開く（3 枚目から開いたままにする）。
   */
  onOpenStep: (mode: EventGuideOpenMode) => void;
}

/** 焦点を移してよい要素。Tab の循環に使う（`Dialog` と同じ並び）。 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * 対象が見つからないまま待つ長さ。ステップを開いた直後は、まだ本文が DOM に無い。
 * 1 描画（16ms）では足りないので、開くアニメーション（260ms）より少し長く取る。
 */
const MISSING_TIMEOUT_MS = 600;

/**
 * 開いた直後に測り続ける長さ。`.event-step__body` の `deco-step-in` が 260ms なので、
 * その間とスムーススクロールの間（約 300ms）を覆う。
 */
const SETTLE_MS = 900;

/**
 * 押せる合図の手（`touch_app` の形）。指先は上の中央で、`x ≈ 48%` `y ≈ 12%`。
 * 押す動きの軸と波の位置は、この指先に合わせる（CSS の `transform-origin` と `top` / `left`）。
 */
const GUIDE_TAP_PATH =
  "M9 11.24V7.5C9 6.12 10.12 5 11.5 5S14 6.12 14 7.5v3.74c1.21-.81 2-2.18 2-3.74C16 5.01 13.99 3 11.5 3S7 5.01 7 7.5c0 1.56.79 2.93 2 3.74zm9.84 4.63-4.54-2.26c-.17-.07-.35-.11-.54-.11H13v-6c0-.83-.67-1.5-1.5-1.5S10 6.67 10 7.5v10.74l-3.43-.72c-.08-.01-.15-.03-.24-.03-.31 0-.59.13-.79.33l-.79.8 4.94 4.94c.27.27.65.44 1.06.44h6.79c.75 0 1.33-.55 1.44-1.28l.75-5.27c.01-.07.02-.14.02-.2 0-.62-.38-1.16-.91-1.38z";

/** ページの端を越えないよう、送る距離を丸める。 */
function boundedDelta(delta: number): number {
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const from = window.scrollY;
  const to = Math.max(0, Math.min(from + delta, maxScroll));
  return to - from;
}

/**
 * 枚を進めるときの段。
 *
 * - `prepare` … 黒い面を出したまま、開いたステップの `deco-step-in`（260ms）を待つ。
 *   待たずに送ると、開く途中の高さを基準に目的地を決めてしまい、ずれる。
 * - `scroll` … 黒い面と紙を外し、赤い枠だけを残して目的地まで送る。何が起きたか
 *   見せるための段で、触れないことは枠が示す。
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

function toRect(element: Element): GuideRect {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/** 幅も高さも 0 の要素は、`display: none` の欄。測れたことにしない。 */
function isMeasurable(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * その場で位置を合わせる。`behavior: "auto"` では足りない。
 *
 * `"auto"` は CSS の `scroll-behavior` に従う。`base.css` に
 * `html { scroll-behavior: smooth }` があるため、毎フレームの `scrollTo` が
 * ブラウザのスムーススクロールに置き換わる。すると、こちらが計算した速さでは動かず、
 * 送り終わりに溜まったスムーススクロールが一気に詰まって「急に速くなる」。
 * `"instant"` は CSS を無視してその場で合わせるので、こちらの計算どおりに動く。
 */
function jumpTo(top: number) {
  window.scrollTo({ top, behavior: "instant" });
}

/**
 * 画面下に固定している帯（スマホの `.form-final`）の高さ。
 *
 * 帯はスクロールで動かないので、穴と吹き出しの計算では「見えている下端」を
 * 帯の上端まで引き上げる。広い画面では帯が本文の中にあるため 0 になる。
 */
function fixedBottomInset(): number {
  const bar = document.querySelector<HTMLElement>(".form-final");
  if (!bar) return 0;
  if (window.getComputedStyle(bar).position !== "fixed") return 0;
  const rect = bar.getBoundingClientRect();
  return Math.max(0, window.innerHeight - rect.top);
}

/** 固定していない要素だけ、画面の外なら中央付近へ送る。 */
function isFixed(element: Element): boolean {
  return window.getComputedStyle(element).position === "fixed";
}

export function EventGuideTour({ signedIn, onClose, onOpenStep }: EventGuideTourProps) {
  const [index, setIndex] = useState(0);
  /**
   * 枚を進めるときの段。`prepare` は黒い面のまま開いたステップを待ち、
   * `scroll` は黒い面と紙を外して目的地まで送る。`idle` だけが「紙が出ている」状態。
   */
  const [phase, setPhase] = useState<GuidePhase>("idle");
  /**
   * 紙を出したあと、読み込みで対象がずれて送り直している最中か。
   * 送っているあいだは紙を隠す（モーダルが出たまま画面が動かないように）。
   */
  const [settling, setSettling] = useState(false);
  /** くり抜く穴。基本は 1 つ。2 枚目だけ 3 つの見出しぶん 3 つになる。 */
  const [holes, setHoles] = useState<GuideHole[]>([]);
  const [placement, setPlacement] = useState<GuideBubblePlacement | null>(null);
  /** 最終枚の「次回から表示しない」。押したまま閉じたときだけ記憶する。 */
  const [dontShow, setDontShow] = useState(false);

  const bubbleRef = useRef<HTMLDivElement | null>(null);
  /** 閉じる道は毎回作り直される。計測の effect を張り直さないよう ref 経由で呼ぶ。 */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const openStepRef = useRef(onOpenStep);
  openStepRef.current = onOpenStep;

  const step = EVENT_GUIDE_STEPS[index] ?? EVENT_GUIDE_STEPS[0];
  const copy = guideCopy(step, signedIn);

  /**
   * 閉じる。チェックが入っていれば次回から出さない。Esc・×・最終枚の「はじめる」の
   * どれから閉じても同じ扱いにする（音声ガイドと同じ）。
   */
  const close = useCallback(() => {
    if (step.final && dontShow) dismissEventGuide(true);
    closeRef.current();
  }, [dontShow, step.final]);

  // この枚の対象が DOM に出るよう、アコーディオンを整える（1 つだけ・全部・全部畳む）。
  // 開いた結果は次の描画で反映されるので、計測は下の effect が待ちながら測る。
  useEffect(() => {
    if (step.openStep) openStepRef.current(step.openStep);
  }, [step]);

  // 対象を測り、穴と吹き出しの位置を決める。スクロール・リサイズ・属性の変化で測り直す。
  //
  // 枚を進めるときは 2 段に分ける。黒い面・穴・紙は最後にまとめて出す（`phase`）。
  //   prepare … 紙を外して開いたステップの動き（260ms）を待つ
  //   scroll  … 目的地まで animateTo で送る（黒い面は出さない。赤い枠だけ残す）
  //   idle    … 黒い面・穴・紙を同時に出す（初回と、送りが終わったあと）
  useEffect(() => {
    const startedAt = performance.now();
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let measured = false;
    let previous = "";
    /** スクロールを頼んだ直後か。頼んだあとは位置が落ち着くまで測り直す。 */
    let scrollPending = false;
    let lastScrollY = window.scrollY;
    let stillFrames = 0;
    /** 移動のアニメーション。effect を張り直すときに止める。 */
    let travelFrame = 0;
    let travelTimer = 0;
    let travelDone = false;
    /** 送り始めたか。スクロールのたびに `run` が来るので、二重に始めないための印。 */
    let travelStarted = false;
    /** 送り直した回数。紙が伸びて目的地が動いたときに、決めた回数まで送り直す。 */
    let legs = 0;
    /** 紙が出たあとに位置を合わせ直した回数。読み込みのたびに動かし続けないための歯止め。 */
    let follows = 0;

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
      // 2 枚目は 3 つの見出しを 1 つずつ囲む。まとめると「3 つのうちどれか」が伝わらない。
      const nextHoles = step.separateTargets
        ? rects.map((rect) =>
            fitHoleToBubble(
              clampHole(rect, viewport, { reservedBottom: safeBottom }),
              viewport,
              bubble,
              safeBottom,
            ),
          )
        : (() => {
            const union = unionRect(rects);
            if (!union) return [];
            // 穴が高い枚（費用・テーマ）は、そのままだと吹き出しが穴の上端を覆う。
            // 下に置ける高さまで縮めてから、吹き出しの位置を決める。
            return [
              fitHoleToBubble(
                clampHole(union, viewport, { reservedBottom: safeBottom }),
                viewport,
                bubble,
                safeBottom,
              ),
            ];
          })();
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

    /**
     * 一定の速さで `distance` だけ送る。ブラウザの `behavior: "smooth"` は距離で速さが
     * 変わり、長い移動ほど「高速でスクロールした」と見えるので使わない。
     *
     * 動かせたら true。動く距離が無ければ false（呼び手が枠だけを見せる）。
     */
    const glide = (distance: number, onDone: () => void): boolean => {
      const from = window.scrollY;
      const to = from + boundedDelta(distance);
      if (to === from) return false;

      const duration = reducedMotion ? 0 : travelDuration(to - from);
      const began = performance.now();
      const tick = (now: number) => {
        const progress = duration === 0 ? 1 : Math.min(1, (now - began) / duration);
        // ease-in-out。動き出しと止まりを緩めて、どこへ移ったかが読めるようにする。
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

    /**
     * 紙を出したあとに読み込みで対象がずれたとき、**紙を隠してから**送り直す。
     *
     * 紙を出したまま送ると「モーダルが出たのに画面が動く」ことになり、どこを見ればよいか
     * 分からなくなる。`GUIDE_SETTLE_MIN_DISTANCE` 未満のずれは送らない（穴は毎描画で
     * 測り直しているので、対象は囲んだまま）。
     */
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
      // 送るあいだは紙を隠す。出したまま動かすと、説明を読みながら画面が流れる。
      setSettling(true);
      lastScrollY = window.scrollY;
      stillFrames = 0;
      glide(distance, () => {
        scrollPending = false;
        setSettling(false);
        schedule();
      });
    };

    /**
     * 移動が終わったら、最後の位置で測り直してから紙を出す。
     * 先に測っておくと、出した瞬間に古い穴が 1 描画だけ見える、ということが起きない。
     *
     * 送っているあいだに紙の高さが変わる（テーマの見本や画像の読み込み）と目的地が
     * 動く。動いたまま紙を出すと「モーダルが出てから画面が動く」ことになるので、
     * 十分に近づくまで紙を出さずに送り直す（`GUIDE_SETTLE_COUNT` まで）。
     */
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
        // 送り直しも 1 度目と同じ速さで動かす。時間を縮めると、目的地が動いたぶんだけ
        // 速いスクロールが紙の直前に見えてしまう。
        if (delta !== null && Math.abs(delta) >= GUIDE_SETTLE_MIN_DISTANCE) {
          animateTo(delta, finishTravel);
          return;
        }
      }
      travelDone = true;
      run(performance.now());
      setPhase("idle");
    };

    /**
     * `distance` だけ送る。
     *
     * 速さは変えない（`GUIDE_TRAVEL_SPEED`）。遠い目的地でも時間を延ばして同じ速さで動かす。
     * 途中で飛ばしたり、時間を縮めたりはしない。紙の直前に画面が飛ぶと「高速で
     * スクロールした」と見え、何が起きたか分からなくなる。
     */
    const animateTo = (distance: number, onDone: () => void) => {
      const delta = boundedDelta(distance);

      // 動く距離が無い枚（1 枚目 → 2 枚目の 11px など）でも、赤い枠は一度見せる。
      // 「いまは触れない」を毎回同じ順で見せたほうが、移動の意味が伝わる。
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
          if (index >= EVENT_GUIDE_STEPS.length - 1) closeRef.current();
          else {
            setPhase("prepare");
            setIndex(index + 1);
          }
          return;
        }
        schedule();
        return;
      }

      const safeBottom = fixedBottomInset();
      const bubbleSize = { width: box.width, height: box.height };
      const rects = elements.map(toRect).filter((rect) => rect.width > 0 && rect.height > 0);
      // 固定した帯（`.form-final`）はスクロールで動かないので、寄せる対象から外す。
      const scrollRect = unionRect(elements.filter((element) => !isFixed(element)).map(toRect));

      // 移動中も穴を更新しておく。黒い面を戻した瞬間に古い穴を見せないため。
      const committed = commitHoles(rects, viewport, bubbleSize, safeBottom);
      if (!committed) {
        schedule();
        return;
      }
      measured = true;

      if (phase === "prepare") {
        // 開いたステップの動きが終わるまで、黒い面のまま待つ。待たずに送ると、
        // 開く途中の高さを基準に送ってしまい、目的地がずれる。
        // ここで位置を飛ばしたりはしない（一瞬の移動が「高速のスクロール」に見える）。
        if (now - startedAt < GUIDE_TRAVEL_DELAY_MS) {
          schedule();
          return;
        }
        setPhase("scroll");
        return;
      }

      if (phase === "scroll") {
        // スクロールのたびに `run` が来る。送り直すと最初からになるので、1 回だけ始める。
        if (travelDone || travelStarted) return;
        const delta = scrollRect
          ? planScroll(scrollRect, viewport, { reservedBottom: safeBottom, bubble: bubbleSize })
          : null;
        travelStarted = true;
        // 動く距離が無い枚でも、枠を一度見せてから次の枚を出す（`animateTo` が判定する）。
        // 送っているあいだの位置は `scroll` のたびに測り直す（穴は commitHoles が更新する）。
        animateTo(delta ?? 0, finishTravel);
        return;
      }

      // スムーススクロールの途中で測った位置を残さない。位置が変わるたびに数え直し、
      // 3 描画ぶん動かなくなったら落ち着いたと見る。
      if (window.scrollY !== lastScrollY) {
        lastScrollY = window.scrollY;
        stillFrames = 0;
      } else {
        stillFrames += 1;
      }
      if (scrollPending && stillFrames >= 3) scrollPending = false;

      if (scrollRect) settleTarget(scrollRect, viewport, safeBottom, bubbleSize);

      // 開いた直後のアニメーションが落ち着くまで、スクロールが終わるまでは測り続ける。
      if (now - startedAt < SETTLE_MS || scrollPending) schedule();
    };

    schedule();

    const resizeObserver =
      typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    resizeObserver?.observe(document.body);
    if (bubbleRef.current) resizeObserver?.observe(bubbleRef.current);
    for (const element of collectTargets(step.targets)) resizeObserver?.observe(element);

    // 帯の高さは body のクラス（`--final-bar-h`）で変わる。幅・高さの変化は出ない。
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
      // 送り直しの途中で枚が変わることがある。隠したままにすると紙が出ない。
      setSettling(false);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [index, step, signedIn, phase]);

  // 移動のあいだは、指でも wheel でも画面を動かせない。動かすのはアニメーションだけ。
  // 赤い枠はこの「触れない」ことの合図で、黒い面は外して移動の様子を見せる。
  useEffect(() => {
    if (phase === "idle" && !settling) return;
    const block = (event: Event) => event.preventDefault();
    window.addEventListener("wheel", block, { passive: false });
    window.addEventListener("touchmove", block, { passive: false });
    return () => {
      window.removeEventListener("wheel", block);
      window.removeEventListener("touchmove", block);
    };
  }, [phase, settling]);

  // 位置が決まってから吹き出しへ焦点を移す。決まる前は visibility: hidden なので、
  // 先に focus() しても入らない。最初の 1 回だけ動かす（枚を変えても焦点は保つ）。
  const focused = useRef(false);
  useEffect(() => {
    if (!placement || focused.current) return;
    focused.current = true;
    bubbleRef.current?.focus();
  }, [placement]);

  // 閉じたら、開く前に触っていた要素へ焦点を戻す。
  useEffect(() => {
    const restore = document.activeElement as HTMLElement | null;
    return () => {
      if (restore && restore.isConnected) restore.focus();
    };
  }, []);

  // Esc で閉じ、Tab は吹き出しの中で循環させる。`Dialog` と同じ扱いをこの部品が持つ。
  // 音声モードの Esc と取り合わないよう、capture で先に止める。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
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
  }, [close]);

  /**
   * 次の枚へ。黒い面を外してから目的地まで送るので、先に `prepare` へ移す。
   * 送る距離と時間は計測の effect が決める（対象が動いたあとの位置で測るため）。
   */
  const goNext = () => {
    if (step.final) {
      close();
      return;
    }
    setPhase("prepare");
    setIndex((current) => Math.min(current + 1, EVENT_GUIDE_STEPS.length - 1));
  };

  const goBack = () => {
    if (index === 0) return;
    setPhase("prepare");
    setIndex((current) => Math.max(current - 1, 0));
  };

  // 穴が決まるまでは、画面全体を黒くして操作を止める（穴 0 個＝全面を覆う）。
  const clip = guideClipPath(holes);
  /**
   * 黒い面・穴・紙を出すのは、送りが終わって止まった段階（`idle`）だけ。
   *
   * 送っているあいだ（`prepare` / `scroll`）と、紙を出したあとの送り直し（`settling`）は
   * 黒い面を外す。画面を隠したまま動かすと、どこへ移ったか目で追えず、黒い面が出た瞬間に
   * モーダルも出たように見える。3 つを同時に出す。
   */
  const resting = phase === "idle" && !settling;
  const showPaper = resting && placement !== null;
  /** 赤い枠を出すのは、画面を動かしている（黒い面を外している）あいだ。 */
  const traveling = !resting;

  const content = (
    <>
      {/* 黒い面。送っているあいだは出さない（赤い枠だけを残し、移動を見せる）。 */}
      {resting ? (
        <div className="guide-scrim" aria-hidden="true" style={{ clipPath: clip }} />
      ) : null}
      {resting
        ? holes.map((hole, holeIndex) => (
            <div key={`hole-${holeIndex}`} aria-hidden="true">
              <div
                className="guide-ring"
                style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
              />
              {/* 穴は原則として押せない。`clip-path` は当たり判定にも効くので、
                  穴の内側だけを別に塞ぐ（誤操作で対象の値が変わらないように）。
                  押して確かめられる枚（アコーディオンの見出し）だけは塞がず、
                  代わりに手の合図を出す。 */}
              {step.pressable ? (
                <span
                  className="guide-tap"
                  style={
                    {
                      ...tapPoint(hole),
                      "--guide-tap-delay": `${holeIndex * GUIDE_TAP_STAGGER_MS}ms`,
                    } as CSSProperties
                  }
                >
                  <span className="guide-tap__ripple" />
                  <svg
                    className="guide-tap__hand"
                    viewBox="0 0 24 24"
                    focusable="false"
                    aria-hidden="true"
                  >
                    <path d={GUIDE_TAP_PATH} />
                  </svg>
                </span>
              ) : (
                <div
                  className="guide-blocker"
                  style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
                />
              )}
            </div>
          ))
        : null}
      {/* 移動中は黒い面を外し、画面の内側に赤い枠だけを残す。枠は「触れない」の合図で、
          画面を隠さないので、どこへ移ったかを目で追える。 */}
      {traveling ? (
        <div className="guide-travel" role="status" aria-live="polite">
          <span className="guide-travel__label">次の説明へ移動しています</span>
        </div>
      ) : null}
      {/* 吹き出しは黒い面の子にしない。子にすると親の clip-path で一緒に切り抜かれる。 */}
      <div
        ref={bubbleRef}
        className="guide-bubble"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-guide-title"
        aria-describedby="event-guide-body"
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
          {index + 1} / {EVENT_GUIDE_STEPS.length}
        </p>
        <p id="event-guide-title" className="guide-bubble__title">
          {copy.title}
        </p>
        {copy.bullets ? (
          <ul id="event-guide-body" className="guide-bubble__list">
            {copy.bullets.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {copy.body ? (
          <p id="event-guide-body" className="guide-bubble__body">
            {copy.body}
          </p>
        ) : null}
        {copy.note ? <p className="guide-bubble__note">{copy.note}</p> : null}
        {step.final ? (
          <label className="check guide-bubble__check">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(event) => setDontShow(event.target.checked)}
            />
            {EVENT_GUIDE_ACTION_COPY.dismiss}
          </label>
        ) : null}
        {/* 枚が変わったことを読み上げへ流す。焦点は動かさない。 */}
        <p className="visually-hidden" role="status">
          {index + 1} / {EVENT_GUIDE_STEPS.length}。{copy.title}
        </p>
        <div className="guide-bubble__actions">
          {index > 0 ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={goBack}>
              {EVENT_GUIDE_ACTION_COPY.back}
            </button>
          ) : null}
          <button type="button" className="btn btn--primary btn--sm" onClick={goNext}>
            {step.final ? EVENT_GUIDE_ACTION_COPY.start : EVENT_GUIDE_ACTION_COPY.next}
          </button>
        </div>
        <button
          type="button"
          className="guide-bubble__close"
          aria-label={EVENT_GUIDE_ACTION_COPY.close}
          title={EVENT_GUIDE_ACTION_COPY.close}
          onClick={close}
        >
          <X className="icon" aria-hidden="true" size={18} />
        </button>
      </div>
    </>
  );

  // フォームの中ではなく、本文の直下へ出す。`position: fixed` の基準になる祖先を
  // つくらないため（`.deco` の傾きなど）。`document` が無い SSR では何も描かない。
  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
