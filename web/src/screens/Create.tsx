import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, Crosshair, Eye, Footprints, Lock, Save, ShieldAlert, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, LIMITS } from '@shared/constants';
import type { Boundary, GameSettings } from '@shared/types';
import { SAFETY_RULES } from '@/content';
import { BoundaryEditor } from '@/components/map/BoundaryEditor';
import { ScreenShell } from '@/components/ScreenShell';
import { Button, Card, Field, Input, Segmented, Slider, Stepper, Toggle } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { navigate } from '@/lib/router';
import { sessions } from '@/lib/sessions';
import { cn } from '@/lib/utils';

const STEPS = ['You', 'Timing', 'Play area', 'Rules', 'Safety'] as const;
const PRESET_KEY = 'manhunt:preset:v1';

function loadPreset(): GameSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESET_KEY) ?? 'null') as Partial<GameSettings> | null;
    return { ...DEFAULT_SETTINGS, ...(raw ?? {}), lobbyLocked: false };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function CreateScreen() {
  const prefs = usePrefs();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(prefs.lastName);
  const [settings, setSettings] = useState<GameSettings>(loadPreset);
  const [boundary, setBoundary] = useState<Boundary | null>(null);
  const [password, setPassword] = useState('');
  const [hostTeam, setHostTeam] = useState<'player' | 'spectator'>('player');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fast, setFast] = useState(false);
  const [presetSaved, setPresetSaved] = useState(false);

  useEffect(() => {
    api.config().then((c) => setFast(c.fastPingsAllowed)).catch(() => {});
  }, []);

  const set = <K extends keyof GameSettings>(k: K, v: GameSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));

  const canNext = [name.trim().length > 0 && settings.name.trim().length > 0, settings.headStartMin < settings.durationMin, true, true, ack][step]!;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.create({
        hostName: name,
        settings,
        boundary,
        password: password || undefined,
        hostTeam,
        safetyAck: true,
      });
      prefs.set({ lastName: name.trim() });
      sessions.save({ gameId: res.gameId, token: res.token, playerId: res.playerId, code: res.code, name: name.trim(), gameName: settings.name });
      navigate(`/game/${res.gameId}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the game');
      setBusy(false);
    }
  };

  const pingOptions = [
    ...(fast ? [{ value: 30, label: '30s', hint: 'Testing only' }, { value: 60, label: '1m' }] : []),
    { value: 120, label: '2m' },
    { value: 180, label: '3m' },
    { value: 300, label: '5m' },
    { value: 600, label: '10m' },
  ];

  return (
    <ScreenShell
      title="Create game"
      onBack={() => (step === 0 ? navigate('/') : setStep(step - 1))}
      footer={
        <div className="space-y-3">
          {error && <p className="text-center text-sm text-danger">{error}</p>}
          {step < STEPS.length - 1 ? (
            <Button variant="primary" size="lg" block disabled={!canNext} onClick={() => setStep(step + 1)}>
              {step === 2 && !boundary ? 'Skip — no play area' : 'Continue'} <ArrowRight className="size-5" />
            </Button>
          ) : (
            <Button variant="primary" size="lg" block disabled={!ack} loading={busy} onClick={create}>
              <Check className="size-5" /> Create private game
            </Button>
          )}
        </div>
      }
    >
      <ol className="mb-6 flex gap-1.5" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <div className={cn('h-1 rounded-full transition-colors', i <= step ? 'bg-signal' : 'bg-surface-3')} />
            <span className={cn('mt-1.5 block text-[0.65rem] font-semibold tracking-wide uppercase', i === step ? 'text-fg' : 'text-faint')}>{s}</span>
          </li>
        ))}
      </ol>

      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }} className="space-y-6">
          {step === 0 && (
            <>
              <Field label="Your display name">
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.nameMax} placeholder="e.g. Alex" autoComplete="nickname" autoFocus enterKeyHint="next" />
              </Field>
              <Field label="Game name">
                <Input value={settings.name} onChange={(e) => set('name', e.target.value)} maxLength={LIMITS.gameNameMax} placeholder="Friday night manhunt" />
              </Field>
              <Card>
                <Stepper label="Max players" min={2} max={LIMITS.maxPlayersMax} value={settings.maxPlayers} onChange={(v) => set('maxPlayers', v)} />
              </Card>
              <div className="space-y-2">
                <span className="label">You will</span>
                <Segmented
                  value={hostTeam}
                  onChange={setHostTeam}
                  options={[
                    { value: 'player', label: (<span className="inline-flex items-center gap-1.5"><UserRound className="size-4" /> Play</span>) },
                    { value: 'spectator', label: (<span className="inline-flex items-center gap-1.5"><Eye className="size-4" /> Referee only</span>) },
                  ]}
                />
                <p className="text-sm text-muted">A referee hosts without a team and never sees runner or hunter locations during play.</p>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="space-y-2">
                <span className="label">Game length</span>
                <Segmented
                  value={[30, 45, 60, 90, 120].includes(settings.durationMin) ? settings.durationMin : -1}
                  onChange={(v) => v > 0 && set('durationMin', v)}
                  options={[30, 45, 60, 90, 120].map((v) => ({ value: v, label: v < 60 ? `${v}m` : `${v / 60}h${v % 60 ? '30' : ''}` }))}
                />
                <Slider label="Custom" min={LIMITS.durationMinMin} max={180} step={5} value={settings.durationMin} onChange={(v) => set('durationMin', v)} format={(v) => `${v} min`} />
              </div>
              <div className="space-y-2">
                <span className="label">Location ping every</span>
                <Segmented value={settings.pingIntervalSec} onChange={(v) => set('pingIntervalSec', v)} options={pingOptions} />
                <p className="text-sm text-muted">Hunters see every runner's position once per interval, all at the same moment. 5 minutes is the classic rule.</p>
              </div>
              <Slider label="Runner head start" min={0} max={15} value={settings.headStartMin} onChange={(v) => set('headStartMin', v)} format={(v) => (v ? `${v} min` : 'None')} />
              <Card className="py-1">
                <Toggle
                  checked={settings.revealAtHeadStartEnd}
                  onChange={(v) => set('revealAtHeadStartEnd', v)}
                  label="Reveal when hunters are released"
                  description="An extra ping the moment the head start ends."
                  disabled={settings.headStartMin === 0}
                />
              </Card>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-muted">Draw the area where the game happens. Everyone gets a warning near or outside the edge.</p>
              <BoundaryEditor value={boundary} onChange={setBoundary} />
            </>
          )}

          {step === 3 && (
            <>
              <div className="space-y-2">
                <span className="label">Teams</span>
                <Segmented
                  value={settings.teamAssignment}
                  onChange={(v) => set('teamAssignment', v)}
                  options={[
                    { value: 'auto', label: 'Auto-balance' },
                    { value: 'manual', label: 'Host assigns' },
                  ]}
                />
              </div>
              <div className="space-y-2">
                <span className="label">With an odd number, the extra player joins</span>
                <Segmented
                  value={settings.extraPlayerTeam}
                  onChange={(v) => set('extraPlayerTeam', v)}
                  options={[
                    { value: 'hunter', label: (<span className="inline-flex items-center gap-1.5"><Crosshair className="size-4 text-hunter" /> Hunters</span>) },
                    { value: 'runner', label: (<span className="inline-flex items-center gap-1.5"><Footprints className="size-4 text-runner" /> Runners</span>) },
                  ]}
                />
              </div>
              <div className="space-y-2">
                <span className="label">Capture confirmation</span>
                <Segmented
                  value={settings.captureMethod}
                  onChange={(v) => set('captureMethod', v)}
                  options={[
                    { value: 'runner_confirm', label: 'Runner confirms' },
                    { value: 'host_confirm', label: 'Host confirms' },
                  ]}
                />
                <p className="text-sm text-muted">
                  {settings.captureMethod === 'runner_confirm'
                    ? 'The hunter taps Capture, then the runner confirms on their own phone. Disputes go to the host.'
                    : 'The host approves every capture. Use this if you have a dedicated referee.'}
                </p>
              </div>
              <Card className="divide-y divide-line py-1">
                <Toggle checked={settings.tagCodeEnabled} onChange={(v) => set('tagCodeEnabled', v)} label="Instant tag codes" description="Each runner has a secret 4-digit code and QR. A hunter who scans it in person captures instantly." />
                <Toggle checked={settings.hunterTeammatesVisible} onChange={(v) => set('hunterTeammatesVisible', v)} label="Hunters see each other live" />
                <Toggle checked={settings.runnerTeammatesVisible} onChange={(v) => set('runnerTeammatesVisible', v)} label="Runners see each other live" description="Never visible to hunters." />
                <Toggle checked={settings.allowSpectators} onChange={(v) => set('allowSpectators', v)} label="Allow spectators" description="Spectators see the timer and captures, never locations." />
              </Card>
              <Field label="Game password (optional)" hint="On top of the private join code.">
                <div className="relative">
                  <Lock className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-faint" />
                  <Input className="pl-10" type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={LIMITS.passwordMax} autoComplete="new-password" placeholder="No password" />
                </div>
              </Field>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  try {
                    localStorage.setItem(PRESET_KEY, JSON.stringify(settings));
                    setPresetSaved(true);
                  } catch {
                    /* ignore */
                  }
                }}
              >
                <Save className="size-4" /> {presetSaved ? 'Saved as my default' : 'Save these settings as my default'}
              </Button>
            </>
          )}

          {step === 4 && (
            <>
              <div className="flex items-start gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4">
                <ShieldAlert className="mt-0.5 size-6 shrink-0 text-warn" />
                <p className="text-sm leading-relaxed">You're the host. Please brief everyone on these rules before you start. Every player confirms them before joining.</p>
              </div>
              <ul className="space-y-3">
                {SAFETY_RULES.map((r) => (
                  <li key={r.title} className="rounded-2xl border border-line bg-surface p-4">
                    <p className="font-semibold">{r.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{r.body}</p>
                  </li>
                ))}
              </ul>
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line-strong bg-surface-2 p-4">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 size-5 accent-[var(--mh-signal)]" />
                <span className="text-sm leading-relaxed">I understand these safety rules and will make sure every player follows them.</span>
              </label>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </ScreenShell>
  );
}
