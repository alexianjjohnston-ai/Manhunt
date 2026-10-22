import { AlertTriangle, Crown, Megaphone, Pause, Play, Send, Settings2, Square, UserX, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { formatAge } from '@shared/clock';
import type { GameView, PlayerView } from '@shared/protocol';
import { Button, HoldButton, Input, Pill, Segmented, Sheet, TeamGlyph } from '@/components/ui';
import { useGame } from '@/lib/game';
import { useServerNow } from '@/lib/time';
import { cn } from '@/lib/utils';
import { HostSettingsSheet } from './HostSettingsSheet';

type Tab = 'controls' | 'players' | 'captures' | 'log';

/** Host dashboard. Every action is re-checked by the server; this UI only issues requests. */
export function HostDashboard({ view, open, onClose }: { view: GameView; open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('controls');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openCaptures = view.captures.filter((c) => c.status === 'pending' || c.status === 'disputed');
  return (
    <>
      <Sheet open={open && !settingsOpen} onClose={onClose} title="Host dashboard" tall>
        <Segmented
          size="sm"
          className="sticky top-0 z-10 mb-4"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'controls', label: 'Controls' },
            { value: 'players', label: 'Players' },
            { value: 'captures', label: `Captures${openCaptures.length ? ` (${openCaptures.length})` : ''}` },
            { value: 'log', label: 'Log' },
          ]}
        />
        {tab === 'controls' && <Controls view={view} onSettings={() => setSettingsOpen(true)} onDone={onClose} />}
        {tab === 'players' && <Players view={view} />}
        {tab === 'captures' && <Captures view={view} />}
        {tab === 'log' && <Log view={view} />}
      </Sheet>
      <HostSettingsSheet view={view} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

function Controls({ view, onSettings, onDone }: { view: GameView; onSettings: () => void; onDone: () => void }) {
  const send = useGame((s) => s.send);
  const [text, setText] = useState('');
  const [winner, setWinner] = useState<'none' | 'runners' | 'hunters'>('none');
  const paused = view.game.paused;
  return (
    <div className="space-y-5 pb-4">
      {view.game.emergency && (
        <div className="rounded-2xl border border-danger/50 bg-danger/10 p-4 text-sm">
          <p className="font-semibold text-danger">Emergency stop is active</p>
          <p className="mt-1 text-muted">Make sure everyone is safe before resuming. Resuming turns location sharing back on.</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {paused ? (
          <Button variant="primary" size="lg" onClick={() => send({ type: 'host.resume' })}>
            <Play className="size-5" /> Resume
          </Button>
        ) : (
          <Button size="lg" onClick={() => send({ type: 'host.pause' })}>
            <Pause className="size-5" /> Pause
          </Button>
        )}
        <Button size="lg" onClick={onSettings}>
          <Settings2 className="size-5" /> Adjust
        </Button>
      </div>

      <div className="space-y-2">
        <p className="label">Announcement</p>
        <div className="flex gap-2">
          <Input value={text} maxLength={140} onChange={(e) => setText(e.target.value)} placeholder="e.g. 10 minutes left!" className="h-11" />
          <Button
            variant="primary"
            size="icon"
            aria-label="Send announcement"
            disabled={!text.trim()}
            onClick={() => {
              send({ type: 'host.announce', text });
              setText('');
            }}
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-2 rounded-2xl border border-line p-3">
        <p className="label">End game</p>
        <Segmented
          size="sm"
          value={winner}
          onChange={setWinner}
          options={[
            { value: 'none', label: 'No winner' },
            { value: 'runners', label: 'Runners win' },
            { value: 'hunters', label: 'Hunters win' },
          ]}
        />
        <HoldButton
          onConfirm={() => {
            send({ type: 'host.end', winner });
            onDone();
          }}
        >
          <Square className="size-4" /> Hold to end game
        </HoldButton>
      </div>
    </div>
  );
}

function Players({ view }: { view: GameView }) {
  const send = useGame((s) => s.send);
  const now = useServerNow(2000);
  const [sel, setSel] = useState<string | null>(null);
  const present = view.players.filter((p) => p.status !== 'left');
  return (
    <ul className="space-y-2 pb-4">
      {present.map((p) => (
        <li key={p.id} className="rounded-2xl border border-line bg-surface-2">
          <button type="button" className="flex w-full items-center gap-3 px-3 py-3 text-left" onClick={() => setSel(sel === p.id ? null : p.id)}>
            <TeamGlyph team={p.team} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate font-semibold">
                {p.name} {p.isHost && <Crown className="size-3.5 text-warn" />}
              </p>
              <HealthLine p={p} now={now} />
            </div>
            {p.status === 'captured' && <Pill tone="signal">Captured</Pill>}
            {p.connected ? <Wifi className="size-4 text-ok" aria-label="Online" /> : <WifiOff className="size-4 text-danger" aria-label="Offline" />}
          </button>
          {p.health?.warnings.length ? (
            <div className="space-y-1 px-3 pb-2">
              {p.health.warnings.map((w) => (
                <p key={w} className="flex items-start gap-1.5 text-xs text-warn">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {w}
                </p>
              ))}
            </div>
          ) : null}
          {sel === p.id && (
            <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
              {p.team === 'runner' && p.status === 'active' && (
                <Button size="sm" variant="outline" onClick={() => send({ type: 'host.setCaptured', playerId: p.id, captured: true })}>
                  Mark captured
                </Button>
              )}
              {p.team === 'runner' && p.status === 'captured' && (
                <Button size="sm" variant="outline" onClick={() => send({ type: 'host.setCaptured', playerId: p.id, captured: false })}>
                  Release
                </Button>
              )}
              {!p.isHost && (
                <Button size="sm" variant="outline" onClick={() => send({ type: 'host.transferHost', playerId: p.id })}>
                  <Crown className="size-4" /> Make host
                </Button>
              )}
              {!p.isHost && (
                <div className="col-span-2">
                  <HoldButton size="md" onConfirm={() => send({ type: 'host.kick', playerId: p.id })}>
                    <UserX className="size-4" /> Hold to remove
                  </HoldButton>
                </div>
              )}
            </div>
          )}
        </li>
      ))}
      <p className="pt-1 text-center text-xs text-faint">GPS health is shown without coordinates. Warnings are hints, not proof of cheating.</p>
    </ul>
  );
}

function HealthLine({ p, now }: { p: PlayerView; now: number }) {
  const h = p.health;
  if (!h || p.team === 'spectator') return <p className="text-xs text-muted">{p.team === 'spectator' ? 'Spectator' : ''}</p>;
  const age = h.lastFixAt != null ? now - h.lastFixAt : null;
  const gpsText =
    h.gps === 'denied'
      ? 'GPS denied'
      : h.gps === 'off'
        ? 'Sharing paused'
        : h.gps === 'unavailable'
          ? 'GPS unavailable'
          : age != null
            ? `GPS ${formatAge(age)} · ±${h.accuracyM} m`
            : 'No GPS yet';
  const bad = h.gps !== 'ok' || age == null || age > 120_000;
  return (
    <p className={cn('text-xs', bad ? 'text-warn' : 'text-muted')}>
      {gpsText}
      {!p.connected && ` · last seen ${formatAge(now - h.lastSeenAt)}`}
    </p>
  );
}

function Captures({ view }: { view: GameView }) {
  const send = useGame((s) => s.send);
  const now = useServerNow(2000);
  const name = (id: string | null) => view.players.find((p) => p.id === id)?.name ?? (id ? 'Unknown' : 'Host');
  const open = view.captures.filter((c) => c.status === 'pending' || c.status === 'disputed');
  const done = view.captures.filter((c) => c.status === 'confirmed').sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
  return (
    <div className="space-y-4 pb-4">
      {open.length === 0 && <p className="text-muted">No captures waiting for a decision.</p>}
      {open.map((c) => (
        <div key={c.id} className={cn('space-y-3 rounded-2xl border p-4', c.status === 'disputed' ? 'border-warn/50 bg-warn/10' : 'border-line bg-surface-2')}>
          <p>
            <span className="font-semibold text-hunter">{name(c.hunterId)}</span> → <span className="font-semibold text-runner">{name(c.runnerId)}</span>
          </p>
          <p className="text-sm text-muted">{c.status === 'disputed' ? 'Runner disputes this capture.' : 'Awaiting confirmation.'} {formatAge(now - c.createdAt)}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="primary" onClick={() => send({ type: 'host.resolveCapture', captureId: c.id, confirm: true })}>
              Confirm capture
            </Button>
            <Button onClick={() => send({ type: 'host.resolveCapture', captureId: c.id, confirm: false })}>Reject</Button>
          </div>
        </div>
      ))}
      {done.length > 0 && (
        <div className="space-y-2">
          <p className="label">Confirmed</p>
          {done.map((c) => (
            <p key={c.id} className="text-sm">
              <span className="font-semibold">{name(c.runnerId)}</span> <span className="text-muted">by {name(c.hunterId)} · {formatAge(now - (c.resolvedAt ?? c.createdAt))}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Log({ view }: { view: GameView }) {
  const events = [...view.events].reverse();
  return (
    <ol className="space-y-2 pb-4">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3 text-sm">
          <span className="w-12 shrink-0 font-mono text-xs text-faint tabular">
            {String(Math.floor(e.elapsedMs / 60000)).padStart(2, '0')}:{String(Math.floor((e.elapsedMs % 60000) / 1000)).padStart(2, '0')}
          </span>
          <span className={cn(e.visibility === 'host' && 'text-warn', e.type === 'announcement' && 'text-hunter')}>
            {e.type === 'announcement' && <Megaphone className="mr-1 inline size-3.5" />}
            {e.text}
          </span>
        </li>
      ))}
    </ol>
  );
}
