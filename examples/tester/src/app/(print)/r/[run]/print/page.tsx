import { PrintReport } from "@/ui/run/PrintReport";

export const metadata = { title: "Report" };

export default async function Page({ params }: { params: Promise<{ run: string }> }) {
  return <PrintReport id={(await params).run} />;
}
