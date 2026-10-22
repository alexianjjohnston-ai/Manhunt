import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';

const CENTER = { latitude: 51.5007, longitude: -0.1246 };

interface Player {
  page: Page;
  frames: string[];
  setGeo(lat: number, lng: number, accuracy?: number): Promise<void>;
}

async function newPlayer(browser: Browser, info: TestInfo, geo = CENTER): Promise<Player> {
  const ctx = await browser.newContext({
    ...info.project.use,
    geolocation: { ...geo, accuracy: 10 },
    permissions: ['geolocation'],
  });
  const page = await ctx.newPage();
  const frames: string[] = [];
  page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
  return {
    page,
    frames,
    setGeo: (lat, lng, accuracy = 10) => ctx.setGeolocation({ latitude: lat, longitude: lng, accuracy }),
  };
}

/** Create a game through the API (fast test settings) and install the host session in the page. */
async function hostGame(p: Player, settings: Record<string, unknown> = {}) {
  const res = await p.page.request.post('/api/games', {
    data: {
      hostName: 'Hostie',
      settings: {
        name: 'E2E Hunt',
        maxPlayers: 8,
        durationMin: 10,
        pingIntervalSec: 15,
        headStartMin: 0,
        revealAtHeadStartEnd: false,
        teamAssignment: 'manual',
        extraPlayerTeam: 'hunter',
        captureMethod: 'runner_confirm',
        tagCodeEnabled: true,
        allowSpectators: false,
        hunterTeammatesVisible: true,
        runnerTeammatesVisible: true,
        lobbyLocked: false,
        ...settings,
      },
      boundary: { type: 'circle', center: { lat: CENTER.latitude, lng: CENTER.longitude }, radiusM: 2000 },
      safetyAck: true,
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { gameId: string; code: string; token: string; playerId: string };
  await p.page.addInitScript((s) => {
    localStorage.setItem('manhunt:sessions:v1', JSON.stringify({ [s.gameId]: { ...s, name: 'Hostie', savedAt: Date.now() } }));
  }, body);
  await p.page.goto(`/game/${body.gameId}`);
  await expect(p.page.getByTestId('join-code')).toHaveText(body.code);
  return body;
}

async function joinViaUi(p: Player, code: string, name: string) {
  await p.page.goto(`/join/${code}`);
  await p.page.getByPlaceholder('e.g. Sam').fill(name);
  await p.page.getByRole('checkbox').check();
  await p.page.getByRole('button', { name: /^Join game$/ }).click();
  await p.page.waitForURL(/\/game\//);
  await p.page.getByRole('button', { name: 'Allow location' }).click({ timeout: 3000 }).catch(() => {});
}

const teams = (p: Page) => p.getByRole('region', { name: 'Teams' });

async function assignTeam(host: Page, name: string, team: 'Runners' | 'Hunters') {
  await teams(host).getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await host.getByRole('dialog').getByRole('button', { name: team }).click();
}

test('host creates a private game through the setup wizard', async ({ browser }, info) => {
  const host = await newPlayer(browser, info);
  await host.page.goto('/');
  await expect(host.page.getByRole('heading', { name: /manhunt/i })).toBeVisible();
  await host.page.getByRole('button', { name: 'Create game' }).click();
  await host.page.getByPlaceholder('e.g. Alex').fill('Wizard');
  await host.page.getByRole('button', { name: /Continue/ }).click(); // timing
  await host.page.getByRole('button', { name: /Continue/ }).click(); // area
  await host.page.getByRole('button', { name: 'Use my location' }).click();
  await expect(host.page.getByText(/Play area ≈/)).toBeVisible();
  await host.page.getByRole('button', { name: /Continue/ }).click(); // rules
  await host.page.getByRole('button', { name: /Continue/ }).click(); // safety
  const create = host.page.getByRole('button', { name: /Create private game/ });
  await expect(create).toBeDisabled();
  await host.page.getByRole('checkbox').check();
  await create.click();
  await host.page.waitForURL(/\/game\//);
  await expect(host.page.getByTestId('join-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
  await expect(host.page.getByText('Location ready')).toBeVisible();
});

test('full game: join, timed reveal, capture confirmation, results', async ({ browser }, info) => {
  const host = await newPlayer(browser, info);
  const runner = await newPlayer(browser, info, { latitude: 51.5123, longitude: -0.1311 });
  const hunter = await newPlayer(browser, info, { latitude: 51.4977, longitude: -0.1201 });
  const { code } = await hostGame(host);

  await joinViaUi(runner, code, 'Rita');
  await joinViaUi(hunter, code, 'Hank');
  await assignTeam(host.page, 'Hostie', 'Hunters');
  await assignTeam(host.page, 'Hank', 'Hunters');
  await assignTeam(host.page, 'Rita', 'Runners');
  await expect(host.page.getByTestId('team-runner')).toContainText('Rita');

  // Non-host players ready up; the host starts.
  await runner.page.getByTestId('ready-button').click();
  await hunter.page.getByTestId('ready-button').click();
  await expect(host.page.getByTestId('start-blockers')).toHaveCount(0);
  await host.page.getByTestId('start-button').click();

  await expect(runner.page.getByTestId('ping-bar')).toBeVisible();
  await expect(hunter.page.getByTestId('ping-bar')).toBeVisible();

  // Before the first reveal hunters receive no runner coordinates at all.
  await runner.page.waitForTimeout(4000);
  expect(hunter.frames.join('\n')).not.toContain('51.5123');
  expect(host.frames.join('\n')).not.toContain('51.5123');

  // First reveal at 15 s: hunters see Rita's marker with its age.
  await expect(hunter.page.locator('.mh-runner-ping')).toHaveCount(1, { timeout: 25_000 });
  await expect(hunter.page.locator('.mh-marker', { hasText: 'Rita' })).toBeVisible();
  expect(hunter.frames.join('\n')).toContain('51.5123');
  await expect(hunter.page.getByText(/Seen .* ±\d+ m/)).toBeVisible();

  // Runner moves: hunters only learn the new coordinates through the NEXT reveal.
  const before = hunter.frames.length;
  await runner.setGeo(51.5155, -0.1333);
  await expect(hunter.page.locator('.mh-marker', { hasText: 'Rita' })).toBeVisible();
  await expect.poll(() => hunter.frames.slice(before).some((f) => f.includes('51.5155')), { timeout: 25_000 }).toBe(true);
  const later = hunter.frames.slice(before);
  const firstCoord = later.findIndex((f) => f.includes('51.5155'));
  const revealEvent = later.findIndex((f) => f.includes('"type":"ping_revealed"'));
  expect(revealEvent).toBeGreaterThanOrEqual(0);
  expect(firstCoord).toBeGreaterThan(revealEvent);

  // Runners never receive hunter coordinates.
  expect(runner.frames.join('\n')).not.toContain('51.4977');

  // Capture: hunter requests, runner confirms.
  await hunter.page.getByTestId('capture-button').click();
  await hunter.page.getByRole('button', { name: 'Rita Tagged' }).click();
  await expect(runner.page.getByRole('alertdialog')).toBeVisible();
  await runner.page.getByRole('button', { name: /Yes, I'm caught/ }).click();

  await expect(host.page.getByTestId('winner')).toHaveText(/hunters win/i);
  await expect(runner.page.getByTestId('winner')).toHaveText(/hunters win/i);
  await expect(host.page.getByText('Ping replay')).toBeVisible();
});

test('refreshing reconnects as the same player without duplicates', async ({ browser }, info) => {
  const host = await newPlayer(browser, info);
  const p2 = await newPlayer(browser, info);
  const { code } = await hostGame(host);
  await joinViaUi(p2, code, 'Rhea');
  await expect(teams(host.page).getByText('Rhea')).toBeVisible();
  await p2.page.reload();
  await expect(teams(p2.page).getByText('Rhea (you)')).toBeVisible();
  await p2.page.reload();
  await expect(teams(p2.page).getByText('Rhea (you)')).toBeVisible();
  await expect(teams(host.page).getByText('Rhea', { exact: true })).toHaveCount(1);
  await expect(teams(host.page).getByText(/2 players/)).toBeVisible();
});

test('host can remove a player and the removed player loses access', async ({ browser }, info) => {
  const host = await newPlayer(browser, info);
  const p2 = await newPlayer(browser, info);
  const { code } = await hostGame(host);
  await joinViaUi(p2, code, 'Kip');
  await teams(host.page).getByRole('button', { name: /^Kip/ }).click();
  const hold = host.page.getByRole('dialog').getByRole('button', { name: /Hold to remove/ });
  await hold.focus();
  await host.page.keyboard.press('Enter');
  await expect(p2.page.getByText('Removed from game')).toBeVisible();
  await p2.page.reload();
  await expect(p2.page.getByText(/Not joined on this device|Removed from game/)).toBeVisible();
});

test('core screens fit a phone without horizontal scrolling', async ({ browser }, info) => {
  const p = await newPlayer(browser, info);
  for (const path of ['/', '/create', '/join', '/join/ABCDEF', '/settings', '/rules', '/privacy']) {
    await p.page.goto(path);
    await p.page.waitForTimeout(300);
    const overflow = await p.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `overflow on ${path}`).toBeLessThanOrEqual(0);
  }
  await hostGame(p);
  const overflow = await p.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

async function startTwoPlayerGame(browser: Browser, info: TestInfo) {
  const host = await newPlayer(browser, info);
  const runner = await newPlayer(browser, info, { latitude: 51.5031, longitude: -0.1222 });
  const { code } = await hostGame(host, { pingIntervalSec: 60 });
  await joinViaUi(runner, code, 'Remy');
  await assignTeam(host.page, 'Hostie', 'Hunters');
  await assignTeam(host.page, 'Remy', 'Runners');
  await runner.page.getByTestId('ready-button').click();
  await host.page.getByTestId('start-button').click();
  await expect(runner.page.getByTestId('ping-bar')).toBeVisible();
  return { host, runner };
}

/** HoldButton also accepts Enter for keyboard / assistive-tech users. */
async function hold(page: Page, name: RegExp) {
  const b = page.getByRole('button', { name });
  await b.focus();
  await page.keyboard.press('Enter');
}

test('any player can trigger an emergency stop; sharing halts until the host resumes', async ({ browser }, info) => {
  const { host, runner } = await startTwoPlayerGame(browser, info);
  await runner.page.getByRole('button', { name: 'Menu' }).click();
  await hold(runner.page, /Hold for emergency stop/);
  for (const p of [host, runner]) await expect(p.page.getByRole('alert').filter({ hasText: 'Emergency stop' })).toBeVisible();
  await expect(runner.page.getByText('Only the host can resume.')).toBeVisible();
  const last = runner.frames.filter((f) => f.includes('"type":"state"')).at(-1)!;
  expect(last).toContain('"shareLocation":false');
  await hold(host.page, /Hold to resume game/);
  await expect(runner.page.getByRole('alert').filter({ hasText: 'Emergency stop' })).toHaveCount(0);
  await expect(runner.page.getByTestId('ping-bar')).toBeVisible();
});

test('a disputed capture goes to the host, who can reject it', async ({ browser }, info) => {
  const { host, runner } = await startTwoPlayerGame(browser, info);
  await host.page.getByTestId('capture-button').click();
  await host.page.getByRole('button', { name: 'Remy Tagged' }).click();
  await runner.page.getByRole('button', { name: /No, dispute it/ }).click();
  await expect(host.page.getByText(/Remy disputed the capture/)).toBeVisible();
  await host.page.getByRole('button', { name: 'Host dashboard' }).click();
  await host.page.getByRole('radio', { name: /Captures/ }).click();
  await host.page.getByRole('dialog').getByRole('button', { name: 'Reject' }).click();
  await expect(host.page.getByText(/rejected the capture of Remy/).first()).toBeVisible();
  await host.page.keyboard.press('Escape');
  await expect(runner.page.getByText('RUNNER', { exact: false }).first()).toBeVisible();
  await expect(runner.page.getByTestId('game-timer')).toBeVisible();
});

test('switching map styles keeps the play area and markers (even when tiles are offline)', async ({ browser }, info) => {
  const { host } = await startTwoPlayerGame(browser, info);
  const boundaryFeatures = () =>
    host.page.evaluate(() => {
      const m = (window as unknown as { __manhuntMap?: { getSource(id: string): { _data?: { geojson?: { features: unknown[] } } } | undefined } }).__manhuntMap;
      return m?.getSource('mh-boundary')?._data?.geojson?.features.length ?? -1;
    });
  await expect.poll(boundaryFeatures, { timeout: 20_000 }).toBe(1);
  for (let i = 0; i < 3; i++) {
    await host.page.getByRole('button', { name: /Map style/ }).click();
    await expect.poll(boundaryFeatures, { timeout: 20_000 }).toBe(1);
  }
  await expect(host.page.locator('.mh-self')).toBeVisible();
});

test('each revealed runner has exactly one marker across successive pings', async ({ browser }, info) => {
  const host = await newPlayer(browser, info);
  const runner = await newPlayer(browser, info, { latitude: 51.503, longitude: -0.1246 });
  const { code } = await hostGame(host);
  await joinViaUi(runner, code, 'Uno');
  await assignTeam(host.page, 'Hostie', 'Hunters');
  await assignTeam(host.page, 'Uno', 'Runners');
  await runner.page.getByTestId('ready-button').click();
  await host.page.getByTestId('start-button').click();
  await expect(host.page.locator('.mh-runner-ping')).toHaveCount(1, { timeout: 25_000 });
  await runner.setGeo(51.506, -0.12);
  // Second reveal (with radar pulse) must still leave a single marker.
  await expect.poll(() => host.frames.some((f) => f.includes('"seq":2')), { timeout: 25_000 }).toBe(true);
  await host.page.waitForTimeout(1000);
  await expect(host.page.locator('.mh-runner-ping')).toHaveCount(1);
});
