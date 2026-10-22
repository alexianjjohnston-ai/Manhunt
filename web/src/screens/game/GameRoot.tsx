import { motion } from 'motion/react';
import { Ban, Home, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SAFETY_RULES } from '@/content';
import { Toasts } from '@/components/Toasts';
import { Button, Sheet, Spinner, Wordmark } from '@/components/ui';
import { useGame } from '@/lib/game';
import { navigate } from '@/lib/router';
import { sessions } from '@/lib/sessions';
import { InGame } from './InGame';
import { Lobby } from './Lobby';
import { Results } from './Results';
import { useLocationSharing } from './useLocationSharing';

export default function GameRoot({ gameId }: { gameId: string }) {
  const connect = useGame((s) => s.connect);
  const disconnect = useGame((s) => s.disconnect);
  const status = useGame((s) => s.status);
  const fatal = useGame((s) => s.fatal);
  const view = useGame((s) => s.view);
  const send = useGame((s) => s.send);
  const session = sessions.get(gameId);

  useEffect(() => {
    if (!session) return;
    connect(gameId);
    return () => disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  useLocationSharing(view);

  // Safety acknowledgement captured on the Join screen is sent once connected.
  useEffect(() => {
    if (view && !view.me.safetyAck && sessionStorage.getItem(`manhunt:ack:${gameId}`)) {
      send({ type: 'ackSafety' });
      sessionStorage.removeItem(`manhunt:ack:${gameId}`);
    }
  }, [view, gameId, send]);

  if (!session) {
    return (
      <Centered>
        <Ban className="size-10 text-muted" />
        <h1 className="font-display text-2xl font-bold">Not joined on this device</h1>
        <p className="max-w-xs text-muted">Use the game code or invite link to join. Each device needs its own player.</p>
        <Button variant="primary" onClick={() => navigate('/join', { replace: true })}>
          Join a game
        </Button>
      </Centered>
    );
  }

  if (status === 'fatal' && fatal) {
    return <FatalScreen gameId={gameId} code={fatal.code} message={fatal.message} />;
  }

  if (!view) {
    return (
      <Centered>
        <Wordmark className="text-2xl" />
        <Spinner className="size-7" />
        <p className="text-muted">{status === 'reconnecting' ? 'Reconnecting…' : 'Connecting to game…'}</p>
      </Centered>
    );
  }

  return (
    <>
      {view.game.status === 'lobby' && <Lobby view={view} />}
      {view.game.status === 'running' && <InGame view={view} />}
      {view.game.status === 'ended' && <Results view={view} />}
      <ConnectionBanner />
      <SafetyGate />
      {view.game.status !== 'running' && <Toasts />}
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="safe-x flex h-full flex-col items-center justify-center gap-4 text-center">
      {children}
    </motion.div>
  );
}

function FatalScreen({ gameId, code, message }: { gameId: string; code: string; message: string }) {
  useEffect(() => {
    if (['kicked', 'left', 'unauthorized', 'not_found'].includes(code)) sessions.remove(gameId);
  }, [code, gameId]);
  return (
    <Centered>
      <Ban className="size-10 text-muted" />
      <h1 className="font-display text-2xl font-bold">
        {code === 'kicked' ? 'Removed from game' : code === 'left' ? 'You left this game' : code === 'not_found' ? 'Game not found' : 'Disconnected'}
      </h1>
      <p className="max-w-xs text-muted">{message}</p>
      <p className="max-w-xs text-sm text-faint">Location sharing is off.</p>
      <Button variant="primary" onClick={() => navigate('/', { replace: true })}>
        <Home className="size-4" /> Home
      </Button>
    </Centered>
  );
}

function ConnectionBanner() {
  const status = useGame((s) => s.status);
  const reconnect = useGame((s) => s.reconnectNow);
  const [show, setShow] = useState(false);
  // Avoid flashing the banner for sub-second blips.
  useEffect(() => {
    if (status === 'reconnecting' || status === 'connecting') {
      const t = window.setTimeout(() => setShow(true), 1500);
      return () => window.clearTimeout(t);
    }
    setShow(false);
  }, [status]);
  if (!show) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-3 safe-bottom">
      <button
        type="button"
        onClick={reconnect}
        className="pointer-events-auto mb-2 flex items-center gap-2 rounded-full border border-warn/40 bg-[#2a1f05] px-4 py-2 text-sm font-semibold text-warn shadow-lg"
      >
        <WifiOff className="size-4" /> Connection lost. Reconnecting… <span className="underline">Retry</span>
      </button>
    </div>
  );
}

function SafetyGate() {
  const view = useGame((s) => s.view);
  const send = useGame((s) => s.send);
  const [ack, setAck] = useState(false);
  const open = !!view && !view.me.safetyAck && !sessionStorage.getItem(`manhunt:ack:${view.game.id}`);
  return (
    <Sheet open={open} onClose={() => {}} dismissible={false} title="Before you play">
      <ul className="space-y-3 pb-3">
        {SAFETY_RULES.map((r) => (
          <li key={r.title} className="text-sm leading-relaxed text-muted">
            <span className="font-semibold text-fg">{r.title}.</span> {r.body}
          </li>
        ))}
      </ul>
      <label className="my-3 flex cursor-pointer items-start gap-3 rounded-2xl border border-line-strong bg-surface-2 p-4">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 size-5 accent-[var(--mh-signal)]" />
        <span className="text-sm">I'll follow these safety rules.</span>
      </label>
      <Button variant="primary" size="lg" block disabled={!ack} onClick={() => send({ type: 'ackSafety' })}>
        Continue
      </Button>
      <Button variant="ghost" block className="mt-2" onClick={() => navigate('/')}>
        Not now
      </Button>
    </Sheet>
  );
}
