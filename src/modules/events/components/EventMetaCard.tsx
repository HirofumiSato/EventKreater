"use client";

import Link from "next/link";
import { MapPin } from "lucide-react";
import { formatDateWithWeekdayJa } from "@/lib/format";
import { formatRsvpDeadlineLabel } from "@/lib/serializers";
import { PRICE_AUDIENCE_LABELS, RAIN_POLICY_LABELS, groupPricePlanPairs, type PublicEvent } from "@/modules/events/types";
import { Badge } from "@/components/ui";
import { EventSummary } from "@/modules/events/components/EventSummary";

interface EventMetaCardProps {
  event: Pick<
    PublicEvent,
    | "title"
    | "summary"
    | "schedules"
    | "pricePlans"
    | "discounts"
    | "location"
    | "rainPolicy"
    | "capacity"
    | "targetGeneration"
    | "attendingCount"
    | "status"
    | "rsvpDeadline"
    | "rsvpOpen"
    | "organizers"
  >;
}

/* チラシの下に置く「紙」1 枚。イベント名・主催・事実の順に読み、
   数字（残席）は最後に置く。読む順が、申し込む順になっている。 */
export function EventMetaCard({ event }: EventMetaCardProps) {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`;
  const remaining = event.capacity === null ? null : Math.max(0, event.capacity - event.attendingCount);
  const owner = event.organizers.owner;
  const coHosts = event.organizers.coHosts;
  // 料金は編集画面と同じ組（男女別は男性用・女性用で 1 組）にまとめて出す。
  const priceGroups = groupPricePlanPairs(event.pricePlans);

  return (
    <section className="event-sheet">
      <h1 className="event-sheet__title">{event.title}</h1>
      <EventSummary html={event.summary} />
      {(owner || coHosts.length > 0) && (
        <p className="event-sheet__host">
          主催者:{" "}
          {owner && (
            <>
              {owner.userId ? (
                <Link href={`/organizers/${owner.userId}`} className="text-link" aria-label={`${owner.name}さんのプロフィールを見る`}>
                  {owner.name}
                </Link>
              ) : (
                owner.name
              )}
            </>
          )}
          {coHosts.length > 0 && (
            <>
              {owner ? "／" : null}
              共同主催・幹事:{" "}
              {coHosts.map((row, index) => (
                <span key={`${row.name}-${index}`}>
                  {index > 0 && "、"}
                  {row.userId ? (
                    <Link href={`/organizers/${row.userId}`} className="text-link" aria-label={`${row.name}さんのプロフィールを見る`}>
                      {row.name}
                    </Link>
                  ) : (
                    row.name
                  )}
                </span>
              ))}
            </>
          )}
        </p>
      )}

      <div className="event-sheet__badges">
        <Badge tone="neutral" small>{RAIN_POLICY_LABELS[event.rainPolicy]}</Badge>
        {event.status === "CLOSED" && <Badge tone="declined" small>受付停止</Badge>}
        {event.status === "PUBLISHED" && event.rsvpDeadline && !event.rsvpOpen && (
          <Badge tone="declined" small>申し込み期限切れ</Badge>
        )}
        {event.capacity !== null && (
          <Badge tone="neutral" small>
            {remaining === 0 ? "満員" : `定員 ${event.capacity}名`}
          </Badge>
        )}
        {event.rsvpDeadline && (
          <Badge tone="warning" small>
            締切 {formatRsvpDeadlineLabel(event.rsvpDeadline)}
            {event.status === "PUBLISHED" && !event.rsvpOpen ? "（過ぎています）" : ""}
          </Badge>
        )}
      </div>

      <dl className="event-facts">
        <div className="event-facts__row">
          <dt>日時</dt>
          <dd>
            {event.schedules.map((row) => (
              <span key={row.id} className="event-facts__line">
                {formatDateWithWeekdayJa(row.eventDate)} {row.eventTime}
              </span>
            ))}
          </dd>
        </div>
        <div className="event-facts__row">
          <dt>場所</dt>
          <dd>
            {event.location}
            <br />
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-link event-facts__map">
              <MapPin className="icon event-facts__icon" aria-hidden="true" />
              Googleマップで開く
            </a>
          </dd>
        </div>
        <div className="event-facts__row">
          <dt>料金</dt>
          <dd>
            {/* 編集画面の「プラン1」「プラン2」と同じ組で区切る。男女別は 1 組＝1 プランなので、
                組の見出しにプラン名を 1 回だけ出し、その下に対象ごとの金額を並べる。 */}
            {priceGroups.map((group, index) => {
              const head = group[0];
              // 1 組＝1 プラン。昔のデータで組の中の名前が食い違うときだけ、行ごとに名前を出す。
              const namesAligned = group.every((row) => row.name === head.name);
              // 組が 1 つだけなら分ける必要がないので番号を出さない。
              const number = priceGroups.length > 1 ? `プラン${index + 1}` : null;
              const numberEl = number ? <span className="event-facts__plan-number">{number}</span> : null;
              // 対象が決まっている 1 行だけの組（片側だけ残った古いデータ）は、対象を添えて 1 行で出す。
              if (group.length === 1) {
                return (
                  <span key={head.id} className="event-facts__plan">
                    <span className="event-facts__line">
                      {numberEl}
                      {head.audience !== "ANY" && `${PRICE_AUDIENCE_LABELS[head.audience]}：`}
                      {head.name} {head.price}
                    </span>
                  </span>
                );
              }
              if (!namesAligned) {
                return (
                  <span key={head.id} className="event-facts__plan">
                    {group.map((row) => (
                      <span key={row.id} className="event-facts__line">
                        {numberEl}
                        {PRICE_AUDIENCE_LABELS[row.audience]}：{row.name} {row.price}
                      </span>
                    ))}
                  </span>
                );
              }
              return (
                <span key={head.id} className="event-facts__plan">
                  <span className="event-facts__line">
                    {numberEl}
                    {head.name}
                  </span>
                  {group.map((row) => (
                    <span key={row.id} className="event-facts__line event-facts__plan-price">
                      {PRICE_AUDIENCE_LABELS[row.audience]}：{row.price}
                    </span>
                  ))}
                </span>
              );
            })}
          </dd>
        </div>
        {/* 割引は任意。0 件なら行ごと出さず、告知ページの見た目を変えない。 */}
        {event.discounts.length > 0 && (
          <div className="event-facts__row">
            <dt>割引</dt>
            <dd>
              {event.discounts.map((row) => (
                <span key={row.id} className="event-facts__line">
                  {row.label}
                </span>
              ))}
            </dd>
          </div>
        )}
        <div className="event-facts__row">
          <dt>参加</dt>
          <dd>
            {event.attendingCount}名
            {event.capacity !== null && ` / 定員 ${event.capacity}名`}
            {remaining !== null && remaining > 0 && `（残り ${remaining}名）`}
            {remaining === 0 && "（満員）"}
          </dd>
        </div>
        {/* 対象世代は未設定のことがある。空の行を出さず、告知ページの見た目を変えない。 */}
        {event.targetGeneration && (
          <div className="event-facts__row">
            <dt>対象</dt>
            <dd>{event.targetGeneration}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
