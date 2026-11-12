import type { Metadata } from "next";
import { Record } from "@/ui/pages/Record";

export const metadata: Metadata = { title: "Record" };

export default function Page() {
  return <Record />;
}
