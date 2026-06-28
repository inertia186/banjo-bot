import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { HiveEngineRpcClient } from "../src/hive-engine/api.js";
import { ScotHttpClient } from "../src/hive-engine/scot.js";
import type { Logger } from "../src/logger.js";

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

test("HiveEngineRpcClient builds findOne token requests", async () => {
  const calls: unknown[] = [];
  await withFetch(async (_input, init) => {
    assert.equal(String(_input), "https://hive-engine.test/rpc/contracts");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body));
    calls.push(body);

    return jsonResponse({
      jsonrpc: "2.0",
      id: body.id,
      result: { symbol: "LEO", issuer: "leofinance", precision: 3 },
    });
  }, async () => {
    assert.deepEqual(await new HiveEngineRpcClient(config, logger).getToken("LEO"), {
      symbol: "LEO",
      issuer: "leofinance",
      precision: 3,
    });
  });

  assert.deepEqual(calls, [{
    jsonrpc: "2.0",
    id: 1,
    method: "findOne",
    params: {
      contract: "tokens",
      table: "tokens",
      query: { symbol: "LEO" },
    },
  }]);
});

test("HiveEngineRpcClient paginates token balances until a short page", async () => {
  const offsets: unknown[] = [];
  await withFetch(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    offsets.push(body.params.offset);
    const result = body.params.offset === 0
      ? Array.from({ length: 1000 }, (_, index) => ({ account: `holder-${index}`, symbol: "LEO" }))
      : [{ account: "holder-last", symbol: "LEO" }];

    return jsonResponse({ jsonrpc: "2.0", id: body.id, result });
  }, async () => {
    const result = await new HiveEngineRpcClient(config, logger).getTokenBalances("LEO");
    assert.equal(result.truncated, false);
    assert.equal(result.balances.length, 1001);
  });

  assert.deepEqual(offsets, [0, 1000]);
});

test("HiveEngineRpcClient throws HTTP and RPC errors", async () => {
  await withFetch(async () => new Response("nope", { status: 503 }), async () => {
    await assert.rejects(() => new HiveEngineRpcClient(config, logger).getToken("LEO"), /Hive Engine RPC HTTP 503/);
  });

  await withFetch(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    return jsonResponse({ jsonrpc: "2.0", id: body.id, error: { message: "bad contract" } });
  }, async () => {
    await assert.rejects(() => new HiveEngineRpcClient(config, logger).getToken("LEO"), /bad contract/);
  });
});

test("ScotHttpClient builds config and discussion requests", async () => {
  const urls: string[] = [];
  await withFetch(async (input) => {
    const url = input instanceof URL ? input : new URL(String(input));
    urls.push(url.toString());
    if (url.pathname === "/config") {
      return jsonResponse([{ token: "LEO" }, { nope: true }]);
    }

    assert.equal(url.pathname, "/get_discussions_by_trending");
    assert.equal(url.searchParams.get("token"), "LEO");
    assert.equal(url.searchParams.get("limit"), "2");
    assert.equal(url.searchParams.get("hive"), "1");
    return jsonResponse([{ author: "alice", pending_token: 12500, precision: 3 }]);
  }, async () => {
    const client = new ScotHttpClient(config, logger);
    assert.deepEqual(await client.getConfig(), [{ token: "LEO" }]);
    assert.deepEqual(await client.getTrendingDiscussions("LEO", 2), [{ author: "alice", pending_token: 12500, precision: 3 }]);
  });

  assert.deepEqual(urls, [
    "https://scot.test/config",
    "https://scot.test/get_discussions_by_trending?token=LEO&limit=2&hive=1",
  ]);
});

test("ScotHttpClient builds account history requests and throws HTTP errors", async () => {
  await withFetch(async (input) => {
    const url = input instanceof URL ? input : new URL(String(input));
    assert.equal(url.pathname, "/get_account_history");
    assert.equal(url.searchParams.get("account"), "alice");
    assert.equal(url.searchParams.get("limit"), "3");
    assert.equal(url.searchParams.get("token"), "LEO");
    assert.equal(url.searchParams.get("hive"), "1");
    return jsonResponse([{ token: "LEO", type: "author_reward", timestamp: "2026-06-01T00:00:00", int_amount: 1000, precision: 3 }]);
  }, async () => {
    assert.deepEqual(await new ScotHttpClient(config, logger).getAccountHistory("alice", "LEO", 3), [
      { token: "LEO", type: "author_reward", timestamp: "2026-06-01T00:00:00", int_amount: 1000, precision: 3 },
    ]);
  });

  await withFetch(async () => new Response("nope", { status: 502 }), async () => {
    await assert.rejects(() => new ScotHttpClient(config, logger).getConfig(), /SCOT API HTTP 502/);
  });
});

async function withFetch(fetcher: typeof fetch, callback: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetcher;

  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
