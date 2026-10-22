import { Crosshair, Footprints, Radar } from 'lucide-react';
import { BROWSER_LIMITS, PRIVACY_POINTS, SAFETY_RULES } from '@/content';
import { ScreenShell } from '@/components/ScreenShell';
import { Card } from '@/components/ui';

export function InfoScreen({ page }: { page: 'rules' | 'privacy' }) {
  if (page === 'privacy') {
    return (
      <ScreenShell title="Privacy & safety">
        <div className="space-y-6">
          <section className="space-y-3">
            <p className="label">Your location</p>
            <ul className="space-y-3">
              {PRIVACY_POINTS.map((t) => (
                <li key={t} className="rounded-2xl border border-line bg-surface p-4 text-sm leading-relaxed">
                  {t}
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-3">
            <p className="label">Honest limits</p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
              {BROWSER_LIMITS.map((t) => (
                <li key={t}>{t}</li>
              ))}
              <li>Browser GPS can be spoofed. MANHUNT flags suspicious movement to the host as a hint, never as proof.</li>
            </ul>
          </section>
          <section className="space-y-3">
            <p className="label">Safety rules</p>
            {SAFETY_RULES.map((r) => (
              <Card key={r.title}>
                <p className="font-semibold">{r.title}</p>
                <p className="mt-1 text-sm text-muted">{r.body}</p>
              </Card>
            ))}
          </section>
        </div>
      </ScreenShell>
    );
  }
  return (
    <ScreenShell title="How to play">
      <div className="space-y-5">
        <Card className="space-y-2 border-runner/30">
          <p className="flex items-center gap-2 font-display text-lg font-bold text-runner">
            <Footprints className="size-5" /> Runners
          </p>
          <p className="text-sm leading-relaxed text-muted">
            On foot only. Stay inside the play area and stay free until time runs out. You can see your team (if the host allows it) but never the hunters. If one runner is still free at zero, all runners win.
          </p>
        </Card>
        <Card className="space-y-2 border-hunter/30">
          <p className="flex items-center gap-2 font-display text-lg font-bold text-hunter">
            <Crosshair className="size-5" /> Hunters
          </p>
          <p className="text-sm leading-relaxed text-muted">
            Wait out the head start, then hunt. You may drive, but only passengers use the phone. Tag a runner, then tap Capture. They confirm on their phone, or you enter their tag code. Catch everyone before time runs out to win.
          </p>
        </Card>
        <Card className="space-y-2 border-ice/30">
          <p className="flex items-center gap-2 font-display text-lg font-bold text-ice">
            <Radar className="size-5" /> Pings
          </p>
          <p className="text-sm leading-relaxed text-muted">
            Every ping interval (5 minutes by default), the server takes one snapshot of every free runner's latest GPS fix and reveals it to all hunters at once. Markers stay put until the next ping and always show how old and how accurate the fix is. Missed pings (no GPS) are shown as missed. MANHUNT never guesses a position.
          </p>
        </Card>
        <section className="space-y-3">
          <p className="label">Safety</p>
          {SAFETY_RULES.map((r) => (
            <p key={r.title} className="text-sm text-muted">
              <span className="font-semibold text-fg">{r.title}.</span> {r.body}
            </p>
          ))}
        </section>
      </div>
    </ScreenShell>
  );
}
