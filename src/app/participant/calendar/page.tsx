"use client";

import { Suspense } from "react";
import { ParticipantCalendarView } from "@/modules/participants/components/ParticipantCalendarView";
import { Loading } from "@/components/ui";

export default function ParticipantCalendarPage() {
  return (
    <Suspense
      fallback={
        <Loading>
          読み込んでいます
        </Loading>
      }
    >
      <ParticipantCalendarView />
    </Suspense>
  );
}
