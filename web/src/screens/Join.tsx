import { motion } from 'motion/react';
import { Clock, Lock, MapPinned, Radar, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { JOIN_CODE_LENGTH, LIMITS } from '@shared/constants';
import { SAFETY_RULES } from '@/content';
import { ScreenShell } from '@/components/ScreenShell';
import { Button, Card, Field, Input, Pill, Spinner, Toggle } from '@/components/ui';
import { api, ApiError, type GamePreview } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { navigate } from '@/lib/router';
import { sessions } from '@/lib/sessions';

const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, JOIN_CODE_LENGTH);

export function JoinScreen({ initialCode }: { initialCode?: string }) {
  const prefs = usePrefs();
  const [code, setCode] = useState(clean(initialCode ?? ''));
  const [preview, setPreview] = useState<GamePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(prefs.lastName);
  const [password, setPassword] = useState('');
  const [spectate, setSpectate] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // If this device already joined a game with this code, offer to resume instead of re-joining.
  const existing = sessions.list().find((s) => s.code === code);

  useEffect(() => {
    if (code.length !== JOIN_CODE_LENGTH) {
      setPreview(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .preview(code)
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        if (p.status !== 'lobby') setSpectate(true);
      })
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : 'Could not find that game'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [code]);

  const join = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.join(code, { name, password: password || undefined, asSpectator: spectate || undefined });
      prefs.set({ lastName: name.trim() });
      sessions.save({ gameId: res.gameId, token: res.token, playerId: res.playerId, code: res.code, name: name.trim(), gameName: preview.name });
      // Safety acknowledgement is sent once connected (see GameRoot).
      sessionStorage.setItem(`manhunt:ack:${res.gameId}`, '1');
      navigate(`/game/${res.gameId}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not join');
      setBusy(false);
    }
  };

  const inProgress = preview && preview.status !== 'lobby';
  const blocked = preview && ((inProgress && !preview.allowSpectators) || (preview.locked && !inProgress));

  return (
    <ScreenShell
      title="Join game"
      footer={
        preview && !blocked && !existing ? (
          <div className="space-y-2">
            {error && <p className="text-center text-sm text-danger-ink">{error}</p>}
            <Button variant="primary" size="lg" block disabled={!name.trim() || !ack || (preview.requiresPassword && !password)} loading={busy} onClick={join}>
              {spectate ? 'Join as spectator' : 'Join game'}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="code" className="label">
            Game code
          </label>
          <div className="relative" onClick={() => inputRef.current?.focus()}>
            <input
              ref={inputRef}
              id="code"
              value={code}
              onChange={(e) => setCode(clean(e.target.value))}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              autoCorrect="off"
              spellCheck={false}
              autoFocus={!initialCode}
              maxLength={JOIN_CODE_LENGTH + 4}
              className="absolute inset-0 h-full w-full opacity-0"
              aria-describedby="code-help"
            />
            <div className="pointer-events-none grid grid-cols-6 gap-2" aria-hidden>
              {Array.from({ length: JOIN_CODE_LENGTH }, (_, i) => (
                <div
                  key={i}
                  className={`grid aspect-[4/5] place-items-center rounded-xl border-2 bg-surface-2 font-mono text-[clamp(1.4rem,7vw,2rem)] font-bold ${
                    i === code.length ? 'border-ice' : code[i] ? 'border-line-strong' : 'border-line'
                  }`}
                >
                  {code[i] ?? ''}
                </div>
              ))}
            </div>
          </div>
          <p id="code-help" className="text-sm text-muted">
            Ask the host for the 6-character code, or open their invite link.
          </p>
        </div>

        {loading && (
          <div className="flex justify-center py-6">
            <Spinner className="size-6" />
          </div>
        )}
        {!preview && error && <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger-ink">{error}</p>}

        {existing && preview && (
          <Card className="space-y-3">
            <p>
              You're already in <span className="font-semibold">{preview.name}</span> as <span className="font-semibold">{existing.name}</span> on this device.
            </p>
            <Button variant="primary" block onClick={() => navigate(`/game/${existing.gameId}`)}>
              Rejoin game
            </Button>
          </Card>
        )}

        {preview && !existing && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <Card className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display text-xl font-bold">{preview.name}</p>
                  <p className="text-sm text-muted">Hosted by {preview.hostName}</p>
                </div>
                {preview.status === 'lobby' ? <Pill tone="ok">In lobby</Pill> : <Pill tone="warn">In progress</Pill>}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="inline-flex items-center gap-2 text-muted"><Users className="size-4" /> {preview.players}/{preview.maxPlayers} players</span>
                <span className="inline-flex items-center gap-2 text-muted"><Clock className="size-4" /> {preview.durationMin} min</span>
                <span className="inline-flex items-center gap-2 text-muted"><Radar className="size-4" /> Ping every {preview.pingIntervalSec >= 60 ? `${preview.pingIntervalSec / 60}m` : `${preview.pingIntervalSec}s`}</span>
                <span className="inline-flex items-center gap-2 text-muted"><MapPinned className="size-4" /> {preview.hasBoundary ? 'Play area set' : 'No play area'}</span>
              </div>
            </Card>

            {blocked ? (
              <p className="rounded-xl border border-warn/30 bg-warn/10 p-3 text-sm">
                {inProgress ? 'This game has already started and does not allow spectators.' : 'The host has locked this lobby.'}
              </p>
            ) : (
              <>
                <Field label="Your display name" hint="Shown to everyone in this game only.">
                  <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.nameMax} placeholder="e.g. Sam" autoComplete="nickname" enterKeyHint="done" />
                </Field>
                {preview.requiresPassword && (
                  <Field label="Game password">
                    <div className="relative">
                      <Lock className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-faint" />
                      <Input className="pl-10" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
                    </div>
                  </Field>
                )}
                {preview.allowSpectators && preview.status === 'lobby' && (
                  <Card className="py-1">
                    <Toggle checked={spectate} onChange={setSpectate} label="Join as spectator" description="Watch the timer and captures. You never see locations." />
                  </Card>
                )}
                <details className="rounded-2xl border border-line bg-surface p-4">
                  <summary className="cursor-pointer font-semibold">Safety rules ({SAFETY_RULES.length})</summary>
                  <ul className="mt-3 space-y-2 text-sm text-muted">
                    {SAFETY_RULES.map((r) => (
                      <li key={r.title}>
                        <span className="font-semibold text-fg">{r.title}.</span> {r.body}
                      </li>
                    ))}
                  </ul>
                </details>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line-strong bg-surface-2 p-4">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 size-5 accent-[var(--mh-signal)]" />
                  <span className="text-sm leading-relaxed">I've read the safety rules. I'll play on foot or as a passenger, stay in bounds and tag without contact.</span>
                </label>
              </>
            )}
          </motion.div>
        )}
      </div>
    </ScreenShell>
  );
}
