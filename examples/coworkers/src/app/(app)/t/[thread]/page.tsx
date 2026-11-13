import { ThreadView } from "@/ui/thread/ThreadView";

export default async function Page({ params }: { params: Promise<{ thread: string }> }) {
  return <ThreadView id={(await params).thread} />;
}
