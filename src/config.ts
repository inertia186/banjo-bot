import "dotenv/config";

export type AppConfig = {
  discordToken: string;
  commandPrefix: string;
  channels: Set<string> | null;
  logLevel: string;
  hive: {
    nodes: string[];
    nodesSourceUrl: string;
  };
  hafbe: {
    baseUrl: string | null;
  };
  hiveSql: {
    enabled: boolean;
    server: string;
    database: string;
    username: string | null;
    password: string | null;
    wildcardLimit: number;
  };
  market: {
    coinGeckoBaseUrl: string;
  };
  hiveEngine: {
    contractsUrl: string;
    scotApiUrl: string;
  };
  splinterlands: {
    baseUrl: string;
  };
  giphy: {
    apiKey: string | null;
  };
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
  const hiveNodes = (env.HIVE_NODES ?? "https://api.hive.blog https://api.deathwing.me")
    .split(/[,\s]+/)
    .map((node) => node.trim())
    .filter(Boolean);

  return {
    discordToken,
    commandPrefix: env.COMMAND_PREFIX ?? "$",
    channels: channelTokens.length > 0 ? new Set(channelTokens) : null,
    logLevel: env.LOG_LEVEL ?? "info",
    hive: {
      nodes: hiveNodes,
      nodesSourceUrl: env.HIVE_NODES_SOURCE_URL ?? "https://developers.hive.io/quickstart/hive_full_nodes.html",
    },
    hafbe: {
      baseUrl: env.HAFBE_BASE_URL?.replace(/\/+$/, "") || null,
    },
    hiveSql: {
      enabled: env.HIVESQL_ENABLED === "true",
      server: env.HIVESQL_HOST ?? "sql.hivesql.io",
      database: env.HIVESQL_DATABASE ?? "DBHive",
      username: env.HIVESQL_USERNAME ?? null,
      password: env.HIVESQL_PASSWORD ?? null,
      wildcardLimit: readPositiveInteger(env.HIVESQL_WILDCARD_LIMIT, 50),
    },
    market: {
      coinGeckoBaseUrl: env.COINGECKO_BASE_URL?.replace(/\/+$/, "") || "https://api.coingecko.com/api/v3",
    },
    hiveEngine: {
      contractsUrl: env.HIVE_ENGINE_CONTRACTS_URL?.replace(/\/+$/, "") || "https://api.hive-engine.com/rpc/contracts",
      scotApiUrl: env.SCOT_API_URL?.replace(/\/+$/, "") || "https://scot-api.hive-engine.com",
    },
    splinterlands: {
      baseUrl: env.SPLINTERLANDS_API_BASE_URL?.replace(/\/+$/, "") || "https://api.splinterlands.com",
    },
    giphy: {
      apiKey: env.GIPHY_API_KEY ?? null,
    },
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
