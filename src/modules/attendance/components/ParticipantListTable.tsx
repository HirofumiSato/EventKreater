"use client";

import { useMemo, useState } from "react";
import {
  GENDER_LABELS,
  type EventPricePlanOption,
  type EventScheduleOption,
  type ParticipantRow,
  type RsvpStatus,
} from "@/modules/events/types";
import { rsvpStatusLabel, rsvpStatusTone } from "@/modules/events/lib/rsvp-status";
import { formatDateTimeJa, yen } from "@/lib/format";
import { Badge, Dialog } from "@/components/ui";
import {
  DEFAULT_PARTICIPANT_COLUMNS,
  LOCKED_PARTICIPANT_COLUMNS,
  PARTICIPANT_COLUMNS_STORAGE_KEY,
  PARTICIPANT_COLUMN_LABELS,
  PARTICIPANT_COLUMN_ORDER,
  parseParticipantColumns,
  toggleParticipantColumn,
  type ParticipantColumnKey,
} from "@/modules/attendance/lib/participant-columns";
import { ParticipantSheet, type ParticipantDraft } from "@/modules/attendance/components/ParticipantSheet";

interface ParticipantListTableProps {
  eventId: string;
  rows: ParticipantRow[];
  schedules: EventScheduleOption[];
  pricePlans: EventPricePlanOption[];
  attendingCount: number;
  declinedCount: number;
  waitlistedCount: number;
  /** 定員。追加の 1 枚で「定員に達しています」を出すために使う。 */
  capacity?: number | null;
  onSave?: (draft: ParticipantDraft) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  /** 削除済みの行を名簿に戻す。 */
  onRestore?: (id: string) => Promise<void>;
  /** 集金の切り替えを親へ伝える。名簿の列と売上の数字を同じ値にするため。 */
  onCollectionChange?: (id: string, collectedAt: string | null) => void;
}

/** `DELETED` は削除済みだけを出す札。`ALL` では末尾に混ぜる。 */
type Filter = "ALL" | RsvpStatus | "DELETED";

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadCsv(rows: ParticipantRow[]) {
  const header = ["名前", "性別", "出欠", "人数", "日時", "料金プラン", "割引", "支払額", "集金", "コメント", "回答日時"];
  const lines = rows.map((row) =>
    [
      csvCell(row.name),
      row.gender ? GENDER_LABELS[row.gender] : "未設定",
      row.status === "ATTENDING" ? "参加" : row.status === "WAITLISTED" ? "参加要望" : "欠席",
      row.status === "ATTENDING" ? String(row.partySize) : "",
      csvCell(row.scheduleLabel ?? ""),
      csvCell(row.pricePlanLabel ?? ""),
      csvCell(row.discounts.map((discount) => discount.label).join(" / ")),
      row.payableAmount === null ? "" : String(row.payableAmount),
      row.status === "ATTENDING" && row.collectedAt ? "済" : "",
      csvCell(row.comment ?? ""),
      csvCell(formatDateTimeJa(row.createdAt)),
    ].join(","),
  );
  const blob = new Blob([`\uFEFF${[header.join(","), ...lines].join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "participants.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function ParticipantListTable({
  eventId,
  rows,
  schedules,
  pricePlans,
  attendingCount,
  declinedCount,
  waitlistedCount,
  capacity = null,
  onSave,
  onDelete,
  onRestore,
  onCollectionChange,
}: ParticipantListTableProps) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  /** 1 行を開いているか。直すときだけ層を出す（表には操作の列を置かない）。 */
  const [openRow, setOpenRow] = useState<ParticipantRow | null>(null);
  /** 追加の 1 枚を開いているか。行がまだ無いので `openRow` とは別に持つ。 */
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  /**
   * 表示する列。この表は参加者を読み終えてから描かれるので、初期化のときに
   * `localStorage` を読める（SSR では既定へ戻す）。
   */
  const [columns, setColumns] = useState<ParticipantColumnKey[]>(() => {
    if (typeof window === "undefined") return [...DEFAULT_PARTICIPANT_COLUMNS];
    return parseParticipantColumns(window.localStorage.getItem(PARTICIPANT_COLUMNS_STORAGE_KEY));
  });
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);

  const toggleColumn = (key: ParticipantColumnKey) => {
    const next = toggleParticipantColumn(columns, key);
    setColumns(next);
    try {
      window.localStorage.setItem(PARTICIPANT_COLUMNS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 保存できない環境（プライベートモードなど）では、その場の切り替えだけにする。
    }
  };

  const visible = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (query && !row.name.includes(query) && !(row.comment ?? "").includes(query)) return false;
      // 削除済みは「すべて」の末尾と「削除済み」にだけ出す（出欠の絞り込みには混ぜない）。
      if (filter === "DELETED") return row.deletedAt !== null;
      if (filter !== "ALL") return row.deletedAt === null && row.status === filter;
      return true;
    });
    // 削除済みは常に最後へ寄せる。それ以外は参加要望どうしを待ち順で並べる（sort は安定）。
    return filtered.sort((left, right) => {
      if (left.deletedAt !== null || right.deletedAt !== null) {
        if (left.deletedAt === null) return -1;
        if (right.deletedAt === null) return 1;
        return 0;
      }
      if (left.status !== "WAITLISTED" || right.status !== "WAITLISTED") return 0;
      return (left.waitlistPosition ?? 0) - (right.waitlistPosition ?? 0);
    });
  }, [filter, query, rows]);

  /** 削除済みの件数。「すべて」の末尾に残る行の数と、札の数を同じにする。 */
  const deletedCount = rows.filter((row) => row.deletedAt !== null).length;

  const filters: [Filter, string][] = [
    ["ALL", `すべて ${rows.length}`],
    ["ATTENDING", `参加 ${attendingCount}`],
    ["WAITLISTED", `参加要望 ${waitlistedCount}`],
    ["DECLINED", `欠席 ${declinedCount}`],
  ];
  // 削除済みがあるときだけ札を出す。無いときは 0 件の札を並べない。
  if (deletedCount > 0) filters.push(["DELETED", `削除済み ${deletedCount}`]);

  /** CSV は集金や当日の受付に使う一覧なので、削除済みは出さない。 */
  const csvRows = rows.filter((row) => row.deletedAt === null);

  /** 1 枚を閉じる。追加の 1 枚と行の 1 枚は同時に開かない。 */
  const closeSheet = () => {
    setOpenRow(null);
    setAdding(false);
  };

  /** 開いている 1 枚の行。追加のときは null（`ParticipantSheet` が追加として描く）。 */
  const sheetRow = adding ? null : openRow;

  const saveRow = async (draft: ParticipantDraft) => {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave(draft);
      closeSheet();
    } catch {
      // 失敗の案内は呼び出し元（Toast）が持つ。開いたまま直せるようにする。
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async (id: string) => {
    if (!onDelete) return;
    setSaving(true);
    try {
      await onDelete(id);
      closeSheet();
    } catch {
      // 失敗の案内は呼び出し元（Toast）が持つ。
    } finally {
      setSaving(false);
    }
  };

  const restoreRow = async (id: string) => {
    if (!onRestore) return;
    setSaving(true);
    try {
      await onRestore(id);
      closeSheet();
    } catch {
      // 失敗の案内（定員が埋まっているときの 409 など）は呼び出し元が持つ。
    } finally {
      setSaving(false);
    }
  };

  const showsColumn = (key: ParticipantColumnKey) => columns.includes(key);
  const shownColumnCount = PARTICIPANT_COLUMN_ORDER.filter(showsColumn).length;

  return (
    <div className="table-card">
      <div className="table-card__head">
        <h2 className="table-card__title">回答 {rows.length}件</h2>
        <div className="panel__actions">
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setAdding(true)}>
            参加者を追加
          </button>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => setColumnPickerOpen(true)}>
            表示列
          </button>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => downloadCsv(csvRows)}>
            CSVで書き出す
          </button>
        </div>
      </div>
      <div className="table-card__search">
        <div className="roster-toolbar">
          <div className="segment" role="group" aria-label="出欠で絞り込む">
            {filters.map(([key, label]) => (
              <label key={key} className="segment__item">
                <input
                  type="radio"
                  name="participant-filter"
                  checked={filter === key}
                  onChange={() => setFilter(key)}
                />
                {label}
              </label>
            ))}
          </div>
          <label className="roster-toolbar__search">
            <span className="visually-hidden">名前・コメントで探す</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="名前・コメントで探す"
              className="input input--compact"
            />
          </label>
        </div>
      </div>
      <div className="table-card__scroll">
        <table className="roster">
          <caption className="visually-hidden">参加者の名簿</caption>
          <thead>
            <tr>
              {PARTICIPANT_COLUMN_ORDER.map((key) => (
                <th key={key} scope="col" data-column={key} hidden={!showsColumn(key)}>
                  {PARTICIPANT_COLUMN_LABELS[key]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={shownColumnCount} className="roster__meta">
                  該当する参加者はいません。
                </td>
              </tr>
            )}
            {visible.map((row) => {
              const deleted = row.deletedAt !== null;
              // 削除済みの行も押せる（削除済みモードの 1 枚が開き、名簿へ戻せる）。
              const openable = Boolean(onSave || onRestore);
              const rowClass = ["roster__row"];
              if (openable) rowClass.push("roster__row--open");
              if (deleted) rowClass.push("roster__row--deleted");
              return (
                <tr
                  key={row.id}
                  className={rowClass.join(" ")}
                  onClick={openable ? () => setOpenRow(row) : undefined}
                >
                  <td data-column="name" hidden={!showsColumn("name")}>
                    {openable ? (
                      // 行そのものを押せるが、キーボードと読み上げにはこのボタンを使う。
                      <button
                        type="button"
                        className="roster__open"
                        aria-label={
                          deleted ? `${row.name} の削除を取り消す` : `${row.name} の出欠を変更`
                        }
                        onClick={() => setOpenRow(row)}
                      >
                        <span className="roster__name">{row.name}</span>
                        {!deleted && row.status === "WAITLISTED" && row.waitlistPosition !== null && (
                          <Badge tone="waitlist" small inline>
                            待ち {row.waitlistPosition}番目
                          </Badge>
                        )}
                      </button>
                    ) : (
                      <>
                        <span className="roster__name">{row.name}</span>
                        {!deleted && row.status === "WAITLISTED" && row.waitlistPosition !== null && (
                          <Badge tone="waitlist" small inline>
                            待ち {row.waitlistPosition}番目
                          </Badge>
                        )}
                      </>
                    )}
                  </td>
                  <td className="roster__meta" data-column="gender" hidden={!showsColumn("gender")}>
                    {row.gender ? GENDER_LABELS[row.gender] : "未設定"}
                  </td>
                  <td data-column="status" hidden={!showsColumn("status")}>
                    {deleted ? (
                      <Badge tone="neutral" small>
                        削除済み
                      </Badge>
                    ) : (
                      <Badge tone={rsvpStatusTone(row.status)} small>
                        {rsvpStatusLabel(row.status)}
                      </Badge>
                    )}
                  </td>
                  <td className="roster__meta" data-column="partySize" hidden={!showsColumn("partySize")}>
                    {!deleted && row.status === "ATTENDING" ? `${row.partySize}人` : "—"}
                  </td>
                  <td className="roster__meta" data-column="schedule" hidden={!showsColumn("schedule")}>
                    {row.scheduleLabel || "—"}
                  </td>
                  <td className="roster__meta" data-column="pricePlan" hidden={!showsColumn("pricePlan")}>
                    {deleted ? (
                      "—"
                    ) : (
                      <>
                        {row.pricePlanLabel || "—"}
                        {row.status === "ATTENDING" && row.discounts.length > 0 && (
                          <span className="roster__discounts">
                            {row.discounts.map((discount, index) => (
                              <span key={`${discount.name}-${index}`} className="roster__discount">
                                {discount.label}
                              </span>
                            ))}
                          </span>
                        )}
                        {row.status === "ATTENDING" &&
                          row.payableAmount !== null &&
                          (row.discountAmount > 0 || row.partySize > 1) && (
                            <>
                              {/* 集金は 1 人ずつ記録する。1 人ぶんを先に、人数ぶんの合計を次に出す。 */}
                              {row.partySize > 1 && (
                                <span className="roster__payable">
                                  1人 {yen(row.unitPayableAmount ?? row.payableAmount)}
                                </span>
                              )}
                              <span className="roster__payable">
                                {row.partySize > 1
                                  ? `${row.partySize}人 合計 ${yen(row.payableAmount)}`
                                  : `支払額 ${yen(row.payableAmount)}`}
                              </span>
                            </>
                          )}
                      </>
                    )}
                  </td>
                  <td className="roster__meta" data-column="collected" hidden={!showsColumn("collected")}>
                    {!deleted && row.status === "ATTENDING" && row.collectedAt ? (
                      <Badge tone="success" small>
                        済
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="roster__meta" data-column="comment" hidden={!showsColumn("comment")}>
                    {row.comment || "—"}
                  </td>
                  <td className="roster__meta" data-column="createdAt" hidden={!showsColumn("createdAt")}>
                    {row.status === "WAITLISTED" && row.waitlistedAt
                      ? `要望 ${formatDateTimeJa(row.waitlistedAt)}`
                      : formatDateTimeJa(row.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-card__foot">
        <p className="help">
          {onSave ? "行を押すと、出欠・人数・料金プランを直せます。" : "回答順に並びます。"}
        </p>
      </div>
      {columnPickerOpen && (
        <Dialog
          title="表示する列"
          titleId="participant-columns-title"
          onClose={() => setColumnPickerOpen(false)}
          actions={
            <button type="button" className="btn btn--sm" onClick={() => setColumnPickerOpen(false)}>
              閉じる
            </button>
          }
        >
          <p className="dialog__body">
            よく見る列だけを残すと、スマホでも横に送らずに読めます。
          </p>
          <div className="column-picker">
            {PARTICIPANT_COLUMN_ORDER.map((key) => {
              const locked = LOCKED_PARTICIPANT_COLUMNS.includes(key);
              return (
                <label key={key} className="check">
                  <input
                    type="checkbox"
                    checked={locked || columns.includes(key)}
                    // 名前は外せない（誰の行か分からなくなるため）。
                    disabled={locked}
                    onChange={() => toggleColumn(key)}
                  />
                  <span>{PARTICIPANT_COLUMN_LABELS[key]}</span>
                </label>
              );
            })}
          </div>
        </Dialog>
      )}
      {(adding || sheetRow) && onSave && (
        <ParticipantSheet
          // 追加と行の編集で初期値を取り違えないよう、開くたびに作り直す。
          key={sheetRow ? sheetRow.id : "participant-new"}
          eventId={eventId}
          row={sheetRow}
          schedules={schedules}
          pricePlans={pricePlans}
          capacity={capacity}
          attendingCount={attendingCount}
          busy={saving}
          onClose={closeSheet}
          onSave={saveRow}
          onDelete={onDelete ? deleteRow : undefined}
          onRestore={onRestore ? restoreRow : undefined}
          onCollectedChange={onCollectionChange}
        />
      )}
    </div>
  );
}
