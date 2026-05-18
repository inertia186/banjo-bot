import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
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

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

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
  message?: Partial<Message>,
): CommandContext {
  return {
    config,
    logger,
    commandName,
    ...(services ? { services } : {}),
    message: {
      client: { commands },
      ...message,
    } as unknown as Message,
  };
}

function embedJson<T>(response: unknown, index = 0): T {
  assert.equal(typeof response, "object");
  const embed = (response as { embeds: Array<{ toJSON(): T }> }).embeds[index];
  assert.ok(embed);
  return embed.toJSON();
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

test("version reports Banjo's package version", async () => {
  const commands = registry();

  assert.equal(await commands.get("version")?.execute(context(commands), []), `banjo-bot v${packageJson.version}`);
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
  const xkcdResponse = await commands.get("xkcd")?.execute(context(commands, "xkcd", { xkcd }), ["42"]);
  const xkcdEmbed = embedJson<{
    title?: string;
    url?: string;
    description?: string;
    image?: { url: string };
  }>(xkcdResponse);
  assert.equal(xkcdEmbed.title, "xkcd #42: Compiler Complaint");
  assert.equal(xkcdEmbed.url, "https://xkcd.com/42/");
  assert.equal(xkcdEmbed.image?.url, "https://imgs.xkcd.com/comics/compiler_complaint.png");
  assert.equal(xkcdEmbed.description, undefined);
  const xkcdAltEmbed = embedJson<{ description?: string }>(xkcdResponse, 1);
  assert.equal(xkcdAltEmbed.description, "|| It compiled on my machine. ||");
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
    getMarketTicker: async () => ({
      latest: "0.062000",
      lowest_ask: "0.064000",
      highest_bid: "0.061000",
      percent_change: "2.35",
      hive_volume: "1000.000 HIVE",
      hbd_volume: "62.000 HBD",
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
      author === "dev-account" && permlink === "developer-tools"
        ? {
            author,
            permlink,
            title: "Developer tools",
            created: "2020-01-01T00:00:00",
            body: "Build and maintain developer tooling for Hive.",
            json_metadata: JSON.stringify({
              description: "Funding developer tooling for the Hive ecosystem.",
              image: ["https://images.hive.blog/dev-tools.png"],
            }),
          }
        : author === "alice" && permlink === "banjo-notes"
        ? {
            author,
            permlink,
            title: "Banjo Notes",
            created: "2026-05-16T00:00:00",
            body: "A closer look at Banjo search results and how embeds should preview Hive posts.",
            json_metadata: JSON.stringify({
              description: "A closer look at Banjo search results.",
              image: ["https://images.hive.blog/banjo-notes.png"],
            }),
          }
        : author === "alice" && permlink === "top-post"
        ? {
            author,
            permlink,
            title: "Top Post",
            created: "2026-05-15T00:00:00",
            body: "Top post body excerpt.",
            json_metadata: JSON.stringify({
              description: "Top post metadata description.",
              image: ["https://images.hive.blog/top-post.png"],
            }),
          }
        : permlink === "first-post"
        ? {
            author,
            permlink,
            title: "First Post",
            created: "2016-07-01T00:00:00",
            cashout_time: "2999-01-01T00:00:00",
            pending_payout_value: "12.345 HBD",
            body: "First post body.",
            json_metadata: JSON.stringify({
              description: "First post preview.",
              image: ["https://images.hive.blog/first-post.png"],
            }),
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
        { value: 58, classification: "Neutral", timestamp: 1_767_135_600, timeUntilUpdate: null },
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
              icon: "https://images.hive.blog/leo.png",
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

  const repEmbed = embedJson<{
    title?: string;
    url?: string;
    thumbnail?: { url: string };
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("rep")?.execute(context(commands, "rep", { hive }), ["@alice"]));
  assert.equal(repEmbed.title, "alice");
  assert.equal(repEmbed.url, "https://hivehub.dev/stats/account?username=alice");
  assert.equal(repEmbed.thumbnail?.url, "https://images.hive.blog/u/alice/avatar");
  assert.equal(repEmbed.footer?.text, "Hive Chain");
  assert.deepEqual(repEmbed.fields, [
    { name: "Reputation", value: "52.82", inline: true },
  ]);
  const proxyEmbed = embedJson<{
    title?: string;
    url?: string;
    thumbnail?: { url: string };
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("proxy")?.execute(context(commands, "proxy", { hive }), ["alice"]));
  assert.equal(proxyEmbed.title, "alice");
  assert.equal(proxyEmbed.url, "https://hivehub.dev/stats/account?username=alice");
  assert.equal(proxyEmbed.thumbnail?.url, "https://images.hive.blog/u/alice/avatar");
  assert.equal(proxyEmbed.footer?.text, "Hive Chain");
  assert.deepEqual(proxyEmbed.fields, [
    { name: "Witness Proxy", value: "@blocktrades", inline: true },
  ]);
  assert.equal(
    await commands.get("poke")?.execute(context(commands, "poke", { hive }), ["alice"]),
    "```json\n{\"transfer\":{\"from\":\"alice\",\"to\":\"bob\",\"amount\":\"1.000 HIVE\",\"memo\":\"poke\"}}\n```",
  );
  const maliciousHive: HiveApi = {
    ...hive,
    getLatestAccountOperation: async (name) => ({
      index: 124,
      block: 457,
      timestamp: "2026-05-17T00:00:01",
      type: "transfer",
      value: {
        from: name,
        to: "bob",
        amount: "1.000 HIVE",
        memo: "```\n@everyone",
      },
    }),
  };
  assert.equal(
    await commands.get("poke")?.execute(context(commands, "poke", { hive: maliciousHive }), ["alice"]),
    "```json\n{\"transfer\":{\"from\":\"alice\",\"to\":\"bob\",\"amount\":\"1.000 HIVE\",\"memo\":\"\\u0060\\u0060\\u0060\\n@everyone\"}}\n```",
  );
  const proxiedApprovalEmbed = embedJson<{
    title?: string;
    url?: string;
    description?: string;
    thumbnail?: { url: string };
    footer?: { text: string; icon_url?: string };
  }>(await commands.get("approval")?.execute(context(commands, "approval", { hive }), ["alice"]));
  assert.equal(proxiedApprovalEmbed.title, "Approved by alice");
  assert.equal(proxiedApprovalEmbed.url, "https://hiveblocks.com/@alice");
  assert.equal(proxiedApprovalEmbed.description, "Proxied to: **blocktrades**");
  assert.equal(proxiedApprovalEmbed.thumbnail?.url, "https://images.hive.blog/u/alice/avatar");
  assert.equal(proxiedApprovalEmbed.footer?.text, "Hive governance");
  const communityEmbed = embedJson<{
    title?: string;
    url?: string;
    description?: string;
    thumbnail?: { url: string };
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("community")?.execute(context(commands, "community", { hive }), ["hive-167922"]));
  assert.equal(communityEmbed.title, "LeoFinance");
  assert.equal(communityEmbed.url, "https://hive.blog/trending/hive-167922#leofinance");
  assert.equal(communityEmbed.description, "**Crypto and finance on Hive.**\nA community for crypto, finance, and Web3 builders.");
  assert.equal(communityEmbed.thumbnail?.url, "https://images.hive.blog/u/hive-167922/avatar");
  assert.equal(communityEmbed.footer?.text, "Hivemind Communities");
  assert.deepEqual(communityEmbed.fields, [
    { name: "Owner", value: "@hive-167922", inline: true },
    { name: "Subscribers", value: "26,677", inline: true },
    { name: "Pending Rewards", value: "$475", inline: true },
    { name: "Active Authors", value: "443", inline: true },
    { name: "Created", value: communityEmbed.fields?.[4]?.value ?? "", inline: false },
  ]);
  assert.match(communityEmbed.fields?.[4]?.value ?? "", /^.+ ago \(2019-11-26 17:25 UTC\)$/);
  assert.equal(
    await commands.get("community")?.execute(context(commands, "community", { hive }), ["missing"]),
    "Unable to find community with: `missing`",
  );
  const approvalEmbed = embedJson<{
    title?: string;
    url?: string;
    thumbnail?: { url: string };
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("approved")?.execute(context(commands, "approved", { hive }), ["bob"]));
  assert.equal(approvalEmbed.title, "Approved by bob");
  assert.equal(approvalEmbed.url, "https://hiveblocks.com/@bob");
  assert.equal(approvalEmbed.thumbnail?.url, "https://images.hive.blog/u/bob/avatar");
  assert.equal(approvalEmbed.footer?.text, "Hive governance");
  assert.deepEqual(approvalEmbed.fields, [
    { name: "Witnesses (2)", value: "gtg, blocktrades", inline: false },
    { name: "Proposals (2)", value: "dev-fund (1), hive.fund (2)", inline: false },
    { name: "Proposal Pay Approved", value: "12.345 HBD daily", inline: true },
    { name: "Upcoming Proposals (1)", value: "future-dev (3)", inline: false },
  ]);
  const proposalEmbed = embedJson<{
    title?: string;
    url?: string;
    description?: string;
    thumbnail?: { url: string };
    image?: { url: string };
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("proposal")?.execute(context(commands, "proposal", { hive }), ["dev-account"]));
  assert.equal(proposalEmbed.title, "Proposal #1: Developer tools");
  assert.equal(proposalEmbed.url, "https://peakd.com/proposals/1");
  assert.match(
    proposalEmbed.description ?? "",
    /^Approved: Yes \(150\.00%\)\n\n\*\*Discussion:\*\* \[dev-account\/developer-tools]\(https:\/\/peakd\.com\/@dev-account\/developer-tools\)\n\n```\nCreator           Receiver\n@dev-account      @dev-account\nStart             End\n.+\nDays              Daily Pay\n\d[\d,]* of 3,653    10\.000 HBD\nTotal Votes \(HP\)  Voters\n1\.5M              2\n```\n\n\*\*Total Requested Pay:\*\* 36,530 HBD\n\nFunding developer tooling for the Hive ecosystem\.$/,
  );
  assert.equal(proposalEmbed.image?.url, "https://images.hive.blog/dev-tools.png");
  assert.equal(proposalEmbed.footer?.text, "Hive DHF Proposal");
  assert.deepEqual(proposalEmbed.fields, undefined);
  const proposalListResponse = await commands.get("proposal")?.execute(context(commands, "proposal", { hive }), ["tools"]);
  const proposalComponents = (proposalListResponse as {
    components: Array<{ toJSON(): { components: Array<{ type?: number; style?: number; custom_id?: string; label?: string; disabled?: boolean }> } }>;
  }).components[0]?.toJSON().components;
  assert.deepEqual(proposalComponents?.map((component) => ({
    customId: component.custom_id,
    label: component.label,
    disabled: component.disabled ?? false,
  })), [
    { customId: "proposal:0:1,3", label: "Previous", disabled: true },
    { customId: "proposal:1:1,3", label: "Next", disabled: false },
  ]);
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
  const hiveRewardsEmbed = embedJson<{
    title?: string;
    url?: string;
    description?: string;
    thumbnail?: { url: string };
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("rewards")?.execute(context(commands, "rewards", { hive, market }), ["alice"]));
  assert.equal(hiveRewardsEmbed.title, "HIVE rewards for alice");
  assert.equal(hiveRewardsEmbed.url, "https://hivehub.dev/stats/account?username=alice");
  assert.match(hiveRewardsEmbed.description ?? "", /^Since .+ ago \(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\)$/);
  assert.equal(hiveRewardsEmbed.thumbnail?.url, "https://images.hive.blog/u/alice/avatar");
  assert.equal(hiveRewardsEmbed.footer?.text, "Hive Account History");
  assert.deepEqual(hiveRewardsEmbed.fields, [
    { name: "Producer", value: "500.000", inline: true },
    { name: "Interest", value: "0.016", inline: true },
    { name: "Curation / Author / Benefactor", value: "2.000 / 52.063 / 26.032", inline: false },
    { name: "Total / USD / USD Per Day", value: "580.110 / 36.55 / 13.29", inline: false },
  ]);
  const scotRewardsEmbed = embedJson<{
    title?: string;
    url?: string;
    description?: string;
    thumbnail?: { url: string };
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("rewards")?.execute(context(commands, "rewards", { hive, hiveEngine, market, scot }), ["alice", "LEO"]));
  assert.equal(scotRewardsEmbed.title, "LEO rewards for alice");
  assert.equal(scotRewardsEmbed.url, "https://hivehub.dev/stats/account?username=alice");
  assert.match(scotRewardsEmbed.description ?? "", /^Since .+ ago \(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\)$/);
  assert.equal(scotRewardsEmbed.thumbnail?.url, "https://images.hive.blog/leo.png");
  assert.equal(scotRewardsEmbed.footer?.text, "SCOT + Hive Engine");
  assert.deepEqual(scotRewardsEmbed.fields, [
    { name: "Staking", value: "1.500", inline: true },
    { name: "Mining", value: "2.000", inline: true },
    { name: "HIVE", value: "3.000", inline: true },
    { name: "Curation / Author / Benefactor", value: "2.500 / 5.000 / 1.000", inline: false },
    { name: "Total / USD / USD Per Day", value: "12.000 / 0.19 / 0.07", inline: false },
  ]);
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
  const claimsEmbed = embedJson<{
    title?: string;
    description?: string;
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("claims")?.execute(context(commands, "claims", { hiveSql }), []));
  assert.equal(claimsEmbed.title, "Hive Reward Claims");
  assert.equal(claimsEmbed.description, "today");
  assert.equal(claimsEmbed.footer?.text, "HiveSQL");
  assert.deepEqual(claimsEmbed.fields, [
    { name: "Claims", value: "3", inline: true },
    { name: "Unique Accounts", value: "2", inline: true },
    { name: "Rewards", value: "1.250 HBD / 2.500 HIVE / 4.250 MVESTS", inline: false },
  ]);
  const yesterdayClaimsEmbed = embedJson<{
    description?: string;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("claims")?.execute(context(commands, "claims", { hiveSql }), ["yesterday"]));
  assert.equal(yesterdayClaimsEmbed.description, "yesterday");
  assert.deepEqual(yesterdayClaimsEmbed.fields, [
    { name: "Claims", value: "8", inline: true },
    { name: "Unique Accounts", value: "5", inline: true },
    { name: "Rewards", value: "3.750 HBD / 8.000 HIVE / 12.000 MVESTS", inline: false },
  ]);
  const allClaimsEmbed = embedJson<{
    description?: string;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("claims")?.execute(context(commands, "claims", { hiveSql }), ["nonsense"]));
  assert.equal(allClaimsEmbed.description, "all");
  assert.deepEqual(allClaimsEmbed.fields, yesterdayClaimsEmbed.fields);
  assert.equal(
    await commands.get("claims")?.execute(context(commands, "claims", { hiveSql }), ["today", "steem"]),
    "Chain `steem` is not configured in this Banjo build.",
  );
  assert.equal(
    await commands.get("claims")?.execute(context(commands, "claims"), []),
    "HiveSQL is not configured, so claim lookup is unavailable.",
  );
  const accountsEmbed = embedJson<{
    title?: string;
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("accounts")?.execute(context(commands, "accounts", { hiveSql }), []));
  assert.equal(accountsEmbed.title, "Hive Accounts");
  assert.equal(accountsEmbed.footer?.text, "HiveSQL");
  assert.deepEqual(accountsEmbed.fields, [
    { name: "Total", value: "2,345,678", inline: true },
    { name: "Mined", value: "13,696", inline: true },
    { name: "Communities", value: "3,210", inline: true },
    { name: "Badges", value: "456", inline: true },
  ]);
  assert.equal(
    await commands.get("accounts")?.execute(context(commands, "accounts", { hiveSql }), ["steem"]),
    "Chain `steem` is not configured in this Banjo build.",
  );
  assert.equal(
    await commands.get("accounts")?.execute(context(commands, "accounts"), []),
    "HiveSQL is not configured, so account summary lookup is unavailable.",
  );
  const searchEmbed = embedJson<{
    title?: string;
    url?: string;
    description?: string;
    image?: { url: string };
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("search")?.execute(context(commands, "search", { hive, hiveSql }), ["banjo", "tag:hive", "!tag:test", "after:2026-05-01", "before:2026-05-16"]));
  assert.equal(searchEmbed.title, "Banjo Notes");
  assert.equal(searchEmbed.url, "https://hive.blog/@alice/banjo-notes");
  assert.equal(searchEmbed.description, [
    "[alice/banjo-notes](https://hive.blog/@alice/banjo-notes)",
    "A closer look at Banjo search results.",
  ].join("\n"));
  assert.equal(searchEmbed.thumbnail?.url, "https://images.hive.blog/u/alice/avatar");
  assert.equal(searchEmbed.image?.url, "https://images.hive.blog/banjo-notes.png");
  assert.equal(searchEmbed.footer?.text, "2 results by 2 authors");
  assert.equal(searchEmbed.fields?.[0]?.name, "Result");
  assert.equal(searchEmbed.fields?.[0]?.value, "1 / 2");
  assert.equal(searchEmbed.fields?.[1]?.name, "Author");
  assert.equal(searchEmbed.fields?.[1]?.value, "@alice");
  assert.equal(searchEmbed.fields?.[2]?.name, "Created");
  assert.match(searchEmbed.fields?.[2]?.value ?? "", /^.+ ago \(2026-05-16 00:00 UTC\)$/);
  assert.deepEqual(searchEmbed.fields?.slice(3), [
    { name: "Query", value: "banjo", inline: true },
    { name: "Tags", value: "in hive; not in test", inline: true },
    { name: "Timeframe", value: "between 2026-05-01 00:00 UTC and 2026-05-16 23:59 UTC", inline: true },
  ]);
  const searchResponse = await commands.get("search")?.execute(context(commands, "search", { hive, hiveSql }), ["banjo", "tag:hive", "!tag:test", "after:2026-05-01", "before:2026-05-16"]);
  const searchComponents = (searchResponse as {
    components: Array<{ toJSON(): { components: Array<{ type?: number; style?: number; custom_id?: string; label?: string; disabled?: boolean }> } }>;
  }).components[0]?.toJSON().components;
  assert.deepEqual(searchComponents?.map((component) => ({
    customId: component.custom_id?.replace(/^search:[^:]+:/, "search:<cache>:"),
    label: component.label,
    disabled: component.disabled ?? false,
  })), [
    { customId: "search:<cache>:0", label: "Previous", disabled: true },
    { customId: "search:<cache>:1", label: "Next", disabled: false },
  ]);
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
  const topEmbed = embedJson<{
    title?: string;
    url?: string;
    description?: string;
    thumbnail?: { url: string };
    image?: { url: string };
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("top")?.execute(context(commands, "top", { hive, hiveSql }), ["upvoted"]));
  assert.equal(topEmbed.title, "Top Post");
  assert.equal(topEmbed.url, "https://hive.blog/@alice/top-post");
  assert.equal(topEmbed.description, [
    "[alice/top-post](https://hive.blog/@alice/top-post)",
    "Top post metadata description.",
  ].join("\n"));
  assert.equal(topEmbed.thumbnail?.url, "https://images.hive.blog/u/alice/avatar");
  assert.equal(topEmbed.image?.url, "https://images.hive.blog/top-post.png");
  assert.equal(topEmbed.footer?.text, "HiveSQL");
  assert.equal(topEmbed.fields?.[0]?.name, "Kind");
  assert.equal(topEmbed.fields?.[0]?.value, "upvoted");
  assert.equal(topEmbed.fields?.[1]?.name, "Since");
  assert.match(topEmbed.fields?.[1]?.value ?? "", /^7 days ago$/);
  assert.equal(topEmbed.fields?.[2]?.name, "Score");
  assert.equal(topEmbed.fields?.[2]?.value, "42");
  const topReplyEmbed = embedJson<{
    title?: string;
    url?: string;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("top")?.execute(context(commands, "top", { hive, hiveSql }), ["reply", "popcorn"]));
  assert.equal(topReplyEmbed.title, "Reply Parent");
  assert.equal(topReplyEmbed.url, "https://hive.blog/@bob/reply-parent");
  assert.deepEqual(topReplyEmbed.fields?.map((field) => [field.name, field.value]), [
    ["Kind", "reply"],
    ["Since", topReplyEmbed.fields?.[1]?.value ?? ""],
    ["Score", "12"],
    ["Keywords", "popcorn"],
  ]);
  assert.match(topReplyEmbed.fields?.[1]?.value ?? "", /^7 days ago$/);
  const topLowRepEmbed = embedJson<{
    title?: string;
    url?: string;
  }>(await commands.get("top")?.execute(context(commands, "top", { hive, hiveSql }), ["-rep"]));
  assert.equal(topLowRepEmbed.title, "Low Rep Post");
  assert.equal(topLowRepEmbed.url, "https://peakd.com/@kgakakillerg/a-walk-around-the-o2-in-greenwich-london-april-2026-part-7");
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
  const appEmbed = embedJson<{
    title?: string;
    description?: string;
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("app")?.execute(context(commands, "app", { hiveSql }), []));
  assert.equal(appEmbed.title, "Top 10 Apps Paid");
  assert.equal(appEmbed.description, [
    "1. `peakd/2026.05.1` - 12,345 HBD",
    "2. `ecency/3.2.0` - 2,345 HBD",
    "3. `unknown` - 123 HBD",
  ].join("\n"));
  assert.equal(appEmbed.footer?.text, "HiveSQL");
  assert.equal(appEmbed.fields?.[0]?.name, "Since");
  assert.match(appEmbed.fields?.[0]?.value ?? "", /^7 days ago$/);
  assert.equal(appEmbed.fields?.[1]?.name, "Results");
  assert.equal(appEmbed.fields?.[1]?.value, "3");
  const appsEmbed = embedJson<{
    title?: string;
    description?: string;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("apps")?.execute(context(commands, "apps", { hiveSql }), ["1"]));
  assert.equal(appsEmbed.title, "Top 1 App Paid");
  assert.equal(appsEmbed.description, "1. `peakd/2026.05.1` - 12,345 HBD");
  assert.equal(appsEmbed.fields?.[1]?.value, "1");
  assert.equal(
    await commands.get("app")?.execute(context(commands, "app"), []),
    "HiveSQL is not configured, so app payout lookup is unavailable.",
  );
  const promotedEmbed = embedJson<{
    title?: string;
    description?: string;
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("promoted")?.execute(context(commands, "promoted", { hiveSql }), []));
  assert.equal(promotedEmbed.title, "Promoted Posts");
  assert.equal(promotedEmbed.description, [
    "1. [Promoted One](https://hive.blog/@alice/promoted-one) - `10.000 HBD`",
    "2. [Promoted Two](https://hive.blog/@bob/promoted-two) - `2.345 HBD`",
  ].join("\n"));
  assert.equal(promotedEmbed.footer?.text, "HiveSQL");
  assert.deepEqual(promotedEmbed.fields, [
    { name: "Yesterday", value: "2 posts / 12.345 HBD", inline: true },
    { name: "Today", value: "0 posts / 0.000 HBD", inline: true },
  ]);
  assert.equal(
    await commands.get("promoted")?.execute(context(commands, "promoted", { hiveSql }), ["steem"]),
    "Chain `steem` is not configured in this Banjo build.",
  );
  assert.equal(
    await commands.get("promoted")?.execute(context(commands, "promoted"), []),
    "HiveSQL is not configured, so promoted post lookup is unavailable.",
  );
  const distributionEmbed = embedJson<{
    title?: string;
    description?: string;
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("distribution")?.execute(context(commands, "distribution", { hive, hiveSql }), ["30"]));
  assert.equal(distributionEmbed.title, "Hive Stake Distribution");
  assert.equal(distributionEmbed.description, [
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
  ].join("\n"));
  assert.equal(distributionEmbed.footer?.text, "HiveSQL");
  assert.deepEqual(distributionEmbed.fields, [
    { name: "Active Accounts", value: "10 / 15", inline: true },
    { name: "Inactive Stake", value: "8.26%", inline: true },
  ]);
  assert.equal(
    await commands.get("dist")?.execute(context(commands, "dist", { hive, hiveSql }), ["nope"]),
    "Usage: `$distribution [days]`",
  );
  assert.equal(
    await commands.get("distribution")?.execute(context(commands, "distribution", { hive }), []),
    "HiveSQL is not configured, so distribution lookup is unavailable.",
  );
  const badgesEmbed = embedJson<{
    title?: string;
    description?: string;
    footer?: { text: string };
  }>(await commands.get("badges")?.execute(context(commands, "badges", { hive, hiveSql }), ["helpful"]));
  assert.equal(badgesEmbed.title, "Latest Badges matching: helpful");
  assert.equal(badgesEmbed.description, "[Fresh Helper](https://peakd.com/b/badge-123#fresh-helper) by @livecreator");
  assert.equal(badgesEmbed.footer?.text, "1 result");
  const badgeEmbed = embedJson<{
    title?: string;
    url?: string;
    description?: string;
    thumbnail?: { url: string };
    footer?: { text: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("badge")?.execute(context(commands, "badge", { hive, hiveSql }), ["helpful"]));
  assert.equal(badgeEmbed.title, "Fresh Helper");
  assert.equal(badgeEmbed.url, "https://peakd.com/b/badge-123#fresh-helper");
  assert.equal(badgeEmbed.description, "Fresh profile from live Hive.");
  assert.equal(badgeEmbed.thumbnail?.url, "https://images.hive.blog/u/badge-123/avatar");
  assert.equal(badgeEmbed.footer?.text, "PeakD Badge");
  assert.deepEqual(badgeEmbed.fields, [
    { name: "Creator", value: "@livecreator", inline: true },
    { name: "Recipients", value: "12", inline: true },
    { name: "Subscribers", value: "3", inline: true },
    { name: "Created", value: badgeEmbed.fields?.[3]?.value ?? "", inline: false },
  ]);
  assert.match(badgeEmbed.fields?.[3]?.value ?? "", /^.+ ago \(2021-01-02 03:04 UTC\)$/);
  assert.equal(
    await commands.get("badges")?.execute(context(commands, "badges"), []),
    "HiveSQL is not configured, so badge search is unavailable.",
  );
  const inflationEmbed = embedJson<{
    title?: string;
    description?: string;
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("inflation")?.execute(context(commands, "inflation"), ["3"]));
  assert.equal(inflationEmbed.title, "Hive Inflation Projection");
  assert.equal(inflationEmbed.description, [
    "```",
    "| Year |   Supply    | Inflation | New Supply |",
    "|------|-------------|-----------|------------|",
    "| 2016 | 250,000,000 |     9.50% | 23,750,000 |",
    "| 2017 | 273,750,000 |     9.08% | 24,854,398 |",
    "| 2018 | 298,604,398 |     8.66% | 25,854,554 |",
    "```",
  ].join("\n"));
  assert.equal(inflationEmbed.footer?.text, "Hive Chain");
  assert.deepEqual(inflationEmbed.fields, [
    { name: "Years", value: "3", inline: true },
  ]);
  assert.equal(
    await commands.get("inflation")?.execute(context(commands, "inflation"), ["3", "steem"]),
    "Chain `steem` is not configured in this Banjo build.",
  );
  const powerEmbed = embedJson<{
    title?: string;
    url?: string;
    thumbnail?: { url: string };
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("power")?.execute(context(commands, "power", { hive }), ["alice"]));
  assert.equal(powerEmbed.title, "alice");
  assert.equal(powerEmbed.url, "https://hivehub.dev/stats/account?username=alice");
  assert.equal(powerEmbed.thumbnail?.url, "https://images.hive.blog/u/alice/avatar");
  assert.equal(powerEmbed.footer?.text, "Hive Chain");
  assert.deepEqual(powerEmbed.fields, [
    { name: "Hive Power", value: "575.000 HP", inline: true },
    { name: "Voting Power", value: "75.00%", inline: true },
  ]);
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
  const rewardPoolEmbed = embedJson<{
    title?: string;
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("rewardpool")?.execute(context(commands, "rewardpool", { hive }), []));
  assert.equal(rewardPoolEmbed.title, "Hive Reward Pool");
  assert.equal(rewardPoolEmbed.footer?.text, "Hive Chain");
  assert.deepEqual(rewardPoolEmbed.fields, [
    { name: "Balance", value: "1,000.000 HIVE", inline: true },
    { name: "Recent Claims", value: "1,234,567,890,123,456", inline: true },
    { name: "Curation Rewards", value: "50.00%", inline: true },
  ]);
  assert.deepEqual(
    embedJson<{ fields?: Array<{ name: string; value: string; inline?: boolean }> }>(
      await commands.get("rewardpool")?.execute(context(commands, "rewardpool", { hive }), ["hive"]),
    ).fields,
    rewardPoolEmbed.fields,
  );
  assert.equal(
    await commands.get("rewardpool")?.execute(context(commands, "rewardpool", { hive }), ["steem"]),
    "Chain `steem` is not configured in this Banjo build.",
  );
  const calcRewardEmbed = embedJson<{
    title?: string;
    url?: string;
    description?: string;
    thumbnail?: { url: string };
    image?: { url: string };
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("calcreward")?.execute(context(commands, "calcreward", { hive }), ["@alice/first-post"]));
  assert.equal(calcRewardEmbed.title, "First Post");
  assert.equal(calcRewardEmbed.url, "https://hive.blog/@alice/first-post");
  assert.equal(calcRewardEmbed.description, [
    "[alice/first-post](https://hive.blog/@alice/first-post)",
    "First post preview.",
  ].join("\n"));
  assert.equal(calcRewardEmbed.thumbnail?.url, "https://images.hive.blog/u/alice/avatar");
  assert.equal(calcRewardEmbed.image?.url, "https://images.hive.blog/first-post.png");
  assert.equal(calcRewardEmbed.footer?.text, "Hive Chain");
  assert.deepEqual(calcRewardEmbed.fields, [
    { name: "Pending Payout", value: "$12.345", inline: true },
    { name: "Reward Pool Ratio", value: "19.595%", inline: true },
  ]);
  assert.equal(
    await commands.get("calcreward")?.execute(context(commands, "calcreward", { hive }), ["https://hive.blog/@alice/first-post"]),
    "Total Pending Payout: $12.345 (19.595% the size of reward pool).",
  );
  assert.equal(
    await commands.get("calcreward")?.execute(context(commands, "calcreward", { hive }), ["<https://hive.blog/@alice/first-post>"]),
    "Total Pending Payout: $12.345 (19.595% the size of reward pool).",
  );
  assert.equal(
    await commands.get("calcreward")?.execute(context(commands, "calcreward", { hive }), ["<https://chromewebstore.google.com/detail/codex/hehggadaopoacecdllhhajmbjkdcmajg>"]),
    "Usage: `$calcreward <url-or-@author/permlink>`",
  );
  assert.equal(
    await commands.get("calcreward")?.execute(
      context(commands, "calcreward", { hive }, {
        fetchReference: async () => ({ content: "Worth checking: https://hive.blog/@alice/first-post." }) as Message,
      }),
      [],
    ),
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
  const nodesEmbed = embedJson<{
    title?: string;
    url?: string;
    description?: string;
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("nodes")?.execute(context(commands, "nodes", { hiveNodes }), []));
  assert.equal(nodesEmbed.title, "Hive Public Nodes");
  assert.equal(nodesEmbed.url, "https://developers.test/hive_full_nodes.html");
  assert.equal(nodesEmbed.description, [
    "1. https://api.hive.blog @blocktrades",
    "2. https://api.deathwing.me @deathwing",
  ].join("\n"));
  assert.equal(nodesEmbed.footer?.text, "Hive Developer Portal");
  assert.deepEqual(nodesEmbed.fields, [
    { name: "Nodes", value: "2", inline: true },
  ]);
  const tickerEmbed = embedJson<{
    title?: string;
    url?: string;
    thumbnail?: { url: string };
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("ticker")?.execute(context(commands, "ticker", { hive, market }), []));
  assert.equal(tickerEmbed.title, "Hive Market Ticker");
  assert.equal(tickerEmbed.url, "https://www.coingecko.com/en/coins/hive");
  assert.equal(tickerEmbed.thumbnail?.url, "https://assets.coingecko.com/coins/images/10840/standard/logo_transparent_4x.png");
  assert.equal(tickerEmbed.footer?.text, "CoinGecko + Hive feed");
  assert.deepEqual(tickerEmbed.fields, [
    { name: "HIVE/USD", value: "$0.0604", inline: true },
    { name: "Feed", value: "0.0630 HBD / HIVE", inline: true },
    { name: "24h", value: "+2.35%", inline: true },
    { name: "Volume", value: "$1,250,000", inline: true },
    { name: "Market Cap", value: "$30,000,000", inline: true },
  ]);
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
  const fearEmbed = embedJson<{
    title?: string;
    url?: string;
    description?: string;
    image?: { url: string };
    footer?: { text: string };
  }>(await commands.get("fear")?.execute(context(commands, "fear", { market }), ["1"]));
  assert.equal(fearEmbed.title, "Crypto Fear & Greed Index");
  assert.equal(fearEmbed.url, "https://alternative.me/crypto/fear-and-greed-index/");
  assert.equal(
    fearEmbed.description,
    [
      "```",
      "Yesterday   Today       Previous Entry  Next Update",
      "65 - Greed  72 - Greed  58 - Neutral    in 3 hours",
      "```",
    ].join("\n"),
  );
  assert.match(fearEmbed.image?.url ?? "", /^https:\/\/alternative\.me\/images\/fng\/crypto-fear-and-greed-index-\d{4}-\d{1,2}-\d{1,2}\.png$/);
  assert.equal(fearEmbed.footer?.text, "Alternative.me");
  assert.equal(
    await commands.get("greed")?.execute(context(commands, "greed", { market }), ["wat"]),
    "Usage: `$fear [days-ago]`",
  );
  const tokenDirectory = await commands.get("token")?.execute(context(commands, "token"), []);
  assert.equal(typeof tokenDirectory, "object");
  const tokenDirectoryEmbed = (tokenDirectory as { embeds: [{ toJSON(): { title?: string; description?: string; fields?: Array<{ name: string; value: string }>; footer?: { text: string } } }] }).embeds[0].toJSON();
  assert.equal(tokenDirectoryEmbed.title, "Token Lookup");
  assert.equal(tokenDirectoryEmbed.description, "Hive Engine market: [BEE](https://hive-engine.com/trade/BEE)");
  assert.deepEqual(tokenDirectoryEmbed.fields, [
    { name: "Native", value: "`HIVE` `HBD`", inline: false },
    { name: "Wrapped", value: "`SWAP.HIVE` `SWAP.HBD` `SWAP.BTC` `SWAP.LTC`", inline: false },
    { name: "Communities", value: "`LEO` `NEOXAG` `CENT` `POB`", inline: false },
    { name: "Games", value: "`SPS` `DEC` `GLX` `SIM`", inline: false },
    { name: "Hive Engine", value: "`BEE` `PIZZA` `WORKERBEE`", inline: false },
  ]);
  assert.equal(tokenDirectoryEmbed.footer?.text, "Use $token <symbol>");
  const tokenResponse = await commands.get("token")?.execute(context(commands, "token", { hive, hiveEngine, market, scot }), ["leo"]);
  assert.equal(typeof tokenResponse, "object");
  const tokenEmbed = (tokenResponse as { embeds: [{ toJSON(): { title?: string; url?: string; description?: string; thumbnail?: { url: string }; footer?: { text: string; icon_url?: string }; fields?: Array<{ name: string; value: string; inline?: boolean }> } }] }).embeds[0].toJSON();
  assert.equal(tokenEmbed.title, "`LEO` issued by `@leofinance`");
  assert.equal(tokenEmbed.url, "https://hive-engine.com/?p=history&t=LEO&utm_source=banjo");
  assert.equal(
    tokenEmbed.description,
    [
      "A social token for finance-focused Hive communities.",
      "See: [LEO](https://leo.io)",
      "Trade [LEO](https://hive-engine.com/trade/LEO)",
      "Also see: [LeoFinance](https://hive.blog/trending/hive-167922)",
    ].join("\n"),
  );
  assert.equal(tokenEmbed.thumbnail?.url, "https://images.hive.blog/leo.png");
  assert.equal(tokenEmbed.footer?.text, "Hive Engine");
  assert.deepEqual(tokenEmbed.fields, [
    { name: "Circulating Supply", value: "`1,234,568 LEO`", inline: true },
    { name: "Last Price", value: "`0.250 SWAP.HIVE / $0.015090`", inline: true },
    { name: "Lowest Ask", value: "`0.260 SWAP.HIVE`", inline: true },
    { name: "Highest Bid", value: "`0.240 SWAP.HIVE`", inline: true },
    { name: "Volume", value: "`123.456 SWAP.HIVE / $7.451804`", inline: true },
    { name: "Change", value: "`-1.25%`", inline: true },
  ]);
  const nativeTokenResponse = await commands.get("token")?.execute(context(commands, "token", { hive, hiveEngine, market }), ["hive"]);
  assert.equal(typeof nativeTokenResponse, "object");
  const nativeTokenEmbed = (nativeTokenResponse as { embeds: [{ toJSON(): { title?: string; description?: string; thumbnail?: { url: string }; footer?: { text: string; icon_url?: string }; fields?: Array<{ name: string; value: string; inline?: boolean }> } }] }).embeds[0].toJSON();
  assert.equal(nativeTokenEmbed.title, "`HIVE` native Hive asset");
  assert.equal(
    nativeTokenEmbed.description,
    [
      "Native governance and resource token for the Hive blockchain.",
      "Trade [HIVE/HBD](https://wallet.hive.blog/market)",
    ].join("\n"),
  );
  assert.equal(nativeTokenEmbed.thumbnail?.url, "https://assets.coingecko.com/coins/images/10840/standard/logo_transparent_4x.png");
  assert.equal(nativeTokenEmbed.footer?.text, "Hive");
  assert.equal(nativeTokenEmbed.footer?.icon_url, "https://assets.coingecko.com/coins/images/10840/standard/logo_transparent_4x.png");
  assert.deepEqual(nativeTokenEmbed.fields, [
    { name: "Current Supply", value: "`500,000.000 HIVE`", inline: true },
    { name: "Last Price", value: "`0.062 HBD / HIVE`", inline: true },
    { name: "Lowest Ask", value: "`0.064 HBD / HIVE`", inline: true },
    { name: "Highest Bid", value: "`0.061 HBD / HIVE`", inline: true },
    { name: "Volume", value: "`1,000.000 HIVE / 62.000 HBD`", inline: true },
    { name: "Change", value: "`+2.35%`", inline: true },
    { name: "Virtual Supply", value: "`600,000.000 HIVE`", inline: true },
    { name: "Feed", value: "`0.0630 HBD / HIVE`", inline: true },
  ]);
  const nativeHbdResponse = await commands.get("token")?.execute(context(commands, "token", { hive, hiveEngine, market }), ["hbd"]);
  assert.equal(typeof nativeHbdResponse, "object");
  const nativeHbdEmbed = (nativeHbdResponse as { embeds: [{ toJSON(): { title?: string; description?: string; fields?: Array<{ name: string; value: string; inline?: boolean }> } }] }).embeds[0].toJSON();
  assert.equal(nativeHbdEmbed.title, "`HBD` native Hive asset");
  assert.equal(
    nativeHbdEmbed.description,
    [
      "Hive-backed stable asset used for savings, payments, and the internal market.",
      "Trade [HIVE/HBD](https://wallet.hive.blog/market)",
    ].join("\n"),
  );
  assert.deepEqual(nativeHbdEmbed.fields, [
    { name: "Current Supply", value: "`25,000.000 HBD`", inline: true },
    { name: "Last Price", value: "`16.129 HIVE / HBD`", inline: true },
    { name: "Lowest Ask", value: "`15.625 HIVE / HBD`", inline: true },
    { name: "Highest Bid", value: "`16.393 HIVE / HBD`", inline: true },
    { name: "Volume", value: "`1,000.000 HIVE / 62.000 HBD`", inline: true },
    { name: "Change", value: "`+2.35%`", inline: true },
    { name: "Interest Rate", value: "`12.00%`", inline: true },
    { name: "Feed", value: "`0.0630 HBD / HIVE`", inline: true },
  ]);
  assert.equal(
    await commands.get("token")?.execute(context(commands, "token", { hiveEngine, market }), ["btc"]),
    "Did you mean: SWAP.BTC",
  );
  assert.equal(
    await commands.get("token")?.execute(context(commands, "token", { hiveEngine, market }), ["wat"]),
    "Unknown token: WAT. Try `$token` for examples or `SWAP.WAT` if it is a wrapped asset.",
  );
  const mixedTokenResponse = await commands.get("token")?.execute(context(commands, "token", { hive, hiveEngine, market }), ["hive", "wat", "btc"]);
  assert.equal(typeof mixedTokenResponse, "object");
  assert.equal((mixedTokenResponse as { content?: string }).content, [
    "Unknown token: WAT. Try `$token` for examples or `SWAP.WAT` if it is a wrapped asset.",
    "Did you mean: SWAP.BTC",
  ].join("\n"));
  assert.equal((mixedTokenResponse as { embeds: unknown[] }).embeds.length, 1);
  const richlistEmbed = embedJson<{
    title?: string;
    url?: string;
    description?: string;
    thumbnail?: { url: string };
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("richlist")?.execute(context(commands, "richlist", { hiveEngine }), ["leo", "3"]));
  assert.equal(richlistEmbed.title, "Top 2 by Total Balance: LEO");
  assert.equal(richlistEmbed.url, "https://he.dtools.dev/richlist/LEO");
  assert.equal(richlistEmbed.thumbnail?.url, "https://images.hive.blog/leo.png");
  assert.equal(richlistEmbed.description, [
    "1. [large](https://he.dtools.dev/@large?symbol=LEO) - `175 LEO`",
    "2. [medium](https://he.dtools.dev/@medium?symbol=LEO) - `35 LEO`",
  ].join("\n"));
  assert.equal(richlistEmbed.footer?.text, "Hive Engine");
  assert.deepEqual(richlistEmbed.fields, [
    { name: "Null Balance", value: "1,000 LEO", inline: true },
  ]);
  assert.equal(
    await commands.get("richlist")?.execute(context(commands, "richlist", { hiveEngine }), ["hive"]),
    "Native HIVE richlist lookup has not been ported yet.",
  );
  assert.equal(
    await commands.get("richlist")?.execute(context(commands, "richlist", { hiveEngine }), ["wat"]),
    "Unknown token: WAT",
  );
  const stakedEmbed = embedJson<{
    title?: string;
    description?: string;
    thumbnail?: { url: string };
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("staked")?.execute(context(commands, "staked", { hiveEngine }), ["leo", "2"]));
  assert.equal(stakedEmbed.title, "Top 2 by Stake: LEO");
  assert.equal(stakedEmbed.thumbnail?.url, "https://images.hive.blog/leo.png");
  assert.equal(stakedEmbed.description, [
    "1. [large](https://he.dtools.dev/@large?symbol=LEO) - `50 LEO POWER` (69.44%)",
    "2. [medium](https://he.dtools.dev/@medium?symbol=LEO) - `20 LEO POWER` (27.78%)",
  ].join("\n"));
  assert.equal(stakedEmbed.footer?.text, "Hive Engine");
  assert.deepEqual(stakedEmbed.fields, [
    { name: "Total Stake", value: "72 LEO POWER", inline: true },
    { name: "Results", value: "2", inline: true },
  ]);
  assert.equal(
    await commands.get("staked")?.execute(context(commands, "staked", { hiveEngine }), ["wat"]),
    "Unknown token: WAT",
  );
  const nftEmbed = embedJson<{
    title?: string;
    url?: string;
    description?: string;
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("nft")?.execute(context(commands, "nft", { hiveEngine }), ["punk"]));
  assert.equal(nftEmbed.title, "PUNK issued by @nftissuer");
  assert.equal(nftEmbed.url, "https://he.dtools.dev/nfts/PUNK");
  assert.equal(nftEmbed.description, "Collectible Hive punks.");
  assert.equal(nftEmbed.footer?.text, "Hive Engine NFT");
  assert.deepEqual(nftEmbed.fields, [
    { name: "Name", value: "Hive Punk", inline: true },
    { name: "Circulating Supply", value: "42 PUNK", inline: true },
    { name: "Metadata", value: "[Hive Punk](https://punks.example)", inline: false },
  ]);
  assert.equal(
    await commands.get("nft")?.execute(context(commands, "nft", { hiveEngine }), ["missing"]),
    "Unknown nft: MISSING",
  );
  const nftsrEmbed = embedJson<{
    title?: string;
    url?: string;
    description?: string;
    image?: { url: string };
    thumbnail?: { url: string };
    footer?: { text: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("nftsr")?.execute(context(commands, "nftsr", { hiveEngine }), ["inertia", "1"]));
  assert.equal(nftsrEmbed.title, "Obey or Get Deleted #2");
  assert.equal(nftsrEmbed.url, "https://nftshowroom.com/gallery/zyberzerk_political-collage_obey-or-get-deleted?collection=true");
  assert.equal(nftsrEmbed.description, "A sharp collage from NFT Showroom.");
  assert.equal(nftsrEmbed.image?.url, "https://images.hive.blog/art.jpg");
  assert.equal(nftsrEmbed.thumbnail?.url, "https://images.hive.blog/u/zyberzerk/avatar");
  assert.equal(nftsrEmbed.footer?.text, "NFT Showroom");
  assert.deepEqual(nftsrEmbed.fields, [
    { name: "Artist", value: "@zyberzerk", inline: true },
    { name: "Collection", value: "Political Collage", inline: true },
    { name: "Note", value: ":))", inline: true },
    { name: "Created", value: nftsrEmbed.fields?.[3]?.value ?? "", inline: false },
  ]);
  assert.match(nftsrEmbed.fields?.[3]?.value ?? "", /^.+ ago \(2020-06-22 00:00 UTC\)$/);
  const nftsrResponse = await commands.get("nftsr")?.execute(context(commands, "nftsr", { hiveEngine }), ["inertia", "1"]);
  const nftsrComponents = (nftsrResponse as {
    components: Array<{ toJSON(): { components: Array<{ type?: number; style?: number; custom_id?: string; label?: string; disabled?: boolean }> } }>;
  }).components[0]?.toJSON().components;
  assert.deepEqual(nftsrComponents?.map((component) => ({
    customId: component.custom_id,
    label: component.label,
    disabled: component.disabled ?? false,
  })), [
    { customId: "nftsr:previous:inertia:0", label: "Previous", disabled: false },
    { customId: "nftsr:next:inertia:2", label: "Next", disabled: false },
  ]);
  assert.deepEqual(nftsrComponents?.map((component) => ({
    type: component.type,
    style: component.style,
  })), [
    { type: 2, style: 2 },
    { type: 2, style: 2 },
  ]);
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
  const tt2xEmbed = embedJson<{
    title?: string;
    url?: string;
    description?: string;
    thumbnail?: { url: string };
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("tt2x")?.execute(context(commands, "tt2x", { hiveEngine, market, scot }), ["leo", "2"]));
  assert.equal(tt2xEmbed.title, "Top 2 Trending to Exchange: LEO");
  assert.equal(tt2xEmbed.url, "https://hive-engine.com/?p=history&t=LEO&utm_source=banjo");
  assert.equal(tt2xEmbed.description, "[Trade LEO](https://hive-engine.com/?p=market&t=LEO&utm_source=banjo)");
  assert.equal(tt2xEmbed.thumbnail?.url, "https://images.hive.blog/leo.png");
  assert.equal(tt2xEmbed.footer?.text, "SCOT + Hive Engine");
  assert.deepEqual(tt2xEmbed.fields, [
    { name: "Last Price", value: "0.250 HIVE / $0.015090", inline: true },
    { name: "Average Pending Payout", value: "10.000 LEO / 2.500 HIVE / $0.150900 (2 unique authors)", inline: false },
    { name: "Sum of Top 2 Pending Payout", value: "20.000 LEO / 5.000 HIVE / $0.301800", inline: false },
    { name: "Actual Yield", value: "20.000 LEO would sell for 4.400 HIVE / $0.265584", inline: false },
    { name: "Price at Final Yield", value: "0.200 HIVE / $0.012072", inline: true },
    { name: "Change at Final Yield", value: "-20.00%", inline: true },
  ]);
  const feedPriceEmbed = embedJson<{
    title?: string;
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("feed")?.execute(context(commands, "feed", { hive }), []));
  assert.equal(feedPriceEmbed.title, "Hive Feed Price");
  assert.equal(feedPriceEmbed.footer?.text, "Hive feed");
  assert.deepEqual(feedPriceEmbed.fields, [
    { name: "Median", value: "0.063 HBD / 1.000 HIVE", inline: true },
    { name: "Market Median", value: "0.064 HBD / 1.000 HIVE", inline: true },
    { name: "Low", value: "0.059 HBD / 1.000 HIVE", inline: true },
    { name: "High", value: "0.066 HBD / 1.000 HIVE", inline: true },
  ]);
  const feedPolicyEmbed = embedJson<{
    title?: string;
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("feed")?.execute(context(commands, "feed", { hive }), ["apr"]));
  assert.equal(feedPolicyEmbed.title, "Hive HBD Policy");
  assert.equal(feedPolicyEmbed.footer?.text, "Hive feed");
  assert.deepEqual(feedPolicyEmbed.fields, [
    { name: "HBD Interest Rate", value: "12.00%", inline: true },
    { name: "HBD Print Rate", value: "0.00%", inline: true },
    { name: "Start Reducing", value: "20.00%", inline: true },
    { name: "Stop Printing", value: "20.00%", inline: true },
  ]);
  assert.equal(
    await commands.get("feed")?.execute(context(commands, "feed", { hive }), ["price", "steem"]),
    "Chain `steem` is not configured in this Banjo build.",
  );
  assert.equal(
    await commands.get("feed")?.execute(context(commands, "feed", { hive }), ["wat"]),
    "Unknown feed type: wat",
  );
  const hardforkEmbed = embedJson<{
    title?: string;
    description?: string;
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("hardfork")?.execute(context(commands, "hardfork", { hive }), []));
  assert.equal(hardforkEmbed.title, "Hive Hardfork Status");
  assert.equal(hardforkEmbed.description, [
    "Version Votes by Top 100 Witnesses:",
    "```markdown",
    "| Version | Witnesses | MVESTS |",
    "|---------|-----------|--------|",
    "|  1.28.0 |         2 |  3,000 |",
    "|  1.27.9 |         1 |    500 |",
    "```",
  ].join("\n"));
  assert.equal(hardforkEmbed.footer?.text, "Hive Chain");
  assert.equal(hardforkEmbed.fields?.[0]?.name, "Current");
  assert.equal(hardforkEmbed.fields?.[0]?.value, "1.28.0");
  assert.equal(hardforkEmbed.fields?.[1]?.name, "Witness Majority");
  assert.equal(hardforkEmbed.fields?.[1]?.value, "1.28.3");
  assert.equal(hardforkEmbed.fields?.[2]?.name, "Last");
  assert.match(hardforkEmbed.fields?.[2]?.value ?? "", /^1\.28\.0 \(.+ ago\)$/);
  assert.equal(
    await commands.get("hardfork")?.execute(context(commands, "hardfork", { hive }), ["steem"]),
    "Chain `steem` is not configured in this Banjo build.",
  );
  const supplyEmbed = embedJson<{
    title?: string;
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("supply")?.execute(context(commands, "supply", { hive }), []));
  assert.equal(supplyEmbed.title, "Hive Supply");
  assert.equal(supplyEmbed.footer?.text, "Hive dynamic global properties");
  assert.deepEqual(supplyEmbed.fields, [
    { name: "Current HIVE", value: "500,000.000 HIVE", inline: true },
    { name: "Virtual HIVE", value: "600,000.000 HIVE", inline: true },
    { name: "Current HBD", value: "25,000.000 HBD", inline: true },
  ]);
  assert.deepEqual(
    embedJson<{ fields?: Array<{ name: string; value: string; inline?: boolean }> }>(
      await commands.get("supply")?.execute(context(commands, "supply", { hive }), ["hive"]),
    ).fields,
    supplyEmbed.fields,
  );
  assert.equal(
    await commands.get("supply")?.execute(context(commands, "supply", { hive }), ["*"]),
    "Chain `*` is not configured in this Banjo build.",
  );
  const witnessEmbed = embedJson<{
    title?: string;
    url?: string;
    thumbnail?: { url: string };
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("witness")?.execute(context(commands, "witness", { hive }), ["alice"]));
  assert.equal(witnessEmbed.title, "alice is a Hive witness");
  assert.equal(witnessEmbed.url, "https://hivehub.dev/witnesses/@alice");
  assert.equal(witnessEmbed.thumbnail?.url, "https://images.hive.blog/u/alice/avatar");
  assert.equal(witnessEmbed.footer?.text, "Hive Witness");
  assert.deepEqual(witnessEmbed.fields, [
    { name: "Version", value: "1.27.0", inline: true },
    { name: "Missed Blocks", value: "2", inline: true },
    { name: "Signing Key", value: "`STM1111111111111111111111111111111114T1Anm`", inline: false },
  ]);
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
  const followsEmbed = embedJson<{
    title?: string;
    url?: string;
    thumbnail?: { url: string };
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("follows")?.execute(context(commands, "follows", { hive }), ["alice"]));
  assert.equal(followsEmbed.title, "alice");
  assert.equal(followsEmbed.url, "https://hivehub.dev/stats/account?username=alice");
  assert.equal(followsEmbed.thumbnail?.url, "https://images.hive.blog/u/alice/avatar");
  assert.equal(followsEmbed.footer?.text, "Hivemind Social");
  assert.deepEqual(followsEmbed.fields, [
    { name: "Followers", value: "1,234", inline: true },
    { name: "Following", value: "56", inline: true },
  ]);
  const ageEmbed = embedJson<{
    title?: string;
    url?: string;
    thumbnail?: { url: string };
    footer?: { text: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>(await commands.get("age")?.execute(context(commands, "age", { hive }), ["https://steemit.com/introduceyourself/@alice/first-post"]));
  assert.equal(ageEmbed.title, "First Post");
  assert.equal(ageEmbed.url, "https://hive.blog/@alice/first-post");
  assert.equal(ageEmbed.thumbnail?.url, "https://images.hive.blog/u/alice/avatar");
  assert.equal(ageEmbed.footer?.text, "Hive Chain");
  assert.deepEqual(ageEmbed.fields?.slice(0, 2), [
    { name: "Author", value: "[@alice](https://hivehub.dev/stats/account?username=alice)", inline: true },
    { name: "Created", value: "2016-07-01 00:00 UTC", inline: true },
  ]);
  assert.equal(ageEmbed.fields?.[2]?.name, "Age");
  assert.match(ageEmbed.fields?.[2]?.value ?? "", /^.+ ago$/);
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
    getMarketTicker: async () => ({}),
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
