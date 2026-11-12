import type { Metadata } from "next";
import { ResidentPage } from "@/ui/pages/ResidentPage";

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  return { title: decodeURIComponent((await params).name) };
}

export default async function Page({ params }: { params: Promise<{ name: string }> }) {
  return <ResidentPage name={decodeURIComponent((await params).name)} />;
}
