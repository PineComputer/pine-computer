import { BriefPage } from "@/ui/brief/BriefPage";

export default async function Page({ params }: { params: Promise<{ brief: string }> }) {
  return <BriefPage id={(await params).brief} />;
}
