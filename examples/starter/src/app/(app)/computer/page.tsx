import type { Metadata } from "next";
import { ComputerView } from "@/ui/computer/ComputerView";

export const metadata: Metadata = { title: "Computer" };

export default function Page() {
  return <ComputerView />;
}
