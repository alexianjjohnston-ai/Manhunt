import { useEffect, useState } from 'react';
import { useGame } from './game';

/** Re-renders every `interval` ms and returns the estimated server time. */
export function useServerNow(interval = 250): number {
  const offset = useGame((s) => s.offset);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(id);
  }, [interval]);
  return now + offset;
}

export function useNow(interval = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(id);
  }, [interval]);
  return now;
}
