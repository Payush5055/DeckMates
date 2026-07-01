/** Entry point: build the server and start listening. */

import { buildServer } from './server';
import { config } from './config';
import { log } from './logger';

async function main(): Promise<void> {
  const { http } = await buildServer();
  http.listen(config.port, () => {
    log.info(`CardAdda game server listening on :${config.port} (CORS: ${config.corsOrigin})`);
  });
}

main().catch((err) => {
  log.error('Fatal startup error', err);
  process.exit(1);
});
