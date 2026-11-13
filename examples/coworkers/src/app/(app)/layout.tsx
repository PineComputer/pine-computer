import { Workspace } from "@/ui/app/Workspace";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Workspace>{children}</Workspace>;
}
