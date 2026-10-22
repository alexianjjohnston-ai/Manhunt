import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/utils';

/** Scrollable page layout with a sticky header and safe-area padding. */
export function ScreenShell({
  title,
  back = '/',
  onBack,
  children,
  footer,
  right,
  className,
}: {
  title?: ReactNode;
  back?: string | null;
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="safe-top safe-x sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-bg/85 pb-3 backdrop-blur">
        {(back !== null || onBack) && (
          <button
            type="button"
            aria-label="Back"
            onClick={() => (onBack ? onBack() : navigate(back ?? '/'))}
            className="-ml-2 grid size-11 place-items-center rounded-full hover:bg-surface-3"
          >
            <ArrowLeft className="size-5" />
          </button>
        )}
        <h1 className="min-w-0 flex-1 truncate font-display text-xl font-bold">{title}</h1>
        {right}
      </header>
      <main className={cn('safe-x mx-auto w-full max-w-lg flex-1 overflow-y-auto py-5', className)}>{children}</main>
      {footer && <footer className="safe-x safe-bottom mx-auto w-full max-w-lg border-t border-line bg-bg pt-3">{footer}</footer>}
    </div>
  );
}
