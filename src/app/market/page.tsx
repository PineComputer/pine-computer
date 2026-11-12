import type { Metadata } from "next";
import { Market } from "@/ui/pages/Market";

export const metadata: Metadata = { title: "Market" };

export default function Page() {
  return <Market />;
}
