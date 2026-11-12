import type { Metadata } from "next";
import { Shelf } from "@/ui/pages/Shelf";

export const metadata: Metadata = { title: "Shelf" };

export default function Page() {
  return <Shelf />;
}
