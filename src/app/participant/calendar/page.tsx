"use client";

import { Suspense } from "react";
import { ParticipantCalendarView } from "@/modules/participants/components/ParticipantCalendarView";

export default function ParticipantCalendarPage() {
  return (
    <Suspense
      fallback={
        <p className="loading">
          <span className="spinner" aria-hidden="true" />
          読み込んでいます
        </p>
      }
    >
      <ParticipantCalendarView />
    </Suspense>
  );
}
