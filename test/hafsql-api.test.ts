import assert from "node:assert/strict";
import test from "node:test";
import { HafSqlClient, claimTimeframeClause } from "../src/hafsql/api.js";
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
    baseUrl: null,
  },
  hyperion: {
    baseUrl: "https://hyperion.test",
    bearerToken: null,
    digestLimit: 10,
    ownerIds: new Set(),
  },
  hiveSql: {
    provider: "hafsql",
    enabled: false,
    server: "sql.hivesql.io",
    database: "DBHive",
    username: null,
    password: null,
    wildcardLimit: 50,
  },
  hafSql: {
    enabled: true,
    host: "hafsql.test",
    port: 5432,
    database: "haf_block_log",
    username: "hafsql_public",
    password: "hafsql_public",
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

test("HafSQL claim timeframe clauses use UTC id windows", () => {
  const all = claimTimeframeClause("all");
  assert.deepEqual(all, { where: "", params: [] });

  const today = claimTimeframeClause("today");
  assert.match(today.where, /hafsql\.id_from_timestamp\(\$1\)/);
  assert.equal(today.params.length, 2);
  assert.equal(today.params[0]?.getUTCHours(), 0);
  assert.equal(today.params[0]?.getUTCMinutes(), 0);
  assert.equal(today.params[1]?.getTime(), (today.params[0]?.getTime() ?? 0) + 24 * 60 * 60 * 1000);
});

test("HafSQL adapter normalizes account wildcard and delegation rows", async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const pool = {
    query: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      if (text.includes("FROM hafsql.accounts") && text.includes("WHERE name LIKE")) {
        return { rows: [{ name: "team.alpha" }, { name: "team.beta" }] };
      }
      if (text.includes("FROM hafsql.delegations") && text.includes("WHERE delegatee = $1")) {
        return { rows: [{ account: "alice", vests: "1230000.000000" }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  } as unknown as ConstructorParameters<typeof HafSqlClient>[2];
  const client = new HafSqlClient(config, logger, pool);

  assert.deepEqual(await client.findAccountNamesByPattern("team_*", 3), ["team.alpha", "team.beta"]);
  assert.deepEqual(await client.getDelegations("bob", "incoming"), [{ account: "alice", vests: 1_230_000 }]);
  assert.deepEqual(queries.map((query) => query.values), [["team\\_%", 3], ["bob"]]);
});

test("HafSQL adapter summarizes reward claims and accounts", async () => {
  const queries: string[] = [];
  const pool = {
    query: async (text: string) => {
      queries.push(text);
      if (text.includes("operation_claim_reward_balance_table")) {
        return {
          rows: [{
            count: "7",
            unique_accounts: "3",
            reward_hbd: "1.500",
            reward_hive: "2.250",
            reward_vests: "3000000.000000",
          }],
        };
      }
      if (text.includes("COUNT(*) AS total")) {
        return { rows: [{ total: "100", communities: "4", badges: "2" }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  } as unknown as ConstructorParameters<typeof HafSqlClient>[2];
  const client = new HafSqlClient(config, logger, pool);

  assert.deepEqual(await client.getClaimSummary("all"), {
    timeframe: "all",
    count: 7,
    uniqueAccounts: 3,
    rewardHbd: 1.5,
    rewardHive: 2.25,
    rewardVests: 3_000_000,
  });
  assert.deepEqual(await client.getAccountSummary(), {
    total: 100,
    mined: 13_696,
    communities: 4,
    badges: 2,
  });
  assert(queries.some((query) => query.includes("name ~ '^hive-[123][0-9]'")));
  assert(queries.some((query) => query.includes("name ~ '^badge-[0-9]'")));
});
