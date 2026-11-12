"use client";

import { Trash2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "../app/AppProvider";
import { Confirm } from "../common/kit";

export function DangerCard() {
  const { busy, lifecycle } = useApp();
  const router = useRouter();
  const [asking, setAsking] = useState(false);

  return (
    <section className="card cv-danger">
      <div className="card-head">
        <TriangleAlert size={15} style={{ color: "var(--bad)" }} />
        <h2>Danger zone</h2>
      </div>
      <div className="card-body">
        <div className="cv-danger-row">
          <p>
            Delete the Computer for good: its sandbox, saved state, sign-ins, passkeys and learned skills go, and its id is never used again. This app keeps
            its task history and the files it kept.
          </p>
          <button className="btn danger" aria-busy={busy === "delete"} disabled={busy !== null} onClick={() => setAsking(true)}>
            <Trash2 /> Delete Computer
          </button>
        </div>
      </div>
      {asking ? (
        <Confirm
          title="Delete this Computer for good?"
          body="There's no undo. Its sandbox stops at once, and its saved state, sign-ins, passkeys and skills are deleted. Your task history and kept files stay in this app."
          action="Delete for good"
          word="delete"
          onClose={() => setAsking(false)}
          onConfirm={async () => {
            if (await lifecycle("delete")) router.push("/");
          }}
        />
      ) : null}
    </section>
  );
}
