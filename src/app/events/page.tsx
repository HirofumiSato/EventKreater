import { redirect } from "next/navigation";

/** 一覧画面はない。`/events/[id]` のパス接頭辞だけを残す。 */
export default function EventsIndexPage() {
  redirect("/");
}
