import { MapPin, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { LatLng } from '@shared/types';
import { Spinner } from '@/components/ui';
import { useAppConfig } from '@/lib/appConfig';
import { autocomplete, newPlacesSession, placeDetails, type PlaceDetails, type PlaceSuggestion } from '@/lib/google';

/** Google Places search for the play area. Renders nothing when no Google key is configured. */
export function PlaceSearch({ near, onPick }: { near: LatLng | null; onPick: (p: PlaceDetails) => void }) {
  const apiKey = useAppConfig((s) => s.config?.googleMapsApiKey ?? null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef(newPlacesSession());
  const pickedText = useRef<string | null>(null);
  const nearRef = useRef(near);
  nearRef.current = near;

  useEffect(() => {
    if (!apiKey || q.trim().length < 3 || q === pickedText.current) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setBusy(true);
      try {
        const r = await autocomplete(apiKey, q.trim(), nearRef.current, session.current);
        if (!cancelled) {
          setResults(r.slice(0, 5));
          setError(null);
        }
      } catch {
        if (!cancelled) setError('Search is unavailable right now. Use your location or tap the map.');
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q, apiKey]);

  if (!apiKey) return null;

  const pick = async (s: PlaceSuggestion) => {
    setBusy(true);
    try {
      const d = await placeDetails(apiKey, s.placeId, session.current);
      session.current = newPlacesSession(); // a pick ends the billing session
      setResults([]);
      pickedText.current = s.main;
      setQ(s.main);
      onPick(d);
    } catch {
      setError('Could not load that place. Try another search.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <label htmlFor="place-search" className="sr-only">
        Search for a park, address or landmark
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-faint" aria-hidden />
      <input
        id="place-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search a park, address or landmark"
        autoComplete="off"
        className="h-12 w-full rounded-xl border border-line-strong bg-surface-2 pr-10 pl-10 text-base text-fg outline-none placeholder:text-faint focus:border-ice"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls="place-results"
      />
      {busy && <Spinner className="absolute top-1/2 right-3 size-4 -translate-y-1/2" />}
      {results.length > 0 && (
        <ul id="place-results" role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-line-strong bg-surface shadow-xl">
          {results.map((r) => (
            <li key={r.placeId} role="option" aria-selected={false}>
              <button type="button" onClick={() => pick(r)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-surface-3">
                <MapPin className="mt-0.5 size-4 shrink-0 text-signal-ink" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.main}</span>
                  {r.secondary && <span className="block truncate text-sm text-muted">{r.secondary}</span>}
                </span>
              </button>
            </li>
          ))}
          <li className="px-3 py-1.5 text-right text-[10px] text-muted">Powered by Google</li>
        </ul>
      )}
      {error && <p className="mt-1 text-sm text-warn">{error}</p>}
    </div>
  );
}
