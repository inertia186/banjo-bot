import { ChannelType, type Message } from "discord.js";
import type { LlmConversationLeases } from "./conversation-lease.js";

export function llmPrompt(message: Message, commandPrefix: string, leases?: LlmConversationLeases): string | null {
  if (message.author.bot) return null;
  if (message.client.user && message.author.id === message.client.user.id) return null;

  if (message.channel.type === ChannelType.DM) {
    const prompt = message.content.trim();
    return prompt && !isBareCommand(prompt, commandPrefix) ? prompt : null;
  }

  const botUser = message.client.user;
  if (!botUser) return null;
  const isMentioned = message.mentions.has(botUser);
  if (!isMentioned && !leases?.claimFollowUp(message, commandPrefix)) return null;

  const mentionPatterns = [`<@${botUser.id}>`, `<@!${botUser.id}>`];
  const prompt = mentionPatterns.reduce(
    (content, mention) => content.replaceAll(mention, ""),
    message.content,
  ).trim();

  if (!prompt) return null;
  if (isMentioned) leases?.noteExplicitInteraction(message);
  return prompt;
}

function isBareCommand(prompt: string, commandPrefix: string): boolean {
  return prompt.startsWith(commandPrefix) && !/\s/.test(prompt);
}
