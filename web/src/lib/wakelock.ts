/** Screen Wake Lock: keeps the screen on so the browser keeps delivering GPS. */
let sentinel: WakeLockSentinel | null = null;
let wanted = false;

export function wakeLockSupported() {
  return 'wakeLock' in navigator;
}

async function acquire() {
  if (!wanted || !wakeLockSupported() || document.visibilityState !== 'visible' || sentinel) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    sentinel = null;
  }
}

document.addEventListener('visibilitychange', () => void acquire());

export function setWakeLock(on: boolean) {
  wanted = on;
  if (on) void acquire();
  else if (sentinel) {
    void sentinel.release();
    sentinel = null;
  }
}

export function wakeLockActive() {
  return !!sentinel;
}
