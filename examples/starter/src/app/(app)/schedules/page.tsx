import type { Metadata } from "next";
import { SchedulesView } from "@/ui/schedules/SchedulesView";

export const metadata: Metadata = { title: "Schedules" };

export default function Page() {
  return <SchedulesView />;
}
