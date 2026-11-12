import type { Metadata } from "next";
import { VaultView } from "@/ui/vault/VaultView";

export const metadata: Metadata = { title: "Vault" };

export default function Page() {
  return <VaultView />;
}
