export type Logger = {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
};

type LogLevel = "debug" | "info" | "warn" | "error";

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function configuredLevel(): LogLevel {
  const rawLevel = process.env.LOG_LEVEL?.toLowerCase();
  return rawLevel && rawLevel in levelRank ? (rawLevel as LogLevel) : "info";
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  if (levelRank[level] < levelRank[configuredLevel()]) return;

  const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
  console.log(`[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${suffix}`);
}

export const logger: Logger = {
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta),
};
