import jsQR from 'jsqr';
import { CameraOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * Camera QR scanner (works on iOS Safari and Android Chrome; uses jsQR because
 * BarcodeDetector is not available everywhere). Calls onCode once per new value.
 */
export function QrScanner({ onCode }: { onCode: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<string | null>(null);
  const cb = useRef(onCode);
  cb.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera not supported in this browser');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stopped) return;
        const v = video.current!;
        v.srcObject = stream;
        v.setAttribute('playsinline', 'true');
        await v.play();
        const ctx = canvas.current!.getContext('2d', { willReadFrequently: true })!;
        const scan = () => {
          if (stopped) return;
          if (v.readyState === v.HAVE_ENOUGH_DATA) {
            const w = 360;
            const h = Math.round((v.videoHeight / v.videoWidth) * w) || 360;
            canvas.current!.width = w;
            canvas.current!.height = h;
            ctx.drawImage(v, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const res = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
            if (res?.data && res.data !== last.current) {
              last.current = res.data;
              cb.current(res.data);
            }
          }
          raf = requestAnimationFrame(scan);
        };
        raf = requestAnimationFrame(scan);
      } catch (e) {
        setError(e instanceof Error && e.name === 'NotAllowedError' ? 'Camera permission denied' : e instanceof Error ? e.message : 'Camera unavailable');
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (error) {
    return (
      <div className="grid aspect-square place-items-center rounded-2xl border border-line bg-surface-2 p-6 text-center text-sm text-muted">
        <div className="space-y-2">
          <CameraOff className="mx-auto size-8" />
          <p>{error}. Type the 4-digit code instead.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="relative aspect-square overflow-hidden rounded-2xl bg-black">
      <video ref={video} className="h-full w-full object-cover" muted playsInline />
      <canvas ref={canvas} className="hidden" />
      <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_999px_rgb(0_0_0/0.35)]" />
    </div>
  );
}
