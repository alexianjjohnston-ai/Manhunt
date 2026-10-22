import { AnimatePresence, motion } from 'motion/react';
import { Car } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { HoldButton } from '@/components/ui';
import { useGame } from '@/lib/game';
import { useLocation } from '@/lib/location';

const VEHICLE_SPEED_MPS = 7; // ~25 km/h: faster than running
const PASSENGER_ACK_MS = 20 * 60_000;

/**
 * Hunters may travel by car, but the driver must never use the phone.
 * When we detect vehicle speed (or the player enables driving mode), the screen
 * locks to a minimal, non-interactive view until a passenger unlocks it.
 * Pings and toasts are muted while locked so nothing invites a glance.
 */
export function DrivingGuard() {
  const fix = useLocation((s) => s.fix);
  const setQuiet = useGame((s) => s.setQuiet);
  const [manual, setManual] = useState(false);
  const [detected, setDetected] = useState(false);
  const [ackUntil, setAckUntil] = useState(0);
  const fastCount = useRef(0);

  useEffect(() => {
    const onToggle = () => setManual(true);
    window.addEventListener('manhunt:drivingMode', onToggle);
    return () => window.removeEventListener('manhunt:drivingMode', onToggle);
  }, []);

  useEffect(() => {
    if (!fix || fix.simulated) return;
    const fast = fix.speed != null && fix.speed > VEHICLE_SPEED_MPS && fix.accuracy < 50;
    fastCount.current = fast ? fastCount.current + 1 : 0;
    if (fastCount.current >= 2 && Date.now() > ackUntil) setDetected(true);
  }, [fix, ackUntil]);

  const locked = manual || detected;
  useEffect(() => {
    setQuiet(locked);
    return () => setQuiet(false);
  }, [locked, setQuiet]);

  return (
    <AnimatePresence>
      {locked && (
        <motion.div
          className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-6 bg-[#05070a] px-8 text-center text-white"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="alertdialog"
          aria-label="Driving lock"
        >
          <Car className="size-16 text-hunter" />
          <div>
            <h2 className="font-display text-3xl font-bold">{manual ? 'Driving mode' : 'Moving at vehicle speed'}</h2>
            <p className="mt-3 text-lg text-white/80">If you're driving, put the phone down and focus on the road. Pings can wait.</p>
            <p className="mt-2 text-white/60">Passengers can unlock the screen.</p>
          </div>
          <div className="w-full max-w-xs">
            <HoldButton
              variant="secondary"
              duration={2000}
              onConfirm={() => {
                setManual(false);
                setDetected(false);
                fastCount.current = 0;
                setAckUntil(Date.now() + PASSENGER_ACK_MS);
              }}
            >
              Hold: I'm a passenger
            </HoldButton>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
