import { redirect } from "next/navigation";

export default function OrganizerEventIndexPage({ params }: { params: { id: string } }) {
  redirect(`/organizer/events/${params.id}/edit`);
}
