import { LocateFixed, Map as MapIcon, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { BROWSER_LIMITS } from '@/content';
import { ScreenShell } from '@/components/ScreenShell';
import { Button, Card, Pill, Segmented, Toggle } from '@/components/ui';
import { useAppConfig } from '@/lib/appConfig';
import { checkGoogle, type GoogleCheck } from '@/lib/google';
import { useLocation } from '@/lib/location';
import { usePrefs } from '@/lib/prefs';
import { navigate } from '@/lib/router';
import { sessions } from '@/lib/sessions';
import { wakeLockSupported } from '@/lib/wakelock';

export function SettingsScreen() {
  const prefs = usePrefs();
  const permission = useLocation((s) => s.permission);
  const fix = useLocation((s) => s.fix);
  const error = useLocation((s) => s.error);
  const requestPermission = useLocation((s) => s.requestPermission);
  const [testing, setTesting] = useState(false);
  const [cleared, setCleared] = useState(false);

  return (
    <ScreenShell title="Settings">
      <div className="space-y-6">
        <section className="space-y-2">
          <p className="label">Location</p>
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">Permission</span>
              <Pill tone={permission === 'granted' ? 'ok' : permission === 'denied' || permission === 'unsupported' ? 'danger' : 'warn'}>
                {permission === 'unknown' || permission === 'prompt' ? 'Not asked yet' : permission}
              </Pill>
            </div>
            {fix && (
              <p className="text-sm text-muted">
                Last fix: ±{Math.round(fix.accuracy)} m, {new Date(fix.timestamp).toLocaleTimeString()}
              </p>
            )}
            {error && <p className="text-sm text-warn">{error}</p>}
            <Button
              block
              loading={testing}
              onClick={async () => {
                setTesting(true);
                await requestPermission();
                setTesting(false);
              }}
            >
              <LocateFixed className="size-4" /> Test GPS
            </Button>
            <p className="text-xs text-muted">Testing reads your location once on this device. Nothing is sent to the server outside a running game.</p>
          </Card>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {BROWSER_LIMITS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>

        <MapsSection />

        <section className="space-y-2">
          <p className="label">Display</p>
          <Card className="divide-y divide-line py-1">
            <Toggle checked={prefs.daylight} onChange={(v) => prefs.set({ daylight: v, mapStyle: v ? 'daylight' : 'dark' })} label="Daylight mode" description="High-contrast light theme for bright sunlight." />
            <Toggle checked={prefs.largeText} onChange={(v) => prefs.set({ largeText: v })} label="Larger text" />
            <Toggle checked={prefs.reducedMotion} onChange={(v) => prefs.set({ reducedMotion: v })} label="Reduce motion" description="Turns off radar sweeps and animated transitions." />
          </Card>
          <div className="space-y-2 pt-2">
            <span className="label">Map</span>
            <Segmented value={prefs.mapStyle} onChange={(v) => prefs.set({ mapStyle: v })} options={[{ value: 'dark', label: 'Dark' }, { value: 'daylight', label: 'Light' }, { value: 'satellite', label: 'Satellite' }]} />
          </div>
          <div className="space-y-2 pt-2">
            <span className="label">Units</span>
            <Segmented value={prefs.units} onChange={(v) => prefs.set({ units: v })} options={[{ value: 'metric', label: 'Metric' }, { value: 'imperial', label: 'Imperial' }]} />
          </div>
        </section>

        <section className="space-y-2">
          <p className="label">Notifications & power</p>
          <Card className="divide-y divide-line py-1">
            <Toggle checked={prefs.sound} onChange={(v) => prefs.set({ sound: v })} label="Sounds" description="Sonar ping on reveals, alerts for captures." />
            <Toggle checked={prefs.haptics} onChange={(v) => prefs.set({ haptics: v })} label="Vibration" description="Where the device supports it (not iOS Safari)." />
            <Toggle checked={prefs.keepAwake} onChange={(v) => prefs.set({ keepAwake: v })} label="Keep screen awake in game" disabled={!wakeLockSupported()} description={wakeLockSupported() ? 'Strongly recommended for runners.' : 'Not supported by this browser.'} />
            <Toggle checked={prefs.lowBattery} onChange={(v) => prefs.set({ lowBattery: v })} label="Battery saver" description="Sends fewer, less precise updates. Pings may be less accurate." />
          </Card>
        </section>

        <section className="space-y-2">
          <p className="label">Privacy</p>
          <Card className="space-y-3">
            <p className="text-sm text-muted">Remove saved game sessions and preferences from this device.</p>
            <Button
              variant="outline"
              block
              onClick={() => {
                sessions.clear();
                try {
                  localStorage.removeItem('manhunt:prefs:v1');
                  localStorage.removeItem('manhunt:preset:v1');
                } catch {
                  /* ignore */
                }
                setCleared(true);
              }}
            >
              <Trash2 className="size-4" /> {cleared ? 'Cleared' : 'Clear local data'}
            </Button>
            <button type="button" className="text-sm font-medium text-ice" onClick={() => navigate('/privacy')}>
              Read how MANHUNT handles your location →
            </button>
          </Card>
        </section>
        <p className="pb-2 text-center text-xs text-muted">MANHUNT {import.meta.env.VITE_APP_VERSION}</p>
      </div>
    </ScreenShell>
  );
}

/** Which map provider is in use, and a live check of the Google key from this device. */
function MapsSection() {
  const loaded = useAppConfig((s) => s.loaded);
  const googleKey = useAppConfig((s) => s.config?.googleMapsApiKey ?? null);
  const basemap = useAppConfig((s) => s.basemap);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<GoogleCheck | null>(null);
  if (!loaded) return null;

  const status = !googleKey
    ? { tone: 'neutral' as const, text: 'OpenStreetMap' }
    : basemap?.provider === 'google'
      ? { tone: 'ok' as const, text: 'Google Maps' }
      : basemap?.provider === 'osm'
        ? { tone: 'warn' as const, text: 'Google refused' }
        : { tone: 'neutral' as const, text: 'Google Maps (not loaded yet)' };

  return (
    <section className="space-y-2" aria-labelledby="maps-label">
      <p className="label" id="maps-label">
        Maps
      </p>
      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">Map data</span>
          <span data-testid="maps-provider">
            <Pill tone={status.tone}>{status.text}</Pill>
          </span>
        </div>
        {!googleKey && <p className="text-sm text-muted">This server has no Google Maps key, so maps come from OpenStreetMap. The host can add one in the server&apos;s .env file.</p>}
        {basemap?.provider === 'osm' && basemap.googleError && (
          <p className="text-sm text-warn" data-testid="maps-error">
            {basemap.googleError} Using OpenStreetMap instead.
          </p>
        )}
        {googleKey && (
          <>
            <Button
              block
              loading={checking}
              onClick={async () => {
                setChecking(true);
                setResult(await checkGoogle(googleKey));
                setChecking(false);
              }}
            >
              <MapIcon className="size-4" /> Check Google Maps
            </Button>
            {result && (
              <ul className="space-y-1 text-sm" data-testid="maps-check">
                <li className={result.tiles ? 'text-warn' : 'text-ok'}>Map tiles: {result.tiles ?? 'working'}</li>
                <li className={result.places ? 'text-warn' : 'text-ok'}>Place search: {result.places ?? 'working'}</li>
              </ul>
            )}
          </>
        )}
      </Card>
    </section>
  );
}
