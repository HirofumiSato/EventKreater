// AI が最初に読む索引 llms.txt をリポジトリ直下に作る。
//
//   npm run docs:gen
//
// llms.txt の慣習（https://llmstxt.org/）に合わせて、H1・要約・節ごとのリンクだけを置く。
// 本文は docs/doc-index.json から引くので、文書を足したら gen-doc-index が先に走る。

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DOCS_ROOT, GENERATED_DOCS, ROOT } from "./lib/docs-util.mjs";

const INDEX = path.join(DOCS_ROOT, "doc-index.json");
const OUTPUT = path.join(ROOT, "llms.txt");

// 節ごとに、入口として読む文書だけを選ぶ。全部並べると llms.txt の意味が無くなる。
const SECTIONS = [
  {
    heading: "最初に読む",
    entries: [
      ["docs/onboarding.md", "全体を 90 分で掴む順路。人間と AI が同じものを使う"],
      ["docs/README.md", "どの文書が何から派生し、何で検証されるか。既知の乖離もここ"],
      ["docs/sitemap.rst", "ドキュメント全体の見取り図"],
      ["AGENTS.md", "AI エージェント向けの探索規則。正はコードであること、コマンド、規約"],
    ],
  },
  {
    heading: "仕様（正はコード）",
    entries: [
      ["docs/backend_api_implementation_spec.md", null],
      ["docs/front_implementation_spec.md", null],
      ["docs/DBschema.md", null],
      ["docs/detailed_design_spec.md", null],
    ],
  },
  {
    heading: "手順",
    entries: [
      ["docs/local.rst", null],
      ["docs/stripe.rst", null],
      ["docs/database.rst", null],
    ],
  },
  {
    heading: "検証",
    entries: [
      ["docs/testing/index.rst", null],
      ["docs/testing/scope.rst", null],
      ["docs/testing/ci.rst", null],
    ],
  },
  {
    heading: "チラシ生成（Python マイクロサービス）",
    entries: [
      ["docs/flyer/index.rst", null],
      ["docs/flyer/architecture.rst", null],
      ["docs/flyer/specs/index.rst", null],
      ["services/flyer/AGENTS.md", "Python 側の設計規約（Ports & Adapters、例外、描画境界、pytest）"],
    ],
  },
  {
    heading: "生成された索引",
    entries: [
      ["docs/doc-index.json", "全原稿のタイトル・要約・見出し・toctree・参照コードの JSON"],
      ["docs/api-routes.md", "route.ts と API 仕様の突き合わせ"],
      ["docs/traceability.md", "コードから文書への逆引き"],
    ],
  },
];

function loadDocs() {
  try {
    const payload = JSON.parse(readFileSync(INDEX, "utf8"));
    return new Map(payload.docs.map((doc) => [doc.path, doc]));
  } catch {
    console.error("docs/doc-index.json がありません。先に `node scripts/gen-doc-index.mjs` を実行してください。");
    process.exit(1);
  }
}

function escapeText(value) {
  return value.replace(/[[\]]/g, "");
}

function oneLine(value, limit) {
  const text = escapeText(value.replace(/\s+/g, " ").trim());
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

const docs = loadDocs();
const missing = [];
const lines = [
  "# event-creater",
  "",
  "> イベント告知・出欠管理と、主催者の利用枠・Stripe 決済を扱う Next.js 14 アプリケーション。",
  "> チラシ生成だけが Python の独立サービス（services/flyer、FastAPI + Pillow + OpenAI）。",
  "> 仕様の正はコードと prisma/schema.prisma で、docs はその検証面。",
  "",
  "このファイルは `npm run docs:gen` が生成します。手で編集しないでください。",
  "パスはリポジトリ直下からの相対パスです。全文書の一覧は docs/doc-index.json にあります。",
];

for (const section of SECTIONS) {
  lines.push("", `## ${section.heading}`, "");
  for (const [docPath, fixedSummary] of section.entries) {
    const doc = docs.get(docPath);
    if (!doc) {
      // docs の索引に無いものは、生成物とリポジトリ直下の規約だけ許可する。
      const allowed = GENERATED_DOCS.has(docPath) || !docPath.startsWith("docs/");
      if (!allowed || !existsSync(path.join(ROOT, docPath))) {
        missing.push(docPath);
        continue;
      }
      const title = path.basename(docPath);
      const summary = fixedSummary ? oneLine(fixedSummary, 160) : "（要約なし）";
      lines.push(`- [${escapeText(title)}](${docPath}): ${summary}`);
      continue;
    }
    const summary = fixedSummary ?? (doc.summary ? oneLine(doc.summary, 160) : "（要約なし）");
    lines.push(`- [${escapeText(doc.title)}](${docPath}): ${summary}`);
  }
}

if (missing.length > 0) {
  console.error(`llms.txt: 索引に無い文書を指しています: ${missing.join(", ")}`);
  console.error("SECTIONS のパスを直すか、文書を追加してください。");
  process.exit(1);
}

writeFileSync(OUTPUT, `${lines.join("\n")}\n`, "utf8");
console.log(`llms.txt: ${SECTIONS.reduce((total, section) => total + section.entries.length, 0)} リンク`);
console.log(`  -> ${path.relative(process.cwd(), OUTPUT)}`);
