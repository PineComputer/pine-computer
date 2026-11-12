"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useApp } from "./AppProvider";
import { Onboarding } from "./Onboarding";

/** With a Computer, home is its first session; without one, how to make one. */
export function Home() {
  const { app } = useApp();
  const router = useRouter();
  const first = app?.computer ? (app.sessions[0]?.name ?? "main") : null;
  useEffect(() => {
    if (first) router.replace(`/s/${first}`);
  }, [first, router]);
  if (!app || first) return null;
  return <Onboarding />;
}
