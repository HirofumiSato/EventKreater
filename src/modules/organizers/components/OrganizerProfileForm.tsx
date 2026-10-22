"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Toast } from "@/components/common/Toast";
import { readProblem } from "@/lib/problem";
import { OrganizerProfileView } from "@/modules/organizers/components/OrganizerProfileView";
import { profileContentFromDraft } from "@/modules/organizers/lib/profile";
import {
  EMPTY_PROFILE_DRAFT,
  MAX_PROFILE_TAGS,
  PROFILE_TAGS,
  PROFILE_TAG_LABELS,
  type OrganizerProfileDraft,
  type OrganizerProfileDraftResponse,
  type OrganizerProfileStats,
  type ProfileTag,
} from "@/modules/organizers/types";

type LoadState = "loading" | "ready" | "error" | "register" | "not-organizer";

/**
 * 主催者の公開プロフィールの編集（SCR-ORG-14）。
 *
 * 入力しながら、公開ページと同じ見た目でプレビューできる。
 * 表示名（`users.name`）はアカウント設定で変えるため、ここでは扱わない。
 */
export function OrganizerProfileForm() {
  const [draft, setDraft] = useState<OrganizerProfileDraft>({ ...EMPTY_PROFILE_DRAFT });
  const [name, setName] = useState("");
  const [stats, setStats] = useState<OrganizerProfileStats | null>(null);
  const [homePath, setHomePath] = useState("");
  const [eventsPath, setEventsPath] = useState("");
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const applyResponse = useCallback((data: OrganizerProfileDraftResponse) => {
    setName(data.name);
    setDraft(data.profile);
    setStats(data.stats);
    setHomePath(data.homePath);
    setEventsPath(data.eventsPath);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/organizer/profile", { cache: "no-store" });
    if (res.status === 401) {
      setState("error");
      setError("ログインが必要です。");
      return;
    }
    if (res.status === 403) {
      const problem = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      setError(problem.detail ?? null);
      setState(problem.error === "REGISTER_REQUIRED" ? "register" : "not-organizer");
      return;
    }
    if (!res.ok) {
      setState("error");
      setError(await readProblem(res));
      return;
    }
    applyResponse((await res.json()) as OrganizerProfileDraftResponse);
    setState("ready");
  }, [applyResponse]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = <K extends keyof OrganizerProfileDraft>(key: K, value: OrganizerProfileDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const toggleTag = (tag: ProfileTag) => {
    setDraft((current) => {
      if (current.tags.includes(tag)) {
        return { ...current, tags: current.tags.filter((row) => row !== tag) };
      }
      if (current.tags.length >= MAX_PROFILE_TAGS) return current;
      return { ...current, tags: [...current.tags, tag] };
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/v1/organizer/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error(await readProblem(res));
      applyResponse((await res.json()) as OrganizerProfileDraftResponse);
      setToast("プロフィールを保存しました。");
      setPreviewing(false);
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : "保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  };

  if (state === "loading") {
    return (
      <p className="loading">
        <span className="spinner" aria-hidden="true" />
        読み込んでいます
      </p>
    );
  }

  if (state === "register") {
    return (
      <section className="card stack">
        <p className="panel__title">公開プロフィールには会員登録が必要です</p>
        <p className="help">{error ?? "ゲスト幹事のままでは、プロフィールを保存できません。"}</p>
        <div className="btn-row">
          <Link href="/auth/register?next=/organizer/profile" className="btn btn--primary">
            会員登録して続ける
          </Link>
          <Link href="/organizer/events" className="btn btn--outline">
            主催一覧へ戻る
          </Link>
        </div>
      </section>
    );
  }

  if (state === "not-organizer") {
    return (
      <section className="card stack">
        <p className="panel__title">まだ主催イベントがありません</p>
        <p className="help">公開プロフィールは、主催イベントを持つ会員だけが使えます。</p>
        <div className="btn-row">
          <Link href="/organizer/events/new" className="btn btn--primary">
            催しをつくる
          </Link>
        </div>
      </section>
    );
  }

  if (state === "error") {
    return (
      <section className="card stack">
        <p className="alert alert--error">{error}</p>
        <div className="btn-row">
          <Link href="/organizer/events" className="btn btn--outline">
            主催一覧へ戻る
          </Link>
        </div>
      </section>
    );
  }

  if (previewing) {
    return (
      <div className="stack">
        <section className="panel">
          <div>
            <p className="eyebrow">プレビュー</p>
            <h2 className="panel__title">参加者から見たページ</h2>
            <p className="panel__note">保存前の内容です。公開すると、この見え方で表示されます。</p>
          </div>
          <div className="panel__actions">
            <button type="button" className="btn btn--outline" onClick={() => setPreviewing(false)}>
              編集に戻る
            </button>
            <button type="button" className="btn btn--primary" onClick={save} disabled={saving}>
              {saving ? "保存しています…" : "この内容で保存"}
            </button>
          </div>
        </section>
        <OrganizerProfileView
          userId="preview"
          name={name}
          profile={profileContentFromDraft(draft, stats)}
          eventsPath={eventsPath || undefined}
          preview
        />
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      </div>
    );
  }

  return (
    <div className="stack">
      <section className="panel">
        <div>
          <p className="eyebrow">公開設定</p>
          <h2 className="panel__title">{draft.isPublished ? "公開中" : "非公開"}</h2>
          <p className="panel__note">
            非公開のあいだは、参加者に名前と催しへの導線だけが出ます。自己紹介・リンク・実績は出ません。
          </p>
        </div>
        <div className="panel__actions">
          <button type="button" className="btn btn--outline" onClick={() => setPreviewing(true)}>
            プレビュー
          </button>
          {homePath && (
            <a href={homePath} target="_blank" rel="noopener noreferrer" className="btn btn--outline">
              公開ページを開く
            </a>
          )}
          {eventsPath && (
            <a href={eventsPath} target="_blank" rel="noopener noreferrer" className="btn btn--outline">
              催しページを開く
            </a>
          )}
        </div>
      </section>

      <form
        className="form form--spaced"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset className="field">
          <legend className="label">公開</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.isPublished}
              onChange={(event) => update("isPublished", event.target.checked)}
            />
            プロフィールを参加者に公開する
          </label>
          <p className="help">オフのままでも、ページと催しへの導線は開けます。</p>
        </fieldset>

        <div className="field">
          <label className="label" htmlFor="profile-headline">
            肩書き・ひとこと
          </label>
          <input
            id="profile-headline"
            className="input"
            maxLength={60}
            value={draft.headline}
            onChange={(event) => update("headline", event.target.value)}
            placeholder="渋谷で月いちの読書会をひらいています"
          />
          <p className="help">{draft.headline.length}/60</p>
        </div>

        <div className="field">
          <label className="label" htmlFor="profile-bio">
            自己紹介
          </label>
          <textarea
            id="profile-bio"
            className="textarea"
            rows={6}
            maxLength={400}
            value={draft.bio}
            onChange={(event) => update("bio", event.target.value)}
            placeholder="どんな催しを、どんな人と、どんな気持ちで開いているか。"
          />
          <p className="help">{draft.bio.length}/400</p>
        </div>

        <div className="field">
          <label className="label" htmlFor="profile-area">
            活動エリア
          </label>
          <input
            id="profile-area"
            className="input"
            maxLength={50}
            value={draft.area}
            onChange={(event) => update("area", event.target.value)}
            placeholder="東京都渋谷区"
          />
        </div>

        <fieldset className="field">
          <legend className="label">活動ジャンル（{MAX_PROFILE_TAGS}つまで）</legend>
          <div className="profile-tag-picker">
            {PROFILE_TAGS.map((tag) => {
              const checked = draft.tags.includes(tag);
              const disabled = !checked && draft.tags.length >= MAX_PROFILE_TAGS;
              return (
                <label key={tag} className="check">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleTag(tag)}
                  />
                  {PROFILE_TAG_LABELS[tag]}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="field">
          <label className="label" htmlFor="profile-x">
            X
          </label>
          <input
            id="profile-x"
            className="input"
            inputMode="url"
            maxLength={200}
            value={draft.xUrl}
            onChange={(event) => update("xUrl", event.target.value)}
            placeholder="https://x.com/example"
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="profile-instagram">
            Instagram
          </label>
          <input
            id="profile-instagram"
            className="input"
            inputMode="url"
            maxLength={200}
            value={draft.instagramUrl}
            onChange={(event) => update("instagramUrl", event.target.value)}
            placeholder="https://www.instagram.com/example"
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="profile-website">
            Webサイト
          </label>
          <input
            id="profile-website"
            className="input"
            inputMode="url"
            maxLength={200}
            value={draft.websiteUrl}
            onChange={(event) => update("websiteUrl", event.target.value)}
            placeholder="https://example.com"
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="profile-line">
            LINE
          </label>
          <input
            id="profile-line"
            className="input"
            inputMode="url"
            maxLength={200}
            value={draft.lineUrl}
            onChange={(event) => update("lineUrl", event.target.value)}
            placeholder="https://lin.ee/xxxxxxx"
          />
          <p className="help">lin.ee か line.me のURLだけを載せられます。</p>
        </div>

        <fieldset className="field">
          <legend className="label">実績</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.showStats}
              onChange={(event) => update("showStats", event.target.checked)}
            />
            主催した回数と活動開始年を表示する
          </label>
          <p className="help">
            {stats
              ? `いまの実績: 主催 ${stats.eventCount}回・${stats.sinceYear}年から`
              : "開催済みの催しが1件もないため、表示できる実績はまだありません。"}
          </p>
        </fieldset>

        <div className="btn-row">
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "保存しています…" : "保存する"}
          </button>
        </div>
      </form>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
