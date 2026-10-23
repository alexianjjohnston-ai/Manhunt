import { expect, test } from '@playwright/test';

/**
 * Google Maps integration against a mocked Google API (no real key or network needed).
 * Runs against the second test server, which is started with GOOGLE_MAPS_API_KEY set.
 */
const GOOGLE_SERVER = 'http://localhost:8798';

// 1×1 PNG used for every map tile.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test('uses Google Maps tiles and Places search when a key is configured', async ({ browser }, info) => {
  const ctx = await browser.newContext({ ...info.project.use, baseURL: GOOGLE_SERVER, geolocation: { latitude: 51.5, longitude: -0.12, accuracy: 10 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  const calls: string[] = [];
  let referer: string | undefined;
  const placesKeys = new Set<string>();
  await page.route('https://tile.googleapis.com/**', async (route) => {
    const url = route.request().url();
    calls.push(url);
    referer ??= await route.request().headerValue('referer') ?? undefined;
    if (url.includes('/v1/createSession')) {
      const body = route.request().postDataJSON() as { mapType: string };
      return route.fulfill({ json: { session: `sess-${body.mapType}`, expiry: String(Math.floor(Date.now() / 1000) + 86400 * 13), tileWidth: 512, tileHeight: 512, imageFormat: 'png' } });
    }
    if (url.includes('/tile/v1/viewport')) return route.fulfill({ json: { copyright: 'Map data ©2026 Google' } });
    if (url.includes('/v1/2dtiles/')) return route.fulfill({ body: PNG, contentType: 'image/png' });
    return route.fulfill({ status: 404 });
  });
  await page.route('https://places.googleapis.com/**', async (route) => {
    const url = route.request().url();
    calls.push(url);
    const k = route.request().headers()['x-goog-api-key'];
    if (k) placesKeys.add(k);
    if (url.endsWith('/v1/places:autocomplete')) {
      return route.fulfill({
        json: { suggestions: [{ placePrediction: { placeId: 'hyde', text: { text: 'Hyde Park, London' }, structuredFormat: { mainText: { text: 'Hyde Park' }, secondaryText: { text: 'London, UK' } } } }] },
      });
    }
    if (url.includes('/v1/places/hyde')) {
      return route.fulfill({
        json: {
          displayName: { text: 'Hyde Park' },
          location: { latitude: 51.5073, longitude: -0.1657 },
          viewport: { low: { latitude: 51.5005, longitude: -0.1795 }, high: { latitude: 51.5135, longitude: -0.1525 } },
        },
      });
    }
    return route.fulfill({ status: 404 });
  });

  await page.goto('/create');
  await page.getByPlaceholder('e.g. Alex').fill('Gee');
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('combobox').fill('hyde pa');
  await page.getByRole('option', { name: /Hyde Park/ }).click();
  await expect(page.getByText(/Play area ≈/)).toBeVisible();
  expect([...placesKeys]).toEqual(['test-google-key']);

  // Tiles come from Google through a Map Tiles API session, with attribution shown.
  await expect.poll(() => calls.some((u) => u.includes('/v1/2dtiles/') && u.includes('session=sess-roadmap'))).toBe(true);
  await expect(page.getByTestId('google-attribution')).toContainText('Map data ©2026 Google');
  expect(calls.some((u) => u.includes('/v1/createSession?key=test-google-key'))).toBe(true);
  // Referrer-restricted keys work: Google sees our origin, never the full path.
  expect(referer).toBe('http://localhost:8798/');

  // The circle moved to the picked place (after the place lookup resolves).
  const centerLat = () =>
    page.evaluate(() => {
      const m = (window as unknown as { __manhuntMap?: { getSource(id: string): { _data?: { geojson?: { features: { geometry: { coordinates: number[][] } }[] } } } } }).__manhuntMap;
      const ring = m?.getSource('mh-boundary')?._data?.geojson?.features[0]?.geometry.coordinates ?? [];
      return ring.length ? ring.reduce((sum, p) => sum + p[1]!, 0) / ring.length : 0;
    });
  await expect.poll(async () => Math.abs((await centerLat()) - 51.5073) < 0.003).toBe(true);
  // Picking a result doesn't re-open the suggestions.
  await expect(page.getByRole('listbox')).toHaveCount(0);
});
