"use client";

import { Suspense } from "react";
import { CalendarView } from "@/modules/organizers/components/CalendarView";
import { Loading } from "@/components/ui";

export default function OrganizerCalendarPage() {
  return (
    <Suspense
      fallback={
        <Loading>
          読み込んでいます
        </Loading>
      }
    >
      <CalendarView />
    </Suspense>
  );
}
