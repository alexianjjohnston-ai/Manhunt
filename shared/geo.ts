import type { Boundary, LatLng } from './types';

const R = 6_371_008.8; // mean Earth radius (m)
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Destination point given start, bearing (deg) and distance (m). */
export function destination(from: LatLng, bearingDeg: number, distM: number): LatLng {
  const δ = distM / R;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(from.lat);
  const λ1 = toRad(from.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lng: ((toDeg(λ2) + 540) % 360) - 180 };
}

/** Ray-casting point-in-polygon on lat/lng (fine for city-scale areas). */
export function pointInPolygon(p: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const intersect = a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Approximate distance from a point to a segment using a local equirectangular projection. */
function distanceToSegmentM(p: LatLng, a: LatLng, b: LatLng): number {
  const k = Math.cos(toRad(p.lat));
  const ax = (a.lng - p.lng) * k, ay = a.lat - p.lat;
  const bx = (b.lng - p.lng) * k, by = b.lat - p.lat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.sqrt(cx * cx + cy * cy) * (Math.PI / 180) * R;
}

export function isInsideBoundary(p: LatLng, boundary: Boundary | null): boolean {
  if (!boundary) return true;
  if (boundary.type === 'circle') return distanceM(p, boundary.center) <= boundary.radiusM;
  return pointInPolygon(p, boundary.points);
}

/** Signed-ish helper: distance to the boundary edge in metres (always >= 0). */
export function distanceToEdgeM(p: LatLng, boundary: Boundary): number {
  if (boundary.type === 'circle') return Math.abs(boundary.radiusM - distanceM(p, boundary.center));
  let min = Infinity;
  const pts = boundary.points;
  for (let i = 0; i < pts.length; i++) {
    min = Math.min(min, distanceToSegmentM(p, pts[i]!, pts[(i + 1) % pts.length]!));
  }
  return min;
}

export type BoundaryStatus = 'inside' | 'near_edge' | 'outside' | 'none';

export function boundaryStatus(p: LatLng, boundary: Boundary | null, warnM = 60): BoundaryStatus {
  if (!boundary) return 'none';
  if (!isInsideBoundary(p, boundary)) return 'outside';
  return distanceToEdgeM(p, boundary) <= warnM ? 'near_edge' : 'inside';
}

/** Polygon ring approximating the boundary (for map rendering). */
export function boundaryRing(boundary: Boundary, steps = 96): LatLng[] {
  if (boundary.type === 'polygon') return boundary.points;
  const ring: LatLng[] = [];
  for (let i = 0; i < steps; i++) ring.push(destination(boundary.center, (360 * i) / steps, boundary.radiusM));
  return ring;
}

export function boundaryCenter(boundary: Boundary): LatLng {
  if (boundary.type === 'circle') return boundary.center;
  const n = boundary.points.length;
  const s = boundary.points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: s.lat / n, lng: s.lng / n };
}

export function boundaryBounds(boundary: Boundary): [[number, number], [number, number]] {
  const ring = boundaryRing(boundary, 48);
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (const p of ring) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}

/** Approximate area of the boundary in km². */
export function boundaryAreaKm2(boundary: Boundary): number {
  if (boundary.type === 'circle') return (Math.PI * boundary.radiusM ** 2) / 1e6;
  const pts = boundary.points;
  const lat0 = toRad(pts.reduce((s, p) => s + p.lat, 0) / pts.length);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    const ax = toRad(a.lng) * Math.cos(lat0) * R, ay = toRad(a.lat) * R;
    const bx = toRad(b.lng) * Math.cos(lat0) * R, by = toRad(b.lat) * R;
    area += ax * by - bx * ay;
  }
  return Math.abs(area) / 2 / 1e6;
}
