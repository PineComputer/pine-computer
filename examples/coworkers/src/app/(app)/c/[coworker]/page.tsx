import { CoworkerView } from "@/ui/coworker/CoworkerView";

export default async function Page({ params }: { params: Promise<{ coworker: string }> }) {
  return <CoworkerView id={(await params).coworker} />;
}
