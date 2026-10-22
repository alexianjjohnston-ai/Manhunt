import { BookOpen, Car, FlaskConical, LogOut, Siren } from 'lucide-react';
import { useState } from 'react';
import type { GameView } from '@shared/protocol';
import { boundaryCenter } from '@shared/geo';
import { BROWSER_LIMITS, SAFETY_RULES } from '@/content';
import { Button, Card, HoldButton, Sheet, Toggle } from '@/components/ui';
import { useGame } from '@/lib/game';
import { useLocation } from '@/lib/location';
import { usePrefs } from '@/lib/prefs';
import { wakeLockSupported } from '@/lib/wakelock';
import { LeaveSheet } from './Lobby';

export function GameMenu({ view, open, onClose }: { view: GameView; open: boolean; onClose: () => void }) {
  const send = useGame((s) => s.send);
  const prefs = usePrefs();
  const loc = useLocation();
  const [rules, setRules] = useState(false);
  const [leave, setLeave] = useState(false);
  const sharing = view.me.shareLocation;
  const canSim = view.game.simulationAllowed;

  return (
    <>
      <Sheet open={open && !rules && !leave} onClose={onClose} title="Menu">
        <div className="space-y-4 pb-4">
          <HoldButton
            duration={900}
            onConfirm={() => {
              send({ type: 'emergencyStop' });
              onClose();
            }}
            disabled={!!view.game.emergency}
          >
            <Siren className="size-5" /> Hold for emergency stop
          </HoldButton>
          <p className="-mt-2 text-center text-xs text-muted">Pauses the game and turns off location sharing for everyone.</p>

          {sharing && (
            <Card className="py-1">
              <Toggle
                checked={!loc.paused}
                onChange={(on) => loc.setPaused(!on)}
                label="Share my location"
                description={
                  view.me.team === 'runner'
                    ? 'If you turn this off, your pings show as "missed". Hunters are told why.'
                    : 'Your teammates stop seeing you.'
                }
              />
            </Card>
          )}

          <Card className="divide-y divide-line py-1">
            <Toggle checked={prefs.daylight} onChange={(v) => prefs.set({ daylight: v, mapStyle: v ? 'daylight' : 'dark' })} label="Daylight mode" description="High contrast for bright sun." />
            <Toggle checked={prefs.keepAwake} onChange={(v) => prefs.set({ keepAwake: v })} label="Keep screen awake" description={wakeLockSupported() ? 'Helps GPS keep working.' : 'Not supported in this browser.'} disabled={!wakeLockSupported()} />
            <Toggle checked={prefs.sound} onChange={(v) => prefs.set({ sound: v })} label="Sounds" />
            <Toggle checked={prefs.haptics} onChange={(v) => prefs.set({ haptics: v })} label="Vibration" />
            <Toggle checked={prefs.lowBattery} onChange={(v) => prefs.set({ lowBattery: v })} label="Battery saver" description="Fewer, less precise GPS updates." />
          </Card>

          {view.me.team === 'hunter' && view.me.status === 'active' && (
            <Button
              block
              size="lg"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('manhunt:drivingMode'));
                onClose();
              }}
            >
              <Car className="size-5" /> I'm driving: lock screen
            </Button>
          )}

          {canSim && sharing && (
            <Card className="space-y-2 border-dashed border-warn/50">
              <p className="flex items-center gap-2 text-sm font-semibold text-warn">
                <FlaskConical className="size-4" /> Test mode: simulated GPS
              </p>
              <p className="text-xs text-muted">This server allows simulated GPS for testing. Simulated fixes are flagged. Never use this in a real game.</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (loc.simulated) loc.stopSimulation();
                  else {
                    const c = view.game.boundary ? boundaryCenter(view.game.boundary) : loc.fix ?? { lat: 51.5007, lng: -0.1246 };
                    loc.startSimulation(c, view.me.team === 'hunter' ? 3 : 1.6);
                  }
                }}
              >
                {loc.simulated ? 'Stop simulation' : 'Simulate walking'}
              </Button>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => setRules(true)}>
              <BookOpen className="size-4" /> Rules
            </Button>
            <Button variant="outline" onClick={() => setLeave(true)}>
              <LogOut className="size-4" /> Leave
            </Button>
          </div>
        </div>
      </Sheet>

      <Sheet open={rules} onClose={() => setRules(false)} title="Rules & safety" tall>
        <div className="space-y-4 pb-4 text-sm leading-relaxed">
          <section>
            <p className="label mb-1">Goal</p>
            <p className="text-muted">
              Runners stay free until the clock hits zero. Hunters must capture every runner first. Every {view.game.settings.pingIntervalSec >= 60 ? `${view.game.settings.pingIntervalSec / 60} minutes` : `${view.game.settings.pingIntervalSec} seconds`}, hunters see where each runner was at that moment.
            </p>
          </section>
          <section className="space-y-2">
            <p className="label">Safety</p>
            {SAFETY_RULES.map((r) => (
              <p key={r.title} className="text-muted">
                <span className="font-semibold text-fg">{r.title}.</span> {r.body}
              </p>
            ))}
          </section>
          <section className="space-y-2">
            <p className="label">Keeping GPS working</p>
            {BROWSER_LIMITS.map((t) => (
              <p key={t} className="text-muted">
                {t}
              </p>
            ))}
          </section>
        </div>
      </Sheet>

      <LeaveSheet open={leave} onClose={() => setLeave(false)} gameId={view.game.id} />
    </>
  );
}
