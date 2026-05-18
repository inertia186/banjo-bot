import assert from "node:assert/strict";
import test from "node:test";
import { ChannelType, type Message, type Typing } from "discord.js";
import { hasInterveningHumanActivity, hasInterveningHumanMessage, TypingActivityTracker } from "../src/llm/turn-taking.js";

test("hasInterveningHumanMessage ignores DMs", async () => {
  assert.equal(await hasInterveningHumanMessage(message(ChannelType.DM, [])), false);
});

test("hasInterveningHumanMessage ignores same-user and bot messages", async () => {
  assert.equal(await hasInterveningHumanMessage(message(ChannelType.GuildText, [
    candidate("original-user", false),
    candidate("helper-bot", true),
    candidate("banjo-id", false),
  ])), false);
});

test("hasInterveningHumanMessage detects another human in a guild channel", async () => {
  assert.equal(await hasInterveningHumanMessage(message(ChannelType.GuildText, [
    candidate("other-user", false),
  ])), true);
});

test("TypingActivityTracker treats active guild typing as intervening human activity", async () => {
  let now = 1_000;
  const tracker = new TypingActivityTracker(() => now, 10_000);
  const original = message(ChannelType.GuildText, []);
  original.createdTimestamp = 900;

  tracker.noteTyping(typing("other-user", ChannelType.GuildText));

  assert.equal(await hasInterveningHumanActivity(original, tracker), true);
});

test("TypingActivityTracker ignores DMs, bots, and expired typing", async () => {
  let now = 1_000;
  const tracker = new TypingActivityTracker(() => now, 10);
  const original = message(ChannelType.GuildText, []);
  original.createdTimestamp = 900;

  tracker.noteTyping(typing("other-user", ChannelType.DM));
  tracker.noteTyping(typing("helper-bot", ChannelType.GuildText, true));
  assert.equal(await hasInterveningHumanActivity(original, tracker), false);

  tracker.noteTyping(typing("other-user", ChannelType.GuildText));
  now += 11;
  assert.equal(await hasInterveningHumanActivity(original, tracker), false);
});

function message(channelType: ChannelType, laterMessages: Message[]): Message {
  return {
    id: "100",
    guild: channelType === ChannelType.DM ? null : { id: "guild-1" },
    author: { id: "original-user", bot: false },
    client: { user: { id: "banjo-id" } },
    channel: {
      id: "channel-1",
      type: channelType,
      messages: {
        fetch: async () => new Map(laterMessages.map((message) => [message.id, message])),
      },
    },
  } as unknown as Message;
}

function candidate(authorId: string, bot: boolean): Message {
  return {
    id: `${authorId}-message`,
    author: { id: authorId, bot },
  } as unknown as Message;
}

function typing(userId: string, channelType: ChannelType, bot = false): Typing {
  return {
    guild: channelType === ChannelType.DM ? null : { id: "guild-1" },
    channel: { id: "channel-1", type: channelType },
    user: { id: userId, bot },
  } as unknown as Typing;
}
