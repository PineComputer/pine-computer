import { RunView } from "@/ui/run/RunView";

export default async function Page({ params }: { params: Promise<{ run: string }> }) {
  return <RunView id={(await params).run} />;
}
