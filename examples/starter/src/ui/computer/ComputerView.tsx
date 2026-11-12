"use client";

import { Monitor, Plus } from "lucide-react";
import Link from "next/link";
import { useApp } from "../app/AppProvider";
import { CapabilitiesCard } from "./CapabilitiesCard";
import { DangerCard } from "./DangerCard";
import { HealthCard } from "./HealthCard";
import { PasskeysCard } from "./PasskeysCard";
import { SandboxCard } from "./SandboxCard";
import { SettingsCard } from "./SettingsCard";
import "./computer.css";

/** The Computer itself: its sandbox and lifecycle, where it browses from, what it can do, the passkeys it keeps. */
export function ComputerView() {
  const { app } = useApp();
  const computer = app?.computer;

  return (
    <div className="page">
      <div className="page-in">
        <header className="page-head">
          <div>
            <h1>Computer</h1>
            <p>Its sandbox and lifecycle, where its browser reaches the internet from, what it can do, and the passkeys it keeps for sites.</p>
          </div>
        </header>

        {!app ? null : !computer ? (
          <div className="card cv-empty">
            <span className="ring">
              <Monitor size={22} />
            </span>
            <h2>No Computer yet</h2>
            <p>Create one and it gets a browser, a shell and a work directory of its own, and keeps its sign-ins between runs.</p>
            <Link href="/" className="btn primary">
              <Plus /> Create a Computer
            </Link>
          </div>
        ) : (
          <div className="cv-stack">
            <SandboxCard computer={computer} />
            <div className="grid-2">
              <SettingsCard computer={computer} />
              <HealthCard sessions={app.sessions} />
            </div>
            <CapabilitiesCard computer={computer} />
            <PasskeysCard computer={computer} />
            <DangerCard />
          </div>
        )}
      </div>
    </div>
  );
}
