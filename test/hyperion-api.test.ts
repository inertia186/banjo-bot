import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { HyperionAgentClient } from "../src/hyperion/api.js";

const config: AppConfig = {
  discordToken: "test-token",
  commandPrefix: "$",
  channels: null,
  logLevel: "silent",
  hive: {
    nodes: ["https://example.test"],
    nodesSourceUrl: "https://developers.test/hive_full_nodes.html",
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
    bearerToken: "hyp_at_secret",
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

test("HyperionAgentClient sends bearer auth for digest requests", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new HyperionAgentClient(config, async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ posts: [] });
  });

  await client.getDigest({ limit: 5, query: "hive" });

  assert.equal(calls[0]?.url, "https://hyperion.test/api/v1/agent/digest?limit=5&query=hive");
  assert.equal((calls[0]?.init?.headers as Record<string, string>).Authorization, "Bearer hyp_at_secret");
});

test("HyperionAgentClient reads unauthenticated session state", async () => {
  const client = new HyperionAgentClient(config, async () => jsonResponse({
    authenticated: false,
    login_url: "/sessions/new",
    auth_challenge_url: "/api/v1/agent/auth_challenges",
  }));

  assert.deepEqual(await client.getSession(), {
    authenticated: false,
    loginUrl: "/sessions/new",
    authChallengeUrl: "/api/v1/agent/auth_challenges",
  });
});

test("HyperionAgentClient starts and redeems auth challenges without bearer auth", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new HyperionAgentClient(config, async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/auth_challenges")) {
      return jsonResponse({ challenge_id: "challenge-1", hivesigner_login_url: "https://hivesigner.test/login" }, 201);
    }
    return jsonResponse({ bearer_token: "hyp_at_new", account_name: "banjo" });
  });

  assert.deepEqual(await client.startAuthChallenge(), {
    challengeId: "challenge-1",
    hivesignerLoginUrl: "https://hivesigner.test/login",
  });
  assert.equal((calls[0]?.init?.headers as Record<string, string>).Authorization, undefined);

  assert.deepEqual(await client.redeemAuthChallenge("challenge-1", "HYP-ABC123"), {
    bearerToken: "hyp_at_new",
    accountName: "banjo",
  });
  assert.equal(calls[1]?.url, "https://hyperion.test/api/v1/agent/auth_challenges/challenge-1/redeem");
  assert.equal(calls[1]?.init?.body, JSON.stringify({ code: "HYP-ABC123" }));
  assert.equal((calls[1]?.init?.headers as Record<string, string>).Authorization, undefined);
});

test("HyperionAgentClient HTTP errors do not include bearer tokens", async () => {
  const client = new HyperionAgentClient(config, async () => jsonResponse({ error: "nope", token: "hyp_at_secret" }, 401));

  await assert.rejects(
    client.getDigest(),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Hyperion API HTTP 401/);
      assert.doesNotMatch(error.message, /hyp_at_secret/);
      return true;
    },
  );
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
