"use client";

import { ArrowRight, Fingerprint, Globe2, Layers, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { brand } from "@/brand";
import { call } from "../common/api";
import { countryName, flag } from "../common/kit";
import { useApp } from "./AppProvider";

const IDLE = [
  { seconds: 300, label: "5 minutes" },
  { seconds: 900, label: "15 minutes" },
  { seconds: 3600, label: "1 hour" },
  { seconds: 4 * 3600, label: "4 hours" },
];

const FEATURES = [
  { icon: Globe2, title: "A real browser and shell", text: "It reads across sites, fills forms, runs code and hands back files." },
  { icon: Fingerprint, title: "Signs in once, stays signed in", text: "Sign-ins, cookies and passkeys survive every Stop and Start." },
  { icon: Sparkles, title: "Learns your workflows", text: "Save a good run, or show it once, and it becomes a reusable skill." },
];

/** Before there's a Computer: what it is, and one button to make one. */
export function Onboarding() {
  const { lifecycle, busy, app } = useApp();
  const router = useRouter();
  const [locations, setLocations] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [idle, setIdle] = useState(900);

  useEffect(() => {
    call<{ locations: string[]; defaultLocation: string }>("/api/computer/locations")
      .then((found) => {
        setLocations(found.locations);
        setLocation(found.defaultLocation || found.locations[0] || "");
      })
      .catch(() => setLocations([]));
  }, []);

  const create = async () => {
    if (await lifecycle("create", { location: location || undefined, idleTimeoutSeconds: idle })) router.push("/s/main");
  };

  return (
    <div className="page">
      <div className="hero">
        <div className="hero-in">
          <span className="eyebrow">
            <Layers size={13} /> Computers for agents, beside the people they work for
          </span>
          <h1>
            Give your work <em>its own computer.</em>
          </h1>
          <p className="lede">{brand.tagline} Hand it a task, watch it browse and build, take the controls whenever you like, and keep everything it returns.</p>

          <div className="launch">
            <label className="field">
              <span>Browse from</span>
              <select className="select" value={location} onChange={(event) => setLocation(event.target.value)} disabled={!locations.length}>
                {locations.length ? null : <option value="">Automatic</option>}
                {locations.map((code) => (
                  <option key={code} value={code}>
                    {flag(code)} {countryName(code)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Sleep when idle for</span>
              <select className="select" value={idle} onChange={(event) => setIdle(Number(event.target.value))}>
                {IDLE.map((option) => (
                  <option key={option.seconds} value={option.seconds}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn primary lg" aria-busy={busy === "create"} disabled={busy !== null || app === null} onClick={() => void create()}>
              Create your Computer <ArrowRight />
            </button>
          </div>

          <div className="features">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="feature">
                <Icon />
                <b>{title}</b>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
