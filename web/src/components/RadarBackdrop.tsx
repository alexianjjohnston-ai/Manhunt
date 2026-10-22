import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '@/lib/prefs';

/**
 * Animated radar backdrop for the welcome screen: rotating sweep, range rings,
 * a coordinate grid and blips that light up as the sweep passes.
 */
export function RadarBackdrop() {
  const [blips] = useState(() =>
    Array.from({ length: 7 }, (_, i) => {
      const angle = Math.random() * 360;
      const r = 18 + Math.random() * 30;
      return { id: i, angle, r, team: i % 3 === 0 ? 'hunter' : 'runner' };
    }),
  );
  const reduced = prefersReducedMotion();
  const [t, setT] = useState(0);
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      setT(((now - start) / 4000) % 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);
  const sweepDeg = t * 360;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="grid-bg absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]" />
      <div className="absolute top-[38%] left-1/2 aspect-square w-[150vmax] -translate-x-1/2 -translate-y-1/2">
        {[0.18, 0.34, 0.5].map((s) => (
          <div
            key={s}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ice/15"
            style={{ width: `${s * 100}%`, height: `${s * 100}%` }}
          />
        ))}
        <div className="absolute top-1/2 left-0 h-px w-full bg-ice/10" />
        <div className="absolute top-0 left-1/2 h-full w-px bg-ice/10" />
        {!reduced && (
          <div
            className="absolute inset-[25%] rounded-full"
            style={{
              transform: `rotate(${sweepDeg}deg)`,
              background:
                'conic-gradient(from 0deg, transparent 0deg, transparent 300deg, color-mix(in srgb, var(--mh-signal) 10%, transparent) 340deg, color-mix(in srgb, var(--mh-signal) 38%, transparent) 360deg)',
              maskImage: 'radial-gradient(circle, black 0%, black 70%, transparent 71%)',
            }}
          />
        )}
        {blips.map((b) => {
          const diff = (((sweepDeg + 90 - b.angle) % 360) + 360) % 360;
          const glow = reduced ? 0.6 : Math.max(0, 1 - diff / 220);
          const rad = (b.angle * Math.PI) / 180;
          const x = 50 + (b.r / 2) * Math.cos(rad - Math.PI / 2);
          const y = 50 + (b.r / 2) * Math.sin(rad - Math.PI / 2);
          return (
            <div
              key={b.id}
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                opacity: 0.15 + glow * 0.85,
                background: b.team === 'hunter' ? 'var(--mh-hunter)' : 'var(--mh-runner)',
                boxShadow: `0 0 ${4 + glow * 16}px ${b.team === 'hunter' ? 'var(--mh-hunter)' : 'var(--mh-runner)'}`,
              }}
            />
          );
        })}
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-bg/30 via-transparent to-bg" />
    </div>
  );
}
