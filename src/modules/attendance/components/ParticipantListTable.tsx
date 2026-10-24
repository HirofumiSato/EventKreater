"use client";

import { useMemo, useState } from "react";
import {
  GENDER_LABELS,
  PRICE_AUDIENCE_LABELS,
  type EventPricePlanOption,
  type EventScheduleOption,
  type Gender,
  type ParticipantRow,
  type RsvpStatus,
} from "@/modules/events/types";
import { rsvpStatusLabel, rsvpStatusTone } from "@/modules/events/lib/rsvp-status";
import { formatDateTimeJa } from "@/lib/format";
import { Badge } from "@/components/ui";

interface ParticipantListTableProps {
  rows: ParticipantRow[];
  schedules: EventScheduleOption[];
  pricePlans: EventPricePlanOption[];
  attendingCount: number;
  declinedCount: number;
  waitlistedCount: number;
  onSave?: (
    row: Pick<
      ParticipantRow,
      "id" | "name" | "status" | "gender" | "comment" | "scheduleId" | "pricePlanId"
    >,
  ) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onIssueReceipt?: (row: ParticipantRow) => void;
}

type Filter = "ALL" | RsvpStatus;

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadCsv(rows: ParticipantRow[]) {
  const header = ["名前", "性別", "出欠", "日時", "費用プラン", "コメント", "回答日時"];
  const lines = rows.map((row) =>
    [
      csvCell(row.name),
      row.gender ? GENDER_LABELS[row.gender] : "未設定",
      row.status === "ATTENDING" ? "出席" : row.status === "WAITLISTED" ? "参加要望" : "欠席",
      csvCell(row.scheduleLabel ?? ""),
      csvCell(row.pricePlanLabel ?? ""),
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
  rows,
  schedules,
  pricePlans,
  attendingCount,
  declinedCount,
  waitlistedCount,
  onSave,
  onDelete,
  onIssueReceipt,
}: ParticipantListTableProps) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftComment, setDraftComment] = useState("");
  const [draftStatus, setDraftStatus] = useState<RsvpStatus>("ATTENDING");
  const [draftGender, setDraftGender] = useState<Gender | "">("");
  const [draftScheduleId, setDraftScheduleId] = useState("");
  const [draftPricePlanId, setDraftPricePlanId] = useState("");

  /** 編集中の性別に合わせて選べるプランを絞る。 */
  const draftPlans = useMemo(() => {
    if (!draftGender) return pricePlans.filter((plan) => plan.audience === "ANY");
    return pricePlans.filter((plan) => plan.audience === "ANY" || plan.audience === draftGender);
  }, [draftGender, pricePlans]);
  const visible = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (filter !== "ALL" && row.status !== filter) return false;
      if (query && !row.name.includes(query) && !(row.comment ?? "").includes(query)) return false;
      return true;
    });
    // 参加要望どうしは待ち順で並べる。sort は安定なので他の状態の並びは変えない。
    return filtered.sort((left, right) => {
      if (left.status !== "WAITLISTED" || right.status !== "WAITLISTED") return 0;
      return (left.waitlistPosition ?? 0) - (right.waitlistPosition ?? 0);
    });
  }, [filter, query, rows]);

  const filters = [
    ["ALL", `すべて ${rows.length}`],
    ["ATTENDING", `参加 ${attendingCount}`],
    ["WAITLISTED", `参加要望 ${waitlistedCount}`],
    ["DECLINED", `不参加 ${declinedCount}`],
  ] as const;

  /** 行を編集モードにする。参加要望の承認は status を出席に上げて同じフォームで行う。 */
  const startEdit = (row: ParticipantRow, nextStatus?: RsvpStatus) => {
    setEditingId(row.id);
    setDraftName(row.name);
    setDraftComment(row.comment ?? "");
    setDraftStatus(nextStatus ?? row.status);
    setDraftGender(row.gender ?? "");
    setDraftScheduleId(row.scheduleId ?? schedules[0]?.id ?? "");
    const allowed = pricePlans.filter(
      (plan) => plan.audience === "ANY" || (row.gender !== null && plan.audience === row.gender),
    );
    setDraftPricePlanId(
      row.pricePlanId && allowed.some((plan) => plan.id === row.pricePlanId)
        ? row.pricePlanId
        : (allowed[0]?.id ?? ""),
    );
  };

  return (
    <div className="table-card">
      <div className="table-card__head">
        <h2 className="table-card__title">回答者 {rows.length}人</h2>
        <div className="panel__actions">
          <button type="button" className="btn btn--outline btn--sm" onClick={() => downloadCsv(rows)}>
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
              <th scope="col">名前</th>
              <th scope="col">性別</th>
              <th scope="col">出欠</th>
              <th scope="col">日時</th>
              <th scope="col">費用プラン</th>
              <th scope="col">コメント</th>
              <th scope="col">回答日時</th>
              {onSave && <th scope="col">操作</th>}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={onSave ? 8 : 7} className="roster__meta">
                  該当する参加者はいません。
                </td>
              </tr>
            )}
            {visible.map((row) => {
              const editing = editingId === row.id;
              return (
                <tr key={row.id}>
                  <td>
                    {editing ? (
                      <input className="input" value={draftName} onChange={(event) => setDraftName(event.target.value)} />
                    ) : (
                      <>
                        <span className="roster__name">{row.name}</span>
                        {row.status === "WAITLISTED" && row.waitlistPosition !== null && (
                          <Badge tone="waitlist" small inline>
                            待ち {row.waitlistPosition}番目
                          </Badge>
                        )}
                      </>
                    )}
                  </td>
                  <td className="roster__meta">
                    {editing ? (
                      <select
                        className="select"
                        value={draftGender}
                        onChange={(event) => {
                          const next = event.target.value as Gender | "";
                          setDraftGender(next);
                          const allowed = pricePlans.filter(
                            (plan) => plan.audience === "ANY" || (next !== "" && plan.audience === next),
                          );
                          if (!allowed.some((plan) => plan.id === draftPricePlanId)) {
                            setDraftPricePlanId(allowed[0]?.id ?? "");
                          }
                        }}
                      >
                        <option value="">未設定</option>
                        <option value="MALE">男性</option>
                        <option value="FEMALE">女性</option>
                      </select>
                    ) : row.gender ? (
                      GENDER_LABELS[row.gender]
                    ) : (
                      "未設定"
                    )}
                  </td>
                  <td>
                    {editing ? (
                      <select className="select" value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as RsvpStatus)}>
                        <option value="ATTENDING">出席</option>
                        <option value="WAITLISTED">参加要望</option>
                        <option value="DECLINED">欠席</option>
                      </select>
                    ) : (
                      <Badge tone={rsvpStatusTone(row.status)} small>
                        {rsvpStatusLabel(row.status)}
                      </Badge>
                    )}
                  </td>
                  <td className="roster__meta">
                    {editing && draftStatus === "ATTENDING" ? (
                      <select className="select" value={draftScheduleId} onChange={(event) => setDraftScheduleId(event.target.value)}>
                        {schedules.map((schedule) => (
                          <option key={schedule.id} value={schedule.id}>
                            {schedule.eventDate} {schedule.eventTime}
                          </option>
                        ))}
                      </select>
                    ) : (
                      row.scheduleLabel || "—"
                    )}
                  </td>
                  <td className="roster__meta">
                    {editing && draftStatus === "ATTENDING" ? (
                      <select className="select" value={draftPricePlanId} onChange={(event) => setDraftPricePlanId(event.target.value)}>
                        {draftPlans.map((plan) => (
                          <option key={plan.id} value={plan.id}>
                            {plan.audience === "ANY" ? "" : `${PRICE_AUDIENCE_LABELS[plan.audience]} `}
                            {plan.name} {plan.price}
                          </option>
                        ))}
                      </select>
                    ) : (
                      row.pricePlanLabel || "—"
                    )}
                  </td>
                  <td className="roster__meta">
                    {editing ? (
                      <input className="input" value={draftComment} onChange={(event) => setDraftComment(event.target.value)} />
                    ) : (
                      row.comment || "—"
                    )}
                  </td>
                  <td className="roster__meta">
                    {row.status === "WAITLISTED" && row.waitlistedAt
                      ? `要望 ${formatDateTimeJa(row.waitlistedAt)}`
                      : formatDateTimeJa(row.createdAt)}
                  </td>
                  {onSave && (
                    <td>
                      <div className="btn-row">
                        {editing ? (
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={() =>
                              void onSave({
                                id: row.id,
                                name: draftName,
                                status: draftStatus,
                                gender: draftStatus === "DECLINED" ? row.gender : draftGender || null,
                                comment: draftComment,
                                scheduleId: draftStatus === "ATTENDING" ? draftScheduleId : null,
                                pricePlanId: draftStatus === "ATTENDING" ? draftPricePlanId : null,
                              })
                                .then(() => setEditingId(null))
                                .catch(() => undefined)
                            }
                          >
                            保存
                          </button>
                        ) : (
                          <>
                            {row.status === "WAITLISTED" && (
                              <button
                                type="button"
                                className="btn btn--primary btn--sm"
                                onClick={() => startEdit(row, "ATTENDING")}
                              >
                                承認
                              </button>
                            )}
                            <button type="button" className="btn btn--sm" onClick={() => startEdit(row)}>
                              変更
                            </button>
                          </>
                        )}
                        {onDelete && (
                          <button type="button" className="btn btn--danger btn--sm" onClick={() => void onDelete(row.id)}>
                            削除
                          </button>
                        )}
                        {onIssueReceipt && row.status === "ATTENDING" && !editing && (
                          <button type="button" className="btn btn--outline btn--sm" onClick={() => onIssueReceipt(row)}>
                            {row.receipt ? "領収書" : "領収書を発行"}
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-card__foot">
        <p className="help">
          名簿は回答順です。「変更」から出欠・日時・費用プランを直せます。費用プランを選ぶと売上に入ります。
        </p>
      </div>
    </div>
  );
}
