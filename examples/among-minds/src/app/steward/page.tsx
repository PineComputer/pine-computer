import type { Metadata } from "next";
import { Steward } from "@/ui/pages/Steward";

export const metadata: Metadata = { title: "Steward" };

export default function Page() {
  return <Steward />;
}
