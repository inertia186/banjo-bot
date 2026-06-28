import assert from "node:assert/strict";
import test from "node:test";
import { HafbeRestClient } from "../src/hafbe/api.js";
import type { AppConfig } from "../src/config.js";
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
    baseUrl: "https://hafbe.test/hafbe-api",
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

test("HAFBE first post lookup uses public REST route and newest-first pagination", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = async (input) => {
    const url = input instanceof URL ? input : new URL(String(input));
    urls.push(url.toString());

    assert.equal(url.pathname, "/hafbe-api/accounts/alice/comment-permlinks");
    assert.equal(url.searchParams.get("comment-type"), "post");
    assert.equal(url.searchParams.get("page-size"), "100");

    const page = url.searchParams.get("page");
    const permlinks = page === "2"
      ? [{ permlink: "first-post", block: 1, timestamp: "2016-01-01T00:00:00" }]
      : Array.from({ length: 100 }, (_, index) => ({
          permlink: `newer-${index}`,
          block: 200 - index,
          timestamp: "2017-01-01T00:00:00",
        }));

    return new Response(JSON.stringify({
      total_permlinks: 101,
      permlinks_result: permlinks,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const post = await new HafbeRestClient(config, logger).getFirstPost("alice", 0);

    assert.equal(post?.permlink, "first-post");
    assert.deepEqual(urls, [
      "https://hafbe.test/hafbe-api/accounts/alice/comment-permlinks?comment-type=post&page=1&page-size=100",
      "https://hafbe.test/hafbe-api/accounts/alice/comment-permlinks?comment-type=post&page=2&page-size=100",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HAFBE first post lookup handles page boundary offsets", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = input instanceof URL ? input : new URL(String(input));
    const page = url.searchParams.get("page");
    const permlinks = page === "2"
      ? [{ permlink: "oldest", block: 1, timestamp: "2016-01-01T00:00:00" }]
      : Array.from({ length: 100 }, (_, index) => ({
          permlink: `newer-${index}`,
          block: 200 - index,
          timestamp: "2017-01-01T00:00:00",
        }));

    return new Response(JSON.stringify({
      total_permlinks: 101,
      permlinks_result: permlinks,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new HafbeRestClient(config, logger);

    assert.equal((await client.getFirstPost("alice", 0))?.permlink, "oldest");
    assert.equal((await client.getFirstPost("alice", 1))?.permlink, "newer-99");
    assert.equal((await client.getFirstPost("alice", 100))?.permlink, "newer-0");
    assert.equal(await client.getFirstPost("alice", 101), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HAFBE first post lookup treats 404 as no history", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("not found", { status: 404 });

  try {
    assert.equal(await new HafbeRestClient(config, logger).getFirstPost("missing", 0), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HAFBE first post lookup logs and throws non-OK responses", async () => {
  const originalFetch = globalThis.fetch;
  const warnings: unknown[] = [];
  globalThis.fetch = async () => new Response("upstream failed", { status: 500 });

  try {
    await assert.rejects(
      () => new HafbeRestClient(config, { ...logger, warn: (_message, context) => warnings.push(context) }).getFirstPost("alice", 0),
      /HAFBE request failed with HTTP 500/,
    );
    assert.deepEqual(warnings, [{ status: 500, body: "upstream failed" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
