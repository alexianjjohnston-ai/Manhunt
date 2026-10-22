import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export function QrCode({ value, className, label }: { value: string; className?: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 1, width: 512, errorCorrectionLevel: 'M', color: { dark: '#05080c', light: '#ffffff' } })
      .then((url) => !cancelled && setSrc(url))
      .catch(() => setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [value]);
  return (
    <div className={cn('aspect-square rounded-2xl bg-white p-3', className)}>
      {src ? <img src={src} alt={label} className="h-full w-full [image-rendering:pixelated]" /> : null}
    </div>
  );
}
