import assert from "node:assert/strict";
import test from "node:test";
import { ChannelType, type Message } from "discord.js";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import type { Command } from "../src/commands/types.js";
import type { AppConfig } from "../src/config.js";
import type { HiveApi } from "../src/hive/api.js";
import type { Logger } from "../src/logger.js";
import { buildCommandCatalog, buildConversationKey, buildInstructions, buildLlmInput, isAgenticTaskRequest, LlmChat, trimDiscordReply } from "../src/llm/chat.js";
import { ChannelAmbientContextProvider, CompositeAmbientContextProvider } from "../src/llm/channel-context.js";
import { LlmConversationLeases } from "../src/llm/conversation-lease.js";
import { HiveAmbientContextProvider, wantsHiveAmbientContext } from "../src/llm/hive-context.js";
import { llmPrompt } from "../src/llm/prompt.js";

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
    enabled: true,
    provider: "openai",
    model: "test-model",
    maxHistory: 2,
    maxOutputTokens: 64,
    openAiApiKey: "test-key",
  },
};

function dmMessage(content: string, authorId = "user-1"): Message {
  return message({
    content,
    authorId,
    channelType: ChannelType.DM,
    guildId: null,
  });
}

function guildMessage(content: string, authorId = "user-1"): Message {
  return message({
    content,
    authorId,
    channelType: ChannelType.GuildText,
    guildId: "guild-1",
  });
}

function message({
  content,
  authorId,
  channelType,
  guildId,
  bot = false,
}: {
  content: string;
  authorId: string;
  channelType: ChannelType;
  guildId: string | null;
  bot?: boolean;
}): Message {
  const botUser = { id: "banjo-id" };
  const author = {
    id: authorId,
    bot,
    displayName: "Alice",
    username: "alice",
  };

  return {
    content,
    author,
    client: { user: botUser },
    channel: { id: "channel-1", type: channelType },
    guild: guildId ? { id: guildId } : null,
    mentions: {
      has: (user: { id: string }) => content.includes(`<@${user.id}>`) || content.includes(`<@!${user.id}>`),
    },
  } as unknown as Message;
}

function channelSearchMessage(id: string, content: string, history: Message[], historicHistory: Message[] = []): Message {
  let calls = 0;
  return {
    ...guildMessage(content),
    id,
    createdTimestamp: Date.parse("2026-05-18T12:00:00Z"),
    channel: {
      id: "channel-1",
      type: ChannelType.GuildText,
      messages: {
        fetch: async (options: { around?: string }) => {
          if (options.around) return new Map(historicHistory.map((message) => [message.id, message]));

          calls += 1;
          return calls === 1
            ? new Map(history.map((message) => [message.id, message]))
            : new Map<string, Message>();
        },
      },
    },
  } as unknown as Message;
}

function dmSearchMessage(id: string, content: string, history: Message[]): Message {
  return {
    ...dmMessage(content),
    id,
    createdTimestamp: Date.parse("2026-05-18T12:00:00Z"),
    channel: {
      id: "dm-channel-1",
      type: ChannelType.DM,
      messages: {
        fetch: async (options: { around?: string }) => options.around
          ? new Map<string, Message>()
          : new Map(history.map((message) => [message.id, message])),
      },
    },
  } as unknown as Message;
}

function channelHistoryMessage(id: string, authorName: string, content: string, createdTimestamp: number, bot = false): Message {
  return {
    id,
    content,
    createdTimestamp,
    createdAt: new Date(createdTimestamp),
    author: {
      id: `${authorName}-id`,
      bot,
      displayName: authorName,
      username: authorName,
    },
    member: {
      displayName: authorName,
    },
  } as unknown as Message;
}

test("llmPrompt returns trimmed DM content", () => {
  assert.equal(llmPrompt(dmMessage("  hello Banjo  "), "$"), "hello Banjo");
});

test("llmPrompt removes bot mentions in guild messages", () => {
  assert.equal(llmPrompt(guildMessage("hey <@banjo-id> what's up?"), "$"), "hey  what's up?");
  assert.equal(llmPrompt(guildMessage("<@!banjo-id> hello"), "$"), "hello");
});

test("llmPrompt ignores empty mention-only and non-mentioned guild messages", () => {
  assert.equal(llmPrompt(guildMessage("<@banjo-id>"), "$"), null);
  assert.equal(llmPrompt(guildMessage("hello Banjo"), "$"), null);
});

test("llmPrompt allows conservative unmentioned guild follow-ups during an active lease", () => {
  let now = 1_000;
  const leases = new LlmConversationLeases(() => now, 1_000, 2);

  assert.equal(llmPrompt(guildMessage("<@banjo-id> why don't they market Hive?"), "$", leases), "why don't they market Hive?");
  assert.equal(llmPrompt(guildMessage("how would I start?"), "$", leases), "how would I start?");
  assert.equal(llmPrompt(guildMessage("lol"), "$", leases), null);
  assert.equal(llmPrompt(guildMessage("what about funding?"), "$", leases), "what about funding?");
  assert.equal(llmPrompt(guildMessage("who would help?"), "$", leases), null);

  leases.noteExplicitInteraction(guildMessage("<@banjo-id> restart"));
  now += 1_001;
  assert.equal(llmPrompt(guildMessage("how now?"), "$", leases), null);
});

test("llmPrompt keeps DMs conversational without requiring a guild lease", () => {
  const leases = new LlmConversationLeases();

  assert.equal(llmPrompt(dmMessage("how would I start?"), "$", leases), "how would I start?");
});

test("llmPrompt ignores bot authors, self messages, and bare DM commands", () => {
  assert.equal(llmPrompt(message({ content: "hello", authorId: "bot-1", channelType: ChannelType.DM, guildId: null, bot: true }), "$"), null);
  assert.equal(llmPrompt(dmMessage("hello", "banjo-id"), "$"), null);
  assert.equal(llmPrompt(dmMessage("$help"), "$"), null);
  assert.equal(llmPrompt(dmMessage("$help me talk this through"), "$"), "$help me talk this through");
});

test("buildConversationKey isolates users in the same channel", () => {
  assert.equal(buildConversationKey(guildMessage("hi", "user-1")), "guild-1:channel-1:user-1");
  assert.equal(buildConversationKey(guildMessage("hi", "user-2")), "guild-1:channel-1:user-2");
});

test("buildLlmInput includes prior turns and Discord surface context", () => {
  const input = buildLlmInput({
    message: dmMessage("hello"),
    prompt: "hello",
    history: [
      { role: "user", content: "earlier" },
      { role: "assistant", content: "Earlier reply" },
    ],
    userName: "Alice",
  });

  assert.deepEqual(input, [
    { role: "user", content: "earlier" },
    { role: "assistant", content: "Earlier reply" },
    { role: "user", content: "[Discord dm conversation]\nUser display name: Alice\nUser message: hello\nReply directly to this user as Banjo." },
  ]);
});

test("buildLlmInput avoids speaker-label prompts that encourage third-person replies", () => {
  const input = buildLlmInput({
    message: dmMessage("What's new on Hive?", "inertia"),
    prompt: "What's new on Hive?",
    history: [],
    userName: "inertia",
  });

  assert.equal(input[0]?.role, "user");
  assert.match(String(input[0]?.content), /User display name: inertia/);
  assert.match(String(input[0]?.content), /User message: What's new on Hive\?/);
  assert.doesNotMatch(String(input[0]?.content), /inertia: What's new/);
});

test("buildLlmInput includes ambient Hive context as developer context", () => {
  const input = buildLlmInput({
    message: dmMessage("What's new on Hive today?"),
    prompt: "What's new on Hive today?",
    history: [],
    userName: "Alice",
    ambientContext: "Latest posts:\n1. Real post (@alice/real-post)",
  });

  assert.equal(input[0]?.role, "developer");
  assert.match(String(input[0]?.content), /Real post/);
  assert.equal(input[1]?.role, "user");
});

test("buildInstructions incorporates the Ruby gpt-prompt persona", () => {
  const instructions = buildInstructions();

  assert.match(instructions, /Discord bot named Banjo/);
  assert.match(instructions, /expert on the Hive blockchain/);
  assert.match(instructions, /started on Steem/);
  assert.match(instructions, /Do not make Canada jokes in chat replies/);
  assert.match(instructions, /rare passive listener for messages containing the word "those"/);
  assert.match(instructions, /porcelain/);
  assert.match(instructions, /Reply directly to the user in second person/);
  assert.match(instructions, /In a DM, treat words like "here" or "this chat" as the private one-on-one conversation/);
  assert.match(instructions, /stakeholders also protect the shared reward pool/);
  assert.match(instructions, /avoid marketing certainty/);
  assert.match(instructions, /messy social experiment/);
  assert.match(instructions, /hard to explain to outsiders/);
  assert.match(instructions, /do not overuse phrases like "uphill marketing battle"/);
  assert.match(instructions, /active siege/);
  assert.match(instructions, /Do not overstate broad adoption/);
  assert.match(instructions, /collapse "they" into shared agency/);
  assert.match(instructions, /Be cautious with detailed protocol mechanics/);
  assert.match(instructions, /modest, caveated wording/);
  assert.match(instructions, /avoid pretending to be an authority on every edge case/);
  assert.match(instructions, /reward-allocation signal/);
  assert.match(instructions, /votes and downvotes affect rshares/);
  assert.match(instructions, /claims move already accrued reward balances/);
  assert.match(instructions, /claims settle rewards that were already assigned/);
  assert.match(instructions, /\$rewardpool shows pool\/feed context/);
  assert.match(instructions, /\$claims and \$rewards show realized or account-level reward activity/);
  assert.match(instructions, /Do not say that \$claims or \$rewards reveal pending reward allocation/);
  assert.match(instructions, /no single command that fully answers where pending rewards are going right now/);
  assert.match(instructions, /authors often experience flags personally/);
  assert.match(instructions, /cannot perform moderation, voting, wallet, follow, blockchain, or admin actions/);
  assert.match(instructions, /perform an agentic task, refuse with exactly: Make it yourself\./);
  assert.match(instructions, /summarize command output, refuse with exactly: Make it yourself\./);
  assert.match(instructions, /Never claim you ran a command/);
});

test("buildCommandCatalog lists real commands once with usage and aliases", () => {
  const helpCommand: Command = {
    name: "help",
    aliases: ["halp"],
    description: "List available commands.",
    usage: "help [command]",
    category: "core",
    execute: () => undefined,
  };
  const registry = new Map<string, Command>([
    ["help", helpCommand],
    ["halp", helpCommand],
  ]);

  assert.equal(
    buildCommandCatalog(registry, "$"),
    "$help [command]: List available commands. Aliases: $halp.",
  );
});

test("buildInstructions tells the model not to invent commands and includes the catalog", () => {
  const instructions = buildInstructions("$rep <account>: Look up a Hive account reputation score.");

  assert.match(instructions, /Never invent \$ commands/);
  assert.match(instructions, /\$rep <account>: Look up a Hive account reputation score/);
});

test("trimDiscordReply suppresses blank and refusal-only responses", () => {
  assert.equal(trimDiscordReply("   "), null);
  assert.equal(trimDiscordReply("I can't assist with that."), null);
});

test("trimDiscordReply caps replies for Discord", () => {
  const reply = trimDiscordReply("a".repeat(20), 10);
  assert.equal(reply, "aaaaaaa...");
});

test("isAgenticTaskRequest detects task requests without blocking questions", () => {
  assert.equal(isAgenticTaskRequest("What's new on Hive?"), false);
  assert.equal(isAgenticTaskRequest("What does `$top upvoted` do?"), false);
  assert.equal(isAgenticTaskRequest("Can you make me a report?"), true);
  assert.equal(isAgenticTaskRequest("please schedule a reminder"), true);
  assert.equal(isAgenticTaskRequest("reply to alice for me"), true);
  assert.equal(isAgenticTaskRequest("Please do a `$top upvoted` and summarize the post."), true);
  assert.equal(isAgenticTaskRequest("run $rep inertia"), true);
  assert.equal(isAgenticTaskRequest("$top upvoted and summarize the post"), true);
});

test("wantsHiveAmbientContext detects casual current Hive questions", () => {
  assert.equal(wantsHiveAmbientContext("What's new on Hive today?"), true);
  assert.equal(wantsHiveAmbientContext("What's the current Hive market doing?"), true);
  assert.equal(wantsHiveAmbientContext("What is Hive?"), false);
});

test("LlmChat replies like $make for agentic task requests without calling the provider", async () => {
  const requests: ResponseCreateParamsNonStreaming[] = [];
  let contextCalls = 0;
  const chat = new LlmChat(config, logger, {
    responses: {
      create: async (body: ResponseCreateParamsNonStreaming) => {
        requests.push(body);
        return { output_text: "I should not be called" };
      },
    },
  }, undefined, {
    contextFor: async () => {
      contextCalls += 1;
      return "context";
    },
  });

  assert.equal(await chat.replyTo(dmMessage("Can you make me a report?"), "Can you make me a report?"), "Make it yourself.");
  assert.equal(
    await chat.replyTo(
      dmMessage("Please do a `$top upvoted` and summarize the post."),
      "Please do a `$top upvoted` and summarize the post.",
    ),
    "Make it yourself.",
  );
  assert.equal(requests.length, 0);
  assert.equal(contextCalls, 0);
});

test("LlmChat includes ambient Hive context for casual current-chain questions", async () => {
  const requests: ResponseCreateParamsNonStreaming[] = [];
  const chat = new LlmChat(config, logger, {
    responses: {
      create: async (body: ResponseCreateParamsNonStreaming) => {
        requests.push(body);
        return { output_text: "Looks lively today." };
      },
    },
  }, undefined, {
    contextFor: async (prompt) => prompt.includes("Hive") ? "Latest posts:\n1. Real post (@alice/real-post)" : null,
  });

  assert.equal(await chat.replyTo(dmMessage("What's new on Hive today?"), "What's new on Hive today?"), "Looks lively today.");
  assert.equal(requests.length, 1);
  assert.match(JSON.stringify(requests[0]?.input), /Real post/);
});

test("HiveAmbientContextProvider formats live Hive context from injected APIs", async () => {
  const hive = {
    getDynamicGlobalProperties: async () => ({
      head_block_number: 123,
      time: "2026-05-18T12:00:00",
      total_vesting_fund_hive: "0.000 HIVE",
      total_vesting_shares: "0.000000 VESTS",
    }),
    getMarketTicker: async () => ({
      latest: "0.250000",
      percent_change: "1.23",
    }),
    getFeedHistory: async () => ({
      current_median_history: {
        base: "0.250 HBD",
        quote: "1.000 HIVE",
      },
    }),
    getRankedPosts: async (sort: "created" | "trending") => [
      {
        author: sort === "created" ? "alice" : "bob",
        permlink: `${sort}-post`,
        title: `${sort} post`,
        created: "2026-05-18T11:00:00",
        net_votes: 12,
        pending_payout_value: "1.000 HBD",
        category: "hive",
      },
    ],
  } as unknown as HiveApi;
  const provider = new HiveAmbientContextProvider(config, logger, hive);
  const context = await provider.contextFor("What's new on Hive today?");

  assert.match(context ?? "", /Head block: 123/);
  assert.match(context ?? "", /Market ticker latest: 0.250000 HBD\/HIVE/);
  assert.match(context ?? "", /created post \(@alice\/created-post/);
  assert.match(context ?? "", /trending post \(@bob\/trending-post/);
});

test("ChannelAmbientContextProvider searches prior current-channel messages for relevant excerpts", async () => {
  const current = channelSearchMessage("500", "why don't they market hive?", [
    channelHistoryMessage("100", "alice", "We tried a banner campaign and it fizzled.", 1000),
    channelHistoryMessage("200", "bob", "Hive marketing is hard because the story is fragmented.", 2000),
    channelHistoryMessage("300", "bot", "marketing bot noise", 3000, true),
    channelHistoryMessage("400", "carol", "Totally unrelated lunch thread.", 4000),
  ]);
  const provider = new ChannelAmbientContextProvider(logger);
  const context = await provider.contextFor("Why don't they market Hive?", current);

  assert.match(context ?? "", /Current Discord guild-channel context/);
  assert.match(context ?? "", /Hive marketing is hard/);
  assert.doesNotMatch(context ?? "", /marketing bot noise/);
  assert.doesNotMatch(context ?? "", /lunch thread/);
});

test("ChannelAmbientContextProvider includes relevant messages from a 10-year-old same-channel slice", async () => {
  const current = channelSearchMessage("500", "why don't they market hive?", [], [
    channelHistoryMessage("50", "dave", "In 2016 we already knew Hive-style marketing would be a coordination problem.", 500),
  ]);
  const provider = new ChannelAmbientContextProvider(logger);
  const context = await provider.contextFor("Why don't they market Hive?", current);

  assert.match(context ?? "", /same channel/);
  assert.match(context ?? "", /about 10 years ago/);
  assert.match(context ?? "", /Do not infer or claim access to other channels/);
  assert.match(context ?? "", /Steem\/Steemit references as historical ancestor-context for Hive/);
  assert.match(context ?? "", /2016 we already knew/);
});

test("ChannelAmbientContextProvider labels DM context as one-on-one, not group chat", async () => {
  const current = dmSearchMessage("500", "what is going on here?", [
    channelHistoryMessage("100", "alice", "we were talking about setup here", 1000),
  ]);
  const provider = new ChannelAmbientContextProvider(logger);
  const context = await provider.contextFor("What is going on here?", current);

  assert.match(context ?? "", /Current Discord DM context/);
  assert.match(context ?? "", /one-on-one conversation/);
  assert.doesNotMatch(context ?? "", /guild-channel context/);
});

test("CompositeAmbientContextProvider joins available context providers", async () => {
  const provider = new CompositeAmbientContextProvider([
    { contextFor: async () => "one" },
    { contextFor: async () => null },
    { contextFor: async () => "two" },
  ]);

  assert.equal(await provider.contextFor("hello"), "one\n\ntwo");
});

test("LlmChat uses Responses API, shapes long prompts, and trims history", async () => {
  const requests: ResponseCreateParamsNonStreaming[] = [];
  const client = {
    responses: {
      create: async (body: ResponseCreateParamsNonStreaming) => {
        requests.push(body);
        return { output_text: `reply ${requests.length}` };
      },
    },
  };
  const commands = new Map<string, Command>([
    ["rep", {
      name: "rep",
      description: "Look up a Hive account reputation score.",
      usage: "rep <account>",
      category: "hive",
      execute: () => undefined,
    }],
  ]);
  const chat = new LlmChat(config, logger, client, commands);

  await chat.replyTo(dmMessage("first"), "first");
  await chat.replyTo(dmMessage("second"), "second");
  await chat.replyTo(dmMessage("third"), "third");
  await chat.replyTo(dmMessage("x".repeat(200)), "x".repeat(200));

  assert.equal(requests[0]?.model, "test-model");
  assert.equal(requests[0]?.max_output_tokens, 64);
  assert.equal(requests[0]?.instructions, buildInstructions(buildCommandCatalog(commands, "$")));
  assert.match(requests[0]?.instructions ?? "", /\$rep <account>/);
  assert.equal(requests[3]?.input.length, 5);
  assert.match(JSON.stringify(requests[3]?.input), /longer Discord message/);
  assert.doesNotMatch(JSON.stringify(requests[3]?.input), /Alice: first/);
  assert.doesNotMatch(JSON.stringify(requests[3]?.input), /Alice: third/);
});

test("LlmChat logs provider failures and returns the friendly failure message", async () => {
  const errors: Array<Record<string, unknown> | undefined> = [];
  const failingLogger: Logger = {
    info: () => undefined,
    warn: () => undefined,
    error: (_message, meta) => errors.push(meta),
  };
  const chat = new LlmChat(config, failingLogger, {
    responses: {
      create: async () => {
        throw new Error("provider down");
      },
    },
  });

  assert.equal(await chat.replyTo(dmMessage("hello"), "hello"), "I tried to think about that, but the LLM call failed.");
  assert.deepEqual(errors, [{ error: "provider down" }]);
});
