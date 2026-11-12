// A small router: the studio has a handful of screens, addressed by path.
import { type AnchorHTMLAttributes, type MouseEvent, useEffect, useState } from "react";

const listeners = new Set<() => void>();

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === location.pathname + location.search) return;
  if (options.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  for (const listener of listeners) listener();
  window.scrollTo(0, 0);
}

export function usePath(): { path: string; query: URLSearchParams } {
  const [, setTick] = useState(0);
  useEffect(() => {
    const update = () => setTick((n) => n + 1);
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return { path: location.pathname, query: new URLSearchParams(location.search) };
}

/** Matches "/d/:id/:tab?" style patterns; returns the named parts or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split("/").filter(Boolean);
  const have = path.split("/").filter(Boolean);
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const part = want[i];
    const optional = part.endsWith("?");
    const name = part.replace(/^:|\?$/g, "");
    if (part.startsWith(":")) {
      if (have[i] === undefined) {
        if (optional) continue;
        return null;
      }
      params[name] = decodeURIComponent(have[i]);
    } else if (part !== have[i]) return null;
  }
  return have.length <= want.length ? params : null;
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={to}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to);
      }}
      {...rest}
    />
  );
}
