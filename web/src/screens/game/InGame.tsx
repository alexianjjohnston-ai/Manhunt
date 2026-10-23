import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronUp,
  Crosshair,
  Layers,
  LocateFixed,
  Menu,
  Pause,
  Radar,
  ShieldAlert,
  Siren,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { formatAge, formatDuration } from '@shared/clock';
import { boundaryStatus, distanceToEdgeM } from '@shared/geo';
import type { GameView, PlayerView } from '@shared/protocol';
import { GameMap, type GameMapHandle } from '@/components/map/GameMap';
import { Toasts } from '@/components/Toasts';
import { demoSpeed, WALK_MPS } from '@/demo/speed';
import { Button, HoldButton, Pill, TeamBadge, TeamGlyph } from '@/components/ui';
import { cue } from '@/lib/feedback';
import { useGame } from '@/lib/game';
import { useLocation } from '@/lib/location';
import { usePrefs, type MapStyleKey } from '@/lib/prefs';
import { useServerNow } from '@/lib/time';
import { cn, formatDistance } from '@/lib/utils';
import { CaptureSheet, IncomingCapture, PendingCaptureCard, TagCodeCard } from './CaptureFlows';
import { clockInfo, playerMap, toCaptureMarkers, toMateMarkers, toPingMarkers, type ClockInfo } from './derived';
import { DrivingGuard } from './DrivingGuard';
import { GameMenu } from './GameMenu';
import { HostDashboard } from './HostDashboard';

const STYLES: MapStyleKey[] = ['dark', 'daylight', 'satellite'];
const DemoMapHint = __DEMO__ ? lazy(() => import('@/demo/DemoPanels').then((m) => ({ default: m.DemoMapHint }))) : null;

export function InGame({ view }: { view: GameView }) {
  const now = useServerNow(500);
  const mapRef = useRef<GameMapHandle>(null);
  const prefs = usePrefs();
  const fix = useLocation((s) => s.fix);
  const paused = useLocation((s) => s.paused);
  const revealPulse = useGame((s) => s.revealPulse);
  const pingRequestAt = useGame((s) => s.pingRequestAt);
  const [panelOpen, setPanelOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [hostOpen, setHostOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [labelNow, setLabelNow] = useState(now);

  const { me, game } = view;
  const players = useMemo(() => playerMap(view), [view]);
  const clock = clockInfo(view, now);
  const role: 'runner' | 'hunter' | 'out' =
    me.status !== 'active' || me.team === 'spectator' || me.team == null ? 'out' : me.team;

  // Marker labels refresh every 5 s (cheaper than every frame).
  useEffect(() => {
    if (Math.abs(now - labelNow) > 5000) setLabelNow(now);
  }, [now, labelNow]);

  const pings = useMemo(() => toPingMarkers(view.runnerMarkers, players), [view.runnerMarkers, players]);
  const mates = useMemo(() => toMateMarkers(view, players), [view, players]);
  const captures = useMemo(() => toCaptureMarkers(view, players), [view, players]);
  const selfStale = fix ? Date.now() - fix.timestamp > 60_000 : true;
  // Memoised so the map only re-renders layers when the fix actually changes.
  const self = useMemo(
    () => (fix && !paused ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, heading: fix.heading, stale: selfStale } : null),
    [fix, paused, selfStale],
  );
  const bStatus = self ? boundaryStatus(self, game.boundary) : 'none';

  // Radar sweep on reveal.
  const [sweep, setSweep] = useState(0);
  useEffect(() => {
    if (revealPulse) setSweep((s) => s + 1);
  }, [revealPulse]);

  // Boundary warning haptics (once per excursion).
  const wasOut = useRef(false);
  useEffect(() => {
    const out = bStatus === 'outside';
    if (out && !wasOut.current) cue('alert');
    wasOut.current = out;
  }, [bStatus]);

  const bottomInset = panelOpen ? 380 : 168;

  return (
    <div className="fixed inset-0 overflow-hidden bg-bg">
      <GameMap
        ref={mapRef}
        className="absolute inset-0"
        boundary={game.boundary}
        self={self}
        mates={mates}
        pings={pings}
        captures={captures}
        now={labelNow}
        pulseKey={revealPulse}
        styleKey={prefs.mapStyle}
        bottomInset={bottomInset}
        topInset={110}
        onMapClick={__DEMO__ ? (p) => useLocation.getState().setSimTarget(p, WALK_MPS * demoSpeed.value) : undefined}
      />

      <AnimatePresence>
        {sweep > 0 && (
          <motion.div
            key={sweep}
            className="pointer-events-none absolute top-1/2 left-1/2 z-10 aspect-square w-[220vmax] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-runner"
            initial={{ scale: 0, opacity: 0.8 }}
            animate={{ scale: 1, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.6, ease: 'easeOut' }}
            onAnimationComplete={() => setSweep(0)}
          />
        )}
      </AnimatePresence>

      {/* ---------------- Top HUD ---------------- */}
      <div className="safe-top safe-x pointer-events-none absolute inset-x-0 top-0 z-20 space-y-2">
        <div className="pointer-events-auto glass flex items-center gap-3 rounded-2xl border border-line px-3 py-2.5">
          <RoleChip view={view} />
          <div className="min-w-0 flex-1 text-center">
            <p className="label !text-[0.6rem]">{clock.paused ? 'Paused' : 'Time left'}</p>
            <p className={cn('font-mono text-[1.75rem] leading-none font-bold tabular', clock.remaining < 5 * 60_000 && 'text-signal', clock.paused && 'text-muted')} data-testid="game-timer">
              {formatDuration(clock.remaining)}
            </p>
          </div>
          <StatusChip view={view} />
        </div>
        <PingBar clock={clock} view={view} pingRequestAt={pingRequestAt} now={now} />
        <Banners view={view} bStatus={bStatus} distEdge={self && game.boundary ? distanceToEdgeM(self, game.boundary) : null} selfStale={!!fix && selfStale} />
        {DemoMapHint && (
          <Suspense fallback={null}>
            <DemoMapHint />
          </Suspense>
        )}
        <Toasts inline />
      </div>

      {/* ---------------- Right rail ---------------- */}
      <div className="absolute right-3 z-20 flex flex-col gap-2" style={{ bottom: bottomInset + 12 }}>
        <Button variant="glass" size="iconLg" aria-label="Center on me" onClick={() => mapRef.current?.recenter()}>
          <LocateFixed className="size-5" />
        </Button>
        <Button
          variant="glass"
          size="iconLg"
          aria-label={`Map style: ${prefs.mapStyle}. Tap to change`}
          onClick={() => prefs.set({ mapStyle: STYLES[(STYLES.indexOf(prefs.mapStyle) + 1) % STYLES.length]! })}
        >
          <Layers className="size-5" />
        </Button>
      </div>
      <div className="absolute left-3 z-20 flex flex-col gap-2" style={{ bottom: bottomInset + 12 }}>
        <Button variant="glass" size="iconLg" aria-label="Menu" onClick={() => setMenuOpen(true)}>
          <Menu className="size-5" />
        </Button>
        {me.isHost && (
          <Button variant="glass" size="iconLg" aria-label="Host dashboard" onClick={() => setHostOpen(true)} className="relative">
            <ShieldAlert className="size-5 text-warn" />
            {view.captures.some((c) => c.status === 'pending' || c.status === 'disputed') && <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-signal" />}
          </Button>
        )}
      </div>

      {/* ---------------- Bottom panel ---------------- */}
      <motion.section
        className="safe-bottom absolute inset-x-0 bottom-0 z-30 rounded-t-3xl border-t border-line-strong bg-surface/95 backdrop-blur-xl"
        animate={{ height: bottomInset + 0 }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}
        aria-label="Game panel"
      >
        <button type="button" className="flex w-full items-center justify-center pt-2 pb-1" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen} aria-label={panelOpen ? 'Collapse panel' : 'Expand panel'}>
          <span className="h-1.5 w-10 rounded-full bg-line-strong" />
        </button>
        <div className="mx-auto h-[calc(100%-1.25rem)] max-w-lg overflow-y-auto px-4">
          {role === 'hunter' && (
            <HunterPanel view={view} players={players} now={labelNow} expanded={panelOpen} onExpand={() => setPanelOpen(true)} onCapture={() => setCaptureOpen(true)} onFocus={(p) => mapRef.current?.flyTo(p)} />
          )}
          {role === 'runner' && <RunnerPanel view={view} now={labelNow} expanded={panelOpen} onExpand={() => setPanelOpen(true)} />}
          {role === 'out' && <SpectatorPanel view={view} now={labelNow} expanded={panelOpen} onExpand={() => setPanelOpen(true)} />}
        </div>
      </motion.section>

      <PauseOverlay view={view} onHost={() => setHostOpen(true)} />
      {role === 'runner' && <IncomingCapture view={view} />}
      {role === 'hunter' && <DrivingGuard />}
      {role === 'hunter' && <CaptureSheet view={view} open={captureOpen} onClose={() => setCaptureOpen(false)} />}
      {me.isHost && <HostDashboard view={view} open={hostOpen} onClose={() => setHostOpen(false)} />}
      <GameMenu view={view} open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// HUD pieces
// ---------------------------------------------------------------------------

function RoleChip({ view }: { view: GameView }) {
  const { me } = view;
  if (me.status === 'captured') return <Pill tone="signal" className="shrink-0">Captured</Pill>;
  return <TeamBadge team={me.team} size="sm" className="shrink-0" />;
}

function StatusChip({ view }: { view: GameView }) {
  const conn = useGame((s) => s.status);
  const fix = useLocation((s) => s.fix);
  const paused = useLocation((s) => s.paused);
  const permission = useLocation((s) => s.permission);
  const simulated = useLocation((s) => s.simulated);
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 5000);
    return () => window.clearInterval(id);
  }, []);
  const sharing = view.me.shareLocation;
  const age = fix ? Date.now() - fix.timestamp : null;
  let tone: 'ok' | 'warn' | 'danger' = 'ok';
  let gps = 'GPS';
  if (!sharing) {
    gps = 'Off';
    tone = 'warn';
  } else if (paused) {
    gps = 'Paused';
    tone = 'danger';
  } else if (permission === 'denied') {
    gps = 'Denied';
    tone = 'danger';
  } else if (age == null) {
    gps = 'Finding';
    tone = 'warn';
  } else if (age > 60_000) {
    gps = formatAge(age).replace(' ago', '');
    tone = 'warn';
  } else {
    gps = `±${Math.round(fix!.accuracy)}m`;
  }
  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5 text-[0.7rem] font-semibold" data-testid="status-chip">
      <span className={cn('inline-flex items-center gap-1', conn === 'online' ? 'text-ok' : 'text-danger')}>
        {conn === 'online' ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
        {conn === 'online' ? 'Live' : 'Offline'}
      </span>
      <span className={cn('inline-flex items-center gap-1', tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-danger')}>
        <LocateFixed className="size-3.5" />
        {simulated ? 'SIM ' : ''}
        {gps}
      </span>
    </div>
  );
}

function PingBar({ clock, view, pingRequestAt, now }: { clock: ClockInfo; view: GameView; pingRequestAt: number | null; now: number }) {
  const isRunner = view.me.team === 'runner' && view.me.status === 'active';
  const incoming = pingRequestAt != null && pingRequestAt > now;
  if (clock.phase === 'headstart') {
    return (
      <div className="pointer-events-auto glass flex items-center gap-3 rounded-2xl border border-warn/40 px-4 py-2.5" data-testid="headstart-bar">
        <Crosshair className="size-5 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{view.me.team === 'hunter' ? 'Hold position. Runners are hiding.' : 'Head start. Get moving!'}</p>
          <p className="text-xs text-muted">Hunters released in</p>
        </div>
        <span className="font-mono text-xl font-bold text-warn tabular">{formatDuration(clock.headStartLeft)}</span>
      </div>
    );
  }
  if (clock.nextPingIn == null) {
    return (
      <div className="pointer-events-auto glass flex items-center gap-3 rounded-2xl border border-line px-4 py-2.5">
        <Radar className="size-5 text-muted" />
        <p className="text-sm text-muted">No more pings before the end.</p>
      </div>
    );
  }
  return (
    <div
      className={cn('pointer-events-auto glass relative flex items-center gap-3 overflow-hidden rounded-2xl border px-4 py-2.5', incoming ? 'border-runner' : 'border-line')}
      data-testid="ping-bar"
    >
      <div className="absolute inset-y-0 left-0 bg-runner/10" style={{ width: `${clock.pingProgress * 100}%` }} aria-hidden />
      <Radar className={cn('relative size-5 shrink-0 text-runner', incoming && 'animate-pulse')} />
      <div className="relative min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {incoming
            ? isRunner
              ? 'Ping incoming. Keep MANHUNT open!'
              : 'Ping incoming…'
            : `Next ping${view.game.pingCount ? ` (#${view.game.pingCount + 1})` : ''}`}
        </p>
        <p className="text-xs text-muted">{isRunner ? 'Hunters will see where you are' : view.me.team === 'hunter' ? 'All runners revealed at once' : 'Runner locations revealed to hunters'}</p>
      </div>
      <span className="relative font-mono text-xl font-bold text-runner tabular" data-testid="ping-countdown">
        {formatDuration(clock.nextPingIn)}
      </span>
    </div>
  );
}

function Banners({ view, bStatus, distEdge, selfStale }: { view: GameView; bStatus: string; distEdge: number | null; selfStale: boolean }) {
  const units = usePrefs((s) => s.units);
  const paused = useLocation((s) => s.paused);
  const setPaused = useLocation((s) => s.setPaused);
  const permission = useLocation((s) => s.permission);
  const sharing = view.me.shareLocation;
  const items: { key: string; tone: 'danger' | 'warn'; text: string; action?: { label: string; run: () => void } }[] = [];
  if (sharing && paused) {
    items.push({ key: 'paused', tone: 'danger', text: view.me.team === 'runner' ? 'Location sharing is paused. Your pings show as missed.' : 'Location sharing is paused.', action: { label: 'Resume', run: () => setPaused(false) } });
  } else if (sharing && permission === 'denied') {
    items.push({ key: 'denied', tone: 'danger', text: 'Location is blocked in your browser settings. Pings will be missed.' });
  } else if (sharing && selfStale) {
    items.push({ key: 'stale', tone: 'warn', text: 'No fresh GPS fix for over a minute. Keep the screen on and the app open.' });
  }
  if (bStatus === 'outside') items.push({ key: 'out', tone: 'danger', text: `You're outside the play area${distEdge != null ? ` (${formatDistance(distEdge, units)} out)` : ''}. Head back in.` });
  else if (bStatus === 'near_edge') items.push({ key: 'edge', tone: 'warn', text: `Near the edge of the play area${distEdge != null ? ` (${formatDistance(distEdge, units)})` : ''}.` });
  return (
    <AnimatePresence initial={false}>
      {items.map((b) => (
        <motion.div
          key={b.key}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className={cn('pointer-events-auto flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold', b.tone === 'danger' ? 'bg-danger text-white' : 'bg-warn text-[#1f1500]')}
          role="status"
        >
          <span className="flex-1">{b.text}</span>
          {b.action && (
            <button type="button" className="rounded-lg bg-black/20 px-2.5 py-1" onClick={b.action.run}>
              {b.action.label}
            </button>
          )}
        </motion.div>
      ))}
    </AnimatePresence>
  );
}

function PauseOverlay({ view, onHost }: { view: GameView; onHost: () => void }) {
  const send = useGame((s) => s.send);
  const em = view.game.emergency;
  if (!view.game.paused) return null;
  const by = em ? view.players.find((p) => p.id === em.byId)?.name : null;
  return (
    <div className={cn('fixed inset-0 z-[55] flex flex-col items-center justify-center gap-5 px-6 text-center backdrop-blur-sm', em ? 'bg-danger/85' : 'bg-bg/85')} role="alert">
      {em ? <Siren className="size-14 animate-pulse text-white" /> : <Pause className="size-14 text-muted" />}
      <div className={em ? 'text-white' : ''}>
        <h2 className="font-display text-3xl font-bold">{em ? 'Emergency stop' : 'Game paused'}</h2>
        <p className={cn('mt-2 text-lg', em ? 'text-white/90' : 'text-muted')}>
          {em ? `Called by ${by ?? 'a player'}. Location sharing is OFF. Stop, check on each other, and call emergency services if needed.` : 'The clock and pings are frozen.'}
        </p>
      </div>
      {view.me.isHost && (
        <div className="w-full max-w-xs space-y-2">
          <HoldButton variant="primary" onConfirm={() => send({ type: 'host.resume' })}>
            Hold to resume game
          </HoldButton>
          <Button variant="secondary" block onClick={onHost}>
            Host dashboard
          </Button>
        </div>
      )}
      {!view.me.isHost && <p className={cn('text-sm', em ? 'text-white/80' : 'text-faint')}>Only the host can resume.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Role panels
// ---------------------------------------------------------------------------

function PanelPeek({ title, subtitle, onExpand, expanded, right }: { title: React.ReactNode; subtitle?: React.ReactNode; onExpand: () => void; expanded: boolean; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onExpand}>
        <p className="truncate font-semibold">{title}</p>
        {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
      </button>
      {right}
      {!expanded && (
        <button type="button" aria-label="More" onClick={onExpand} className="grid size-9 place-items-center rounded-full text-muted">
          <ChevronUp className="size-5" />
        </button>
      )}
    </div>
  );
}

function HunterPanel({
  view,
  players,
  now,
  expanded,
  onExpand,
  onCapture,
  onFocus,
}: {
  view: GameView;
  players: Map<string, PlayerView>;
  now: number;
  expanded: boolean;
  onExpand: () => void;
  onCapture: () => void;
  onFocus: (p: { lat: number; lng: number }) => void;
}) {
  const runners = view.players.filter((p) => p.team === 'runner' && p.status !== 'kicked');
  const free = runners.filter((r) => r.status === 'active');
  const markers = new Map(view.runnerMarkers.map((m) => [m.playerId, m]));
  const huntingPhase = view.game.phase === 'hunting' && !view.game.paused;
  return (
    <div className="space-y-3 pb-3">
      <PanelPeek
        expanded={expanded}
        onExpand={onExpand}
        title={`${free.length} of ${runners.length} runners free`}
        subtitle={view.game.pingCount ? `Last ping #${view.game.pingCount}` : 'No pings yet'}
        right={
          <Button variant="primary" size="lg" onClick={onCapture} disabled={!huntingPhase || free.length === 0} data-testid="capture-button">
            <Crosshair className="size-5" /> Capture
          </Button>
        }
      />
      <PendingCaptureCard view={view} players={players} />
      <ul className="space-y-1.5" aria-label="Runners">
        {runners.map((r) => {
          const m = markers.get(r.id);
          const pos = m?.lat != null ? { lat: m.lat, lng: m.lng! } : m?.lastKnown;
          let status: React.ReactNode = <span className="text-muted">Not revealed yet</span>;
          if (r.status === 'captured') status = <span className="text-signal">Captured</span>;
          else if (r.status === 'left') status = <span className="text-muted">Left the game</span>;
          else if (m) {
            if (m.status === 'ok') status = <span className="text-ok">Seen {formatAge(now - (m.fixAt ?? m.revealedAt))} · ±{m.accuracyM} m</span>;
            else if (m.status === 'stale') status = <span className="text-warn">Stale fix: {formatAge(now - (m.fixAt ?? m.revealedAt))}</span>;
            else status = (
              <span className="text-danger">
                Missed ping #{m.seq}
                {m.lastKnown ? ` · last seen ${formatAge(now - m.lastKnown.fixAt)}` : ''}
              </span>
            );
          }
          return (
            <li key={r.id}>
              <button
                type="button"
                disabled={!pos}
                onClick={() => pos && onFocus(pos)}
                className={cn('flex w-full items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-left disabled:opacity-80', r.status !== 'active' && 'opacity-60')}
              >
                <TeamGlyph team="runner" />
                <span className={cn('flex-1 truncate font-medium', r.status === 'captured' && 'line-through')}>{r.name}</span>
                <span className="text-right text-xs">{status}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-center text-xs text-faint">Markers stay where runners were at the last ping. They do not move between pings.</p>
    </div>
  );
}

function RunnerPanel({ view, now, expanded, onExpand }: { view: GameView; now: number; expanded: boolean; onExpand: () => void }) {
  const mine = view.runnerMarkers.find((m) => m.playerId === view.me.id);
  const team = view.players.filter((p) => p.team === 'runner' && p.id !== view.me.id && p.status !== 'kicked');
  const serverAge = view.me.lastFixAt != null ? now - view.me.lastFixAt : null;
  const last = mine
    ? mine.status === 'missed'
      ? `Ping #${mine.seq} missed you (${mine.reason ?? 'no GPS'})`
      : `Hunters saw you ${formatAge(now - (mine.fixAt ?? mine.revealedAt))} (ping #${mine.seq})`
    : 'Hunters have not seen you yet';
  return (
    <div className="space-y-3 pb-3">
      <PanelPeek
        expanded={expanded}
        onExpand={onExpand}
        title={last}
        subtitle={serverAge == null ? 'Server has no location from you yet' : `Server has your location from ${formatAge(serverAge)}`}
      />
      {view.me.tagCode && <TagCodeCard code={view.me.tagCode} />}
      <div className="rounded-2xl border border-line bg-surface-2 p-3 text-sm">
        <p className="font-semibold">Objective</p>
        <p className="mt-1 text-muted">Stay free until the clock hits zero. On foot only. Stay inside the play area. If you're tagged, confirm it honestly.</p>
      </div>
      {team.length > 0 && (
        <div>
          <p className="label mb-1.5">Your team</p>
          <ul className="space-y-1.5">
            {team.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
                <TeamGlyph team="runner" />
                <span className={cn('flex-1 truncate font-medium', p.status === 'captured' && 'line-through opacity-70')}>{p.name}</span>
                {p.status === 'captured' ? <Pill tone="signal">Captured</Pill> : p.status === 'left' ? <Pill>Left</Pill> : <Pill tone="ok">Free</Pill>}
                {!p.connected && p.status === 'active' && <WifiOff className="size-4 text-faint" aria-label="Offline" />}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-center text-xs text-faint">Hunters never see you live, only at each ping.</p>
    </div>
  );
}

function SpectatorPanel({ view, now, expanded, onExpand }: { view: GameView; now: number; expanded: boolean; onExpand: () => void }) {
  const runners = view.players.filter((p) => p.team === 'runner' && p.status !== 'kicked');
  const free = runners.filter((r) => r.status === 'active').length;
  const captured = view.me.status === 'captured';
  const recent = [...view.events].filter((e) => ['runner_captured', 'ping_revealed', 'announcement', 'headstart_ended', 'game_resumed', 'game_paused'].includes(e.type)).slice(-12).reverse();
  return (
    <div className="space-y-3 pb-3">
      <PanelPeek
        expanded={expanded}
        onExpand={onExpand}
        title={captured ? "You've been captured" : 'Spectating'}
        subtitle={`${free} of ${runners.length} runners still free`}
      />
      <div className="rounded-2xl border border-line bg-surface-2 p-3 text-sm text-muted">
        {captured
          ? 'Your location is no longer shared. To keep it fair, captured players see no locations until the game ends. Please don\'t pass information to anyone still playing.'
          : 'Spectators see the clock and captures, not locations. The full map replay unlocks at the end.'}
      </div>
      <ol className="space-y-1.5 text-sm">
        {recent.map((e) => (
          <li key={e.id} className="flex gap-2">
            <span className="w-16 shrink-0 text-xs text-faint">{formatAge(now - e.at)}</span>
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
