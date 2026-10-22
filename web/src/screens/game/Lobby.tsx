import { motion } from 'motion/react';
import {
  Check,
  Copy,
  Crown,
  LocateFixed,
  LogOut,
  MapPinOff,
  QrCode as QrIcon,
  Settings2,
  Share2,
  Shuffle,
  Sliders,
  UserX,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { teamTargets } from '@shared/teams';
import type { GameView, PlayerView } from '@shared/protocol';
import type { Team } from '@shared/types';
import { BROWSER_LIMITS } from '@/content';
import { QrCode } from '@/components/QrCode';
import { Button, Card, HoldButton, Pill, Sheet, TeamBadge, TeamGlyph, TeamIcon } from '@/components/ui';
import { useGame } from '@/lib/game';
import { useLocation } from '@/lib/location';
import { navigate } from '@/lib/router';
import { sessions } from '@/lib/sessions';
import { cn, inviteUrl } from '@/lib/utils';
import { HostSettingsSheet } from './HostSettingsSheet';

export function Lobby({ view }: { view: GameView }) {
  const send = useGame((s) => s.send);
  const { game, me, players } = view;
  const [inviteOpen, setInviteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState<PlayerView | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const present = players.filter((p) => p.status === 'active');
  const competitors = present.filter((p) => p.team !== 'spectator');
  const runners = competitors.filter((p) => p.team === 'runner');
  const hunters = competitors.filter((p) => p.team === 'hunter');
  const unassigned = competitors.filter((p) => p.team == null);
  const spectators = present.filter((p) => p.team === 'spectator');
  const targets = teamTargets(competitors.length, game.settings.extraPlayerTeam);
  const isSpectator = me.team === 'spectator';

  const blockers = useMemo(() => {
    const out: { text: string; ready: boolean }[] = [];
    if (unassigned.length) out.push({ text: `${unassigned.length} player${unassigned.length > 1 ? 's' : ''} without a team`, ready: false });
    if (!runners.length && game.settings.teamAssignment === 'manual') out.push({ text: 'Need at least one runner', ready: false });
    if (!hunters.length && game.settings.teamAssignment === 'manual') out.push({ text: 'Need at least one hunter', ready: false });
    if (competitors.length < 2) out.push({ text: 'Need at least 2 players', ready: false });
    const unsafe = present.filter((p) => !p.safetyAck);
    if (unsafe.length) out.push({ text: `Waiting for safety confirmation: ${unsafe.map((p) => p.name).join(', ')}`, ready: false });
    const notReady = competitors.filter((p) => !p.isHost && !p.ready);
    if (notReady.length) out.push({ text: `Not ready: ${notReady.map((p) => p.name).join(', ')}`, ready: true });
    return out;
  }, [unassigned, runners, hunters, competitors, present, game.settings.teamAssignment]);
  const hardBlocked = blockers.some((b) => !b.ready);

  return (
    <div className="flex h-full flex-col">
      <header className="safe-top safe-x border-b border-line bg-bg/90 pb-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="label">Lobby</p>
            <h1 className="truncate font-display text-2xl font-bold">{game.name}</h1>
          </div>
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-line-strong bg-surface-2 px-3 py-2"
            aria-label={`Invite players. Code ${game.code}`}
          >
            <span className="font-mono text-lg font-bold tracking-[0.2em]" data-testid="join-code">
              {game.code}
            </span>
            <Share2 className="size-4 text-muted" />
          </button>
        </div>
      </header>

      <main className="safe-x mx-auto w-full max-w-lg flex-1 space-y-5 overflow-y-auto py-5">
        {!isSpectator && <LocationOnboarding />}

        {/* Me */}
        <Card className="flex items-center gap-4">
          <div className={cn('grid size-14 shrink-0 place-items-center rounded-2xl', me.team === 'runner' ? 'bg-runner/15 text-runner' : me.team === 'hunter' ? 'bg-hunter/15 text-hunter' : 'bg-surface-3 text-muted')}>
            <TeamIcon team={me.team} className="size-7" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted">You are</p>
            <p className="truncate text-lg font-semibold">{me.name}</p>
            <TeamBadge team={me.team} size="sm" className="mt-1" />
          </div>
          {!me.isHost && !isSpectator && (
            <Button
              variant={me.ready ? 'secondary' : 'primary'}
              size="lg"
              onClick={() => send({ type: 'setReady', ready: !me.ready })}
              aria-pressed={me.ready}
              data-testid="ready-button"
            >
              {me.ready ? (
                <>
                  <Check className="size-5 text-ok" /> Ready
                </>
              ) : (
                "I'm ready"
              )}
            </Button>
          )}
        </Card>

        {/* Teams */}
        <section className="space-y-3" aria-label="Teams">
          <div className="flex items-end justify-between">
            <div>
              <p className="label">Teams</p>
              <p className="text-sm text-muted">
                {competitors.length} player{competitors.length === 1 ? '' : 's'} · {targets.runner} runner{targets.runner === 1 ? '' : 's'} vs {targets.hunter} hunter
                {targets.hunter === 1 ? '' : 's'}
                {competitors.length % 2 === 1 && (
                  <span className="font-semibold text-fg"> · extra player goes to {game.settings.extraPlayerTeam === 'hunter' ? 'Hunters' : 'Runners'}</span>
                )}
              </p>
            </div>
            {me.isHost && (
              <Button size="sm" variant="outline" onClick={() => send({ type: 'host.balanceTeams' })}>
                <Shuffle className="size-4" /> Shuffle
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TeamColumn team="runner" players={runners} target={targets.runner} isHost={me.isHost} onSelect={setSelected} meId={me.id} />
            <TeamColumn team="hunter" players={hunters} target={targets.hunter} isHost={me.isHost} onSelect={setSelected} meId={me.id} />
          </div>
          {unassigned.length > 0 && <PlayerList title="Waiting for a team" players={unassigned} isHost={me.isHost} onSelect={setSelected} meId={me.id} />}
          {spectators.length > 0 && <PlayerList title="Spectators" players={spectators} isHost={me.isHost} onSelect={setSelected} meId={me.id} />}
          {me.isHost && <p className="text-center text-xs text-faint">Tap a player to move them, make them host or remove them.</p>}
        </section>

        {/* Rules summary */}
        <Card className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="label">Rules</p>
            {me.isHost && (
              <Button size="sm" variant="ghost" onClick={() => setSettingsOpen(true)}>
                <Sliders className="size-4" /> Edit
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Pill>{game.settings.durationMin} min game</Pill>
            <Pill tone="ice">Ping every {game.settings.pingIntervalSec >= 60 ? `${game.settings.pingIntervalSec / 60} min` : `${game.settings.pingIntervalSec}s`}</Pill>
            <Pill>{game.settings.headStartMin ? `${game.settings.headStartMin} min head start` : 'No head start'}</Pill>
            <Pill>{game.settings.captureMethod === 'runner_confirm' ? 'Runner confirms captures' : 'Host confirms captures'}</Pill>
            {game.settings.tagCodeEnabled && <Pill>Tag codes on</Pill>}
            {game.boundary ? <Pill tone="signal">Play area set</Pill> : <Pill tone="warn">No play area</Pill>}
            {game.hasPassword && <Pill>Password</Pill>}
            {game.settings.lobbyLocked && <Pill tone="warn">Locked</Pill>}
          </div>
        </Card>

        <button type="button" onClick={() => setLeaveOpen(true)} className="mx-auto flex items-center gap-2 py-2 text-sm text-muted hover:text-danger">
          <LogOut className="size-4" /> Leave game
        </button>
      </main>

      <footer className="safe-x safe-bottom border-t border-line bg-bg pt-3">
        <div className="mx-auto max-w-lg space-y-2">
          {me.isHost ? (
            <>
              {blockers.length > 0 && (
                <ul className="space-y-1 text-sm text-muted" data-testid="start-blockers">
                  {blockers.map((b) => (
                    <li key={b.text} className="flex gap-2">
                      <span className={b.ready ? 'text-warn' : 'text-danger'}>•</span> {b.text}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Button variant="secondary" size="lg" aria-label="Game settings" onClick={() => setSettingsOpen(true)}>
                  <Settings2 className="size-5" />
                </Button>
                {hardBlocked || blockers.length === 0 ? (
                  <Button variant="primary" size="lg" block disabled={hardBlocked} onClick={() => send({ type: 'host.start' })} data-testid="start-button">
                    Start game
                  </Button>
                ) : (
                  <HoldButton variant="primary" onConfirm={() => send({ type: 'host.start', force: true })}>
                    Hold to start anyway
                  </HoldButton>
                )}
              </div>
            </>
          ) : (
            <p className="py-2 text-center text-muted">
              Waiting for <span className="font-semibold text-fg">{players.find((p) => p.isHost)?.name ?? 'the host'}</span> to start the game…
            </p>
          )}
        </div>
      </footer>

      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} code={game.code} name={game.name} />
      {me.isHost && <HostSettingsSheet view={view} open={settingsOpen} onClose={() => setSettingsOpen(false)} />}
      {me.isHost && <PlayerActionsSheet player={selected} meId={me.id} onClose={() => setSelected(null)} />}
      <LeaveSheet open={leaveOpen} onClose={() => setLeaveOpen(false)} gameId={game.id} />
    </div>
  );
}

function PlayerRow({ p, isHost, onSelect, meId, compact }: { p: PlayerView; isHost: boolean; onSelect: (p: PlayerView) => void; meId: string; compact?: boolean }) {
  const content = (
    <>
      <span className="relative">
        <TeamGlyph team={p.team} />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">
        {p.name}
        {p.id === meId && <span className="text-muted"> (you)</span>}
      </span>
      {p.isHost && <Crown className="size-4 shrink-0 text-warn" aria-label="Host" />}
      {!p.connected && <WifiOff className="size-3.5 shrink-0 text-faint" aria-label="Offline" />}
      {!compact &&
        (p.isHost || p.team === 'spectator' ? null : p.ready ? (
          <Check className="size-4 shrink-0 text-ok" aria-label="Ready" />
        ) : (
          <span className="size-2 shrink-0 rounded-full bg-faint" aria-label="Not ready" />
        ))}
    </>
  );
  const cls = 'flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm';
  return isHost ? (
    <button type="button" className={cn(cls, 'hover:bg-surface-3')} onClick={() => onSelect(p)}>
      {content}
    </button>
  ) : (
    <div className={cls}>{content}</div>
  );
}

function TeamColumn({ team, players, target, isHost, onSelect, meId }: { team: Team; players: PlayerView[]; target: number; isHost: boolean; onSelect: (p: PlayerView) => void; meId: string }) {
  return (
    <div className={cn('rounded-2xl border bg-surface p-2', team === 'runner' ? 'border-runner/30' : 'border-hunter/30')} data-testid={`team-${team}`}>
      <div className="flex items-center justify-between px-2 pt-1 pb-2">
        <TeamBadge team={team} size="sm" />
        <span className="font-mono text-xs text-muted">
          {players.length}/{target}
        </span>
      </div>
      <div className="min-h-16">
        {players.map((p) => (
          <motion.div key={p.id} layout>
            <PlayerRow p={p} isHost={isHost} onSelect={onSelect} meId={meId} />
          </motion.div>
        ))}
        {players.length === 0 && <p className="px-2.5 py-3 text-xs text-faint">Nobody yet</p>}
      </div>
    </div>
  );
}

function PlayerList({ title, players, isHost, onSelect, meId }: { title: string; players: PlayerView[]; isHost: boolean; onSelect: (p: PlayerView) => void; meId: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-2">
      <p className="label px-2 pt-1 pb-1">{title}</p>
      {players.map((p) => (
        <PlayerRow key={p.id} p={p} isHost={isHost} onSelect={onSelect} meId={meId} />
      ))}
    </div>
  );
}

function PlayerActionsSheet({ player, meId, onClose }: { player: PlayerView | null; meId: string; onClose: () => void }) {
  const send = useGame((s) => s.send);
  const act = (fn: () => void) => {
    fn();
    onClose();
  };
  return (
    <Sheet open={!!player} onClose={onClose} title={player?.name}>
      {player && (
        <div className="space-y-3 pb-3">
          <p className="label">Move to</p>
          <div className="grid grid-cols-3 gap-2">
            {(['runner', 'hunter', 'spectator'] as const).map((t) => (
              <Button key={t} variant={player.team === t ? (t === 'runner' ? 'runner' : t === 'hunter' ? 'hunter' : 'secondary') : 'outline'} onClick={() => act(() => send({ type: 'host.setTeam', playerId: player.id, team: t }))}>
                <TeamIcon team={t} className="size-4" />
                {t === 'runner' ? 'Runners' : t === 'hunter' ? 'Hunters' : 'Watch'}
              </Button>
            ))}
          </div>
          {player.id !== meId && (
            <>
              <Button block onClick={() => act(() => send({ type: 'host.transferHost', playerId: player.id }))}>
                <Crown className="size-4" /> Make host
              </Button>
              <HoldButton onConfirm={() => act(() => send({ type: 'host.kick', playerId: player.id }))}>
                <UserX className="size-4" /> Hold to remove {player.name}
              </HoldButton>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

function InviteSheet({ open, onClose, code, name }: { open: boolean; onClose: () => void; code: string; name: string }) {
  const url = inviteUrl(code);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(true);
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${name} on MANHUNT`, text: `Join my Manhunt game. Code: ${code}`, url });
        return;
      } catch {
        /* cancelled */
      }
    }
    await copy();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Invite players">
      <div className="space-y-4 pb-3">
        <div className="text-center">
          <p className="label">Join code</p>
          <p className="mt-1 font-mono text-5xl font-bold tracking-[0.25em]">{code}</p>
        </div>
        {showQr && <QrCode value={url} label={`QR code for ${url}`} className="mx-auto w-56" />}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="primary" onClick={share}>
            <Share2 className="size-4" /> Share link
          </Button>
          <Button onClick={copy}>{copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />} {copied ? 'Copied' : 'Copy link'}</Button>
        </div>
        <Button variant="ghost" block size="sm" onClick={() => setShowQr((q) => !q)}>
          <QrIcon className="size-4" /> {showQr ? 'Hide' : 'Show'} QR code
        </Button>
        <p className="text-center text-sm text-muted">This game is private. Only people with the code or link can find it. Share it only with your players.</p>
      </div>
    </Sheet>
  );
}

export function LeaveSheet({ open, onClose, gameId }: { open: boolean; onClose: () => void; gameId: string }) {
  const send = useGame((s) => s.send);
  const view = useGame((s) => s.view);
  const running = view?.game.status === 'running';
  return (
    <Sheet open={open} onClose={onClose} title="Leave game?">
      <div className="space-y-3 pb-3">
        <p className="text-muted">
          {running && view?.me.team === 'runner'
            ? "You'll be out of the game (it does not count as a capture). Location sharing stops immediately."
            : 'Location sharing stops immediately. You cannot rejoin this game as the same player.'}
        </p>
        <HoldButton
          onConfirm={() => {
            send({ type: 'leave' });
            useLocation.getState().stop();
            sessions.remove(gameId);
            navigate('/', { replace: true });
          }}
        >
          <LogOut className="size-4" /> Hold to leave
        </HoldButton>
        <Button variant="ghost" block onClick={onClose}>
          Stay
        </Button>
      </div>
    </Sheet>
  );
}

function LocationOnboarding() {
  const permission = useLocation((s) => s.permission);
  const fix = useLocation((s) => s.fix);
  const request = useLocation((s) => s.requestPermission);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (permission === 'granted' || fix) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-ok/30 bg-ok/10 px-4 py-3 text-sm">
        <Wifi className="size-5 shrink-0 text-ok" />
        <span className="flex-1">
          Location ready{fix ? ` · ±${Math.round(fix.accuracy)} m` : ''}. Sharing starts only when the game begins.
        </span>
      </div>
    );
  }
  return (
    <Card className="space-y-3 border-ice/30">
      <div className="flex items-start gap-3">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-ice/15 text-ice">
          {permission === 'denied' || permission === 'unsupported' ? <MapPinOff className="size-6" /> : <LocateFixed className="size-6" />}
        </div>
        <div>
          <p className="font-semibold">{permission === 'denied' ? 'Location is blocked' : 'Allow location for this game'}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {permission === 'denied'
              ? 'Turn location back on for this site in your browser settings (Safari: aA › Website Settings · Chrome: lock icon › Permissions), then reload.'
              : permission === 'unsupported'
                ? 'This browser cannot share location. You can still spectate.'
                : 'Runners are revealed to hunters every ping. Hunters can share with their team. Nothing is shared until the game starts, and it stops when you leave or the game ends.'}
          </p>
        </div>
      </div>
      {permission !== 'denied' && permission !== 'unsupported' && (
        <Button
          variant="primary"
          block
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await request();
            setBusy(false);
          }}
        >
          <LocateFixed className="size-4" /> Allow location
        </Button>
      )}
      <button type="button" className="text-sm font-medium text-ice" onClick={() => setExpanded((e) => !e)}>
        {expanded ? 'Hide' : 'Why must I keep the app open?'}
      </button>
      {expanded && (
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
          {BROWSER_LIMITS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
