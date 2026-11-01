"use client";

import { useCallback, useState } from "react";
import type { Gender, MyRsvp, RsvpStatus } from "@/modules/events/types";
import { readProblem } from "@/lib/problem";

export interface RsvpDraft {
  name: string;
  status: RsvpStatus;
  gender?: Gender;
  comment: string;
  /** 出席する日時（複数可）。 */
  scheduleIds?: string[];
  /** 自分を含む参加人数。 */
  partySize?: number;
  pricePlanId?: string;
  /** 申込時に選んだ割引。出席のときだけ送る。 */
  discountIds?: string[];
}

interface SubmitResponse {
  success: boolean;
  myRsvp: MyRsvp | null;
  attendingCount?: number;
  waitlistCount?: number;
}

export function useRsvp(eventId: string, initial: MyRsvp | null) {
  const [myRsvp, setMyRsvp] = useState<MyRsvp | null>(initial);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (draft: RsvpDraft): Promise<SubmitResponse> => {
      const previous = myRsvp;
      const optimistic: MyRsvp = {
        id: previous?.id ?? "optimistic",
        name: draft.name,
        status: draft.status,
        gender: draft.gender ?? null,
        comment: draft.comment || null,
        scheduleId: draft.status === "ATTENDING" ? draft.scheduleIds?.[0] ?? null : null,
        scheduleIds: draft.status === "ATTENDING" ? draft.scheduleIds ?? [] : [],
        partySize: draft.partySize ?? 1,
        pricePlanId: draft.status === "ATTENDING" ? draft.pricePlanId ?? null : null,
        discounts: previous?.discounts ?? [],
        waitlistPosition: previous?.waitlistPosition ?? null,
      };
      setMyRsvp(optimistic);
      setIsSubmitting(true);
      setError(null);
      try {
        const res = await fetch(`/api/v1/public/events/${eventId}/rsvp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft.name,
            status: draft.status,
            comment: draft.comment || undefined,
            ...(draft.gender ? { gender: draft.gender } : {}),
            partySize: draft.partySize ?? 1,
            ...(draft.status === "ATTENDING"
              ? {
                  scheduleIds: draft.scheduleIds ?? [],
                  pricePlanId: draft.pricePlanId,
                }
              : {}),
            // 出席のときだけ割引を送る。欠席・参加要望ではサーバーが無視する。
            ...(draft.status === "ATTENDING" ? { discountIds: draft.discountIds ?? [] } : {}),
          }),
        });
        if (!res.ok) {
          throw new Error(await readProblem(res));
        }
        const data = (await res.json()) as SubmitResponse;
        setMyRsvp(data.myRsvp);
        return data;
      } catch (cause) {
        setMyRsvp(previous);
        const message = cause instanceof Error ? cause.message : "出欠の送信に失敗しました";
        setError(message);
        throw cause;
      } finally {
        setIsSubmitting(false);
      }
    },
    [eventId, myRsvp],
  );

  const cancel = useCallback(async (): Promise<SubmitResponse> => {
    const previous = myRsvp;
    setMyRsvp(null);
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/public/events/${eventId}/rsvp`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error(await readProblem(res));
      }
      const data = (await res.json()) as SubmitResponse;
      setMyRsvp(null);
      return data;
    } catch (cause) {
      setMyRsvp(previous);
      const message = cause instanceof Error ? cause.message : "出欠の取り消しに失敗しました";
      setError(message);
      throw cause;
    } finally {
      setIsSubmitting(false);
    }
  }, [eventId, myRsvp]);

  return { myRsvp, setMyRsvp, submit, cancel, isSubmitting, error };
}
