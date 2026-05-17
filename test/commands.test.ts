import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import type { Client, Message } from "discord.js";
import { registerCommands } from "../src/commands/index.js";
import type { Command, CommandContext } from "../src/commands/types.js";
import type { AppConfig } from "../src/config.js";
import type { XkcdApi } from "../src/comics/xkcd.js";
import type { HiveApi } from "../src/hive/api.js";
import type { HiveEngineApi } from "../src/hive-engine/api.js";
import type { ScotApi } from "../src/hive-engine/scot.js";
import type { HiveNodeDirectory } from "../src/hive/nodes.js";
import type { HiveSqlApi } from "../src/hivesql/api.js";
import type { Logger } from "../src/logger.js";
import type { MarketApi } from "../src/market/api.js";
import type { GiphyApi } from "../src/media/giphy.js";

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
  hiveEngine: {
    contractsUrl: "https://hive-engine.test/rpc/contracts",
    scotApiUrl: "https://scot.test",
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

function registry(): Map<string, Command> {
  const client = {} as Client;
  registerCommands(client);
  return client.commands;
}

function context(
  commands = registry(),
  commandName = "test",
  services?: { hive?: HiveApi; hiveEngine?: HiveEngineApi; hiveNodes?: HiveNodeDirectory; hiveSql?: HiveSqlApi; market?: MarketApi; giphy?: GiphyApi; scot?: ScotApi; xkcd?: XkcdApi },
): CommandContext {
  return {
    config,
    logger,
    commandName,
    ...(services ? { services } : {}),
    message: {
      client: { commands },
    } as unknown as Message,
  };
}

test("registerCommands registers aliases to the same command", () => {
  const commands = registry();

  assert.equal(commands.get("pancakes"), commands.get("pancake"));
  assert.equal(commands.get("silver"), commands.get("gold"));
  assert.equal(commands.get("wa"), commands.get("wolframalpha"));
  assert.equal(commands.get("google"), commands.get("lmgtfy"));
  assert.equal(commands.get("approve"), commands.get("approval"));
  assert.equal(commands.get("approved"), commands.get("approval"));
  assert.equal(commands.get("dist"), commands.get("distribution"));
  assert.equal(commands.get("greed"), commands.get("fear"));
  assert.equal(commands.get("apps"), commands.get("app"));
  assert.equal(commands.get("ticker2"), commands.get("ticker"));
  assert.equal(commands.get("vo"), commands.get("say"));
  assert.equal(commands.get("prediction"), commands.get("predict"));
  assert.equal(commands.get("catfacts"), commands.get("catfact"));
});

test("help lists each command once despite aliases", async () => {
  const commands = registry();
  const response = await commands.get("help")?.execute(context(commands), []);

  assert.equal(typeof response, "object");
  assert.equal((response as { embeds: unknown[] }).embeds.length, 1);
  assert.equal((response as { components: unknown[] }).components.length, 3);
  assert.equal((response as { afterSend?: unknown }).afterSend, undefined);

  const embed = (response as { embeds: [{ toJSON(): { title?: string; fields?: Array<{ name: string; value: string }> } }] }).embeds[0].toJSON();
  assert.equal(embed.title, "Banjo Help");
  assert.ok(embed.fields?.some((field) => field.name === "Banjo"));
  assert.ok(embed.fields?.some((field) => field.name === "Hive"));
  assert.ok(embed.fields?.some((field) => field.name === "Snarks"));
  assert.ok(embed.fields?.some((field) => field.name === "🔗 Links"));
  assert.doesNotMatch(JSON.stringify(embed), /placeholders are registered/);
});

test("help renders cached custom emoji mentions when available", async () => {
  const commands = registry();
  const response = await commands.get("help")?.execute({
    ...context(commands),
    message: {
      client: {
        commands,
        emojis: {
          cache: {
            values: () => [
              { name: "banjo", toString: () => "<:banjo:1111111111>" },
              { name: "hivertinyji", toString: () => "<:hivertinyji:2222222222>" },
              { name: "nicetry001", toString: () => "<:nicetry001:3333333333>" },
            ][Symbol.iterator](),
          },
        },
      },
    } as unknown as Message,
  }, []);

  const embed = (response as { embeds: [{ toJSON(): { fields?: Array<{ name: string; value: string }> } }] }).embeds[0].toJSON();
  assert.ok(embed.fields?.some((field) => field.name === "<:banjo:1111111111> Banjo"));
  assert.ok(embed.fields?.some((field) => field.name === "<:hivertinyji:2222222222> Hive"));
  assert.ok(embed.fields?.some((field) => field.name === "<:nicetry001:3333333333> Snarks"));
});

test("legacy static links keep their migrated URLs", async () => {
  const commands = registry();

  assert.equal(
    (await commands.get("bandwagon")?.execute(context(commands), []) as { files: string[] }).files[0].endsWith("assets/images/bandwagon.jpg"),
    true,
  );
  assert.equal(
    (await commands.get("headphones")?.execute(context(commands), []) as { files: string[] }).files[0].endsWith("assets/images/headphones.jpg"),
    true,
  );
  assert.equal(
    await commands.get("watch")?.execute(context(commands), []),
    "https://www.youtube.com/watch?v=VAesMQ6VtK8",
  );
  assert.ok(
    [
      "https://www.youtube.com/watch?v=kuVMtOChVcM",
      "https://www.youtube.com/watch?v=D9RhgrwkTFQ",
      "https://www.youtube.com/watch?v=iigKPkLB5IQ",
    ].includes(await commands.get("music")?.execute(context(commands), ["debugging"]) as string),
  );
  assert.equal(
    await commands.get("fallacy")?.execute(context(commands), ["popular"]),
    "**Bandwagon Fallacy**\nArguing that something is true or good because many people believe or do it.",
  );
});

test("help for a selected alias resolves the canonical command", async () => {
  const commands = registry();
  const response = await commands.get("help")?.execute(context(commands), ["pancakes"]);

  assert.equal(typeof response, "object");

  const embed = (response as { embeds: [{ toJSON(): { title?: string; description?: string; fields?: Array<{ name: string; value: string }> } }] }).embeds[0].toJSON();
  assert.equal(embed.title, "Help: $pancake");
  assert.equal(embed.description, "`$pancake`");
  assert.ok(embed.fields?.some((field) => field.name === "Aliases" && field.value === "`$pancakes`"));
});

test("help descriptions do not label commands as legacy", () => {
  const commands = registry();
  const legacyDescriptions = [...new Set(commands.values())]
    .filter((command) => /\blegacy\b/i.test(command.description))
    .map((command) => command.name);

  assert.deepEqual(legacyDescriptions, []);
});

test("explicitly disabled legacy commands keep their legacy messages", async () => {
  const commands = registry();

  assert.equal(await commands.get("register")?.execute(context(commands), ["alice"]), "Registration is currently disabled.");
  assert.equal(await commands.get("upvote")?.execute(context(commands), []), "Upvote is currently disabled.");
  assert.equal(await commands.get("verify")?.execute(context(commands), ["alice"]), "Account verification is not available.");
  assert.equal(await commands.get("version")?.execute(context(commands), []), "Cosgrove version lookup is not available in this Banjo build.");
  assert.equal(await commands.get("slap")?.execute(context(commands), ["alice"]), "Slap command is not available.");
  assert.equal(await commands.get("catfacts")?.execute(context(commands, "catfacts"), []), "Cat fact lookup is not available.");
  assert.equal(await commands.get("voting")?.execute(context(commands), []), "Sorry, voting stats are currently not available.");
  assert.equal(await commands.get("play")?.execute(context(commands), ["rimshot"]), "Voice sound playback is not available.");
  assert.equal(await commands.get("disconnect_voice")?.execute(context(commands), []), "Voice playback is not available.");
  assert.equal(await commands.get("stats")?.execute(context(commands), []), "Stats are currently disabled.");
  assert.equal(await commands.get("payout")?.execute(context(commands), []), "Payout summary is not available.");
  assert.equal(await commands.get("flagwars")?.execute(context(commands), []), "Flagwars report is not available.");
  assert.equal(await commands.get("regex")?.execute(context(commands), ["banjo"]), "Regex content scan is not available. Use `$search` for indexed keyword search.");
  assert.equal(await commands.get("poll")?.execute(context(commands), ["@alice/poll"]), "Poll rendering is not available.");
  assert.equal(await commands.get("mod")?.execute(context(commands), ["leo"]), "Moderation report is not available.");
  assert.equal(await commands.get("woodwork")?.execute(context(commands), ["photography"]), "Woodwork report is not available.");
  assert.equal(await commands.get("investors")?.execute(context(commands), ["91"]), "Investor report is not available.");
  assert.equal(await commands.get("prediction")?.execute(context(commands, "prediction"), ["dublup"]), "Prediction lookup is not available. The legacy Dublup API is no longer usable.");
  assert.equal(await commands.get("bidbots")?.execute(context(commands), ["palnet"]), "Bidbot report is not available.");
});

test("birthday reports tracked legacy birthdays", async () => {
  const commands = registry();

  assert.match(
    await commands.get("birthday")?.execute(context(commands), []) as string,
    /^`HIVE (?:is|became) 6 years old .+`$/,
  );
  assert.match(
    await commands.get("birthday")?.execute(context(commands), ["bitcoin"]) as string,
    /^`Bitcoin (?:is|became) 17 years old .+`$/,
  );
  assert.equal(
    await commands.get("birthday")?.execute(context(commands), ["bananas"]),
    "Not tracking bananas's birthday.",
  );
});

test("trail reports the deprecated legacy trail", async () => {
  const commands = registry();

  assert.equal(
    await commands.get("trail")?.execute(context(commands), []),
    "The legacy Streemian curation trail is no longer available.",
  );
});

test("dilbert reports the deprecated legacy mirror", async () => {
  const commands = registry();

  assert.equal(
    await commands.get("dilbert")?.execute(context(commands), []),
    "The legacy Dilbert image mirror is no longer available.",
  );
});

test("ported snarks keep legacy static responses", async () => {
  const commands = registry();
  const xkcd: XkcdApi = {
    getComic: async (num) => num === 404
      ? null
      : {
          num: num ?? 123,
          title: "Compiler Complaint",
          safeTitle: "Compiler Complaint",
          alt: "It compiled on my machine.",
          imageUrl: "https://imgs.xkcd.com/comics/compiler_complaint.png",
        },
  };

  assert.equal(await commands.get("make")?.execute(context(commands), []), "Make it yourself.");
  assert.equal(await commands.get("sudo")?.execute(context(commands), []), "Ok.");
  assert.equal(await commands.get("donut")?.execute(context(commands), []), "*Yummeh*");
  assert.equal(
    await commands.get("roll")?.execute(context(commands), []),
    "Your random number is: **4** - chosen by fair dice roll, guaranteed to be random, see RFC 1149.5.",
  );
  assert.equal(await commands.get("snark")?.execute(context(commands), []), "It will self-correct.");
  assert.equal(
    await commands.get("xkcd")?.execute(context(commands, "xkcd", { xkcd }), ["42"]),
    [
      "xkcd # 42: Compiler Complaint",
      "https://imgs.xkcd.com/comics/compiler_complaint.png",
      "|| It compiled on my machine. ||",
    ].join("\n"),
  );
  assert.equal(
    await commands.get("xkcd")?.execute(context(commands, "xkcd", { xkcd }), ["404"]),
    "Unknown xkcd: # 404",
  );
});

test("image snarks upload vendored legacy assets", async () => {
  const commands = registry();
  const ricky = await commands.get("ricky!")?.execute(context(commands), []);
  const kappa = await commands.get("kappa")?.execute(context(commands), []);

  assert.deepEqual(Object.keys(ricky as Record<string, unknown>), ["files"]);
  assert.deepEqual(Object.keys(kappa as Record<string, unknown>), ["files"]);

  const rickyFile = (ricky as { files: string[] }).files[0];
  const kappaFile = (kappa as { files: string[] }).files[0];

  assert.match(rickyFile, /assets\/images\/ricky\.gif$/);
  assert.match(kappaFile, /assets\/images\/kappa\.png$/);
  assert.equal(existsSync(rickyFile), true);
  assert.equal(existsSync(kappaFile), true);
});

test("lmgtfy returns an encoded Google search URL", async () => {
  const commands = registry();

  assert.equal(
    await commands.get("lmgtfy")?.execute(context(commands), ["hive", "account"]),
    "https://www.google.com/search?q=hive%20account",
  );
  assert.equal(
    await commands.get("wa")?.execute(context(commands, "wa"), ["88", "MPH"]),
    "https://www.wolframalpha.com/input/?i=88%20MPH",
  );
  assert.equal(
    await commands.get("tr")?.execute(context(commands, "tr"), ["bonjour"]),
    "https://www.wolframalpha.com/input/?i=translate%20%22bonjour%22%20to%20english",
  );
  assert.equal(
    await commands.get("alexa")?.execute(context(commands), ["hive.blog"]),
    "Alexa traffic graphs are no longer available; Amazon retired Alexa Internet.",
  );
  assert.equal(
    await commands.get("carousel")?.execute(context(commands), []),
    "The legacy Bittrex markets carousel is no longer available.",
  );
  assert.equal(
    await commands.get("ego")?.execute(context(commands), ["banjo"]),
    "The legacy ICNDB joke API is no longer available.",
  );
  assert.equal(
    await commands.get("flounce")?.execute(context(commands), []),
    "Giphy is not configured, so flounce lookup is unavailable.",
  );
  assert.equal(
    await commands.get("vo")?.execute(context(commands, "vo"), ["trump", "hello"]),
    "The legacy voice synthesis service is no longer available.",
  );
  assert.equal(
    await commands.get("wat")?.execute(context(commands, "wat"), []),
    "Query required.  Example: `88 MPH`",
  );
  assert.equal(
    await commands.get("mempool")?.execute(context(commands), []),
    [
      "**Bitcoin Mempool Size Growth**",
      "https://www.blockchain.com/charts/mempool-growth",
      "The rate at which the bitcoin mempool is growing in bytes per second.",
    ].join("\n"),
  );
  assert.equal(
    await commands.get("gold")?.execute(context(commands, "gold"), []),
    "https://www.kitconet.com/images/sp_en_8.gif",
  );
  assert.equal(
    await commands.get("rhodium")?.execute(context(commands, "rhodium"), []),
    "https://www.kitconet.com/images/sp_en_8.gif",
  );
});

test("flounce uses an injected Giphy service when configured", async () => {
  const commands = registry();
  const giphy: GiphyApi = {
    searchGif: async (query) => query.startsWith("flounce ")
      ? "https://media.giphy.com/media/flounce/giphy.gif"
      : null,
  };

  assert.equal(
    await commands.get("flounce")?.execute(context(commands, "flounce", { giphy }), []),
    "https://media.giphy.com/media/flounce/giphy.gif",
  );
});

test("static command responses do not link to steemit.com", async () => {
  const commands = registry();
  const canonicalCommands = [...new Map([...commands.values()].map((command) => [command.name, command])).values()]
    .filter((command) => command.category === "links");

  for (const command of canonicalCommands) {
    const response = await command.execute(context(commands, command.name), []);
    if (typeof response === "string") {
      assert.doesNotMatch(response, /https?:\/\/(?:www\.)?steemit\.com\b/i, command.name);
    }
  }
});

test("element aliases route to Wolfram Alpha lookup links", async () => {
  const commands = registry();
  const response = await commands.get("neon")?.execute(context(commands, "neon"), []);

  assert.equal(
    response,
    "https://www.wolframalpha.com/input/?i=neon",
  );
});

test("hive account commands use the injected Hive API", async () => {
  const commands = registry();
  const hive: HiveApi = {
    getAccount: async (name) => ({
      name,
      proxy: name === "alice" ? "blocktrades" : "",
      hbd_balance: name === "hive.fund" ? "1000.000 HBD" : "0.000 HBD",
      voting_power: 7500,
      last_vote_time: "2999-01-01T00:00:00",
      vesting_shares: "1000.000000 VESTS",
      received_vesting_shares: "200.000000 VESTS",
      delegated_vesting_shares: "50.000000 VESTS",
      witness_votes: name === "bob" ? ["gtg", "blocktrades"] : [],
    }),
    getAccounts: async (names) =>
      names
        .filter((name) => name !== "missing")
        .map((name) => ({
          name,
          ...(name === "badge-123"
            ? {
                created: "2021-01-02T03:04:05",
                posting_json_metadata: JSON.stringify({ profile: { name: "Fresh Helper", about: "Fresh profile from live Hive." } }),
                recovery_account: "livecreator",
              }
            : {}),
          proxy: "",
          voting_power: 7500,
          last_vote_time: "2999-01-01T00:00:00",
          vesting_shares: name === "alice" ? "1000.000000 VESTS" : "2000.000000 VESTS",
          received_vesting_shares: "200.000000 VESTS",
          delegated_vesting_shares: "50.000000 VESTS",
        })),
    getAccountReputation: async (account) => ({ account, reputation: "1234567890123" }),
    getConfig: async () => ({
      HIVE_PROPOSAL_FUND_PERCENT_HF21: 10_000,
      HIVE_TREASURY_ACCOUNT: "hive.fund",
    }),
    getDynamicGlobalProperties: async () => ({
      current_supply: "500000.000 HIVE",
      current_hbd_supply: "25000.000 HBD",
      hbd_interest_rate: 1200,
      hbd_print_rate: 0,
      hbd_start_percent: 2000,
      hbd_stop_percent: 2000,
      participation_count: 120,
      total_vesting_fund_hive: "500.000 HIVE",
      total_vesting_shares: "1000.000000 VESTS",
      virtual_supply: "600000.000 HIVE",
    }),
    getFeedHistory: async () => ({
      current_max_history: {
        base: "0.066 HBD",
        quote: "1.000 HIVE",
      },
      current_median_history: {
        base: "0.063 HBD",
        quote: "1.000 HIVE",
      },
      current_min_history: {
        base: "0.059 HBD",
        quote: "1.000 HIVE",
      },
      market_median_history: {
        base: "0.064 HBD",
        quote: "1.000 HIVE",
      },
    }),
    getFollowCount: async (account) => ({
      account,
      follower_count: 1234,
      following_count: 56,
    }),
    getFirstPost: async (author, offset) =>
      offset === 1
        ? {
            author,
            permlink: "second-post",
            created: "2016-07-05T00:00:00",
          }
        : null,
    getLatestPosts: async (author, limit) =>
      [
        { author, permlink: "newest-post", url: `/hive-100000/@${author}/newest-post` },
        { author, permlink: "older-post", url: `/@${author}/older-post` },
      ].slice(0, limit),
    getPostCreation: async (author, permlink) =>
      permlink === "first-post"
        ? {
            author,
            permlink,
            title: "First Post",
            created: "2016-07-01T00:00:00",
            cashout_time: "2999-01-01T00:00:00",
            pending_payout_value: "12.345 HBD",
          }
        : permlink === "paid-post"
          ? {
              author,
              permlink,
              title: "Paid Post",
              created: "2016-07-01T00:00:00",
              cashout_time: "2000-01-01T00:00:00",
              pending_payout_value: "1.000 HBD",
            }
          : null,
    getCommunity: async (query) =>
      query === "hive-167922" || query === "leofinance"
        ? {
            name: "hive-167922",
            title: "LeoFinance",
            about: "Crypto and finance on Hive.",
            description: "A community for crypto, finance, and Web3 builders.",
            subscribers: 26677,
            sum_pending: 475,
            num_authors: 443,
            created_at: "2019-11-26 17:25:27",
            team: [["hive-167922", "owner", ""], ["khaleelkazi", "admin", ""]],
          }
        : null,
    getLatestAccountOperation: async (name) => ({
      index: 123,
      block: 456,
      timestamp: "2026-05-17T00:00:00",
      type: "transfer",
      value: {
        from: name,
        to: "bob",
        amount: "1.000 HIVE",
        memo: "poke",
      },
    }),
    getRewardOperations: async (name) => [
      {
        type: "producer_reward",
        timestamp: "2026-05-14T00:00:00",
        value: { vesting_shares: "1000.000000 VESTS" },
      },
      {
        type: "curation_reward",
        timestamp: "2026-05-15T00:00:00",
        value: { reward: "2.000 HIVE" },
      },
      {
        type: "author_reward",
        timestamp: "2026-05-16T00:00:00",
        value: {
          author: name,
          hbd_payout: "1.000 HBD",
          hive_payout: "2.000 HIVE",
          vesting_payout: "100.000000 VESTS",
        },
      },
      {
        type: "comment_benefactor_reward",
        timestamp: "2026-05-16T12:00:00",
        value: {
          benefactor: name,
          hbd_payout: "0.500 HBD",
          hive_payout: "1.000 HIVE",
          vesting_payout: "50.000000 VESTS",
        },
      },
      {
        type: "interest",
        timestamp: "2026-05-16T18:00:00",
        value: { interest: "0.250 HBD" },
      },
    ],
    getRewardFund: async () => ({
      name: "post",
      reward_balance: "1000.000 HIVE",
      recent_claims: "1234567890123456",
      percent_curation_rewards: 5000,
    }),
    listProposals: async () => [
      {
        proposal_id: 1,
        creator: "dev-account",
        receiver: "dev-account",
        subject: "Developer tools",
        permlink: "developer-tools",
        start_date: "2020-01-01T00:00:00",
        end_date: "2030-01-01T00:00:00",
        daily_pay: "10.000 HBD",
        total_votes: "3000000000000",
      },
      {
        proposal_id: 2,
        creator: "return",
        receiver: "hive.fund",
        subject: "Return proposal",
        permlink: "return-proposal",
        start_date: "2020-01-01T00:00:00",
        end_date: "2030-01-01T00:00:00",
        daily_pay: "1000.000 HBD",
        total_votes: "2000000000000",
      },
      {
        proposal_id: 3,
        creator: "small-dev",
        receiver: "small-dev",
        subject: "Small developer tools",
        permlink: "small-developer-tools",
        start_date: "2020-01-01T00:00:00",
        end_date: "2030-01-01T00:00:00",
        daily_pay: "1.000 HBD",
        total_votes: "1000000000000",
      },
    ],
    listProposalVotesByProposal: async (proposalId) => [
      {
        voter: "alice",
        proposal: {
          id: proposalId,
          receiver: "dev-account",
          status: "active",
          daily_pay: "10.000 HBD",
        },
      },
      {
        voter: "bob",
        proposal: {
          id: proposalId,
          receiver: "dev-account",
          status: "active",
          daily_pay: "10.000 HBD",
        },
      },
    ],
    listProposalVotes: async (voter) => [
      {
        voter,
        proposal: {
          id: 1,
          receiver: "dev-fund",
          status: "active",
          daily_pay: {
            amount: "12345",
            precision: 3,
            nai: "@@000000013",
          },
        },
      },
      {
        voter,
        proposal: {
          id: 2,
          receiver: "steem.dao",
          status: "active",
          daily_pay: {
            amount: "999000",
            precision: 3,
            nai: "@@000000013",
          },
        },
      },
      {
        voter,
        proposal: {
          id: 3,
          receiver: "future-dev",
          status: "inactive",
          daily_pay: "1.000 HBD",
        },
      },
    ],
    getHardforkVersion: async () => "1.28.0",
    getNextScheduledHardfork: async () => ({
      hf_version: "1.28.0",
      live_time: "2025-11-19T13:00:00",
    }),
    getWitnessByAccount: async (owner) => ({
      owner,
      running_version: "1.27.0",
      total_missed: 2,
      signing_key: "STM1111111111111111111111111111111114T1Anm",
    }),
    getWitnessesByVote: async (limit) => [
      { owner: "alice", hardfork_version_vote: "1.28.0", votes: "2000000000000000" },
      { owner: "bob", hardfork_version_vote: "1.28.0", votes: "1000000000000000" },
      { owner: "carol", hardfork_version_vote: "1.27.9", votes: "500000000000000" },
    ].map((witness, index) => ({
      ...witness,
      running_version: index < 2 ? "1.28.0" : "1.27.9",
    })).slice(0, limit),
    getWitnessSchedule: async () => ({
      majority_version: "1.28.3",
    }),
  };
  const market: MarketApi = {
    getHiveTicker: async () => ({
      usd: 0.06036,
      usdMarketCap: 30_000_000,
      usd24hVolume: 1_250_000,
      usd24hChange: 2.3456,
    }),
    getHiveHbdUsdPrices: async () => ({
      hive: 0.06036,
      hbd: 0.99,
    }),
    getHiveUsdPrice: async () => 0.06036,
    getFearGreedIndex: async () => ({
      name: "Crypto Fear & Greed Index",
      entries: [
        { value: 72, classification: "Greed", timestamp: 1_767_308_400, timeUntilUpdate: 12_345 },
        { value: 65, classification: "Greed", timestamp: 1_767_222_000, timeUntilUpdate: null },
      ],
    }),
  };
  const hiveEngine: HiveEngineApi = {
    getToken: async (symbol) =>
      symbol === "LEO"
        ? {
            symbol,
            issuer: "leofinance",
            name: "LEO",
            metadata: JSON.stringify({
              desc: "A social token for finance-focused Hive communities.",
              url: "leo.io",
            }),
            circulatingSupply: "1234567.890",
          }
        : null,
    getNft: async (symbol) =>
      symbol === "PUNK"
        ? {
            symbol,
            issuer: "nftissuer",
            name: "Hive Punk",
            metadata: JSON.stringify({
              desc: "Collectible Hive punks.",
              url: "punks.example",
            }),
            circulatingSupply: "42",
          }
        : null,
    getNftShowroomArt: async (account, index) => {
      if (account === "missing") return null;
      if (account === "unpublished") {
        return {
          series: "hidden-series",
          artist: "artist",
          title: "Hidden Art",
          collection: null,
          description: null,
          thumbnail: null,
          image: null,
          nsfw: false,
          published: false,
          createdAt: null,
          note: null,
        };
      }

      return {
        series: "zyberzerk_political-collage_obey-or-get-deleted",
        artist: "zyberzerk",
        title: `Obey or Get Deleted #${index + 1}`,
        collection: "Political Collage",
        description: "A sharp collage from NFT Showroom.",
        thumbnail: "https://images.hive.blog/thumb.jpg",
        image: "https://images.hive.blog/art.jpg",
        nsfw: false,
        published: true,
        createdAt: "2020-06-22T00:00:19.033Z",
        note: ":))",
      };
    },
    getTokenBalances: async (symbol) =>
      symbol === "LEO"
        ? {
            balances: [
              { account: "small", symbol, balance: "1.000", stake: "2.000", pendingUnstake: "0.000" },
              { account: "large", symbol, balance: "100.000", stake: "50.000", pendingUnstake: "25.000" },
              { account: "null", symbol, balance: "1000.000", stake: "0.000", pendingUnstake: "0.000" },
              { account: "medium", symbol, balance: "10.000", stake: "20.000", pendingUnstake: "5.000" },
            ],
            truncated: false,
          }
        : { balances: [], truncated: false },
    getLatestTrade: async () => ({
      price: "0.25000000",
    }),
    getBuyBook: async () => [
      { quantity: "10.000", price: "0.24000000" },
      { quantity: "20.000", price: "0.20000000" },
    ],
    getMarketMetrics: async () => ({
      volume: "123.456",
      lowestAsk: "0.26000000",
      highestBid: "0.24000000",
      priceChangePercent: "-1.25",
    }),
  };
  const scot: ScotApi = {
    getConfig: async () => [
      {
        token: "LEO",
        hive_community: "hive-167922",
        json_metadata_key: "tags",
        json_metadata_value: "leo finance inleo",
      },
      {
        token: "SPT",
        hive_community: "hive-13323",
        json_metadata_key: "community",
        json_metadata_value: "",
      },
      {
        token: "APP",
        hive_community: null,
        json_metadata_key: "app",
        json_metadata_value: "customapp",
      },
    ],
    getTrendingDiscussions: async () => [
      { author: "alice", pending_token: 12500, precision: 3 },
      { author: "bob", pending_token: 7500, precision: 3 },
    ],
    getAccountHistory: async () => [
      {
        token: "LEO",
        type: "staking_reward",
        timestamp: "2026-05-14T00:00:00",
        int_amount: 1500,
        precision: 3,
      },
      {
        token: "LEO",
        type: "curation_reward",
        timestamp: "2026-05-15T00:00:00",
        int_amount: 2500,
        precision: 3,
      },
      {
        token: "LEO",
        type: "author_reward",
        timestamp: "2026-05-16T00:00:00",
        int_amount: 5000,
        precision: 3,
      },
      {
        token: "LEO",
        type: "comment_benefactor_reward",
        timestamp: "2026-05-16T12:00:00",
        int_amount: 1000,
        precision: 3,
      },
      {
        token: "LEO",
        type: "mining_reward",
        timestamp: "2026-05-16T18:00:00",
        int_amount: 2000,
        precision: 3,
      },
    ],
  };
  const hiveSql: HiveSqlApi = {
    findAccountNamesByPattern: async (pattern) => {
      if (pattern === "team*") return ["alice", "bob"];
      if (pattern === "nobody*") return [];
      return [];
    },
    searchComments: async (options) => {
      if (options.keywords.includes("none")) {
        return {
          total: 0,
          authorCount: 0,
          comments: [],
        };
      }

      if (options.keywords.includes("crowded")) {
        return {
          total: 81,
          authorCount: 20,
          comments: [],
        };
      }

      return {
        total: 2,
        authorCount: 2,
        comments: [
          { author: "alice", permlink: "banjo-notes", title: "Banjo Notes", created: new Date("2026-05-16T00:00:00Z") },
          { author: "bob", permlink: "more-banjo", title: "More Banjo", created: new Date("2026-05-15T00:00:00Z") },
        ],
      };
    },
    getTopPost: async (options) => {
      if (options.kind === "reply") {
        return {
          author: "bob",
          permlink: "reply-parent",
          title: "Reply Parent",
          url: null,
          score: 12,
        };
      }
      if (options.kind === "-rep") {
        return {
          author: "kgakakillerg",
          permlink: "a-walk-around-the-o2-in-greenwich-london-april-2026-part-7",
          title: "Low Rep Post",
          url: "/hive-108278/@kgakakillerg/a-walk-around-the-o2-in-greenwich-london-april-2026-part-7",
          score: -4,
        };
      }

      return {
        author: "alice",
        permlink: "top-post",
        title: "Top Post",
        url: "/hive-108278/@alice/top-post",
        score: 42,
      };
    },
    getAppPayouts: async (options) =>
      [
        { app: "peakd/2026.05.1", payout: 12345 },
        { app: "ecency/3.2.0", payout: 2345 },
        { app: "unknown", payout: 123 },
      ].slice(0, options.limit),
    getPromotedSummary: async (timeframe) => ({
      timeframe,
      count: timeframe === "today" ? 0 : 2,
      totals: timeframe === "today" ? [] : [{ symbol: "HBD", total: 12.345 }],
      posts: timeframe === "today"
        ? []
        : [
            { author: "alice", permlink: "promoted-one", title: "Promoted One", promoted: 10, symbol: "HBD" },
            { author: "bob", permlink: "promoted-two", title: "Promoted Two", promoted: 2.345, symbol: "HBD" },
          ],
    }),
    getDistribution: async (daysAgo) => ({
      daysAgo,
      activeAccountCount: 10,
      inactiveAccountCount: 5,
      activeVestingShares: 11_111_000,
      inactiveVestingShares: 1_000_000,
      buckets: [
        { level: "dust", mvests: 0, accountCount: 1, vestingShares: 1_000 },
        { level: "newbie", mvests: 0.01, accountCount: 2, vestingShares: 50_000 },
        { level: "user", mvests: 0.1, accountCount: 3, vestingShares: 600_000 },
        { level: "superuser", mvests: 1, accountCount: 4, vestingShares: 10_460_000 },
      ],
    }),
    findBadges: async (terms, limit) =>
      [
        {
          name: "badge-123",
          recoveryAccount: "creator",
          jsonMetadata: JSON.stringify({ profile: { name: "Helpful Human", about: "Given for being useful." } }),
          created: new Date("2021-01-02T03:04:05Z"),
        },
        {
          name: "badge-456",
          recoveryAccount: "maker",
          jsonMetadata: JSON.stringify({ profile: { name: "Builder Badge" } }),
          created: new Date("2021-02-03T04:05:06Z"),
        },
      ]
        .filter((badge) => terms.length === 0 || terms.some((term) => badge.name.includes(term) || badge.jsonMetadata.toLowerCase().includes(term)))
        .slice(0, limit),
    getBadgeStats: async () => ({
      recipients: 12,
      subscribers: 3,
    }),
    getDelegations: async (_account, direction) =>
      direction === "incoming"
        ? [
            { account: "carol", vests: 1_500_000 },
            { account: "dan", vests: 500_000 },
          ]
        : [
            { account: "erin", vests: 250_000 },
          ],
    getDelegateesByMinimumMvests: async (minMvests) =>
      [
        { delegatee: "alice", vests: 2_000_000, delegatorCount: 2, singleDelegator: "carol" },
        { delegatee: "erin", vests: 1_000_000, delegatorCount: 1, singleDelegator: "alice" },
        { delegatee: "dan", vests: 250_000, delegatorCount: 1, singleDelegator: "bob" },
      ].filter((delegatee) => delegatee.vests >= minMvests * 1_000_000),
    getClaimSummary: async (timeframe) => ({
      timeframe,
      count: timeframe === "today" ? 3 : 8,
      uniqueAccounts: timeframe === "today" ? 2 : 5,
      rewardHbd: timeframe === "today" ? 1.25 : 3.75,
      rewardHive: timeframe === "today" ? 2.5 : 8,
      rewardVests: timeframe === "today" ? 4_250_000 : 12_000_000,
    }),
    getAccountSummary: async () => ({
      total: 2_345_678,
      mined: 13_696,
      communities: 3_210,
      badges: 456,
    }),
  };
  const hiveNodes: HiveNodeDirectory = {
    getPublicNodes: async () => [
      { url: "https://api.hive.blog", owner: "@blocktrades" },
      { url: "https://api.deathwing.me", owner: "@deathwing" },
    ],
  };

  assert.match(
    await commands.get("rep")?.execute(context(commands, "rep", { hive }), ["@alice"]) as string,
    /alice has reputation/,
  );
  assert.equal(
    await commands.get("proxy")?.execute(context(commands, "proxy", { hive }), ["alice"]),
    "alice is proxied to **blocktrades**.",
  );
  assert.equal(
    await commands.get("poke")?.execute(context(commands, "poke", { hive }), ["alice"]),
    "```json\n{\"transfer\":{\"from\":\"alice\",\"to\":\"bob\",\"amount\":\"1.000 HIVE\",\"memo\":\"poke\"}}\n```",
  );
  assert.equal(
    await commands.get("approval")?.execute(context(commands, "approval", { hive }), ["alice"]),
    ["**Approved by: alice**", "https://hiveblocks.com/@alice", "Proxied to: **blocktrades**"].join("\n"),
  );
  assert.match(
    await commands.get("community")?.execute(context(commands, "community", { hive }), ["hive-167922"]) as string,
    /^\*\*LeoFinance created by @hive-167922\*\*\nhttps:\/\/hive\.blog\/trending\/hive-167922#leofinance\n\*\*Crypto and finance on Hive\.\*\*\nA community for crypto, finance, and Web3 builders\.\nSubscribers: \*\*26,677\*\*\nPending Rewards: \*\*\$475\*\*\nActive Authors: \*\*443\*\*\nCreated: .+ ago \(2019-11-26 17:25 UTC\)\nAvatar: https:\/\/images\.hive\.blog\/u\/hive-167922\/avatar$/,
  );
  assert.equal(
    await commands.get("community")?.execute(context(commands, "community", { hive }), ["missing"]),
    "Unable to find community with: `missing`",
  );
  assert.equal(
    await commands.get("approved")?.execute(context(commands, "approved", { hive }), ["bob"]),
    [
      "**Approved by: bob**",
      "https://hiveblocks.com/@bob",
      "Witnesses (total: 2): gtg, blocktrades",
      "Proposals (total: 2): dev-fund (1), hive.fund (2)",
      "Proposal Pay Approved: 12.345 HBD (daily)",
      "Upcoming Proposals (total: 1): future-dev (3)",
    ].join("\n"),
  );
  assert.match(
    await commands.get("proposal")?.execute(context(commands, "proposal", { hive }), ["dev-account"]) as string,
    /\*\*Proposal #1: Developer tools\*\*\nhttps:\/\/peakd\.com\/proposals\/1\nDiscussion: https:\/\/peakd\.com\/@dev-account\/developer-tools[\s\S]+Daily Pay: 10\.000 HBD[\s\S]+Total Votes \(HP\): 1\.5M[\s\S]+Voters: 2[\s\S]+Approved: Yes \(150\.00%\)/,
  );
  assert.equal(
    await commands.get("proposal")?.execute(context(commands, "proposal", { hive }), ["missing-proposal"]),
    'Proposal "missing-proposal" not found (or not active).',
  );
  assert.equal(
    await commands.get("consensus")?.execute(context(commands, "consensus", { hive }), ["2"]),
    [
      "**Witnesses (93.8% participation)**",
      "https://hiveblocks.com/witnesses",
      "```",
      " 1. alice            1.28.0",
      " 2. bob              1.28.0",
      "```",
      "1.28.0: 2",
    ].join("\n"),
  );
  assert.equal(
    await commands.get("consensus")?.execute(context(commands, "consensus", { hive }), ["steem"]),
    "Chain `steem` is not configured in this Banjo build.",
  );
  assert.match(
    await commands.get("rewards")?.execute(context(commands, "rewards", { hive, market }), ["alice"]) as string,
    /\*\*HIVE rewards for alice since .+ ago\*\*\nproducer: 500\.000\ninterest: 0\.016\ncuration: 2\.000\nauthor: 52\.063\nbenefactor: 26\.032\ntotal: 580\.110\nUSD: 35\.02\nUSD per day: 12\.73/,
  );
  assert.match(
    await commands.get("rewards")?.execute(context(commands, "rewards", { hive, hiveEngine, market, scot }), ["alice", "LEO"]) as string,
    /\*\*LEO rewards for alice since .+ ago\*\*\nstaking: 1\.500\ncuration: 2\.500\nauthor: 5\.000\nbenefactor: 1\.000\nmining: 2\.000\ntotal: 12\.000\nHIVE: 3\.000\nUSD: 0\.18\nUSD per day: 0\.07/,
  );
  assert.equal(
    await commands.get("delegate")?.execute(context(commands, "delegate", { hive, hiveSql }), ["alice"]),
    [
      "`MVESTS` delegated to `alice` by 2 delegators: `2.000`",
      "```",
      "carol: 1.500; dan: 0.500",
      "```",
      "`MVESTS` delegated by `alice` to 1 delegatee: `0.250`",
      "```",
      "erin: 0.250",
      "```",
    ].join("\n"),
  );
  assert.equal(
    await commands.get("delegator")?.execute(context(commands, "delegator", { hive, hiveSql }), ["alice"]),
    ["`MVESTS` delegated to `alice` by 2 delegators: `2.000`", "```", "carol: 1.500; dan: 0.500", "```"].join("\n"),
  );
  assert.equal(
    await commands.get("delegatee")?.execute(context(commands, "delegatee", { hive, hiveSql }), ["alice"]),
    ["`MVESTS` delegated by `alice` to 1 delegatee: `0.250`", "```", "erin: 0.250", "```"].join("\n"),
  );
  assert.equal(
    await commands.get("delegate")?.execute(context(commands, "delegate", { hive }), ["alice"]),
    "HiveSQL is not configured, so delegation lookup is unavailable.",
  );
  assert.equal(
    await commands.get("delegated")?.execute(context(commands, "delegated", { hiveSql }), ["1"]),
    ["MVESTS delegated to 2 accounts", "```", "<multiple> to alice: 2; alice to erin: 1", "```"].join("\n"),
  );
  assert.equal(
    await commands.get("delegated")?.execute(context(commands, "delegated", { hiveSql }), ["3"]),
    "MVESTS delegated to 0 accounts",
  );
  assert.equal(
    await commands.get("delegated")?.execute(context(commands, "delegated", { hiveSql }), ["1", "steem"]),
    "Chain `steem` is not configured in this Banjo build.",
  );
  assert.equal(
    await commands.get("delegated")?.execute(context(commands, "delegated"), []),
    "HiveSQL is not configured, so delegated account lookup is unavailable.",
  );
  assert.equal(
    await commands.get("claims")?.execute(context(commands, "claims", { hiveSql }), []),
    "3 claims today (by 2 unique accounts): `1.250 HBD`; `2.500 HIVE`; `4.250 MVESTS`",
  );
  assert.equal(
    await commands.get("claims")?.execute(context(commands, "claims", { hiveSql }), ["yesterday"]),
    "8 claims yesterday (by 5 unique accounts): `3.750 HBD`; `8.000 HIVE`; `12.000 MVESTS`",
  );
  assert.equal(
    await commands.get("claims")?.execute(context(commands, "claims", { hiveSql }), ["nonsense"]),
    "8 claims all (by 5 unique accounts): `3.750 HBD`; `8.000 HIVE`; `12.000 MVESTS`",
  );
  assert.equal(
    await commands.get("claims")?.execute(context(commands, "claims", { hiveSql }), ["today", "steem"]),
    "Chain `steem` is not configured in this Banjo build.",
  );
  assert.equal(
    await commands.get("claims")?.execute(context(commands, "claims"), []),
    "HiveSQL is not configured, so claim lookup is unavailable.",
  );
  assert.equal(
    await commands.get("accounts")?.execute(context(commands, "accounts", { hiveSql }), []),
    ["```", "Total Hive accounts: 2,345,678; mined: 13,696; communities: 3,210; badges: 456", "```"].join("\n"),
  );
  assert.equal(
    await commands.get("accounts")?.execute(context(commands, "accounts", { hiveSql }), ["steem"]),
    "Chain `steem` is not configured in this Banjo build.",
  );
  assert.equal(
    await commands.get("accounts")?.execute(context(commands, "accounts"), []),
    "HiveSQL is not configured, so account summary lookup is unavailable.",
  );
  assert.equal(
    await commands.get("search")?.execute(context(commands, "search", { hiveSql }), ["banjo", "tag:hive", "!tag:test", "after:2026-05-01", "before:2026-05-16"]),
    [
      "Authors writing `banjo` in hive not in test between 2026-05-01 00:00 UTC and 2026-05-16 23:59 UTC (2):",
      "",
      "[alice](https://hive.blog/@alice/banjo-notes) [bob](https://hive.blog/@bob/more-banjo)",
    ].join("\n"),
  );
  assert.equal(
    await commands.get("search")?.execute(context(commands, "search", { hiveSql }), ["none"]),
    "No authors wrote about `none` today.",
  );
  assert.equal(
    await commands.get("search")?.execute(context(commands, "search", { hiveSql }), ["crowded"]),
    "Too many results for `crowded` (81).",
  );
  assert.equal(
    await commands.get("search")?.execute(context(commands, "search"), ["banjo"]),
    "HiveSQL is not configured, so content search is unavailable.",
  );
  assert.equal(
    await commands.get("top")?.execute(context(commands, "top", { hiveSql }), ["upvoted"]),
    ["Top upvoted since 7 days ago ...", "https://hive.blog/@alice/top-post"].join("\n"),
  );
  assert.equal(
    await commands.get("top")?.execute(context(commands, "top", { hiveSql }), ["reply", "popcorn"]),
    ["Top reply with `popcorn` since 7 days ago ...", "https://hive.blog/@bob/reply-parent"].join("\n"),
  );
  assert.equal(
    await commands.get("top")?.execute(context(commands, "top", { hiveSql }), ["-rep"]),
    [
      "Top -rep since 7 days ago ...",
      "https://peakd.com/@kgakakillerg/a-walk-around-the-o2-in-greenwich-london-april-2026-part-7",
    ].join("\n"),
  );
  assert.equal(
    await commands.get("top")?.execute(context(commands, "top", { hiveSql }), []),
    "Expected options: upvoted, downvoted, children, rep, -rep, promoted, reply",
  );
  assert.equal(
    await commands.get("top")?.execute(context(commands, "top", { hiveSql }), ["upvoted", "extra"]),
    "Did not expect keywords for `$top upvoted`.",
  );
  assert.equal(
    await commands.get("top")?.execute(context(commands, "top"), ["upvoted"]),
    "HiveSQL is not configured, so top post lookup is unavailable.",
  );
  assert.equal(
    await commands.get("app")?.execute(context(commands, "app", { hiveSql }), []),
    [
      "Top 10 apps paid since 7 days ago ...",
      "```markdown",
      "|          App          | Payout in HBD |",
      "|-----------------------|---------------|",
      "| peakd/2026.05.1       |        12,345 |",
      "| ecency/3.2.0          |         2,345 |",
      "| unknown               |           123 |",
      "```",
    ].join("\n"),
  );
  assert.equal(
    await commands.get("apps")?.execute(context(commands, "apps", { hiveSql }), ["1"]),
    [
      "Top 1 app paid since 7 days ago ...",
      "```markdown",
      "|          App          | Payout in HBD |",
      "|-----------------------|---------------|",
      "| peakd/2026.05.1       |        12,345 |",
      "```",
    ].join("\n"),
  );
  assert.equal(
    await commands.get("app")?.execute(context(commands, "app"), []),
    "HiveSQL is not configured, so app payout lookup is unavailable.",
  );
  assert.equal(
    await commands.get("promoted")?.execute(context(commands, "promoted", { hiveSql }), []),
    [
      "2 promoted posts yesterday: `12.345 HBD`",
      "1. [Promoted One](https://hive.blog/@alice/promoted-one) - `10.000 HBD`",
      "2. [Promoted Two](https://hive.blog/@bob/promoted-two) - `2.345 HBD`",
      "0 promoted posts today: `0.000 HBD`",
    ].join("\n"),
  );
  assert.equal(
    await commands.get("promoted")?.execute(context(commands, "promoted", { hiveSql }), ["steem"]),
    "Chain `steem` is not configured in this Banjo build.",
  );
  assert.equal(
    await commands.get("promoted")?.execute(context(commands, "promoted"), []),
    "HiveSQL is not configured, so promoted post lookup is unavailable.",
  );
  assert.equal(
    await commands.get("distribution")?.execute(context(commands, "distribution", { hive, hiveSql }), ["30"]),
    [
      "Active since 30 days ago:",
      "```markdown",
      "|     $     |   MV  |   level   |   accts  | accts % | stake % |",
      "|-----------|-------|-----------|----------|---------|---------|",
      "| $0        |     0 | dust      |        1 |  10.00% |   0.01% |",
      "| $315.00   |  0.01 | newbie    |        2 |  20.00% |   0.41% |",
      "| $3,150    |   0.1 | user      |        3 |  30.00% |   4.95% |",
      "| $31,500   |     1 | superuser |        4 |  40.00% |  86.37% |",
      "| $315,000  |    10 | hero      |        0 |   0.00% |   0.00% |",
      "| $3,150,000 |   100 | superhero |        0 |   0.00% |   0.00% |",
      "| $31,500,000 | 1,000 | legend    |        0 |   0.00% |   0.00% |",
      "```",
      "Active accounts: `10 / 15`",
      "Inactive stake: `8.26%`",
    ].join("\n"),
  );
  assert.equal(
    await commands.get("dist")?.execute(context(commands, "dist", { hive, hiveSql }), ["nope"]),
    "Usage: `$distribution [days]`",
  );
  assert.equal(
    await commands.get("distribution")?.execute(context(commands, "distribution", { hive }), []),
    "HiveSQL is not configured, so distribution lookup is unavailable.",
  );
  assert.equal(
    await commands.get("badges")?.execute(context(commands, "badges", { hive, hiveSql }), ["helpful"]),
    ["**Latest Badges matching: helpful**", "[Fresh Helper](https://peakd.com/b/badge-123#fresh-helper) by @livecreator"].join("\n"),
  );
  assert.match(
    await commands.get("badge")?.execute(context(commands, "badge", { hive, hiveSql }), ["helpful"]) as string,
    /^\*\*Fresh Helper created by @livecreator\*\*\nhttps:\/\/peakd\.com\/b\/badge-123#fresh-helper\nFresh profile from live Hive\.\nRecipients: \*\*12\*\*\nSubscribers: \*\*3\*\*\nCreated: .+ ago \(2021-01-02 03:04 UTC\)\nAvatar: https:\/\/images\.hive\.blog\/u\/badge-123\/avatar$/,
  );
  assert.equal(
    await commands.get("badges")?.execute(context(commands, "badges"), []),
    "HiveSQL is not configured, so badge search is unavailable.",
  );
  assert.equal(
    await commands.get("inflation")?.execute(context(commands, "inflation"), ["3"]),
    [
      "```",
      "| Year |   Supply    | Inflation | New Supply |",
      "|------|-------------|-----------|------------|",
      "| 2016 | 250,000,000 |     9.50% | 23,750,000 |",
      "| 2017 | 273,750,000 |     9.08% | 24,854,398 |",
      "| 2018 | 298,604,398 |     8.66% | 25,854,554 |",
      "```",
    ].join("\n"),
  );
  assert.equal(
    await commands.get("inflation")?.execute(context(commands, "inflation"), ["3", "steem"]),
    "Chain `steem` is not configured in this Banjo build.",
  );
  assert.equal(
    await commands.get("power")?.execute(context(commands, "power", { hive }), ["alice"]),
    ["**alice**", "Hive Power: **575.000 HP**", "Voting Power: **75.00%**"].join("\n"),
  );
  assert.equal(
    await commands.get("mvests")?.execute(context(commands, "mvests", { hive, market }), []),
    "`1MV = 1M VESTS = 500,000.000 HIVE = 31,500.000 HBD = $30,180.000`",
  );
  assert.equal(
    await commands.get("mvests")?.execute(context(commands, "mvests", { hive, market }), ["alice"]),
    "`@alice: 0.001 MVESTS = 575.000 HIVE = 36.225 HBD = $34.707`",
  );
  assert.equal(
    await commands.get("mvests")?.execute(context(commands, "mvests", { hive, market }), ["alice", "bob", "missing", "missing-banjo-test-account"]),
    "`2 accounts: 0.003 MVESTS = 1,650.000 HIVE = 103.950 HBD = $99.594` Missing: @missing, @missing-banjo-test-account.",
  );
  assert.equal(
    await commands.get("mvests")?.execute(context(commands, "mvests", { hive, hiveSql, market }), ["team*"]),
    "`2 accounts: 0.003 MVESTS = 1,650.000 HIVE = 103.950 HBD = $99.594`",
  );
  assert.equal(
    await commands.get("mvests")?.execute(context(commands, "mvests", { hive, hiveSql, market }), ["team*", "nobody*"]),
    "`2 accounts: 0.003 MVESTS = 1,650.000 HIVE = 103.950 HBD = $99.594` No matches: `nobody*`.",
  );
  assert.equal(
    await commands.get("mvests")?.execute(context(commands, "mvests", { hive, market }), ["team*"]),
    "HiveSQL is not configured, so wildcard account lookups are unavailable.",
  );
  assert.equal(
    await commands.get("mvests")?.execute(context(commands, "mvests", { hive, market }), ["missing-banjo-test-account"]),
    "Unable to find Hive account **missing-banjo-test-account**.",
  );
  assert.equal(
    await commands.get("rewardpool")?.execute(context(commands, "rewardpool", { hive }), []),
    ["**Hive reward pool**", "Balance: **1,000.000 HIVE**", "Recent claims: **1,234,567,890,123,456**", "Curation rewards: **50.00%**"].join("\n"),
  );
  assert.equal(
    await commands.get("rewardpool")?.execute(context(commands, "rewardpool", { hive }), ["hive"]),
    ["**Hive reward pool**", "Balance: **1,000.000 HIVE**", "Recent claims: **1,234,567,890,123,456**", "Curation rewards: **50.00%**"].join("\n"),
  );
  assert.equal(
    await commands.get("rewardpool")?.execute(context(commands, "rewardpool", { hive }), ["steem"]),
    "Chain `steem` is not configured in this Banjo build.",
  );
  assert.equal(
    await commands.get("calcreward")?.execute(context(commands, "calcreward", { hive }), ["@alice/first-post"]),
    "Total Pending Payout: $12.345 (19.595% the size of reward pool).",
  );
  assert.equal(
    await commands.get("calcreward")?.execute(context(commands, "calcreward", { hive }), ["@alice/paid-post"]),
    "Sorry, this calculation only makes sense for posts within the first payout timeframe.",
  );
  assert.equal(
    await commands.get("calcreward")?.execute(context(commands, "calcreward", { hive }), []),
    "Sorry, I wasn't paying attention.",
  );
  assert.equal(
    await commands.get("nodes")?.execute(context(commands, "nodes", { hiveNodes }), []),
    ["**Hive public nodes**", "https://api.hive.blog @blocktrades", "https://api.deathwing.me @deathwing"].join("\n"),
  );
  assert.equal(
    await commands.get("ticker")?.execute(context(commands, "ticker", { hive, market }), []),
    [
      "**Hive ticker**",
      "HIVE/USD: **$0.0604**",
      "Feed: **0.0630 HBD / HIVE**",
      "24h: **+2.35%**",
      "Volume: **$1,250,000**",
      "Market cap: **$30,000,000**",
    ].join("\n"),
  );
  assert.equal(
    await commands.get("ticker")?.execute(context(commands, "ticker", { hive, market }), ["steem"]),
    "Chain `steem` is not configured in this Banjo build.",
  );
  assert.equal(
    await commands.get("price")?.execute(context(commands, "price", { hive, market }), ["$hive", "hbd", "HIVE"]),
    ["HIVE: **$0.0604**", "HBD: **$0.99**"].join("\n"),
  );
  assert.equal(
    await commands.get("price")?.execute(context(commands, "price", { hive, market }), ["leo"]),
    "Unsupported price symbol: `LEO`. Supported: `HIVE`, `HBD`.",
  );
  assert.match(
    await commands.get("fear")?.execute(context(commands, "fear", { market }), ["1"]) as string,
    /^\*\*Crypto Fear & Greed Index\*\*\nhttps:\/\/alternative\.me\/crypto\/fear-and-greed-index\/\nImage: https:\/\/alternative\.me\/images\/fng\/crypto-fear-and-greed-index-\d{4}-\d{1,2}-\d{1,2}\.png\n.+ ago: \*\*72 - Greed\*\*\n.+ ago: \*\*65 - Greed\*\*\nNext update in 3 hours\.$/,
  );
  assert.equal(
    await commands.get("greed")?.execute(context(commands, "greed", { market }), ["wat"]),
    "Usage: `$fear [days-ago]`",
  );
  assert.equal(
    await commands.get("token")?.execute(context(commands, "token", { hiveEngine, market }), ["leo"]),
    [
      "**LEO** issued by **@leofinance**",
      "https://hive-engine.com/?p=history&t=LEO&utm_source=banjo",
      "Name: LEO",
      "A social token for finance-focused Hive communities.",
      "See: https://leo.io",
      "Circulating Supply: `1,234,568 LEO`",
      "Last Price: `0.250 SWAP.HIVE / $0.015090`",
      "Lowest Ask: `0.260 SWAP.HIVE`",
      "Highest Bid: `0.240 SWAP.HIVE`",
      "Volume: `123.456 SWAP.HIVE / $7.451804`",
      "Change: `-1.25%`",
      "Trade: https://hive-engine.com/?p=market&t=LEO&utm_source=banjo",
    ].join("\n"),
  );
  assert.equal(
    await commands.get("token")?.execute(context(commands, "token", { hiveEngine, market }), ["wat"]),
    "Unknown token: WAT",
  );
  assert.equal(
    await commands.get("richlist")?.execute(context(commands, "richlist", { hiveEngine }), ["leo", "3"]),
    [
      "**Top 2 by Total Balance: LEO**",
      "https://he.dtools.dev/richlist/LEO",
      "```",
      " 1. large            175 LEO",
      " 2. medium           35 LEO",
      "```",
      "null: 1,000 LEO",
    ].join("\n"),
  );
  assert.equal(
    await commands.get("richlist")?.execute(context(commands, "richlist", { hiveEngine }), ["hive"]),
    "Native HIVE richlist lookup has not been ported yet.",
  );
  assert.equal(
    await commands.get("richlist")?.execute(context(commands, "richlist", { hiveEngine }), ["wat"]),
    "Unknown token: WAT",
  );
  assert.equal(
    await commands.get("staked")?.execute(context(commands, "staked", { hiveEngine }), ["leo", "2"]),
    [
      "**Top 2 by Stake: LEO**",
      "1. [large](https://he.dtools.dev/@large?symbol=LEO) - `50 LEO POWER` (69.44%)",
      "2. [medium](https://he.dtools.dev/@medium?symbol=LEO) - `20 LEO POWER` (27.78%)",
    ].join("\n"),
  );
  assert.equal(
    await commands.get("staked")?.execute(context(commands, "staked", { hiveEngine }), ["wat"]),
    "Unknown token: WAT",
  );
  assert.equal(
    await commands.get("nft")?.execute(context(commands, "nft", { hiveEngine }), ["punk"]),
    [
      "**PUNK** issued by **@nftissuer**",
      "https://he.dtools.dev/nfts/PUNK",
      "Name: Hive Punk",
      "Circulating Supply: `42 PUNK`",
      "Collectible Hive punks.",
      "See: https://punks.example",
    ].join("\n"),
  );
  assert.equal(
    await commands.get("nft")?.execute(context(commands, "nft", { hiveEngine }), ["missing"]),
    "Unknown nft: MISSING",
  );
  assert.match(
    await commands.get("nftsr")?.execute(context(commands, "nftsr", { hiveEngine }), ["inertia", "1"]) as string,
    /^\*\*Obey or Get Deleted #2 by @zyberzerk\*\*\nhttps:\/\/nftshowroom\.com\/gallery\/zyberzerk_political-collage_obey-or-get-deleted\?collection=true\nCollection: Political Collage\nNote: :\)\)\nCreated: .+ ago \(2020-06-22 00:00 UTC\)$/,
  );
  assert.equal(
    await commands.get("nftsr")?.execute(context(commands, "nftsr", { hiveEngine }), ["unpublished"]),
    "That NFT is unpublished: `unpublished`",
  );
  assert.equal(
    await commands.get("nftsr")?.execute(context(commands, "nftsr", { hiveEngine }), ["missing"]),
    "Unable to find NFT: `missing`",
  );
  assert.equal(
    await commands.get("scottags")?.execute(context(commands, "scottags", { scot }), ["leo", "spt", "app"]),
    ["```", "LEO: hive-167922 leo finance inleo", "SPT (community only): hive-13323", "APP (app only): customapp", "```"].join("\n"),
  );
  assert.equal(
    await commands.get("scottags")?.execute(context(commands, "scottags", { scot }), []),
    "Please specify a token, or tokens: `LEO SPT APP`",
  );
  assert.equal(
    await commands.get("tt2x")?.execute(context(commands, "tt2x", { hiveEngine, market, scot }), ["leo", "2"]),
    [
      "**Top 2 Trending to Exchange: LEO**",
      "https://hive-engine.com/?p=history&t=LEO&utm_source=banjo",
      "Trade: https://hive-engine.com/?p=market&t=LEO&utm_source=banjo",
      "Last Price: `0.250 HIVE / $0.015090`",
      "Average Pending Payout: `10.000 LEO` / `2.500 HIVE` / `$0.150900` (2 unique authors)",
      "Sum of Top 2 Pending Payout: `20.000 LEO` / `5.000 HIVE` / `$0.301800`",
      "Actual Yield: `20.000 LEO` would sell for `4.400 HIVE` / `$0.265584`",
      "Price at Final Yield: `0.200 HIVE` / `$0.012072`",
      "Change at Final Yield: `-20.00%`",
    ].join("\n"),
  );
  assert.equal(
    await commands.get("feed")?.execute(context(commands, "feed", { hive }), []),
    [
      "**Hive feed price**",
      "Median: **0.063 HBD / 1.000 HIVE**",
      "Market median: **0.064 HBD / 1.000 HIVE**",
      "Low: **0.059 HBD / 1.000 HIVE**",
      "High: **0.066 HBD / 1.000 HIVE**",
    ].join("\n"),
  );
  assert.equal(
    await commands.get("feed")?.execute(context(commands, "feed", { hive }), ["apr"]),
    [
      "**Hive HBD policy**",
      "HBD interest rate: **12.00%**",
      "HBD print rate: **0.00%**",
      "Start reducing HBD printing at: **20.00%**",
      "Stop HBD printing at: **20.00%**",
    ].join("\n"),
  );
  assert.equal(
    await commands.get("feed")?.execute(context(commands, "feed", { hive }), ["price", "steem"]),
    "Chain `steem` is not configured in this Banjo build.",
  );
  assert.equal(
    await commands.get("feed")?.execute(context(commands, "feed", { hive }), ["wat"]),
    "Unknown feed type: wat",
  );
  assert.match(
    await commands.get("hardfork")?.execute(context(commands, "hardfork", { hive }), []) as string,
    /^Current: `1\.28\.0`; Witness Majority: `1\.28\.3`; Last: `1\.28\.0` \(.+ ago\)\nVersion Votes by Top 100 Witnesses:\n```markdown\n\| Version \| Witnesses \| MVESTS \|\n\|---------\|-----------\|--------\|\n\|  1\.28\.0 \|         2 \|  3,000 \|\n\|  1\.27\.9 \|         1 \|    500 \|\n```\n?$/,
  );
  assert.equal(
    await commands.get("hardfork")?.execute(context(commands, "hardfork", { hive }), ["steem"]),
    "Chain `steem` is not configured in this Banjo build.",
  );
  assert.equal(
    await commands.get("supply")?.execute(context(commands, "supply", { hive }), []),
    ["**Hive supply**", "Current HIVE: **500,000.000 HIVE**", "Virtual HIVE: **600,000.000 HIVE**", "Current HBD: **25,000.000 HBD**"].join("\n"),
  );
  assert.equal(
    await commands.get("supply")?.execute(context(commands, "supply", { hive }), ["hive"]),
    ["**Hive supply**", "Current HIVE: **500,000.000 HIVE**", "Virtual HIVE: **600,000.000 HIVE**", "Current HBD: **25,000.000 HBD**"].join("\n"),
  );
  assert.equal(
    await commands.get("supply")?.execute(context(commands, "supply", { hive }), ["*"]),
    "Chain `*` is not configured in this Banjo build.",
  );
  assert.match(
    await commands.get("witness")?.execute(context(commands, "witness", { hive }), ["alice"]) as string,
    /\*\*alice\*\* is a Hive witness\.\nVersion: \*\*1\.27\.0\*\*\nMissed blocks: \*\*2\*\*/,
  );
  assert.equal(
    await commands.get("avatar")?.execute(context(commands, "avatar", { hive }), ["alice"]),
    "https://images.hive.blog/u/alice/avatar",
  );
  assert.equal(
    await commands.get("latest")?.execute(context(commands, "latest", { hive }), ["alice", "1"]),
    "https://hive.blog/@alice/older-post",
  );
  assert.equal(
    await commands.get("latest")?.execute(context(commands, "latest", { hive }), ["alice", "hive", "1"]),
    "https://hive.blog/@alice/older-post",
  );
  assert.equal(
    await commands.get("first")?.execute(context(commands, "first", { hive }), ["alice", "1"]),
    "https://hive.blog/@alice/second-post",
  );
  assert.equal(
    await commands.get("first")?.execute(context(commands, "first", { hive }), ["alice", "2"]),
    "Unable to find first blog entry for alice.",
  );
  assert.equal(
    await commands.get("follows")?.execute(context(commands, "follows", { hive }), ["alice"]),
    "**alice's followers:** `1,234`; **following:** `56`",
  );
  assert.match(
    await commands.get("age")?.execute(context(commands, "age", { hive }), ["https://steemit.com/introduceyourself/@alice/first-post"]) as string,
    /^First Post by @alice was posted .+ ago \(2016-07-01 00:00 UTC\)\.$/,
  );
  assert.equal(
    await commands.get("age")?.execute(context(commands, "age", { hive }), ["@alice/missing-post"]),
    "Unable to find post @alice/missing-post.",
  );
});

test("rep reports unknown accounts when the reputation page does not exactly match", async () => {
  const commands = registry();
  const hive: HiveApi = {
    getAccount: async () => null,
    getAccounts: async () => [],
    getAccountReputation: async () => null,
    getConfig: async () => ({}),
    getDynamicGlobalProperties: async () => ({
      total_vesting_fund_hive: "0.000 HIVE",
      total_vesting_shares: "0.000000 VESTS",
    }),
    getFeedHistory: async () => ({
      current_median_history: {
        base: "0.000 HBD",
        quote: "0.000 HIVE",
      },
    }),
    getFollowCount: async () => null,
    getFirstPost: async () => null,
    getLatestPosts: async () => [],
    getPostCreation: async () => null,
    getCommunity: async () => null,
    getLatestAccountOperation: async () => null,
    getRewardOperations: async () => [],
    getRewardFund: async () => ({
      name: "post",
      reward_balance: "0.000 HIVE",
      recent_claims: "0",
    }),
    listProposals: async () => [],
    listProposalVotesByProposal: async () => [],
    listProposalVotes: async () => [],
    getHardforkVersion: async () => "0.0.0",
    getNextScheduledHardfork: async () => ({
      hf_version: "0.0.0",
      live_time: "1970-01-01T00:00:00",
    }),
    getWitnessByAccount: async () => null,
    getWitnessesByVote: async () => [],
    getWitnessSchedule: async () => ({
      majority_version: "0.0.0",
    }),
  };

  assert.equal(
    await commands.get("rep")?.execute(context(commands, "rep", { hive }), ["missing-account"]),
    "Could not find Hive account **missing-account**.",
  );
});
