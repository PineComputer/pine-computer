import { SessionView } from "@/ui/session/SessionView";

export default async function Page({ params }: { params: Promise<{ session: string }> }) {
  const { session } = await params;
  return <SessionView name={session} />;
}
