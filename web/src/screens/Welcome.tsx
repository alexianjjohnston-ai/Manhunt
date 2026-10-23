import { motion } from 'motion/react';
import { ChevronRight, KeyRound, Plus, Settings, ShieldCheck, BookOpen } from 'lucide-react';
import { useState } from 'react';
import { RadarBackdrop } from '@/components/RadarBackdrop';
import { Button, Pill, Wordmark } from '@/components/ui';
import { isTestServer, useAppConfig } from '@/lib/appConfig';
import { navigate } from '@/lib/router';
import { sessions } from '@/lib/sessions';

export function WelcomeScreen() {
  const [saved] = useState(() => sessions.list().slice(0, 3));
  const testServer = useAppConfig((s) => isTestServer(s.config));
  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <RadarBackdrop />
      <div className="safe-top safe-x relative z-10 flex items-center justify-end gap-1">
        {testServer && (
          <span className="mr-auto" data-testid="test-server">
            <Pill tone="warn">Test server</Pill>
          </span>
        )}
        <button type="button" aria-label="Settings" onClick={() => navigate('/settings')} className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface-3/60 hover:text-fg">
          <Settings className="size-5" />
        </button>
      </div>

      <div className="safe-x relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <p className="label mb-3 text-ice">Real streets · Real chase</p>
          <h1>
            <Wordmark className="block text-[clamp(2.9rem,15vw,4.4rem)] leading-none" />
          </h1>
          <p className="mt-4 max-w-sm text-lg leading-relaxed text-muted">
            Runners go on foot. Hunters close in. Every <span className="font-semibold text-fg">5 minutes</span>, the runners' locations are revealed.
          </p>
        </motion.div>

        <motion.div
          className="mt-10 space-y-3"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
        >
          <Button variant="primary" size="xl" block onClick={() => navigate('/create')}>
            <Plus className="size-5" /> Create game
          </Button>
          <Button variant="glass" size="xl" block onClick={() => navigate('/join')}>
            <KeyRound className="size-5" /> Join with code
          </Button>
        </motion.div>

        {saved.length > 0 && (
          <motion.div className="mt-8 space-y-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
            <p className="label">Resume</p>
            {saved.map((s) => (
              <button
                key={s.gameId}
                type="button"
                onClick={() => navigate(`/game/${s.gameId}`)}
                className="glass flex w-full items-center gap-3 rounded-2xl border border-line px-4 py-3 text-left"
              >
                <span className="grid size-10 place-items-center rounded-xl bg-signal/15 font-mono text-xs font-bold text-signal-ink">{s.code.slice(0, 3)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{s.gameName ?? 'Game'}</span>
                  <span className="block text-sm text-muted">
                    as {s.name} · code {s.code}
                  </span>
                </span>
                <ChevronRight className="size-5 text-muted" />
              </button>
            ))}
          </motion.div>
        )}
      </div>

      <nav className="safe-x safe-bottom relative z-10 mx-auto flex w-full max-w-md justify-center gap-6 pt-4 text-sm text-muted">
        <button type="button" onClick={() => navigate('/rules')} className="inline-flex items-center gap-1.5 py-2 hover:text-fg">
          <BookOpen className="size-4" /> How to play
        </button>
        <button type="button" onClick={() => navigate('/privacy')} className="inline-flex items-center gap-1.5 py-2 hover:text-fg">
          <ShieldCheck className="size-4" /> Privacy & safety
        </button>
      </nav>
    </div>
  );
}
