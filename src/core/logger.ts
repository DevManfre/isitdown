export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

const SEVERITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Falls back to info for an unset or unrecognised value. */
export function parseLogLevel(value: string | undefined): LogLevel {
  return value !== undefined && value in SEVERITY ? (value as LogLevel) : "info";
}

/**
 * One JSON object per line on stdout. Log output is for whoever is reading
 * `docker logs`, so it stays English and is never routed through i18n.
 */
export function createLogger(
  level: LogLevel = "info",
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Logger {
  const threshold = SEVERITY[level];

  const emit = (at: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (SEVERITY[at] < threshold) return;
    write(JSON.stringify({ time: new Date().toISOString(), level: at, msg, ...fields }));
  };

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}
