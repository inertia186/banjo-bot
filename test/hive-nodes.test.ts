import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";
import { HiveDeveloperNodeDirectory, parseHiveDeveloperNodes } from "../src/hive/nodes.js";

const config: AppConfig = {
  discordToken: "test-token",
  commandPrefix: "$",
  channels: null,
  logLevel: "silent",
  hive: {
    nodes: ["https://configured-one.test", "https://configured-two.test"],
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

test("Hive developer node parser reads the public nodes section", () => {
  const html = `
    <h3>Public Nodes</h3>
    <table>
      <tr><th>URL</th><th>Owner</th></tr>
      <tr><td>api.hive.blog</td><td>@blocktrades</td></tr>
      <tr><td>api.deathwing.me</td><td>@deathwing</td></tr>
    </table>
    <h3>Private Nodes</h3>
    <a href="https://docs.docker.com/">Docker</a>
  `;

  assert.deepEqual(parseHiveDeveloperNodes(html), [
    { url: "https://api.hive.blog", owner: "@blocktrades" },
    { url: "https://api.deathwing.me", owner: "@deathwing" },
  ]);
});

test("Hive developer node directory falls back when successful HTML has no public nodes", async (t) => {
  const warnings: Array<Record<string, unknown> | undefined> = [];
  const logger: Logger = {
    info: () => undefined,
    warn: (_message, meta) => warnings.push(meta),
    error: () => undefined,
  };
  t.mock.method(globalThis, "fetch", async () => new Response("<html><h1>Changed page</h1></html>", { status: 200 }));

  const directory = new HiveDeveloperNodeDirectory(config, logger);

  assert.deepEqual(await directory.getPublicNodes(), [
    { url: "https://configured-one.test" },
    { url: "https://configured-two.test" },
  ]);
  assert.deepEqual(warnings, [{ error: "No public nodes found in directory response." }]);
});
