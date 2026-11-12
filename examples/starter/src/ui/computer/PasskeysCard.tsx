"use client";

import { Fingerprint, KeyRound, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Ceremony, ComputerView, PasskeyView } from "@/shared/api";
import { useApp } from "../app/AppProvider";
import { call, enc, errorText } from "../common/api";
import { relative } from "../common/format";
import { Confirm } from "../common/kit";

/** The passkeys the Computer keeps for sites, and sites waiting to create one. */
export function PasskeysCard({ computer }: { computer: ComputerView }) {
  const { ceremonies, decide, toast, app } = useApp();
  const running = computer.state === "running";
  const [passkeys, setPasskeys] = useState<PasskeyView[] | null>(null);
  const [pending, setPending] = useState<Ceremony[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<PasskeyView | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const label = (name: string) => app?.sessions.find((s) => s.name === name)?.label ?? name;

  const load = useCallback(async () => {
    try {
      const found = await call<{ passkeys: PasskeyView[]; pending: Ceremony[] }>("/api/passkeys");
      setPasskeys(found.passkeys);
      setPending(found.pending);
      setProblem(null);
    } catch (error) {
      setProblem(errorText(error));
    }
  }, []);

  // Read again when the pushed requests change: one was approved, declined or expired.
  const pushed = ceremonies.map((c) => c.id).join();
  useEffect(() => {
    if (running) void load();
  }, [running, computer.sandboxId, pushed, load]);

  const waiting = running ? pending : [];

  return (
    <section className="card">
      <div className="card-head">
        <Fingerprint size={15} className="muted" />
        <h2>Passkeys</h2>
        {waiting.length ? (
          <span className="end">
            <span className="badge human">{waiting.length} waiting</span>
          </span>
        ) : null}
      </div>
      {!running ? (
        <p className="empty-note">Start the Computer to see the passkeys it keeps.</p>
      ) : problem ? (
        <div className="card-body">
          <p className="problem">{problem}</p>
        </div>
      ) : !passkeys ? (
        <div className="card-body">
          <div className="cv-checking">
            <span className="spinner" /> Reading its passkeys…
          </div>
        </div>
      ) : (
        <div className="rows">
          {waiting.map((c) => (
            <div key={c.id} className="row">
              <span className="cv-key pending">
                <Fingerprint />
              </span>
              <div className="grow">
                <div className="title">{c.rpId} wants to create a passkey</div>
                <div className="sub">
                  {c.userName ? `For ${c.userName} · ` : ""}in {label(c.session)}
                  {c.expiresAt ? ` · expires ${relative(Date.parse(c.expiresAt))}` : ""}
                </div>
              </div>
              <button
                className="btn sm primary"
                aria-busy={deciding === c.id}
                disabled={deciding !== null}
                onClick={async () => {
                  setDeciding(c.id);
                  await decide(c.id, "approve");
                  setDeciding(null);
                  void load();
                }}
              >
                Approve
              </button>
              <button
                className="btn sm ghost"
                disabled={deciding !== null}
                onClick={async () => {
                  await decide(c.id, "decline");
                  void load();
                }}
              >
                Decline
              </button>
            </div>
          ))}
          {passkeys.map((p) => (
            <div key={p.id} className="row">
              <span className="cv-key">
                <KeyRound />
              </span>
              <div className="grow">
                <div className="title">{p.rpId}</div>
                <div className="sub">
                  {p.userName || "No account name"}
                  {p.createdAt ? ` · created ${relative(Date.parse(p.createdAt))}` : ""}
                  {p.lastUsedAt ? ` · used ${relative(Date.parse(p.lastUsedAt))}` : " · never used"}
                </div>
              </div>
              <button className="btn sm ghost danger" aria-label={`Delete the passkey for ${p.rpId}`} onClick={() => setRemoving(p)}>
                <Trash2 />
              </button>
            </div>
          ))}
          {!passkeys.length && !waiting.length ? (
            <p className="empty-note">
              None yet. When a site asks to create a passkey, you&apos;re asked to approve it; the Computer then keeps it, and its private key never leaves.
            </p>
          ) : null}
        </div>
      )}

      {removing ? (
        <Confirm
          title={`Delete the passkey for ${removing.rpId}?`}
          body={
            <>
              The Computer can&apos;t sign in to {removing.rpId} with it any more. The site keeps its public half until you remove the passkey in its
              settings too.
            </>
          }
          action="Delete passkey"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              await call(`/api/passkeys/${enc(removing.id)}`, { method: "DELETE" });
              toast({ tone: "done", text: `Deleted the passkey for ${removing.rpId}` });
              await load();
            } catch (error) {
              toast({ tone: "failed", text: errorText(error) });
            }
          }}
        />
      ) : null}
    </section>
  );
}
