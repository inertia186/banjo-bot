import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";
import { CoinGeckoMarketClient } from "../src/market/api.js";

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const config: AppConfig = {
  discordToken: "test-token",
  commandPrefix: "$",
  channels: null,
  logLevel: "silent",
  hive: {
    nodes: ["https://example.test"],
    nodesSourceUrl: "https://developers.test/hive_full_nodes.html",
    requestTimeoutMs: 1_000,
  },
  hiveReferences: {
    whitepaperPath: null,
    sourcePath: null,
    maxAgeDays: 30,
  },
  hafbe: {
    baseUrl: null,
  },
  hyperion: {
    baseUrl: "https://hyperion.test",
    bearerToken: null,
    digestLimit: 10,
    ownerIds: new Set(),
  },
  hiveSql: {
    provider: "hivesql",
    enabled: false,
    server: "sql.hivesql.io",
    database: "DBHive",
    username: null,
    password: null,
    wildcardLimit: 50,
  },
  hafSql: {
    enabled: false,
    host: "hafsql.test",
    port: 5432,
    database: "haf_block_log",
    username: null,
    password: null,
    ssl: false,
    statementTimeoutMs: 8_000,
    maxPoolSize: 3,
  },
  market: {
    coinGeckoBaseUrl: "https://coingecko.test",
    requestTimeoutMs: 1,
  },
  hiveEngine: {
    contractsUrl: "https://hive-engine.test/rpc/contracts",
    scotApiUrl: "https://scot.test",
  },
  splinterlands: {
    baseUrl: "https://splinterlands.test",
  },
  giphy: {
    apiKey: null,
    requestTimeoutMs: 1_000,
  },
  llm: {
    enabled: false,
    provider: "openai",
    model: "test-model",
    maxHistory: 1,
    maxOutputTokens: 1,
    openAiApiKey: null,
  },
};

test("market ticker lookup returns null when the request times out", async () => {
  const client = new CoinGeckoMarketClient(config, logger);
  await withNeverResolvingFetch(async () => {
    assert.equal(await client.getHiveTicker(), null);
  });
});

test("market HIVE/HBD price lookup returns null prices when the request times out", async () => {
  const client = new CoinGeckoMarketClient(config, logger);
  await withNeverResolvingFetch(async () => {
    assert.deepEqual(await client.getHiveHbdUsdPrices(), { hive: null, hbd: null });
  });
});

test("fear and greed lookup returns null when the request times out", async () => {
  const client = new CoinGeckoMarketClient(config, logger);
  await withNeverResolvingFetch(async () => {
    assert.equal(await client.getFearGreedIndex(1), null);
  });
});

async function withNeverResolvingFetch(callback: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.ok(init?.signal);
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  };

  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
