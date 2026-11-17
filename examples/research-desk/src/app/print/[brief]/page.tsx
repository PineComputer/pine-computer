import { PrintView } from "@/ui/brief/PrintView";

export default async function Page({ params }: { params: Promise<{ brief: string }> }) {
  return <PrintView id={(await params).brief} />;
}
