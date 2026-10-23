/**
 * DEMO BUILD ONLY: quick-start sheet (you + bots), "add bots" for the lobby, and the
 * in-game hint that explains tap-to-walk.
 */
import { Bot, Crosshair, Footprints, Play } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { Button, Segmented, Sheet } from '@/components/ui';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { navigate } from '@/lib/router';
import { sessions } from '@/lib/sessions';
import { addBots, arrangeTeams } from './bots';
import { demoSpeed } from './speed';

export const DEMO_CENTER = { lat: 51.5025, lng: -0.134 }; // St James's Park, London

export function QuickDemoSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prefs = usePrefs();
  const [role, setRole] = useState<'runner' | 'hunter'>('hunter');
  const [bots, setBots] = useState(5);
  const [interval, setInterval] = useState(60);
  const [headStart, setHeadStart] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const name = prefs.lastName || 'Player';
      const res = await api.create({
        hostName: name,
        settings: {
          ...DEFAULT_SETTINGS,
          name: 'Demo game',
          durationMin: 15,
          pingIntervalSec: interval,
          headStartMin: headStart,
          revealAtHeadStartEnd: headStart > 0,
          teamAssignment: 'manual',
        },
        boundary: { type: 'circle', center: DEMO_CENTER, radiusM: 650 },
        safetyAck: true,
      });
      sessions.save({ gameId: res.gameId, token: res.token, playerId: res.playerId, code: res.code, name, gameName: 'Demo game' });
      addBots(res.gameId, res.code, bots);
      arrangeTeams(res.gameId, res.playerId, role);
      navigate(`/game/${res.gameId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the demo');
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Demo game">
      <div className="space-y-5 pb-4">
        <p className="text-sm text-muted">
          Everything runs in this page: the real game engine plus bot players walking simulated routes around St James's Park. Your GPS is simulated too. Tap the map to walk.
        </p>
        <div className="space-y-2">
          <span className="label">You play as</span>
          <Segmented
            value={role}
            onChange={setRole}
            options={[
              { value: 'hunter', label: (<span className="inline-flex items-center gap-1.5"><Crosshair className="size-4 text-hunter" /> Hunter</span>) },
              { value: 'runner', label: (<span className="inline-flex items-center gap-1.5"><Footprints className="size-4 text-runner" /> Runner</span>) },
            ]}
          />
        </div>
        <div className="space-y-2">
          <span className="label">Bots</span>
          <Segmented value={bots} onChange={setBots} options={[3, 5, 7, 9].map((n) => ({ value: n, label: String(n) }))} />
        </div>
        <div className="space-y-2">
          <span className="label">Ping every</span>
          <Segmented value={interval} onChange={setInterval} options={[{ value: 30, label: '30s' }, { value: 60, label: '1m' }, { value: 120, label: '2m' }, { value: 300, label: '5m' }]} />
        </div>
        <div className="space-y-2">
          <span className="label">Runner head start</span>
          <Segmented value={headStart} onChange={setHeadStart} options={[{ value: 0, label: 'None' }, { value: 1, label: '1 min' }, { value: 2, label: '2 min' }]} />
        </div>
        {error && <p className="text-sm text-danger-ink">{error}</p>}
        <Button variant="primary" size="lg" block loading={busy} onClick={start}>
          <Play className="size-5" /> Set up demo lobby
        </Button>
        <p className="text-center text-xs text-faint">You're the host. Start the game from the lobby when you're ready.</p>
      </div>
    </Sheet>
  );
}

export function AddBotsButton({ gameId, code }: { gameId: string; code: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <Button
        block
        variant="outline"
        onClick={() => {
          const added = addBots(gameId, code, 3);
          setMsg(added.length ? `${added.join(', ')} joined` : 'No room for more bots');
        }}
      >
        <Bot className="size-4" /> Add 3 bot players (demo)
      </Button>
      {msg && <p className="text-center text-xs text-muted">{msg}</p>}
    </div>
  );
}

const SPEEDS = [1, 4, 10];

export function DemoMapHint() {
  const [speed, setSpeed] = useState(demoSpeed.value);
  return (
    <button
      type="button"
      onClick={() => {
        const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
        demoSpeed.value = next;
        setSpeed(next);
      }}
      className="pointer-events-auto glass rounded-full border border-warn/40 px-3 py-1.5 text-xs font-semibold text-warn"
    >
      Demo: tap the map to walk · {speed}× speed
    </button>
  );
}

