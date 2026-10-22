"use client";

import { Suspense } from "react";
import { CalendarView } from "@/modules/organizers/components/CalendarView";

export default function OrganizerCalendarPage() {
  return (
    <Suspense
      fallback={
        <p className="loading">
          <span className="spinner" aria-hidden="true" />
          読み込んでいます
        </p>
      }
    >
      <CalendarView />
    </Suspense>
  );
}
