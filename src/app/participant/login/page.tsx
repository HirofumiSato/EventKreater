"use client";

import { AuthEntryScreen } from "@/modules/auth/components/AuthEntryScreen";

/** 参加者の入口。主催イベントの画面とは着地もナビも分ける。 */
export default function ParticipantLoginPage() {
  return <AuthEntryScreen audience="participant" />;
}
