import { LngLatBounds, Map as MLMap, Marker, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { formatAge } from '@shared/clock';
import { boundaryBounds, boundaryRing, destination } from '@shared/geo';
import type { Boundary, LatLng, Team } from '@shared/types';
import type { MapStyleKey } from '@/lib/prefs';
import { cn } from '@/lib/utils';
import { fallbackStyle, styleFor } from './mapStyles';

setWorkerUrl(workerUrl);

export interface SelfMarker {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  stale: boolean;
}

export interface MateMarker {
  id: string;
  name: string;
  team: Team;
  lat: number;
  lng: number;
  accuracyM: number;
  fixAt: number;
}

export interface PingMarker {
  id: string;
  name: string;
  lat: number;
  lng: number;
  accuracyM: number;
  fixAt: number;
  seq: number;
  /** ok = fresh reveal, stale = old fix at reveal time, old = last-known from an earlier ping */
  kind: 'ok' | 'stale' | 'old';
}

export interface CaptureMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
}

export interface GameMapHandle {
  recenter(): void;
  fitBoundary(): void;
  flyTo(p: LatLng, zoom?: number): void;
  center(): LatLng | null;
}

interface Props {
  boundary: Boundary | null;
  self?: SelfMarker | null;
  mates?: MateMarker[];
  pings?: PingMarker[];
  captures?: CaptureMarker[];
  /** Server "now" for marker age labels. */
  now: number;
  pulseKey?: number;
  styleKey: MapStyleKey;
  className?: string;
  bottomInset?: number;
  topInset?: number;
  initialCenter?: LatLng | null;
  onMapClick?: (p: LatLng) => void;
  editPoints?: LatLng[];
  showAccuracy?: boolean;
  interactive?: boolean;
}

const WORLD: [number, number][] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

function circleRing(c: LatLng, r: number, steps = 48): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const p = destination(c, (360 * i) / steps, Math.max(r, 1));
    ring.push([p.lng, p.lat]);
  }
  return ring;
}

function ringCoords(b: Boundary): [number, number][] {
  const r = boundaryRing(b).map((p) => [p.lng, p.lat] as [number, number]);
  r.push(r[0]!);
  return r;
}

/** Build/patch a marker element. Names are written with textContent (never innerHTML). */
function markerEl(kind: string, glyph: string, label?: string, sub?: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'mh-marker';
  el.dataset.kind = kind;
  const body = document.createElement('div');
  body.className = kind;
  if (glyph) {
    const s = document.createElement('span');
    s.textContent = glyph;
    body.appendChild(s);
  }
  el.appendChild(body);
  if (label) {
    const l = document.createElement('div');
    l.className = 'mh-label';
    l.append(document.createTextNode(label));
    const small = document.createElement('small');
    small.textContent = sub ?? '';
    l.appendChild(small);
    el.appendChild(l);
  }
  return el;
}

function setLabel(el: HTMLElement, label: string, sub: string) {
  const l = el.querySelector('.mh-label');
  if (!l) return;
  if (l.firstChild?.textContent !== label) l.firstChild!.textContent = label;
  const small = l.querySelector('small');
  if (small && small.textContent !== sub) small.textContent = sub;
}

function initials(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

export const GameMap = forwardRef<GameMapHandle, Props>(function GameMap(
  {
    boundary,
    self,
    mates = [],
    pings = [],
    captures = [],
    now,
    pulseKey = 0,
    styleKey,
    className,
    bottomInset = 0,
    topInset = 0,
    initialCenter,
    onMapClick,
    editPoints,
    showAccuracy = true,
    interactive = true,
  },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const [ready, setReady] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const [tilesDown, setTilesDown] = useState(false);
  const fittedOnce = useRef(false);
  const styleState = useRef<{ loaded: boolean; timer: number | undefined; arm: () => void }>({ loaded: false, timer: undefined, arm: () => {} });
  const styleKeyRef = useRef(styleKey);
  styleKeyRef.current = styleKey;
  const latest = useRef({ self, boundary, onMapClick });
  latest.current = { self, boundary, onMapClick };

  // --- init ------------------------------------------------------------------
  useEffect(() => {
    if (!container.current) return;
    let m: MLMap;
    try {
      const b = latest.current.boundary;
      const c = b ? (b.type === 'circle' ? b.center : boundaryRing(b)[0]!) : (initialCenter ?? latest.current.self ?? null);
      m = new MLMap({
        container: container.current,
        style: styleFor(styleKey),
        center: c ? [c.lng, c.lat] : [0, 20],
        zoom: c ? 14 : 1.5,
        attributionControl: { compact: true },
        pitchWithRotate: false,
        dragRotate: false,
        maxPitch: 0,
        interactive,
        fadeDuration: 0,
      });
      m.touchZoomRotate.disableRotation();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : 'WebGL unavailable');
      return;
    }
    map.current = m;
    (window as unknown as { __manhuntMap?: MLMap }).__manhuntMap = m;
    // Style loading with a fallback: if the basemap cannot load (offline, blocked tile host),
    // switch to a plain background so markers, boundary and accuracy circles still render.
    const armFallback = () => {
      styleState.current.loaded = false;
      window.clearTimeout(styleState.current.timer);
      styleState.current.timer = window.setTimeout(() => {
        if (!styleState.current.loaded) useFallback();
      }, 9000);
    };
    const useFallback = () => {
      window.clearTimeout(styleState.current.timer);
      styleState.current.loaded = true;
      setTilesDown(true);
      m.setStyle(fallbackStyle(styleKeyRef.current), { diff: false });
    };
    styleState.current.arm = armFallback;
    armFallback();
    m.on('style.load', () => {
      styleState.current.loaded = true;
      window.clearTimeout(styleState.current.timer);
      ensureLayers(m);
      setReady((r) => r + 1);
    });
    m.on('error', (e) => {
      const msg = String((e as unknown as { error?: { message?: string } }).error?.message ?? '');
      if (!styleState.current.loaded && /style|fetch|Failed|NetworkError|load/i.test(msg)) useFallback();
    });
    m.on('click', (e) => latest.current.onMapClick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(container.current);
    return () => {
      window.clearTimeout(styleState.current.timer);
      ro.disconnect();
      for (const mk of markers.current.values()) mk.remove();
      markers.current.clear();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- basemap switching -----------------------------------------------------
  const firstStyle = useRef(true);
  useEffect(() => {
    if (firstStyle.current) {
      firstStyle.current = false;
      return;
    }
    const m = map.current;
    if (!m) return;
    setTilesDown(false);
    styleState.current.arm();
    m.setStyle(styleFor(styleKey), { diff: false });
  }, [styleKey]);

  // --- data layers -----------------------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !m.getSource('mh-mask')) return;
    const src = (id: string) => m.getSource(id) as GeoJSONSource | undefined;

    const maskFeatures = boundary
      ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [WORLD, ringCoords(boundary).reverse()] } }]
      : [];
    src('mh-mask')?.setData({ type: 'FeatureCollection', features: maskFeatures });
    src('mh-boundary')?.setData({
      type: 'FeatureCollection',
      features: boundary ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ringCoords(boundary) } }] : [],
    });

    const acc: GeoJSON.Feature[] = [];
    if (showAccuracy) {
      if (self && self.accuracy > 5) acc.push(accFeature(self, self.accuracy, '#8be3ff'));
      for (const p of pings) if (p.accuracyM > 5) acc.push(accFeature(p, p.accuracyM, p.kind === 'old' ? '#64748b' : '#38d7f5'));
      for (const mt of mates) if (mt.accuracyM > 10) acc.push(accFeature(mt, mt.accuracyM, mt.team === 'hunter' ? '#ffa21f' : '#38d7f5'));
    }
    src('mh-acc')?.setData({ type: 'FeatureCollection', features: acc });

    src('mh-edit')?.setData({
      type: 'FeatureCollection',
      features: (editPoints ?? []).map((p, i) => ({
        type: 'Feature',
        properties: { i },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
    });
  }, [ready, boundary, self, pings, mates, editPoints, showAccuracy]);

  // Fit to the boundary on first load.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || fittedOnce.current) return;
    fittedOnce.current = true;
    if (boundary) {
      m.fitBounds(boundaryBounds(boundary), { padding: { top: 90 + topInset, bottom: 60 + bottomInset, left: 30, right: 30 }, duration: 0 });
    } else if (self) {
      m.jumpTo({ center: [self.lng, self.lat], zoom: 15 });
    }
  }, [ready, boundary, self, bottomInset, topInset]);

  // --- DOM markers -------------------------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    const upsert = (key: string, lngLat: [number, number], build: () => HTMLElement, update?: (el: HTMLElement) => void, z = 0) => {
      seen.add(key);
      let mk = markers.current.get(key);
      if (!mk) {
        const el = build();
        el.style.zIndex = String(z);
        mk = new Marker({ element: el, anchor: 'center' }).setLngLat(lngLat).addTo(m);
        markers.current.set(key, mk);
      } else {
        mk.setLngLat(lngLat);
        update?.(mk.getElement());
      }
    };

    for (const c of captures) {
      upsert(`cap:${c.id}`, [c.lng, c.lat], () => markerEl('mh-capture', '✕', c.label, 'captured'), undefined, 1);
    }
    for (const p of pings) {
      const sub = `${p.kind === 'old' ? 'last known · ' : p.kind === 'stale' ? 'stale fix · ' : ''}${formatAge(now - p.fixAt)}`;
      const cls = `mh-runner-ping${p.kind === 'stale' ? ' is-stale' : p.kind === 'old' ? ' is-old' : ''}`;
      upsert(
        `ping:${p.id}:${p.kind}`,
        [p.lng, p.lat],
        () => markerEl(cls, initials(p.name), p.name, sub),
        (el) => {
          setLabel(el, p.name, sub);
          const body = el.firstElementChild as HTMLElement;
          if (body.className !== cls) body.className = cls;
        },
        3,
      );
    }
    for (const mt of mates) {
      const sub = formatAge(now - mt.fixAt);
      upsert(
        `mate:${mt.id}`,
        [mt.lng, mt.lat],
        () => markerEl(mt.team === 'hunter' ? 'mh-mate-hunter' : 'mh-mate-runner', mt.team === 'hunter' ? '' : initials(mt.name), mt.name, sub),
        (el) => setLabel(el, mt.name, sub),
        2,
      );
    }
    if (self) {
      upsert(
        'self',
        [self.lng, self.lat],
        () => {
          const el = document.createElement('div');
          el.className = 'mh-marker';
          el.setAttribute('aria-label', 'Your location');
          const h = document.createElement('div');
          h.className = 'mh-heading';
          el.appendChild(h);
          const dot = document.createElement('div');
          dot.className = 'mh-self';
          el.appendChild(dot);
          return el;
        },
        undefined,
        5,
      );
      const el = markers.current.get('self')!.getElement();
      const h = el.querySelector<HTMLElement>('.mh-heading')!;
      h.style.display = self.heading != null && !self.stale ? 'block' : 'none';
      if (self.heading != null) h.style.transform = `rotate(${self.heading}deg)`;
      el.querySelector('.mh-self')!.classList.toggle('is-stale', self.stale);
    }
    for (const [key, mk] of markers.current) {
      if (!seen.has(key)) {
        mk.remove();
        markers.current.delete(key);
      }
    }
  }, [self, mates, pings, captures, now, ready]);

  // --- radar pulse on new reveals ------------------------------------------------
  useEffect(() => {
    if (!pulseKey) return;
    for (const [key, mk] of markers.current) {
      if (!key.startsWith('ping:') || key.endsWith(':old')) continue;
      const el = mk.getElement();
      const ring = document.createElement('div');
      ring.className = 'mh-pulse';
      el.prepend(ring);
      window.setTimeout(() => ring.remove(), 7500);
    }
  }, [pulseKey]);

  useImperativeHandle(ref, () => ({
    recenter() {
      const s = latest.current.self;
      if (s) map.current?.easeTo({ center: [s.lng, s.lat], zoom: Math.max(map.current.getZoom(), 15), duration: 600 });
      else if (latest.current.boundary) this.fitBoundary();
    },
    fitBoundary() {
      const b = latest.current.boundary;
      if (b) map.current?.fitBounds(boundaryBounds(b), { padding: { top: 90 + topInset, bottom: 60 + bottomInset, left: 30, right: 30 }, duration: 600 });
    },
    flyTo(p, zoom = 16) {
      map.current?.easeTo({ center: [p.lng, p.lat], zoom, duration: 700 });
    },
    center() {
      const c = map.current?.getCenter();
      return c ? { lat: c.lat, lng: c.lng } : null;
    },
  }));

  if (failed) {
    return (
      <div className={cn('grid place-items-center bg-surface-2 p-6 text-center grid-bg', className)}>
        <div className="max-w-xs space-y-2">
          <p className="font-display text-lg font-bold">Map unavailable</p>
          <p className="text-sm text-muted">
            This browser could not start the map (WebGL is required). Game timers, pings and captures still work — use the lists below.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('relative', className)} style={{ ['--map-bottom-inset' as string]: `${bottomInset}px` }}>
      {/* maplibre forces position:relative on its container, so size it explicitly */}
      <div ref={container} className="h-full w-full" data-testid="game-map" />
      {tilesDown && (
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2.5 py-0.5 text-[10px] whitespace-nowrap text-white/80" style={{ bottom: bottomInset + 4 }}>
          Map tiles offline · positions still accurate
        </div>
      )}
    </div>
  );
});

function accFeature(p: LatLng, r: number, color: string): GeoJSON.Feature {
  return { type: 'Feature', properties: { color }, geometry: { type: 'Polygon', coordinates: [circleRing(p, r)] } };
}

function ensureLayers(m: MLMap) {
  const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  for (const id of ['mh-mask', 'mh-boundary', 'mh-acc', 'mh-edit']) {
    if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: empty });
  }
  if (!m.getLayer('mh-mask')) {
    m.addLayer({ id: 'mh-mask', type: 'fill', source: 'mh-mask', paint: { 'fill-color': '#05070a', 'fill-opacity': 0.5 } });
  }
  if (!m.getLayer('mh-boundary-glow')) {
    m.addLayer({
      id: 'mh-boundary-glow',
      type: 'line',
      source: 'mh-boundary',
      paint: { 'line-color': '#ff4b2b', 'line-width': 10, 'line-opacity': 0.18, 'line-blur': 4 },
    });
  }
  if (!m.getLayer('mh-boundary')) {
    m.addLayer({
      id: 'mh-boundary',
      type: 'line',
      source: 'mh-boundary',
      paint: { 'line-color': '#ff4b2b', 'line-width': 2.5, 'line-dasharray': [3, 2] },
    });
  }
  if (!m.getLayer('mh-acc')) {
    m.addLayer({ id: 'mh-acc', type: 'fill', source: 'mh-acc', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.14 } });
    m.addLayer({ id: 'mh-acc-line', type: 'line', source: 'mh-acc', paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.5, 'line-width': 1 } });
  }
  if (!m.getLayer('mh-edit')) {
    m.addLayer({
      id: 'mh-edit',
      type: 'circle',
      source: 'mh-edit',
      paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-stroke-color': '#ff4b2b', 'circle-stroke-width': 3 },
    });
  }
}

export { LngLatBounds };
