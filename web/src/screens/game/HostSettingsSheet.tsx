import { useEffect, useState } from 'react';
import { elapsedMs } from '@shared/clock';
import { LIMITS } from '@shared/constants';
import type { GameView } from '@shared/protocol';
import type { Boundary, GameSettings } from '@shared/types';
import { BoundaryEditor } from '@/components/map/BoundaryEditor';
import { Button, Card, Field, Input, Segmented, Slider, Stepper, Toggle } from '@/components/ui';
import { Sheet } from '@/components/ui';
import { serverNow, useGame } from '@/lib/game';

/** Host-only settings editor. In-game, only safe-to-change settings are editable (server enforces this too). */
export function HostSettingsSheet({ view, open, onClose }: { view: GameView; open: boolean; onClose: () => void }) {
  const send = useGame((s) => s.send);
  const running = view.game.status === 'running';
  const [s, setS] = useState<GameSettings>(view.game.settings);
  const [boundary, setBoundary] = useState<Boundary | null>(view.game.boundary);
  const [editArea, setEditArea] = useState(false);

  useEffect(() => {
    if (open) {
      setS(view.game.settings);
      setBoundary(view.game.boundary);
      setEditArea(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = <K extends keyof GameSettings>(k: K, v: GameSettings[K]) => setS((p) => ({ ...p, [k]: v }));
  const fast = view.game.fastPingsAllowed;
  const minDuration = running
    ? Math.min(240, Math.ceil((elapsedMs(view.game.clock, serverNow()) + 60_000) / 300_000) * 5)
    : LIMITS.durationMinMin;

  const save = () => {
    const patch: Partial<GameSettings> = {};
    for (const k of Object.keys(s) as (keyof GameSettings)[]) {
      if (s[k] !== view.game.settings[k]) (patch as Record<string, unknown>)[k] = s[k];
    }
    const boundaryChanged = JSON.stringify(boundary) !== JSON.stringify(view.game.boundary);
    if (Object.keys(patch).length || boundaryChanged) {
      send({ type: 'host.updateSettings', settings: patch, ...(boundaryChanged ? { boundary } : {}) });
    }
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={running ? 'Adjust game' : 'Game settings'} tall>
      <div className="space-y-6 pb-4">
        {!running && (
          <>
            <Field label="Game name">
              <Input value={s.name} maxLength={LIMITS.gameNameMax} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Card className="py-1">
              <Stepper label="Max players" min={2} max={LIMITS.maxPlayersMax} value={s.maxPlayers} onChange={(v) => set('maxPlayers', v)} />
            </Card>
          </>
        )}
        <Slider label="Game length" min={minDuration} max={240} step={5} value={s.durationMin} onChange={(v) => set('durationMin', v)} format={(v) => `${v} min`} />
        {running && <p className="-mt-4 text-sm text-muted">You can extend a running game. Shortening is possible but must leave at least one minute.</p>}
        <div className="space-y-2">
          <span className="label">Ping every</span>
          <Segmented
            value={s.pingIntervalSec}
            onChange={(v) => set('pingIntervalSec', v)}
            options={[...(fast ? [{ value: 30, label: '30s' }, { value: 60, label: '1m' }] : []), { value: 120, label: '2m' }, { value: 180, label: '3m' }, { value: 300, label: '5m' }, { value: 600, label: '10m' }]}
          />
        </div>
        {!running && (
          <>
            <Slider label="Head start" min={0} max={15} value={s.headStartMin} onChange={(v) => set('headStartMin', v)} format={(v) => (v ? `${v} min` : 'None')} />
            <div className="space-y-2">
              <span className="label">Teams</span>
              <Segmented value={s.teamAssignment} onChange={(v) => set('teamAssignment', v)} options={[{ value: 'auto', label: 'Auto-balance' }, { value: 'manual', label: 'Host assigns' }]} />
            </div>
            <div className="space-y-2">
              <span className="label">Extra player joins</span>
              <Segmented value={s.extraPlayerTeam} onChange={(v) => set('extraPlayerTeam', v)} options={[{ value: 'hunter', label: 'Hunters' }, { value: 'runner', label: 'Runners' }]} />
            </div>
          </>
        )}
        <Slider label="Final phase (pings twice as often)" min={0} max={Math.max(0, Math.min(30, s.durationMin - 5))} step={5} value={Math.min(s.finalPhaseMin, Math.max(0, s.durationMin - 5))} onChange={(v) => set('finalPhaseMin', v)} format={(v) => (v ? `last ${v} min` : 'Off')} />
        {!running && (
          <>
            <div className="space-y-2">
              <span className="label">When a runner is caught</span>
              <Segmented value={s.mode} onChange={(v) => set('mode', v)} options={[{ value: 'classic', label: "They're out" }, { value: 'infection', label: 'They join the hunters' }]} />
            </div>
            <Card className="py-1">
              <Stepper label="Cloaks per runner" min={0} max={LIMITS.cloaksMax} value={s.cloaksPerRunner} onChange={(v) => set('cloaksPerRunner', v)} />
              <Stepper label="Radar sweeps (hunters)" min={0} max={LIMITS.sweepsMax} value={s.sweepsPerGame} onChange={(v) => set('sweepsPerGame', v)} />
            </Card>
          </>
        )}
        <div className="space-y-2">
          <span className="label">Capture confirmation</span>
          <Segmented value={s.captureMethod} onChange={(v) => set('captureMethod', v)} options={[{ value: 'runner_confirm', label: 'Runner confirms' }, { value: 'host_confirm', label: 'Host confirms' }]} />
        </div>
        <Card className="divide-y divide-line py-1">
          {!running && <Toggle checked={s.revealAtHeadStartEnd} onChange={(v) => set('revealAtHeadStartEnd', v)} label="Reveal when hunters are released" disabled={s.headStartMin === 0} />}
          <Toggle checked={s.tagCodeEnabled} onChange={(v) => set('tagCodeEnabled', v)} label="Instant tag codes" />
          <Toggle checked={s.hunterTeammatesVisible} onChange={(v) => set('hunterTeammatesVisible', v)} label="Hunters see each other live" />
          <Toggle checked={s.runnerTeammatesVisible} onChange={(v) => set('runnerTeammatesVisible', v)} label="Runners see each other live" />
          <Toggle checked={s.allowSpectators} onChange={(v) => set('allowSpectators', v)} label="Allow spectators" />
          <Toggle checked={s.lobbyLocked} onChange={(v) => set('lobbyLocked', v)} label="Lock lobby" description="Nobody new can join with the code." />
        </Card>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="label">Play area</span>
            <Button size="sm" variant="outline" onClick={() => setEditArea((e) => !e)}>
              {editArea ? 'Done' : boundary ? 'Edit area' : 'Draw area'}
            </Button>
          </div>
          {editArea && <BoundaryEditor value={boundary} onChange={setBoundary} />}
          {running && editArea && <p className="text-sm text-warn">Everyone will be notified that the play area changed.</p>}
        </div>
      </div>
      <div className="sticky bottom-0 -mx-5 border-t border-line bg-surface px-5 pt-3">
        <Button variant="primary" size="lg" block onClick={save}>
          Save changes
        </Button>
      </div>
    </Sheet>
  );
}
