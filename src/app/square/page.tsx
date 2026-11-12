import type { Metadata } from "next";
import { Square } from "@/ui/pages/Square";

export const metadata: Metadata = { title: "Square" };

export default function Page() {
  return <Square />;
}
