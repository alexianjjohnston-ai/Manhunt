import { cva, type VariantProps } from 'class-variance-authority';
import { AnimatePresence, motion } from 'motion/react';
import { Crosshair, Eye, Footprints, Loader2, X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { Team } from '@shared/types';
import { cue } from '@/lib/feedback';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export const buttonVariants = cva(
  'relative inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap transition-[transform,background,opacity,box-shadow] duration-150 active:scale-[0.97] disabled:opacity-45 disabled:pointer-events-none select-none',
  {
    variants: {
      variant: {
        primary:
          'bg-signal text-signal-fg shadow-[0_8px_24px_-8px_color-mix(in_srgb,var(--mh-signal)_70%,transparent)] hover:brightness-110',
        secondary: 'bg-surface-3 text-fg border border-line-strong hover:bg-surface-2',
        ghost: 'text-fg hover:bg-surface-3/60',
        outline: 'border border-line-strong text-fg hover:bg-surface-3/50',
        danger: 'bg-danger text-white hover:brightness-110',
        runner: 'bg-runner text-[#031018] hover:brightness-110',
        hunter: 'bg-hunter text-[#1a0e00] hover:brightness-110',
        glass: 'glass text-fg border border-line',
      },
      size: {
        sm: 'h-9 px-3 text-sm rounded-lg',
        md: 'h-11 px-4 text-[0.95rem] rounded-xl',
        lg: 'h-13 px-5 text-base rounded-2xl',
        xl: 'h-15 px-6 text-lg rounded-2xl',
        icon: 'h-11 w-11 rounded-xl',
        iconLg: 'h-13 w-13 rounded-2xl',
      },
      block: { true: 'w-full' },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, loading, children, disabled, onClick, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled || loading}
      onClick={(e) => {
        cue('tap');
        onClick?.(e);
      }}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Hold-to-confirm (destructive / safety-critical actions; hard to trigger by accident)
// ---------------------------------------------------------------------------

export function HoldButton({
  onConfirm,
  children,
  duration = 1200,
  className,
  variant = 'danger',
  size = 'lg',
  disabled,
}: {
  onConfirm: () => void;
  children: ReactNode;
  duration?: number;
  className?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  disabled?: boolean;
}) {
  const [progress, setProgress] = useState(0);
  const raf = useRef<number | null>(null);
  const start = useRef(0);
  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    setProgress(0);
  };
  const begin = () => {
    if (disabled) return;
    start.current = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - start.current) / duration);
      setProgress(p);
      if (p >= 1) {
        stop();
        cue('success');
        onConfirm();
      } else raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(buttonVariants({ variant, size, block: true }), 'overflow-hidden touch-none', className)}
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onConfirm();
        }
      }}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-white/25"
        style={{ width: `${progress * 100}%` }}
      />
      <span className="relative flex items-center gap-2">{children}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-13 w-full rounded-xl border border-line-strong bg-surface-2 px-4 text-base text-fg placeholder:text-faint outline-none transition focus:border-ice focus:ring-2 focus:ring-ice/25',
        className,
      )}
      {...props}
    />
  );
});

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="label">{label}</span>
      {children}
      {error ? <span className="block text-sm text-danger">{error}</span> : hint ? <span className="block text-sm text-muted">{hint}</span> : null}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-center justify-between gap-4 py-3', disabled && 'opacity-50')}>
      <div className="min-w-0">
        <label htmlFor={id} className="block font-medium">
          {label}
        </label>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => {
          cue('tap');
          onChange(!checked);
        }}
        className={cn(
          'relative h-8 w-13 shrink-0 rounded-full border transition-colors',
          checked ? 'border-transparent bg-signal' : 'border-line-strong bg-surface-3',
        )}
      >
        <span
          className={cn(
            'absolute top-1/2 size-6 -translate-y-1/2 rounded-full bg-white shadow transition-[left]',
            checked ? 'left-[calc(100%-1.75rem)]' : 'left-0.5',
          )}
        />
      </button>
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  className,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: ReactNode; hint?: string }[];
  onChange: (v: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" className={cn('flex rounded-xl border border-line bg-surface-2 p-1', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.hint}
            onClick={() => {
              cue('tap');
              onChange(o.value);
            }}
            className={cn(
              'relative flex-1 rounded-lg font-semibold transition-colors',
              size === 'sm' ? 'h-8 text-xs' : 'h-10 text-sm',
              active ? 'text-fg' : 'text-muted hover:text-fg',
            )}
          >
            {active && (
              <motion.span
                layoutId={undefined}
                className="absolute inset-0 rounded-lg border border-line-strong bg-surface-3 shadow-sm"
                initial={false}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  label: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="font-mono text-lg font-semibold tabular">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mh-range h-10 w-full cursor-pointer appearance-none bg-transparent"
        style={{ ['--pct' as string]: `${pct}%` }}
      />
    </div>
  );
}

export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="font-medium">{label}</span>
      <div className="flex items-center gap-1 rounded-xl border border-line bg-surface-2 p-1">
        <button type="button" aria-label={`Decrease ${label}`} className="size-10 rounded-lg text-xl font-semibold hover:bg-surface-3 disabled:opacity-30" disabled={value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
        <span className="w-10 text-center font-mono text-lg font-semibold tabular">{value}</span>
        <button type="button" aria-label={`Increase ${label}`} className="size-10 rounded-lg text-xl font-semibold hover:bg-surface-3 disabled:opacity-30" disabled={value >= max} onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-2xl border border-line bg-surface p-4', className)} {...rest}>
      {children}
    </div>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
  dismissible = true,
  tall,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
  tall?: boolean;
}) {
  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissible, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
          <motion.div
            className="absolute inset-0 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => dismissible && onClose()}
          />
          <motion.div
            className={cn(
              'relative flex w-full max-w-lg flex-col rounded-t-3xl border border-b-0 border-line-strong bg-surface safe-bottom',
              tall ? 'h-[88dvh]' : 'max-h-[88dvh]',
              className,
            )}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 340 }}
            drag={dismissible ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (dismissible && (info.offset.y > 120 || info.velocity.y > 600)) onClose();
            }}
          >
            <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-line-strong" aria-hidden />
            {(title || dismissible) && (
              <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-3 pb-2">
                <h2 className="font-display text-xl font-bold">{title}</h2>
                {dismissible && (
                  <button type="button" aria-label="Close" onClick={onClose} className="-mr-2 grid size-10 place-items-center rounded-full text-muted hover:bg-surface-3">
                    <X className="size-5" />
                  </button>
                )}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-2" onPointerDownCapture={(e) => e.stopPropagation()}>
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Team identity: colour + shape + icon + text (never colour alone)
// ---------------------------------------------------------------------------

export const TEAM_LABEL: Record<Team, string> = { runner: 'Runner', hunter: 'Hunter', spectator: 'Spectator' };

export function TeamIcon({ team, className }: { team: Team | null; className?: string }) {
  if (team === 'runner') return <Footprints className={className} aria-hidden />;
  if (team === 'hunter') return <Crosshair className={className} aria-hidden />;
  return <Eye className={className} aria-hidden />;
}

export function TeamBadge({ team, className, size = 'md' }: { team: Team | null; className?: string; size?: 'sm' | 'md' }) {
  const styles =
    team === 'runner'
      ? 'bg-runner/15 text-runner border-runner/40'
      : team === 'hunter'
        ? 'bg-hunter/15 text-hunter border-hunter/40'
        : 'bg-surface-3 text-muted border-line-strong';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-semibold uppercase tracking-wider',
        size === 'sm' ? 'px-2 py-0.5 text-[0.62rem]' : 'px-2.5 py-1 text-[0.7rem]',
        styles,
        className,
      )}
    >
      <TeamIcon team={team} className={size === 'sm' ? 'size-3' : 'size-3.5'} />
      {team ? TEAM_LABEL[team] : 'No team'}
    </span>
  );
}

/** Small team glyph that mirrors the map marker shapes: diamond = runner, triangle = hunter. */
export function TeamGlyph({ team, className }: { team: Team | null; className?: string }) {
  if (team === 'runner')
    return (
      <svg viewBox="0 0 16 16" className={cn('size-4', className)} aria-hidden>
        <rect x="3.2" y="3.2" width="9.6" height="9.6" rx="2" transform="rotate(45 8 8)" fill="var(--mh-runner)" />
      </svg>
    );
  if (team === 'hunter')
    return (
      <svg viewBox="0 0 16 16" className={cn('size-4', className)} aria-hidden>
        <path d="M8 2 L14.5 13.5 H1.5 Z" fill="var(--mh-hunter)" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" className={cn('size-4', className)} aria-hidden>
      <circle cx="8" cy="8" r="5" fill="none" stroke="var(--mh-muted)" strokeWidth="2" />
    </svg>
  );
}

export function Pill({ children, className, tone = 'neutral' }: { children: ReactNode; className?: string; tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'signal' | 'ice' }) {
  const tones = {
    neutral: 'bg-surface-3 text-muted border-line',
    ok: 'bg-ok/15 text-ok border-ok/30',
    warn: 'bg-warn/15 text-warn border-warn/30',
    danger: 'bg-danger/15 text-danger border-danger/30',
    signal: 'bg-signal/15 text-signal border-signal/30',
    ice: 'bg-ice/15 text-ice border-ice/30',
  };
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold', tones[tone], className)}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-muted', className)} aria-label="Loading" />;
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-display font-bold tracking-[0.18em] uppercase', className)}>
      Man<span className="text-signal">hunt</span>
    </span>
  );
}
