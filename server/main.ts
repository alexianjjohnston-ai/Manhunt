import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = createApp(config);
const port = await app.listen();

console.log(
  `MANHUNT server listening on http://${config.host}:${port} ` +
    `(${config.production ? 'production' : 'development'}; db=${config.databasePath}` +
    `${config.allowFastPings ? '; fast pings ON' : ''}${config.allowSimulation ? '; simulation ON' : ''})`,
);

let closing = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    if (closing) return;
    closing = true;
    console.log(`${sig} received, shutting down…`);
    await app.close();
    process.exit(0);
  });
}
