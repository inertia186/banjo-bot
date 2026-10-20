import assert from "node:assert/strict";
import test from "node:test";
import { ChannelType, type Message } from "discord.js";
import type { Command } from "../src/commands/types.js";
import { testConfig } from "./helpers/config.js";
import { LlmConversationLeases } from "../src/llm/conversation-lease.js";
import { TypingActivityTracker } from "../src/llm/turn-taking.js";
import type { Logger } from "../src/logger.js";
import { handleMessageCreate, type MessageHandlerDependencies } from "../src/message-handler.js";
import type { PassiveSnarkResponse } from "../src/passive-snarks.js";

const config = testConfig();

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
