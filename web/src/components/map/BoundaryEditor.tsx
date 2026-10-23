import { Circle, Hexagon, LocateFixed, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { boundaryAreaKm2 } from '@shared/geo';
import { LIMITS } from '@shared/constants';
import type { Boundary, LatLng } from '@shared/types';
import { Button, Segmented, Slider } from '@/components/ui';
import { useLocation } from '@/lib/location';
import { usePrefs } from '@/lib/prefs';
import { formatDistance } from '@/lib/utils';
import { GameMap, type GameMapHandle } from './GameMap';
import { PlaceSearch } from './PlaceSearch';

/** Suggested play-area radius: roomy enough to hide, small enough to find people on foot. */
export function recommendedRadiusM(players: number, durationMin: number) {
  const base = 250 + players * 45 + durationMin * 3;
  return Math.round(Math.min(2000, Math.max(300, base)) / 50) * 50;
}

/**
 * Host tool for drawing the play area: search a place, use your location, or tap the
 * map; then a circle (slide the radius) or a custom polygon (tap to drop corners).
 */
export function BoundaryEditor({
  value,
  onChange,
  recommendedRadius = 600,
}: {
  value: Boundary | null;
  onChange: (b: Boundary | null) => void;
  recommendedRadius?: number;
}) {
  const mapRef = useRef<GameMapHandle>(null);
  const [mode, setMode] = useState<'circle' | 'polygon'>(value?.type ?? 'circle');
  const [points, setPoints] = useState<LatLng[]>(value?.type === 'polygon' ? value.points : []);
  const [radius, setRadius] = useState(value?.type === 'circle' ? value.radiusM : recommendedRadius);
  const fix = useLocation((s) => s.fix);
  const requestFresh = useLocation((s) => s.requestFresh);
  const permission = useLocation((s) => s.permission);
  const units = usePrefs((s) => s.units);
  const mapStyle = usePrefs((s) => s.mapStyle);
  const [locating, setLocating] = useState(false);

  const setCircle = (center: LatLng, r = radius) => onChange({ type: 'circle', center, radiusM: r });

  // Easiest start: ask for the host's location once (they're choosing where to play),
  // then propose a circle around them.
  const requestPermission = useLocation((s) => s.requestPermission);
  useEffect(() => {
    if (!value && !fix && permission !== 'denied' && permission !== 'unsupported') void requestPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const proposed = useRef(!!value);
  useEffect(() => {
    if (proposed.current || !fix || mode !== 'circle') return;
    proposed.current = true;
    setCircle({ lat: fix.lat, lng: fix.lng });
    mapRef.current?.flyTo(fix, 14);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix]);

  const onMapClick = (p: LatLng) => {
    if (mode === 'circle') setCircle(p);
    else {
      if (points.length >= LIMITS.polygonPointsMax) return;
      const next = [...points, p];
      setPoints(next);
      onChange(next.length >= 3 ? { type: 'polygon', points: next } : null);
    }
  };

  const useMyLocation = async () => {
    setLocating(true);
    const f = (await requestFresh()) ?? fix;
    setLocating(false);
    if (!f) return;
    mapRef.current?.flyTo(f, 15);
    if (mode === 'circle') setCircle({ lat: f.lat, lng: f.lng });
  };

  return (
    <div className="space-y-3">
      <PlaceSearch
        near={value?.type === 'circle' ? value.center : fix}
        onPick={(place) => {
          proposed.current = true;
          setMode('circle');
          // Fit big places (a whole park) but never go below the recommended size.
          const r = Math.round(Math.min(3000, Math.max(recommendedRadius, place.sizeM ?? 0)) / 50) * 50;
          setRadius(r);
          setCircle(place.location, r);
          mapRef.current?.flyTo(place.location, r > 1200 ? 13 : 14);
        }}
      />
      <Segmented
        value={mode}
        onChange={(m) => {
          setMode(m);
          if (m === 'circle') {
            const c = mapRef.current?.center();
            if (c) setCircle(c);
          } else {
            setPoints([]);
            onChange(null);
          }
        }}
        options={[
          { value: 'circle', label: (<span className="inline-flex items-center gap-1.5"><Circle className="size-4" /> Circle</span>) },
          { value: 'polygon', label: (<span className="inline-flex items-center gap-1.5"><Hexagon className="size-4" /> Custom shape</span>) },
        ]}
      />
      <div className="relative h-[46dvh] min-h-72 overflow-hidden rounded-2xl border border-line">
        <GameMap
          ref={mapRef}
          className="absolute inset-0"
          boundary={value}
          self={fix ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, heading: null, stale: false } : null}
          initialCenter={fix}
          now={Date.now()}
          styleKey={mapStyle}
          onMapClick={onMapClick}
          editPoints={mode === 'polygon' ? points : undefined}
          showAccuracy={false}
        />
        <div className="pointer-events-none absolute inset-x-2 top-2 flex justify-center">
          <span className="glass rounded-full px-3 py-1.5 text-xs font-medium">
            {mode === 'circle' ? 'Tap the map to set the centre' : points.length < 3 ? `Tap to add corners (${points.length}/3+)` : 'Tap to add more corners'}
          </span>
        </div>
        <div className="absolute right-2 bottom-2 flex flex-col gap-2">
          <Button variant="glass" size="icon" aria-label="Use my location" onClick={useMyLocation} loading={locating} disabled={permission === 'unsupported'}>
            {!locating && <LocateFixed className="size-5" />}
          </Button>
          {mode === 'polygon' && (
            <>
              <Button
                variant="glass"
                size="icon"
                aria-label="Undo last corner"
                disabled={!points.length}
                onClick={() => {
                  const next = points.slice(0, -1);
                  setPoints(next);
                  onChange(next.length >= 3 ? { type: 'polygon', points: next } : null);
                }}
              >
                <Undo2 className="size-5" />
              </Button>
              <Button
                variant="glass"
                size="icon"
                aria-label="Clear shape"
                disabled={!points.length}
                onClick={() => {
                  setPoints([]);
                  onChange(null);
                }}
              >
                <Trash2 className="size-5" />
              </Button>
            </>
          )}
        </div>
      </div>
      {mode === 'circle' && radius !== recommendedRadius && (
        <button
          type="button"
          className="text-sm font-medium text-ice"
          onClick={() => {
            setRadius(recommendedRadius);
            if (value?.type === 'circle') setCircle(value.center, recommendedRadius);
          }}
        >
          Use recommended size ({formatDistance(recommendedRadius, units)})
        </button>
      )}
      {mode === 'circle' && (
        <Slider
          label="Radius"
          min={100}
          max={5000}
          step={50}
          value={radius}
          format={(v) => formatDistance(v, units)}
          onChange={(r) => {
            setRadius(r);
            if (value?.type === 'circle') setCircle(value.center, r);
          }}
        />
      )}
      <p className="text-sm text-muted">
        {value
          ? `Play area ≈ ${boundaryAreaKm2(value).toFixed(2)} km². Keep it walkable and avoid busy roads, water and private property.`
          : 'No play area set yet.'}
      </p>
    </div>
  );
}
