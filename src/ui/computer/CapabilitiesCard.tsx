"use client";

import { Check, Cpu } from "lucide-react";
import { useEffect, useState } from "react";
import type { Capabilities, ComputerView } from "@/shared/api";
import { call, errorText } from "../common/api";
import { duration, size } from "../common/format";

function amount(value: number, unit: string): string {
  if (unit === "bytes") return size(value);
  if (unit === "milliseconds") return duration(value);
  return value.toLocaleString();
}

/** What this sandbox can do and the limits it applies, as the Computer reports them. */
export function CapabilitiesCard({ computer }: { computer: ComputerView }) {
  const running = computer.state === "running";
  const [found, setFound] = useState<Capabilities | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // A new sandbox may serve different features: ask again after each Start.
  useEffect(() => {
    if (!running) return;
    setProblem(null);
    call<Capabilities>("/api/computer/capabilities").then(setFound, (error) => setProblem(errorText(error)));
  }, [running, computer.sandboxId]);

  return (
    <section className="card">
      <div className="card-head">
        <Cpu size={15} className="muted" />
        <h2>What it can do</h2>
        {found && running ? (
          <span className="end">
            <span className="badge">{found.sessions} sessions at once</span>
          </span>
        ) : null}
      </div>
      <div className="card-body">
        {!running ? (
          <p className="empty-note">Start the Computer to see what its sandbox serves.</p>
        ) : problem ? (
          <p className="problem">{problem}</p>
        ) : !found ? (
          <div className="cv-checking">
            <span className="spinner" /> Asking the Computer…
          </div>
        ) : (
          <>
            {found.features.length ? (
              <div className="cv-features">
                {found.features.map((feature) => (
                  <div key={feature.id} className="cv-feature" title={feature.id}>
                    <b>
                      <Check /> {feature.title}
                    </b>
                    <span>{feature.description}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {found.limits.length ? (
              <>
                <div className="cv-subhead">Limits</div>
                <table className="cv-table">
                  <thead>
                    <tr>
                      <th>Applies to</th>
                      <th />
                      <th style={{ textAlign: "right", paddingRight: 0 }}>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {found.limits.map((limit) => (
                      <tr key={limit.id} title={limit.id}>
                        <td>{limit.description}</td>
                        <td className="tags">
                          <span className="badge">per {limit.scope}</span>
                          <span className={limit.kind === "maximum" ? "badge" : "badge accent"}>{limit.kind}</span>
                        </td>
                        <td className="value">{amount(limit.value, limit.unit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
