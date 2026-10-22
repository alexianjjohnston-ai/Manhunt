import { Circle, Hexagon, LocateFixed, Trash2, Undo2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { boundaryAreaKm2 } from '@shared/geo';
import { LIMITS } from '@shared/constants';
import type { Boundary, LatLng } from '@shared/types';
import { Button, Segmented, Slider } from '@/components/ui';
import { useLocation } from '@/lib/location';
import { usePrefs } from '@/lib/prefs';
import { formatDistance } from '@/lib/utils';
import { GameMap, type GameMapHandle } from './GameMap';

/**
 * Host tool for drawing the play area: a circle (tap to set the centre, slide the
 * radius) or a polygon (tap to drop corners).
 */
export function BoundaryEditor({ value, onChange }: { value: Boundary | null; onChange: (b: Boundary | null) => void }) {
  const mapRef = useRef<GameMapHandle>(null);
  const [mode, setMode] = useState<'circle' | 'polygon'>(value?.type ?? 'circle');
  const [points, setPoints] = useState<LatLng[]>(value?.type === 'polygon' ? value.points : []);
  const [radius, setRadius] = useState(value?.type === 'circle' ? value.radiusM : 800);
  const fix = useLocation((s) => s.fix);
  const requestFresh = useLocation((s) => s.requestFresh);
  const permission = useLocation((s) => s.permission);
  const units = usePrefs((s) => s.units);
  const mapStyle = usePrefs((s) => s.mapStyle);
  const [locating, setLocating] = useState(false);

  const setCircle = (center: LatLng, r = radius) => onChange({ type: 'circle', center, radiusM: r });

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
