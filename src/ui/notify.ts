// Telling the maker, through the system, when something new waits for them while the
// studio is in the background. Off until they turn it on in Settings; the choice is kept
// in this browser (the desktop app will use its own notifications).
import { useEffect, useRef, useState } from "react";
import type { ReviewSummary } from "../shared/types.ts";
import { type TKey, useT } from "./i18n.ts";
import { navigate } from "./router.tsx";

const KEY = "studio.notify";

function wanted(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

/** Whether notifications are on, and a switch that asks the system's permission first. */
export function useNotifySetting(): { on: boolean; blocked: boolean; supported: boolean; toggle: () => Promise<void> } {
  const supported = typeof Notification !== "undefined";
  const [on, setOn] = useState(() => supported && wanted() && Notification.permission === "granted");
  const [blocked, setBlocked] = useState(() => supported && Notification.permission === "denied");
  const toggle = async () => {
    if (!supported) return;
    const next = on ? false : (await Notification.requestPermission()) === "granted";
    setBlocked(Notification.permission === "denied");
    setOn(next);
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      // kept for this visit only
    }
  };
  return { on, blocked, supported, toggle };
}

/** Announces each review that opens while the studio is out of sight; a click brings the maker to it. */
export function useReviewNotifications(waiting: ReviewSummary[] | undefined): void {
  const { t } = useT();
  const seen = useRef<Set<string> | undefined>(undefined);
  useEffect(() => {
    if (!waiting) return;
    const known = seen.current;
    seen.current = new Set(waiting.map((item) => item.id));
    // The first list is what was already waiting; only what arrives after it is news.
    if (!known || !document.hidden || typeof Notification === "undefined" || Notification.permission !== "granted" || !wanted()) return;
    for (const item of waiting.filter((review) => !known.has(review.id))) {
      const note = new Notification(`${item.dramaTitle}${item.episode ? ` · ${item.episode}` : ""}`, {
        body: `${t(`kind.${item.kind}` as TKey)} — ${item.question}`,
        tag: item.id,
      });
      note.onclick = () => {
        window.focus();
        navigate(`/r/${item.id}`);
        note.close();
      };
    }
  }, [waiting, t]);
}
