import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, ChevronDown, Crosshair, Eye, Footprints, Lock, Save, ShieldAlert, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, LIMITS } from '@shared/constants';
import type { Boundary, GameSettings } from '@shared/types';
import { SAFETY_RULES } from '@/content';
import { BoundaryEditor, recommendedRadiusM } from '@/components/map/BoundaryEditor';
import { ScreenShell } from '@/components/ScreenShell';
import { Button, Card, Field, Input, Segmented, Slider, Stepper, Toggle } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { navigate } from '@/lib/router';
import { PRESETS, presetFor, rulesSummary } from '@/lib/rules';
import { sessions } from '@/lib/sessions';
import { cn } from '@/lib/utils';

const STEPS = ['Game', 'Area', 'Go'] as const;
const PRESET_KEY = 'manhunt:preset:v2';

function loadSaved(): GameSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESET_KEY) ?? 'null') as Partial<GameSettings> | null;
    return { ...DEFAULT_SETTINGS, ...PRESETS[1]!.settings, ...(raw ?? {}), lobbyLocked: false };
  } catch {
    return { ...DEFAULT_SETTINGS, ...PRESETS[1]!.settings };
  }
}

export function CreateScreen() {
  const prefs = usePrefs();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(prefs.lastName);
  const [settings, setSettings] = useState<GameSettings>(loadSaved);
  const [expected, setExpected] = useState(6);
  const [boundary, setBoundary] = useState<Boundary | null>(null);
  const [password, setPassword] = useState('');
  const [hostTeam, setHostTeam] = useState<'player' | 'spectator'>('player');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fast, setFast] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.config().then((c) => setFast(c.fastPingsAllowed)).catch(() => {});
  }, []);

  const set = <K extends keyof GameSettings>(k: K, v: GameSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const preset = presetFor(settings);
  const recommended = recommendedRadiusM(expected, settings.durationMin);
  const defaultGameName = `${name.trim() || 'Your'}'s game`;

  const canNext = [name.trim().length > 0, true, ack][step]!;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const gameName = settings.name.trim() && settings.name !== DEFAULT_SETTINGS.name ? settings.name.trim() : defaultGameName;
      const res = await api.create({
        hostName: name,
        settings: { ...settings, name: gameName, maxPlayers: Math.max(settings.maxPlayers, expected) },
        boundary,
        password: password || undefined,
        hostTeam,
        safetyAck: true,
      });
      prefs.set({ lastName: name.trim() });
      sessions.save({ gameId: res.gameId, token: res.token, playerId: res.playerId, code: res.code, name: name.trim(), gameName });
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
    { value: 240, label: '4m' },
    { value: 300, label: '5m' },
    { value: 600, label: '10m' },
  ];

  return (
    <ScreenShell
      title="New game"
      onBack={() => (step === 0 ? navigate('/') : setStep(step - 1))}
      footer={
        <div className="space-y-3">
          {error && <p className="text-center text-sm text-danger-ink">{error}</p>}
          {step < STEPS.length - 1 ? (
            <Button variant="primary" size="lg" block disabled={!canNext} onClick={() => setStep(step + 1)}>
              {step === 1 && !boundary ? 'Skip: no play area' : 'Continue'} <ArrowRight className="size-5" />
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
            <span className={cn('mt-1.5 block text-xs font-semibold tracking-wide uppercase', i === step ? 'text-fg' : 'text-muted')}>
              {i + 1}. {s}
            </span>
          </li>
        ))}
      </ol>

      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }} className="space-y-6">
          {step === 0 && (
            <>
              <Field label="Your name">
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.nameMax} placeholder="e.g. Alex" autoComplete="nickname" autoFocus enterKeyHint="next" />
              </Field>
              <div className="space-y-2">
                <span className="label">Pick a game</span>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Game type">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={preset === p.id}
                      onClick={() => setSettings((s) => ({ ...s, ...p.settings }))}
                      className={cn(
                        'rounded-2xl border p-3 text-left transition-colors',
                        preset === p.id ? 'border-signal bg-signal/10' : 'border-line bg-surface hover:border-line-strong',
                      )}
                    >
                      <span className="flex items-center justify-between font-display font-bold">
                        {p.name}
                        {preset === p.id && <Check className="size-4 text-signal-ink" />}
                      </span>
                      <span className="mt-1 block text-xs leading-snug text-muted">{p.blurb}</span>
                    </button>
                  ))}
                </div>
                {!preset && <p className="text-sm text-muted">Custom rules. Edit them on the last step.</p>}
              </div>
              <Card className="py-1">
                <Stepper label="How many players?" min={2} max={LIMITS.maxPlayersMax} value={expected} onChange={setExpected} />
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
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-muted">Where are you playing? Search for a park or neighbourhood, or use your location. Players are warned near the edge.</p>
              <BoundaryEditor value={boundary} onChange={setBoundary} recommendedRadius={recommended} />
            </>
          )}

          {step === 2 && (
            <>
              <Card className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-display text-lg font-bold">{settings.name !== DEFAULT_SETTINGS.name && settings.name.trim() ? settings.name : defaultGameName}</p>
                  <span className="text-sm text-muted">{PRESETS.find((p) => p.id === preset)?.name ?? 'Custom'}</span>
                </div>
                <ul className="space-y-2 text-sm leading-relaxed" data-testid="rules-summary">
                  {rulesSummary(settings).map((r) => (
                    <li key={r} className="flex gap-2">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-signal" aria-hidden />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              <button
                type="button"
                className="flex w-full items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 font-semibold"
                aria-expanded={advanced}
                onClick={() => setAdvanced((a) => !a)}
              >
                Advanced rules
                <ChevronDown className={cn('size-5 transition-transform', advanced && 'rotate-180')} />
              </button>

              {advanced && (
                <div className="space-y-6">
                  <Field label="Game name">
                    <Input
                      value={settings.name === DEFAULT_SETTINGS.name ? '' : settings.name}
                      onChange={(e) => set('name', e.target.value || DEFAULT_SETTINGS.name)}
                      maxLength={LIMITS.gameNameMax}
                      placeholder={defaultGameName}
                    />
                  </Field>
                  <Slider label="Game length" min={10} max={180} step={5} value={settings.durationMin} onChange={(v) => set('durationMin', v)} format={(v) => `${v} min`} />
                  <div className="space-y-2">
                    <span className="label">Location ping every</span>
                    <Segmented value={settings.pingIntervalSec} onChange={(v) => set('pingIntervalSec', v)} options={pingOptions} size="sm" />
                  </div>
                  <Slider label="Runner head start" min={0} max={15} value={settings.headStartMin} onChange={(v) => set('headStartMin', v)} format={(v) => (v ? `${v} min` : 'None')} />
                  <Slider
                    label="Final phase (pings twice as often)"
                    min={0}
                    max={Math.max(0, Math.min(30, settings.durationMin - 5))}
                    step={5}
                    value={Math.min(settings.finalPhaseMin, Math.max(0, settings.durationMin - 5))}
                    onChange={(v) => set('finalPhaseMin', v)}
                    format={(v) => (v ? `last ${v} min` : 'Off')}
                  />
                  <div className="space-y-2">
                    <span className="label">When a runner is caught</span>
                    <Segmented
                      value={settings.mode}
                      onChange={(v) => set('mode', v)}
                      options={[
                        { value: 'classic', label: "They're out" },
                        { value: 'infection', label: 'They join the hunters' },
                      ]}
                    />
                  </div>
                  <Card className="py-1">
                    <Stepper label="Cloaks per runner" min={0} max={LIMITS.cloaksMax} value={settings.cloaksPerRunner} onChange={(v) => set('cloaksPerRunner', v)} />
                    <Stepper label="Radar sweeps (hunters)" min={0} max={LIMITS.sweepsMax} value={settings.sweepsPerGame} onChange={(v) => set('sweepsPerGame', v)} />
                  </Card>
                  <div className="space-y-2">
                    <span className="label">Teams</span>
                    <Segmented value={settings.teamAssignment} onChange={(v) => set('teamAssignment', v)} options={[{ value: 'auto', label: 'Auto-balance' }, { value: 'manual', label: 'Host assigns' }]} />
                  </div>
                  <div className="space-y-2">
                    <span className="label">Odd number of players: extra joins</span>
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
                    <Segmented value={settings.captureMethod} onChange={(v) => set('captureMethod', v)} options={[{ value: 'runner_confirm', label: 'Runner confirms' }, { value: 'host_confirm', label: 'Host confirms' }]} />
                  </div>
                  <Card className="divide-y divide-line py-1">
                    <Toggle checked={settings.tagCodeEnabled} onChange={(v) => set('tagCodeEnabled', v)} label="Instant tag codes" description="A runner's secret code or QR, shown in person, captures instantly." />
                    <Toggle checked={settings.revealAtHeadStartEnd} onChange={(v) => set('revealAtHeadStartEnd', v)} label="Ping when hunters are released" disabled={settings.headStartMin === 0} />
                    <Toggle checked={settings.hunterTeammatesVisible} onChange={(v) => set('hunterTeammatesVisible', v)} label="Hunters see each other live" />
                    <Toggle checked={settings.runnerTeammatesVisible} onChange={(v) => set('runnerTeammatesVisible', v)} label="Runners see each other live" description="Never visible to hunters." />
                    <Toggle checked={settings.allowSpectators} onChange={(v) => set('allowSpectators', v)} label="Allow spectators" description="They see the clock and captures, never locations." />
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
                        localStorage.setItem(PRESET_KEY, JSON.stringify({ ...settings, name: DEFAULT_SETTINGS.name }));
                        setSaved(true);
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    <Save className="size-4" /> {saved ? 'Saved as my default' : 'Save these rules as my default'}
                  </Button>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-start gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4">
                  <ShieldAlert className="mt-0.5 size-6 shrink-0 text-warn" />
                  <p className="text-sm leading-relaxed">Brief everyone on these rules before you start. Every player confirms them when they join.</p>
                </div>
                <ul className="space-y-2">
                  {SAFETY_RULES.map((r) => (
                    <li key={r.title} className="text-sm leading-relaxed text-muted">
                      <span className="font-semibold text-fg">{r.title}.</span> {r.body}
                    </li>
                  ))}
                </ul>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line-strong bg-surface-2 p-4">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 size-5 accent-[var(--mh-signal)]" />
                  <span className="text-sm leading-relaxed">I understand these safety rules and will make sure every player follows them.</span>
                </label>
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </ScreenShell>
  );
}
