"use client";

import { AuthEntryScreen } from "@/modules/auth/components/AuthEntryScreen";

/**
 * 主催者（幹事）の入口。参加者として使うときは /participant/login へ。
 * 中身は参加者入口と共通で、文言と着地だけを差し替えている。
 */
export default function RegisterPage() {
  return <AuthEntryScreen audience="organizer" />;
}
