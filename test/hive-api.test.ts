import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { HiveRpcClient } from "../src/hive/api.js";
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
    nodes: ["https://hive.test"],
    nodesSourceUrl: "https://developers.test/hive_full_nodes.html",
  },
  hafbe: {
    baseUrl: null,
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

test("Hive first post lookup scans account history and ignores later edits", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.method, "condenser_api.get_account_history");
    assert.deepEqual(body.params, ["alice", 999, 1000]);

    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      result: [
        [1, {
          block: 10,
          timestamp: "2017-01-01T00:00:00",
          op: ["comment", {
            author: "alice",
            parent_author: "",
            parent_permlink: "introduceyourself",
            permlink: "first-post",
            title: "First post",
          }],
        }],
        [2, {
          block: 11,
          timestamp: "2017-01-01T00:05:00",
          op: ["comment", {
            author: "alice",
            parent_author: "",
            parent_permlink: "introduceyourself",
            permlink: "first-post",
            title: "First post edited",
          }],
        }],
        [3, {
          block: 12,
          timestamp: "2017-01-02T00:00:00",
          op: ["comment", {
            author: "alice",
            parent_author: "",
            parent_permlink: "life",
            permlink: "second-post",
            title: "Second post",
          }],
        }],
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new HiveRpcClient(config, logger);

    assert.deepEqual(await client.getFirstPost("alice", 0), {
      author: "alice",
      permlink: "first-post",
      title: "First post",
      created: "2017-01-01T00:00:00",
    });
    assert.deepEqual(await client.getFirstPost("alice", 1), {
      author: "alice",
      permlink: "second-post",
      title: "Second post",
      created: "2017-01-02T00:00:00",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Hive post creation uses content created timestamp directly", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];

  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    methods.push(body.method);

    assert.equal(body.method, "condenser_api.get_content");
    assert.deepEqual(body.params, ["inertia", "profile"]);

    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        author: "inertia",
        permlink: "profile",
        title: "Profile",
        created: "2018-05-17T22:54:00",
        url: "/meta/@inertia/profile",
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new HiveRpcClient(config, logger);

    assert.deepEqual(await client.getPostCreation("inertia", "profile"), {
      author: "inertia",
      permlink: "profile",
      title: "Profile",
      created: "2018-05-17T22:54:00",
      url: "/meta/@inertia/profile",
    });
    assert.deepEqual(methods, ["condenser_api.get_content"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Hive post creation fails fast when content is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];

  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    methods.push(body.method);

    assert.equal(body.method, "condenser_api.get_content");
    assert.deepEqual(body.params, ["steemitblog", "steemit-update-may-10th-2026-steemit-challenge-season-31-week-5"]);

    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        author: "",
        permlink: "",
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new HiveRpcClient(config, logger);

    assert.equal(
      await client.getPostCreation("steemitblog", "steemit-update-may-10th-2026-steemit-challenge-season-31-week-5"),
      null,
    );
    assert.deepEqual(methods, ["condenser_api.get_content"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Hive post creation treats missing content RPC errors as not found", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];

  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    methods.push(body.method);

    assert.equal(body.method, "condenser_api.get_content");

    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      error: {
        message: "Assert Exception:Post steemitblog/steemit-update-may-10th-2026-steemit-challenge-season-31-week-5 does not exist",
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new HiveRpcClient(config, logger);

    assert.equal(
      await client.getPostCreation("steemitblog", "steemit-update-may-10th-2026-steemit-challenge-season-31-week-5"),
      null,
    );
    assert.deepEqual(methods, ["condenser_api.get_content"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
