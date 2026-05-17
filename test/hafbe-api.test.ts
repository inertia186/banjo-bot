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
  },
  hafbe: {
    baseUrl: "https://hafbe.test/hafbe-api",
  },
  hiveSql: {
    enabled: false,
    server: "sql.hivesql.io",
    database: "DBHive",
    username: null,
    password: null,
    wildcardLimit: 50,
  },
  market: {
    coinGeckoBaseUrl: "https://coingecko.test",
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
