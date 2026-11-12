import type { Metadata } from "next";
import { Library } from "@/ui/pages/Library";

export const metadata: Metadata = { title: "Library" };

export default function Page() {
  return <Library />;
}
