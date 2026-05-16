import "dotenv/config";

export type AppConfig = {
  discordToken: string;
  commandPrefix: string;
  channels: Set<string> | null;
  logLevel: string;
  llm: {
    enabled: boolean;
    provider: "openai";
    model: string;
    maxHistory: number;
    maxOutputTokens: number;
    openAiApiKey: string | null;
  };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const discordToken = env.DISCORD_TOKEN;

  if (!discordToken) {
    throw new Error("DISCORD_TOKEN is required.");
  }

  const channelTokens = (env.CHANNELS ?? "")
    .split(/ +/)
    .map((channel) => channel.trim())
    .filter(Boolean);

  return {
    discordToken,
    commandPrefix: env.COMMAND_PREFIX ?? "$",
    channels: channelTokens.length > 0 ? new Set(channelTokens) : null,
    logLevel: env.LOG_LEVEL ?? "info",
    llm: {
      enabled: env.LLM_ENABLED === "true",
      provider: "openai",
      model: env.LLM_MODEL ?? "gpt-4.1-mini",
      maxHistory: readPositiveInteger(env.LLM_MAX_HISTORY, 8),
      maxOutputTokens: readPositiveInteger(env.LLM_MAX_OUTPUT_TOKENS, 180),
      openAiApiKey: env.OPENAI_API_KEY ?? null,
    },
  };
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
