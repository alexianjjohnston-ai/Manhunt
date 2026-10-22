import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDistance(m: number, units: 'metric' | 'imperial'): string {
  if (units === 'imperial') {
    const ft = m * 3.28084;
    return ft < 1000 ? `${Math.round(ft)} ft` : `${(m / 1609.344).toFixed(1)} mi`;
  }
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function inviteUrl(code: string) {
  return `${location.origin}/join/${code}`;
}
