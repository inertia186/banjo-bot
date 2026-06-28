import "dotenv/config";

export type AppConfig = {
  discordToken: string;
  commandPrefix: string;
  channels: Set<string> | null;
  logLevel: string;
  hive: {
    nodes: string[];
    nodesSourceUrl: string;
    requestTimeoutMs: number;
  };
  hiveReferences: {
    whitepaperPath: string | null;
    sourcePath: string | null;
    maxAgeDays: number;
  };
  hafbe: {
    baseUrl: string | null;
  };
  hyperion: {
    baseUrl: string;
    bearerToken: string | null;
    digestLimit: number;
    ownerIds: Set<string>;
  };
  hiveSql: {
    provider: "hivesql" | "hafsql";
    enabled: boolean;
    server: string;
    database: string;
    username: string | null;
    password: string | null;
    wildcardLimit: number;
  };
  hafSql: {
    enabled: boolean;
    host: string;
    port: number;
    database: string;
    username: string | null;
    password: string | null;
    ssl: boolean;
    statementTimeoutMs: number;
    maxPoolSize: number;
  };
  market: {
    coinGeckoBaseUrl: string;
    requestTimeoutMs: number;
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
    requestTimeoutMs: number;
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
      requestTimeoutMs: readPositiveInteger(env.HIVE_RPC_TIMEOUT_MS, 10_000),
    },
    hiveReferences: {
      whitepaperPath: env.HIVE_WHITEPAPER_TEXT_PATH ?? null,
      sourcePath: env.HIVE_SOURCE_PATH ?? null,
      maxAgeDays: readNonNegativeInteger(env.HIVE_REFERENCE_MAX_AGE_DAYS, 30),
    },
    hafbe: {
      baseUrl: env.HAFBE_BASE_URL?.replace(/\/+$/, "") || null,
    },
    hyperion: {
      baseUrl: env.HYPERION_BASE_URL?.replace(/\/+$/, "") || "https://www.hyperion.zone",
      bearerToken: env.HYPERION_BEARER_TOKEN ?? null,
      digestLimit: readPositiveInteger(env.HYPERION_DIGEST_LIMIT, 10),
      ownerIds: new Set((env.BANJO_OWNER_IDS ?? "")
        .split(/[,\s]+/)
        .map((id) => id.trim())
        .filter(Boolean)),
    },
    hiveSql: {
      provider: env.HIVE_HISTORY_PROVIDER === "hafsql" ? "hafsql" : "hivesql",
      enabled: env.HIVESQL_ENABLED === "true",
      server: env.HIVESQL_HOST ?? "sql.hivesql.io",
      database: env.HIVESQL_DATABASE ?? "DBHive",
      username: env.HIVESQL_USERNAME ?? null,
      password: env.HIVESQL_PASSWORD ?? null,
      wildcardLimit: readPositiveInteger(env.HIVESQL_WILDCARD_LIMIT, 50),
    },
    hafSql: {
      enabled: env.HAFSQL_ENABLED === "true",
      host: env.HAFSQL_HOST ?? "hafsql-sql.mahdiyari.info",
      port: readPositiveInteger(env.HAFSQL_PORT, 5432),
      database: env.HAFSQL_DATABASE ?? "haf_block_log",
      username: env.HAFSQL_USERNAME ?? null,
      password: env.HAFSQL_PASSWORD ?? null,
      ssl: env.HAFSQL_SSL === "true",
      statementTimeoutMs: readPositiveInteger(env.HAFSQL_STATEMENT_TIMEOUT_MS, 8_000),
      maxPoolSize: readPositiveInteger(env.HAFSQL_MAX_POOL_SIZE, 3),
    },
    market: {
      coinGeckoBaseUrl: env.COINGECKO_BASE_URL?.replace(/\/+$/, "") || "https://api.coingecko.com/api/v3",
      requestTimeoutMs: readPositiveInteger(env.MARKET_REQUEST_TIMEOUT_MS, 8_000),
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
      requestTimeoutMs: readPositiveInteger(env.GIPHY_REQUEST_TIMEOUT_MS, 5_000),
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

  const parsed = parseStrictInteger(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const parsed = parseStrictInteger(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseStrictInteger(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return Number.NaN;

  return Number(trimmed);
}
