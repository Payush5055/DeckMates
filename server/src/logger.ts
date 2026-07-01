/** Minimal timestamped logger. Swap for pino/winston later if needed. */
function line(level: string, msg: string, meta?: unknown): void {
  const ts = new Date().toISOString();
  if (meta !== undefined) {
    console.log(`${ts} [${level}] ${msg}`, meta);
  } else {
    console.log(`${ts} [${level}] ${msg}`);
  }
}

export const log = {
  info: (msg: string, meta?: unknown) => line('info', msg, meta),
  warn: (msg: string, meta?: unknown) => line('warn', msg, meta),
  error: (msg: string, meta?: unknown) => line('error', msg, meta),
};
