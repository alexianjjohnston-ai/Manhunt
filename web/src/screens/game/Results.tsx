import { motion } from 'motion/react';
import { Clock, Crosshair, Footprints, Home, Radar, RotateCcw, ShieldCheck, Trash2, Trophy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { elapsedMs, formatDuration } from '@shared/clock';
import type { GameView } from '@shared/protocol';
import { GameMap, type PingMarker } from '@/components/map/GameMap';
import { Button, Card, Slider, TeamGlyph } from '@/components/ui';
import { useGame } from '@/lib/game';
import { usePrefs } from '@/lib/prefs';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/utils';
import { playerMap, toCaptureMarkers } from './derived';
import { LeaveSheet } from './Lobby';

export function Results({ view }: { view: GameView }) {
  const send = useGame((s) => s.send);
  const mapStyle = usePrefs((s) => s.mapStyle);
  const players = useMemo(() => playerMap(view), [view]);
  const { game } = view;
  const [seq, setSeq] = useState(view.history.length);
  const [leave, setLeave] = useState(false);

  const played = elapsedMs(game.clock, game.clock.endedAt ?? Date.now());
  const runners = view.players.filter((p) => p.team === 'runner');
  const survivors = runners.filter((p) => p.status === 'active');
  const confirmed = view.captures.filter((c) => c.status === 'confirmed').sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));
  const captureCounts = new Map<string, number>();
  for (const c of confirmed) if (c.hunterId) captureCounts.set(c.hunterId, (captureCounts.get(c.hunterId) ?? 0) + 1);
  const topHunter = [...captureCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  const snapshot = view.history.find((r) => r.seq === seq);
  const pings: PingMarker[] = useMemo(
    () =>
      (snapshot?.entries ?? [])
        .filter((e) => e.status !== 'missed' && e.lat != null && e.lng != null)
        .map((e) => ({
          id: e.playerId,
          name: players.get(e.playerId)?.name ?? 'Runner',
          lat: e.lat!,
          lng: e.lng!,
          accuracyM: e.accuracyM ?? 0,
          fixAt: e.fixAt ?? snapshot!.revealedAt,
          seq: snapshot!.seq,
          kind: e.status === 'stale' ? 'stale' : 'ok',
        })),
    [snapshot, players],
  );

  const winner = game.winner ?? 'none';
  const headline = winner === 'runners' ? 'Runners win' : winner === 'hunters' ? 'Hunters win' : 'Game over';
  const tone = winner === 'runners' ? 'text-runner' : winner === 'hunters' ? 'text-hunter' : 'text-fg';
  const keyEvents = view.events.filter((e) => ['game_started', 'headstart_ended', 'runner_captured', 'runner_released', 'emergency_stop', 'game_ended', 'announcement'].includes(e.type));

  return (
    <div className="h-full overflow-y-auto">
      <div className="safe-top safe-x mx-auto max-w-lg space-y-5 pb-10">
        <motion.header initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }} className="relative overflow-hidden rounded-3xl border border-line bg-surface p-6 text-center">
          <div className="grid-bg absolute inset-0 opacity-50 [mask-image:radial-gradient(circle_at_center,black,transparent_70%)]" aria-hidden />
          <div className="relative">
            <div className={cn('mx-auto grid size-16 place-items-center rounded-2xl', winner === 'runners' ? 'bg-runner/15' : winner === 'hunters' ? 'bg-hunter/15' : 'bg-surface-3')}>
              {winner === 'runners' ? <Footprints className={cn('size-9', tone)} /> : winner === 'hunters' ? <Crosshair className={cn('size-9', tone)} /> : <Trophy className="size-9 text-muted" />}
            </div>
            <h1 className={cn('mt-4 font-display text-4xl font-bold tracking-tight uppercase', tone)} data-testid="winner">
              {headline}
            </h1>
            <p className="mt-2 text-muted">{game.endReason}</p>
          </div>
        </motion.header>

        <div className="grid grid-cols-2 gap-3">
          <Stat icon={<Clock className="size-4" />} label="Played" value={formatDuration(played)} />
          <Stat icon={<Radar className="size-4" />} label="Pings" value={String(game.pingCount)} />
          <Stat icon={<Crosshair className="size-4" />} label="Captures" value={String(confirmed.length)} />
          <Stat icon={<Footprints className="size-4" />} label="Escaped" value={`${survivors.length}/${runners.length}`} />
        </div>

        {/* Replay */}
        <Card className="space-y-3 p-3">
          <div className="flex items-center justify-between px-1">
            <p className="label">Ping replay</p>
            {snapshot && <span className="text-xs text-muted">Ping #{snapshot.seq} at {formatDuration(snapshot.elapsedMs)}</span>}
          </div>
          {game.locationsPurged ? (
            <p className="flex items-center gap-2 rounded-xl bg-surface-2 p-4 text-sm text-muted">
              <Trash2 className="size-4" /> Location data from this game has been deleted.
            </p>
          ) : view.history.length === 0 ? (
            <p className="rounded-xl bg-surface-2 p-4 text-sm text-muted">No pings happened in this game.</p>
          ) : (
            <>
              <div className="relative h-72 overflow-hidden rounded-xl">
                <GameMap className="absolute inset-0" boundary={game.boundary} pings={pings} captures={toCaptureMarkers(view, players)} now={snapshot?.revealedAt ?? Date.now()} styleKey={mapStyle} />
              </div>
              {view.history.length > 1 && <Slider label="Ping" min={1} max={view.history.length} value={seq} onChange={setSeq} format={(v) => `#${v}`} />}
              {snapshot && snapshot.entries.some((e) => e.status === 'missed') && (
                <p className="px-1 text-xs text-muted">
                  Missed:{' '}
                  {snapshot.entries
                    .filter((e) => e.status === 'missed')
                    .map((e) => players.get(e.playerId)?.name)
                    .join(', ')}
                </p>
              )}
            </>
          )}
          {game.locationsPurgeAt && !game.locationsPurged && (
            <p className="flex items-center gap-1.5 px-1 text-xs text-faint">
              <ShieldCheck className="size-3.5" /> Locations are deleted automatically at{' '}
              {new Date(game.locationsPurgeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
            </p>
          )}
        </Card>

        <Card className="space-y-3">
          <p className="label">Runners</p>
          <ul className="space-y-2">
            {runners.map((r) => {
              const c = confirmed.find((x) => x.runnerId === r.id);
              return (
                <li key={r.id} className="flex items-center gap-3">
                  <TeamGlyph team="runner" />
                  <span className="flex-1 font-medium">{r.name}</span>
                  <span className={cn('text-sm', r.status === 'active' ? 'text-ok' : 'text-muted')}>
                    {r.status === 'active'
                      ? 'Escaped'
                      : r.status === 'captured'
                        ? `Caught${c?.hunterId ? ` by ${players.get(c.hunterId)?.name}` : ''}${capturedAt(view, r.id)}`
                        : 'Left'}
                  </span>
                </li>
              );
            })}
          </ul>
          {topHunter && (
            <p className="border-t border-line pt-3 text-sm text-muted">
              Top hunter: <span className="font-semibold text-hunter">{players.get(topHunter[0])?.name}</span> with {topHunter[1]} capture{topHunter[1] === 1 ? '' : 's'}
            </p>
          )}
        </Card>

        <Card className="space-y-2">
          <p className="label">Timeline</p>
          <ol className="space-y-1.5 text-sm">
            {keyEvents.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="w-12 shrink-0 font-mono text-xs text-faint tabular">{formatDuration(e.elapsedMs)}</span>
                <span>{e.text}</span>
              </li>
            ))}
          </ol>
        </Card>

        <div className="space-y-2">
          {view.me.isHost ? (
            <Button variant="primary" size="lg" block onClick={() => send({ type: 'host.rematch' })}>
              <RotateCcw className="size-5" /> Rematch (same players)
            </Button>
          ) : (
            <p className="text-center text-sm text-muted">The host can start a rematch. Stay here to join it.</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" onClick={() => navigate('/')}>
              <Home className="size-5" /> Home
            </Button>
            <Button size="lg" variant="outline" onClick={() => setLeave(true)}>
              Leave game
            </Button>
          </div>
        </div>
      </div>
      <LeaveSheet open={leave} onClose={() => setLeave(false)} gameId={game.id} />
    </div>
  );
}

function capturedAt(view: GameView, runnerId: string) {
  const e = [...view.events].reverse().find((x) => x.type === 'runner_captured' && x.targetId === runnerId);
  return e ? ` at ${formatDuration(e.elapsedMs)}` : '';
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="label flex items-center gap-1.5">
        {icon} {label}
      </p>
      <p className="mt-1 font-mono text-2xl font-bold tabular">{value}</p>
    </div>
  );
}
