"use client";

import { SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ComputerView } from "@/shared/api";
import { useApp } from "../app/AppProvider";
import { call, errorText } from "../common/api";
import { duration } from "../common/format";
import { countryName, flag } from "../common/kit";

interface Locations {
  locations: string[];
  defaultLocation: string;
  policy: {
    maxConcurrentComputers: number | null;
    lifecycle: { maxIdleTimeoutSeconds: number; maxRuntimeAgeSeconds: number } | null;
  };
}

const IDLE_CHOICES = [300, 900, 1800, 3600, 4 * 3600, 8 * 3600];

/** Where its browser reaches the internet from, and how long it may sit idle. */
export function SettingsCard({ computer }: { computer: ComputerView }) {
  const { toast, refresh } = useApp();
  const [found, setFound] = useState<Locations | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const currentIdle = computer.lifetime?.idleTimeoutSeconds ?? computer.idleTimeoutSeconds ?? 300;
  const currentLocation = computer.location ?? "";
  const [idle, setIdle] = useState(currentIdle);
  const [location, setLocation] = useState(currentLocation);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    call<Locations>("/api/computer/locations").then(setFound, (error) => setProblem(errorText(error)));
  }, []);

  // What's saved moved on (another tab, a Start): follow it.
  useEffect(() => setIdle(currentIdle), [currentIdle]);
  useEffect(() => setLocation(currentLocation), [currentLocation]);

  // The choices the sandbox and the project allow, and the current value even if it's none of them.
  const choices = useMemo(() => {
    const min = computer.lifetime?.minIdleTimeoutSeconds ?? 60;
    const max = Math.min(computer.lifetime?.maxIdleTimeoutSeconds ?? Infinity, found?.policy.lifecycle?.maxIdleTimeoutSeconds ?? Infinity);
    const allowed = IDLE_CHOICES.filter((s) => s >= min && s <= max);
    return [...new Set([...allowed, currentIdle])].sort((a, b) => a - b);
  }, [computer.lifetime, found, currentIdle]);

  const locations = useMemo(() => {
    const list = found?.locations ?? [];
    return currentLocation && !list.includes(currentLocation) ? [currentLocation, ...list] : list;
  }, [found, currentLocation]);

  const dirty = idle !== currentIdle || location !== currentLocation;

  const save = async () => {
    setSaving(true);
    try {
      const changes: { idleTimeoutSeconds?: number; location?: string } = {};
      if (idle !== currentIdle) changes.idleTimeoutSeconds = idle;
      if (location !== currentLocation) changes.location = location;
      const { appliedNow } = await call<{ appliedNow: boolean }>("/api/computer/settings", { method: "PATCH", body: changes });
      const said: string[] = [];
      if (changes.idleTimeoutSeconds !== undefined) said.push(appliedNow ? "The idle timeout applies now" : "The idle timeout applies at the next Start");
      if (changes.location !== undefined) said.push("The new location applies at the next Start");
      toast({ tone: "done", text: `${said.join(". ")}.` });
      await refresh();
    } catch (error) {
      toast({ tone: "failed", text: errorText(error) });
    } finally {
      setSaving(false);
    }
  };

  const policy = found?.policy;
  return (
    <section className="card">
      <div className="card-head">
        <SlidersHorizontal size={15} className="muted" />
        <h2>Settings</h2>
      </div>
      <div className="card-body">
        <label className="field">
          <span>Sleep when idle for</span>
          <select className="select" value={idle} onChange={(event) => setIdle(Number(event.target.value))}>
            {choices.map((seconds) => (
              <option key={seconds} value={seconds}>
                {duration(seconds * 1000)}
              </option>
            ))}
          </select>
          <small>Work renews it; watching the screen or reading status doesn&apos;t. A running Computer takes the new value at once when it can.</small>
        </label>

        <label className="field">
          <span>Browse from</span>
          <select className="select" value={location} onChange={(event) => setLocation(event.target.value)} disabled={!found}>
            <option value="">Automatic{found?.defaultLocation ? ` (now ${countryName(found.defaultLocation)})` : ""}</option>
            {locations.map((code) => (
              <option key={code} value={code}>
                {flag(code)} {countryName(code)}
              </option>
            ))}
          </select>
          <small>Sites see its traffic from this country. It applies at the next Start.</small>
        </label>

        {problem ? <p className="problem">{problem}</p> : null}

        {policy ? (
          <div className="cv-policy" aria-label="Your project's limits">
            <span className="badge">
              {policy.maxConcurrentComputers === null ? "Any number of Computers at once" : `Up to ${policy.maxConcurrentComputers} Computers at once`}
            </span>
            {policy.lifecycle ? (
              <>
                <span className="badge">Idle up to {duration(policy.lifecycle.maxIdleTimeoutSeconds * 1000)}</span>
                <span className="badge">Runs up to {duration(policy.lifecycle.maxRuntimeAgeSeconds * 1000)}</span>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="cv-save">
          <button className="btn primary" aria-busy={saving} disabled={!dirty || saving} onClick={() => void save()}>
            Save
          </button>
          {dirty ? <small>Unsaved changes</small> : null}
        </div>
      </div>
    </section>
  );
}
