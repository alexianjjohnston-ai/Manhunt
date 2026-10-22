import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Info, Megaphone, OctagonAlert, Radar, ShieldCheck, Siren, XCircle } from 'lucide-react';
import { useGame, type ToastKind } from '@/lib/game';
import { cn } from '@/lib/utils';

const ICONS: Record<ToastKind, typeof Info> = {
  info: Info,
  ping: Radar,
  capture: ShieldCheck,
  warn: AlertTriangle,
  error: XCircle,
  success: ShieldCheck,
  announce: Megaphone,
  emergency: Siren,
};

const TONES: Record<ToastKind, string> = {
  info: 'text-ice',
  ping: 'text-runner',
  capture: 'text-signal',
  warn: 'text-warn',
  error: 'text-danger',
  success: 'text-ok',
  announce: 'text-hunter',
  emergency: 'text-danger',
};

/** Unobtrusive stacked notifications under the HUD. */
/** `inline` renders in the parent's flow (game HUD); otherwise toasts float at the bottom of the screen. */
export function Toasts({ inline }: { inline?: boolean }) {
  const toasts = useGame((s) => s.toasts);
  const dismiss = useGame((s) => s.dismiss);
  return (
    <div
      className={cn('pointer-events-none flex flex-col items-center gap-2', inline ? 'w-full' : 'fixed inset-x-0 z-40 px-3')}
      style={inline ? undefined : { bottom: 'calc(max(env(safe-area-inset-bottom), 0.75rem) + 5.5rem)' }}
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = ICONS[t.kind] ?? OctagonAlert;
          return (
            <motion.button
              layout
              key={t.id}
              type="button"
              onClick={() => dismiss(t.id)}
              initial={{ opacity: 0, y: -12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              className={cn(
                'glass pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-line px-4 py-3 text-left',
                t.kind === 'emergency' && 'border-danger bg-danger/20',
              )}
            >
              <Icon className={cn('mt-0.5 size-5 shrink-0', TONES[t.kind])} aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-snug">{t.title}</span>
                {t.body && <span className="mt-0.5 block text-sm text-muted">{t.body}</span>}
              </span>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
