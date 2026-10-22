import { lazy, Suspense } from 'react';
import { Spinner } from './components/ui';
import { match, usePath } from './lib/router';
import { JoinScreen } from './screens/Join';
import { InfoScreen } from './screens/Info';
import { SettingsScreen } from './screens/Settings';
import { WelcomeScreen } from './screens/Welcome';

// The game screen pulls in MapLibre; load it on demand to keep the first paint fast.
const GameRoot = lazy(() => import('./screens/game/GameRoot'));
const CreateScreen = lazy(() => import('./screens/Create').then((m) => ({ default: m.CreateScreen })));

export function App() {
  const path = usePath();
  let screen: React.ReactNode;
  let m: Record<string, string> | null;
  if (path === '/') screen = <WelcomeScreen />;
  else if (path === '/create') screen = <CreateScreen />;
  else if (path === '/join') screen = <JoinScreen />;
  else if ((m = match('/join/:code', path))) screen = <JoinScreen initialCode={m.code} />;
  else if ((m = match('/game/:id', path))) screen = <GameRoot key={m.id} gameId={m.id!} />;
  else if (path === '/settings') screen = <SettingsScreen />;
  else if (path === '/rules') screen = <InfoScreen page="rules" />;
  else if (path === '/privacy') screen = <InfoScreen page="privacy" />;
  else screen = <WelcomeScreen />;
  return (
    <Suspense
      fallback={
        <div className="grid h-full place-items-center">
          <Spinner className="size-8" />
        </div>
      }
    >
      {screen}
    </Suspense>
  );
}
