import type { Metadata } from "next";
import { SkillsView } from "@/ui/skills/SkillsView";

export const metadata: Metadata = { title: "Skills" };

export default function Page() {
  return <SkillsView />;
}
