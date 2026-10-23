// CI の変更判定の仕様。scripts/ci-scope.mjs を直接読み込む。
// ジョブ名ではなく「どの変更で何を走らせるか」を仕様として書く。

import { describe, expect, it } from "vitest";

import { classifyChanges, fetchChangedFiles } from "../../scripts/ci-scope.mjs";

const classify = (...files) => classifyChanges(files);

describe("文書だけの変更", () => {
  it("docs 配下だけなら check も flyer も走らせない", () => {
    expect(classify("docs/testing/ci.rst", "docs/README.md")).toEqual({ code: false, flyer: false });
  });

  it("リポジトリ直下の .md だけなら走らせない", () => {
    expect(classify("README.md", "AGENTS.md")).toEqual({ code: false, flyer: false });
  });

  it("llms.txt だけなら走らせない", () => {
    expect(classify("llms.txt")).toEqual({ code: false, flyer: false });
  });

  it("docs と llms.txt が混ざっても走らせない", () => {
    expect(classify("docs/a.md", "llms.txt")).toEqual({ code: false, flyer: false });
  });
});

describe("アプリ本体の変更", () => {
  it("src 配下なら check を走らせる", () => {
    expect(classify("src/app/page.tsx")).toEqual({ code: true, flyer: false });
  });

  it("src 配下の .md も、直下ではないので文書扱いにしない", () => {
    expect(classify("src/modules/events/README.md")).toEqual({ code: true, flyer: false });
  });

  it("tests 配下なら check を走らせる", () => {
    expect(classify("tests/unit/revenue.test.ts")).toEqual({ code: true, flyer: false });
  });

  it("prisma のスキーマとマイグレーションなら check を走らせる", () => {
    expect(
      classify("prisma/schema.prisma", "prisma/migrations/0001_x/migration.sql"),
    ).toEqual({ code: true, flyer: false });
  });

  it("package-lock.json だけでも check を走らせる", () => {
    expect(classify("package-lock.json")).toEqual({ code: true, flyer: false });
  });
});

describe("チラシ生成サービスの変更", () => {
  it("services/flyer 配下なら flyer だけを走らせる", () => {
    expect(classify("services/flyer/src/main.py")).toEqual({ code: false, flyer: true });
  });

  it("services/flyer の .md も flyer 側として扱う", () => {
    expect(classify("services/flyer/README.md")).toEqual({ code: false, flyer: true });
  });

  it("flyer と docs が混ざっても flyer は走らせる", () => {
    expect(classify("services/flyer/src/main.py", "docs/flyer/specs/x.md")).toEqual({
      code: false,
      flyer: true,
    });
  });
});

describe("複数の領域にまたがる変更", () => {
  it("docs と src が混ざったら check を走らせる", () => {
    expect(classify("docs/a.rst", "src/lib/x.ts")).toEqual({ code: true, flyer: false });
  });

  it("flyer と src が混ざったら両方走らせる", () => {
    expect(classify("services/flyer/src/main.py", "src/lib/x.ts")).toEqual({
      code: true,
      flyer: true,
    });
  });

  it("リポジトリ直下の .md と src が混ざったら check を走らせる", () => {
    expect(classify("AGENTS.md", "src/lib/x.ts")).toEqual({ code: true, flyer: false });
  });

  it("flyer とアプリ本体が混ざったら flyer も check も走らせる", () => {
    expect(classify("services/flyer/src/main.py", "tests/integration/waitlist.test.ts")).toEqual({
      code: true,
      flyer: true,
    });
  });
});

describe("ワークフロー自身の変更", () => {
  it("ci.yml を変えたら、どのジョブが壊れたか分からないので全部走らせる", () => {
    expect(classify(".github/workflows/ci.yml")).toEqual({ code: true, flyer: true });
  });

  it("別の workflow でも全部走らせる", () => {
    expect(classify(".github/workflows/deploy.yml")).toEqual({ code: true, flyer: true });
  });
});

describe("判定できないとき", () => {
  it("一覧が空なら、取得に失敗した場合と区別できないので全部走らせる", () => {
    expect(classify()).toEqual({ code: true, flyer: true });
  });

  it("空文字だけの一覧も全部走らせる", () => {
    expect(classify("", "")).toEqual({ code: true, flyer: true });
  });
});

describe("変更ファイルの取得", () => {
  it("リネームは移動前のパスも含めて返す", () => {
    const run = () => "src/new.ts\nsrc/old.ts\n";
    expect(
      fetchChangedFiles({ repository: "owner/repo", pullNumber: "1", run }),
    ).toEqual(["src/new.ts", "src/old.ts"]);
  });

  it("末尾の空行は落とす", () => {
    const run = () => "src/a.ts\n\n";
    expect(fetchChangedFiles({ repository: "owner/repo", pullNumber: "1", run })).toEqual([
      "src/a.ts",
    ]);
  });

  it("gh に渡す URL と jq の組み立てが変わっていない", () => {
    const calls = [];
    const run = (command, args) => {
      calls.push({ command, args });
      return "";
    };
    fetchChangedFiles({ repository: "owner/repo", pullNumber: "42", run });
    expect(calls[0].command).toBe("gh");
    expect(calls[0].args).toEqual([
      "api",
      "repos/owner/repo/pulls/42/files?per_page=100",
      "--paginate",
      "--jq",
      ".[] | .filename, (.previous_filename // empty)",
    ]);
  });
});
