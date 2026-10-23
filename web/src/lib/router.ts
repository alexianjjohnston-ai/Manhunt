import { useSyncExternalStore } from 'react';

/** Minimal history-based router (the app only has a handful of routes). */
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

window.addEventListener('popstate', notify);

// The demo runs inside an embedded frame where URL routes don't apply, so it keeps the
// current path in memory instead of the address bar.
let memoryPath = '/';
const currentPath = () => (__DEMO__ ? memoryPath : location.pathname);

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (__DEMO__) {
    if (to === memoryPath) return;
    memoryPath = to;
  } else {
    if (to === location.pathname + location.search) return;
    if (opts.replace) history.replaceState(null, '', to);
    else history.pushState(null, '', to);
  }
  window.scrollTo(0, 0);
  notify();
}

export function usePath(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    currentPath,
  );
}

export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith(':')) out[p[i]!.slice(1)] = decodeURIComponent(s[i]!);
    else if (p[i] !== s[i]) return null;
  }
  return out;
}
