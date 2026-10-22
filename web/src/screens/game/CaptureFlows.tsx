import { AnimatePresence, motion } from 'motion/react';
import { Check, Hand, Hourglass, KeyRound, ScanLine, ShieldQuestion, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatAge } from '@shared/clock';
import type { CaptureView, GameView, PlayerView } from '@shared/protocol';
import { QrCode } from '@/components/QrCode';
import { QrScanner } from '@/components/QrScanner';
import { Button, Segmented, Sheet, TeamGlyph } from '@/components/ui';
import { cue } from '@/lib/feedback';
import { useGame } from '@/lib/game';
import { useServerNow } from '@/lib/time';
import { cn } from '@/lib/utils';

export const TAG_PREFIX = 'MANHUNT-TAG:';

/** Hunter: start a capture (request → runner confirms) or capture instantly with a tag code / QR. */
export function CaptureSheet({ view, open, onClose }: { view: GameView; open: boolean; onClose: () => void }) {
  const send = useGame((s) => s.send);
  const [mode, setMode] = useState<'request' | 'code'>('request');
  const [code, setCode] = useState('');
  const [scan, setScan] = useState(false);
  const runners = view.players.filter((p) => p.team === 'runner' && p.status === 'active');
  const tagEnabled = view.game.settings.tagCodeEnabled;
  const confirmBy = view.game.settings.captureMethod === 'host_confirm' ? 'the host' : 'the runner';

  useEffect(() => {
    if (!open) {
      setCode('');
      setScan(false);
    }
  }, [open]);

  const submitCode = (c: string) => {
    if (!/^\d{4}$/.test(c)) return;
    send({ type: 'captureByCode', code: c });
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Capture a runner">
      <div className="space-y-4 pb-3">
        <p className="text-sm text-muted">Only capture someone you've physically tagged. GPS is never enough on its own.</p>
        {tagEnabled && (
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'request', label: (<span className="inline-flex items-center gap-1.5"><Hand className="size-4" /> Ask to confirm</span>) },
              { value: 'code', label: (<span className="inline-flex items-center gap-1.5"><KeyRound className="size-4" /> Tag code</span>) },
            ]}
          />
        )}
        {mode === 'request' || !tagEnabled ? (
          <>
            <p className="text-sm">Who did you tag? {confirmBy[0]!.toUpperCase() + confirmBy.slice(1)} will be asked to confirm.</p>
            <div className="space-y-2">
              {runners.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3.5 text-left active:scale-[0.99]"
                  onClick={() => {
                    send({ type: 'captureRequest', runnerId: r.id });
                    onClose();
                  }}
                >
                  <TeamGlyph team="runner" className="size-5" />
                  <span className="flex-1 text-lg font-semibold">{r.name}</span>
                  <span className="text-sm text-muted">Tagged</span>
                </button>
              ))}
              {runners.length === 0 && <p className="text-muted">No runners left in play.</p>}
            </div>
          </>
        ) : (
          <div className="space-y-3">
            {scan ? (
              <QrScanner
                onCode={(text) => {
                  const m = text.match(/^MANHUNT-TAG:(\d{4})$/);
                  if (m) {
                    cue('success');
                    submitCode(m[1]!);
                  }
                }}
              />
            ) : (
              <input
                aria-label="Runner's tag code"
                inputMode="numeric"
                pattern="\d*"
                autoComplete="off"
                maxLength={4}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                className="h-20 w-full rounded-2xl border border-line-strong bg-surface-2 text-center font-mono text-5xl font-bold tracking-[0.4em] outline-none focus:border-ice"
              />
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => setScan((s) => !s)}>
                <ScanLine className="size-4" /> {scan ? 'Type code' : 'Scan QR'}
              </Button>
              <Button variant="primary" disabled={code.length !== 4 || scan} onClick={() => submitCode(code)}>
                Capture
              </Button>
            </div>
            <p className="text-sm text-muted">The runner shows you their code or QR once you've tagged them. A matching code captures them instantly.</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Runner: blocking modal when a hunter claims a tag. */
export function IncomingCapture({ view }: { view: GameView }) {
  const send = useGame((s) => s.send);
  const now = useServerNow(1000);
  const pending = view.captures.find((c) => c.runnerId === view.me.id && c.status === 'pending' && view.me.status === 'active');
  const hunter = pending ? view.players.find((p) => p.id === pending.hunterId) : undefined;
  useEffect(() => {
    if (pending) cue('alert');
  }, [pending?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 bg-bg/95 px-6 text-center backdrop-blur"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="alertdialog"
          aria-labelledby="capture-title"
        >
          <div className="grid size-20 place-items-center rounded-full bg-signal/15 text-signal">
            <Hand className="size-10" />
          </div>
          <div>
            <h2 id="capture-title" className="font-display text-3xl font-bold">
              Were you tagged?
            </h2>
            <p className="mt-2 text-lg text-muted">
              <span className="font-semibold text-hunter">{hunter?.name ?? 'A hunter'}</span> says they caught you.
            </p>
            <p className="mt-1 text-sm text-faint">Expires in {Math.max(0, Math.ceil((pending.expiresAt - now) / 1000))}s</p>
          </div>
          <div className="w-full max-w-sm space-y-3">
            <Button variant="primary" size="xl" block onClick={() => send({ type: 'captureRespond', captureId: pending.id, accept: true })}>
              <Check className="size-6" /> Yes, I'm caught
            </Button>
            <Button variant="secondary" size="lg" block onClick={() => send({ type: 'captureRespond', captureId: pending.id, accept: false })}>
              <X className="size-5" /> No, dispute it
            </Button>
            <p className="text-xs text-faint">Disputes go to the host to decide.</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Hunter: status of my outstanding capture request. */
export function PendingCaptureCard({ view, players }: { view: GameView; players: Map<string, PlayerView> }) {
  const send = useGame((s) => s.send);
  const now = useServerNow(1000);
  const mine = view.captures.filter((c) => c.hunterId === view.me.id && (c.status === 'pending' || c.status === 'disputed'));
  if (!mine.length) return null;
  return (
    <div className="space-y-2">
      {mine.map((c) => (
        <CaptureStatusRow key={c.id} c={c} players={players} now={now} onCancel={c.status === 'pending' ? () => send({ type: 'captureCancel', captureId: c.id }) : undefined} />
      ))}
    </div>
  );
}

function CaptureStatusRow({ c, players, now, onCancel }: { c: CaptureView; players: Map<string, PlayerView>; now: number; onCancel?: () => void }) {
  const runner = players.get(c.runnerId);
  return (
    <div className={cn('flex items-center gap-3 rounded-2xl border px-4 py-3', c.status === 'disputed' ? 'border-warn/40 bg-warn/10' : 'border-signal/40 bg-signal/10')}>
      {c.status === 'disputed' ? <ShieldQuestion className="size-5 shrink-0 text-warn" /> : <Hourglass className="size-5 shrink-0 animate-pulse text-signal" />}
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">
          {c.status === 'disputed' ? `${runner?.name ?? 'Runner'} disputed the capture` : `Waiting for ${runner?.name ?? 'runner'} to confirm…`}
        </p>
        <p className="text-muted">{c.status === 'disputed' ? 'The host will decide.' : `${Math.max(0, Math.ceil((c.expiresAt - now) / 1000))}s left`}</p>
      </div>
      {onCancel && (
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  );
}

/** Runner: secret tag code + QR shown to a hunter who has physically tagged you. */
export function TagCodeCard({ code }: { code: string }) {
  const [shown, setShown] = useState(false);
  const [qr, setQr] = useState(false);
  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-3">
      <div className="flex items-center gap-3">
        <KeyRound className="size-5 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Your tag code</p>
          <p className="text-xs text-muted">Only show it to a hunter who has tagged you.</p>
        </div>
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          className="rounded-lg bg-surface-3 px-3 py-1.5 font-mono text-xl font-bold tracking-[0.25em]"
          aria-label={shown ? 'Hide tag code' : 'Reveal tag code'}
        >
          {shown ? code : '••••'}
        </button>
        <Button size="sm" variant="outline" onClick={() => setQr(true)} aria-label="Show tag QR code">
          QR
        </Button>
      </div>
      <Sheet open={qr} onClose={() => setQr(false)} title="Show to the hunter who tagged you">
        <div className="space-y-4 pb-4 text-center">
          <QrCode value={`${TAG_PREFIX}${code}`} label="Your tag QR code" className="mx-auto w-64" />
          <p className="font-mono text-4xl font-bold tracking-[0.3em]">{code}</p>
          <p className="text-sm text-muted">Scanning this captures you immediately.</p>
        </div>
      </Sheet>
    </div>
  );
}

export function captureAge(c: CaptureView, now: number) {
  return formatAge(now - (c.resolvedAt ?? c.createdAt));
}
