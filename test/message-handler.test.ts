import assert from "node:assert/strict";
import test from "node:test";
import { ChannelType, type Message } from "discord.js";
import type { Command } from "../src/commands/types.js";
import type { AppConfig } from "../src/config.js";
import { LlmConversationLeases } from "../src/llm/conversation-lease.js";
import { TypingActivityTracker } from "../src/llm/turn-taking.js";
import type { Logger } from "../src/logger.js";
import { handleMessageCreate, type MessageHandlerDependencies } from "../src/message-handler.js";
import type { PassiveSnarkResponse } from "../src/passive-snarks.js";

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

type LogEntry = {
  message: string;
  meta?: Record<string, unknown>;
};

test("message handler catches rejected passive replies", async () => {
  const errors: LogEntry[] = [];
  const message = fakeMessage("Ping!", async () => {
    throw new Error("reply rejected");
  });

  await assert.doesNotReject(handleMessageCreate(message, dependencies({
    errors,
    passiveResponse: { kind: "reply", content: "Pong!" },
  })));

  assert.deepEqual(errors.map((entry) => entry.message), ["Message handler failed."]);
  assert.equal(errors[0]?.meta?.error, "reply rejected");
});

test("message handler catches rejected command failure replies after logging the command error", async () => {
  const errors: LogEntry[] = [];
  const command: Command = {
    name: "boom",
    description: "Throw.",
    category: "core",
    execute: () => {
      throw new Error("command exploded");
    },
  };
  const message = fakeMessage("$boom", async () => {
    throw new Error("fallback reply rejected");
  });

  await assert.doesNotReject(handleMessageCreate(message, dependencies({
    errors,
    commands: new Map([["boom", command]]),
  })));

  assert.deepEqual(errors.map((entry) => entry.message), [
    "Command failed.",
    "Message handler failed.",
  ]);
  assert.equal(errors[0]?.meta?.command, "boom");
  assert.equal(errors[0]?.meta?.error, "command exploded");
  assert.equal(errors[1]?.meta?.error, "fallback reply rejected");
});

function dependencies(options: {
  errors: LogEntry[];
  commands?: ReadonlyMap<string, Command>;
  passiveResponse?: PassiveSnarkResponse | null;
}): MessageHandlerDependencies {
  const logger: Logger = {
    info: () => undefined,
    warn: () => undefined,
    error: (message, meta) => options.errors.push({
      message,
      ...(meta ? { meta } : {}),
    }),
  };

  return {
    config,
    logger,
    commands: options.commands ?? new Map(),
    llmChat: {
      enabled: false,
      replyTo: async () => null,
    },
    passiveSnarks: {
      replyFor: () => options.passiveResponse ?? null,
    },
    conversationLeases: new LlmConversationLeases(),
    typingActivity: new TypingActivityTracker(),
    startTyping: () => () => undefined,
  };
}

function fakeMessage(content: string, reply: Message["reply"]): Message {
  return {
    author: {
      bot: false,
    },
    channel: {
      type: ChannelType.DM,
    },
    content,
    reply,
  } as unknown as Message;
}
