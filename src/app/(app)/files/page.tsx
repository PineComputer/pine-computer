import type { Metadata } from "next";
import { FilesView } from "@/ui/files/FilesView";

export const metadata: Metadata = { title: "Files" };

export default function Page() {
  return <FilesView />;
}
