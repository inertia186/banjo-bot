import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";
import { SplinterlandsHttpClient } from "../src/splinterlands/api.js";

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
    requestTimeoutMs: 1_000,
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

test("Splinterlands player lookup treats API error payloads as missing players", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = input instanceof URL ? input : new URL(String(input));
    assert.equal(url.pathname, "/players/details");
    assert.equal(url.searchParams.get("name"), "missing");

    return new Response(JSON.stringify({ error: "Player not found." }), { status: 200 });
  };

  try {
    assert.equal(await new SplinterlandsHttpClient(config, logger).getPlayer("missing"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Splinterlands collection parser normalizes optional fields and numeric strings", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = input instanceof URL ? input : new URL(String(input));
    assert.equal(url.pathname, "/cards/collection/alice");

    return new Response(JSON.stringify({
      cards: [
        {
          uid: "C1",
          card_detail_id: "12",
          gold: true,
          foil: "1",
          edition: "4",
          card_set: "untamed",
          collection_power: "123.5",
          delegated_to: "bob",
          market_id: "market-1",
          market_listing_type: "RENT",
          stake_ref_uid: "I-1",
        },
        {
          uid: "",
          card_detail_id: null,
          collection_power: null,
        },
      ],
    }), { status: 200 });
  };

  try {
    const cards = await new SplinterlandsHttpClient(config, logger).getCollection("alice");

    assert.deepEqual(cards, [
      {
        uid: "C1",
        cardDetailId: 12,
        gold: true,
        foil: 1,
        edition: 4,
        cardSet: "untamed",
        collectionPower: 123.5,
        delegatedTo: "bob",
        marketId: "market-1",
        marketListingType: "RENT",
        stakeRefUid: "I-1",
      },
      {
        uid: null,
        cardDetailId: null,
        gold: false,
        foil: null,
        edition: null,
        cardSet: null,
        collectionPower: null,
        delegatedTo: null,
        marketId: null,
        marketListingType: null,
        stakeRefUid: null,
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Splinterlands card details parser skips invalid rows and caches metadata", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async (input) => {
    const url = input instanceof URL ? input : new URL(String(input));
    assert.equal(url.pathname, "/cards/get_details");
    calls += 1;

    return new Response(JSON.stringify([
      { id: "1", name: "Goblin Shaman", color: "Red", type: "Monster", rarity: "1", game_type: "splinterlands" },
      { id: 2, name: "" },
      { name: "Missing Id" },
    ]), { status: 200 });
  };

  try {
    const client = new SplinterlandsHttpClient(config, logger);
    const first = await client.getCardDetails();
    const second = await client.getCardDetails();

    assert.deepEqual(first, [
      {
        id: 1,
        name: "Goblin Shaman",
        color: "Red",
        type: "Monster",
        rarity: 1,
        gameType: "splinterlands",
      },
    ]);
    assert.equal(second, first);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
