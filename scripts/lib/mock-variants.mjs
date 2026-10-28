// モックの「隠し DOM」を、製品の DOM から取り出して 1 枚に合成する純ロジック。
//
//   scripts/mock-sync.mjs          … 目印を付けて HTML を読み、足りない断片を集めてここへ渡す
//   scripts/lib/capture-core.mjs   … 目印付けと断片の収集（ブラウザ側）
//   tests/unit/mock-sync.test.mjs  … この中の関数を直接呼ぶ
//
// ここには DOM もブラウザも無い。文字列を受けて文字列を返すだけにして、
// 取得（クリック）と保存（writeFile）は呼び出し側に残す。テストで固定できるようにするため。
//
// なぜ合成するか:
//   製品は「開いているステップ」「選んでいる日」の本文しか描かない。モックは 1 枚で
//   操作を再現したいので、閉じている本文・選んでいない日の一覧を隠し DOM として持たせる。
//   隠し DOM は `data-mock-hidden="true"` で消し、`mock-interactions.js` が出し入れする。

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** 控えの形式。合成の仕方が変わったら上げる（古い控えは捨てて取り直す）。 */
export const VARIANT_VERSION = 1;

/** 合成前の HTML の指紋。これが変わらなければ、押して集め直す必要は無い。 */
export function sourceHashOf(html) {
  return createHash("sha256").update(html).digest("hex");
}

/**
 * 追加で集めるべき断片があるか。目印（`data-mock-*`）は `markVariants` が付ける。
 *
 * - `steps` … 閉じているステップの本文があるか（`<li>` の数 > 本文の数）
 * - `days`  … カレンダーの日を選び直せるか（日セルと日別セクションの両方がある）
 */
export function variantsWanted(html) {
  const stepKeys = new Set();
  for (const match of html.matchAll(/data-mock-step-key="([^"]+)"/g)) stepKeys.add(match[1]);
  const bodies = new Set();
  for (const match of html.matchAll(/data-mock-step-body="([^"]+)"/g)) bodies.add(match[1]);
  const steps = [...stepKeys].some((key) => !bodies.has(key));
  const days = html.includes("data-mock-date=") && html.includes("data-mock-cal-section");
  return { steps, days, wanted: steps || days };
}

/**
 * 閉じているステップの本文を、その `<li>` の見出しの直後へ差し込む。
 *
 * 目印は `markVariants` が付けた `data-mock-step-key`。差し込む位置は `<h2>` の直後で、
 * 製品が開いたときに出す位置と同じになる。すでに本文があるステップは触らない
 * （編集画面は全部開いているので、ここは何もしない）。
 */
export function mergeStepBodies(html, steps = {}) {
  let out = html;
  for (const [key, body] of Object.entries(steps)) {
    if (!body || typeof body !== "string") continue;
    if (out.includes(`id="event-step-${key}"`)) continue;

    const range = findStepItem(out, key);
    if (!range) continue;
    const heading = out.indexOf("</h2>", range.start);
    if (heading < 0 || heading > range.end) continue;

    const at = heading + "</h2>".length;
    out = `${out.slice(0, at)}${markStepBody(body, key)}${out.slice(at)}`;
  }
  return out;
}

/** 差し込む本文に、隠す印とステップの目印を付ける。JS はこの 2 つで出し入れする。 */
function markStepBody(html, key) {
  const attributes = ` data-mock-step-body="${key}" data-mock-hidden="true"`;
  const trimmed = html.replace(/^\s+/, "");
  if (/^<div\b/.test(trimmed)) {
    const cleaned = trimmed.replace(/<div\b([^>]*)>/, (_tag, attrs) => {
      const kept = attrs.replace(/\s+data-mock-(?:step-body|hidden)="[^"]*"/g, "");
      return `<div${kept}>`;
    });
    return cleaned.replace(/^<div\b/, (tag) => tag + attributes);
  }
  return `<div${attributes}>${trimmed}</div>`;
}

/** `data-mock-step-key` を持つ `<li>` の範囲。中に `<li>` は入れ子にならない前提。 */
function findStepItem(html, key) {
  const marker = html.indexOf(`data-mock-step-key="${key}"`);
  if (marker < 0) return null;
  const start = html.lastIndexOf("<li", marker);
  const end = html.indexOf("</li>", marker);
  if (start < 0 || end < 0) return null;
  return { start, end };
}

/**
 * 選んでいない日の一覧を、いま出ている日別セクションの直後へ隠して並べる。
 *
 * `days` は `{ "YYYY-MM-DD": "<section>…</section>" }`。現在の日は元の HTML に
 * 出ているので触らない。並びは日付の昇順にして、撮り直しても順序が動かないようにする。
 */
export function mergeCalendarDays(html, days = {}) {
  const current = currentDaySection(html);
  if (!current) return html;

  const blocks = [];
  for (const [date, sectionHtml] of Object.entries(days).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    if (!sectionHtml || typeof sectionHtml !== "string") continue;
    if (date === current.date) continue;
    blocks.push(markDaySection(sectionHtml, { date, hidden: true }));
  }
  if (blocks.length === 0) return html.replace(current.openTag, current.cleanOpenTag);

  return (
    html.slice(0, current.end) +
    blocks.join("") +
    html.slice(current.end)
  ).replace(current.openTag, current.cleanOpenTag);
}

/**
 * いま出ている日別セクション。`markVariants` が `data-mock-cal-section` を付けている。
 * 合成後は目印を外し、`data-mock-cal-date` だけで日付を持つ（JS が付け替える）。
 */
function currentDaySection(html) {
  const marker = html.indexOf("data-mock-cal-section");
  if (marker < 0) return null;

  const start = html.lastIndexOf("<section", marker);
  if (start < 0) return null;
  const openEnd = html.indexOf(">", marker);
  const end = html.indexOf("</section>", openEnd);
  if (openEnd < 0 || end < 0) return null;

  const openTag = html.slice(start, openEnd + 1);
  const dateMatch = openTag.match(/data-mock-cal-date="([^"]+)"/);
  const cleanOpenTag = openTag.replace(/\s+data-mock-cal-section="[^"]*"/, "");
  return {
    date: dateMatch ? dateMatch[1] : "",
    start,
    end: end + "</section>".length,
    openTag,
    cleanOpenTag,
  };
}

/**
 * 日別セクションに、モック専用の日付と隠す印を付ける。
 *
 * 集めてきた `outerHTML` には、`markVariants` が付けた目印が残っていることがある
 * （React は自分が知らない属性を消さない）。そのまま足すと同じ属性が 2 つ並び、
 * ブラウザは先に書いた古い日付を採る。ここで一度落としてから付け直す。
 */
function markDaySection(sectionHtml, { date, hidden }) {
  const attributes = ` data-mock-cal-date="${date}"${hidden ? ' data-mock-hidden="true"' : ""}`;
  const trimmed = sectionHtml.replace(/^\s+/, "");
  const dropMarks = (attrs) =>
    attrs.replace(/\s+data-mock-(?:cal-date|cal-section|hidden)="[^"]*"/g, "");

  if (/^<section\b/.test(trimmed)) {
    const cleaned = trimmed.replace(/<section\b([^>]*)>/, (_tag, attrs) => {
      return `<section${dropMarks(attrs)}>`;
    });
    return cleaned.replace(/^<section\b/, (tag) => tag + attributes);
  }
  const cleaned = trimmed.replace(/<div\b([^>]*)>/, (_tag, attrs) => {
    return `<div${dropMarks(attrs)}>`;
  });
  // 想定外の骨格でも消えずに残す。JS は `[data-mock-cal-date]` を探すので包めば足りる。
  return `<div${attributes}>${cleaned}</div>`;
}

/**
 * 前回の控えを読む。形式か指紋が合わなければ null（取り直す）。
 * 壊れた JSON も null にして、生成を止めない。
 */
export async function readVariantCache(file, sourceHash) {
  try {
    const data = JSON.parse(await readFile(file, "utf8"));
    if (data.version !== VARIANT_VERSION) return null;
    if (data.sourceHash !== sourceHash) return null;
    if (typeof data.steps !== "object" || typeof data.calendarDays !== "object") return null;
    return data;
  } catch {
    return null;
  }
}

/** 控えを書く。人が読める形にしておく（中身を確かめたいことがある）。 */
export async function writeVariantCache(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const body = {
    version: VARIANT_VERSION,
    sourceHash: data.sourceHash,
    path: data.path,
    uiHash: data.uiHash ?? null,
    collectedAt: data.collectedAt ?? new Date().toISOString(),
    steps: data.steps ?? {},
    calendarDays: data.calendarDays ?? {},
  };
  await writeFile(file, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

/** `{ steps, calendarDays }` だけを取り出す。控えのメタ情報は合成に要らない。 */
export function fragmentsOf(cache) {
  return {
    steps: cache?.steps ?? {},
    calendarDays: cache?.calendarDays ?? {},
  };
}

/** 断片をまとめて合成する。順序は「ステップ → カレンダー」。 */
export function mergeVariants(html, fragments = {}) {
  const withSteps = mergeStepBodies(html, fragments.steps);
  return mergeCalendarDays(withSteps, fragments.calendarDays);
}

/**
 * 撮り直しを省いてよいか。
 *
 * HTML が前回と同じで、390 / 1280 の PNG がそろっていれば撮らない。`--refresh` のときは
 * 必ず撮る（見た目を確かめ直したいときの逃げ道）。
 */
export function shouldReuseShots({ changed, refresh = false, shotsExist = false }) {
  if (refresh) return false;
  if (changed) return false;
  return Boolean(shotsExist);
}
