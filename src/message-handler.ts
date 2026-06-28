import { ChannelType, type GuildTextBasedChannel, type Message } from "discord.js";
import { parseCommand } from "./command-parser.js";
import { UserFacingCommandError } from "./commands/hive.js";
import type { Command } from "./commands/types.js";
import type { AppConfig } from "./config.js";
import { LlmConversationLeases } from "./llm/conversation-lease.js";
import { llmPrompt } from "./llm/prompt.js";
import { hasInterveningHumanActivity, type TypingActivityTracker } from "./llm/turn-taking.js";
import type { Logger } from "./logger.js";
import type { PassiveSnarks } from "./passive-snarks.js";
import { startDelayedTyping } from "./typing.js";

type LlmResponder = {
  enabled: boolean;
  replyTo(message: Message, prompt: string): Promise<string | null>;
};

export type MessageHandlerDependencies = {
  config: AppConfig;
  logger: Logger;
  commands: ReadonlyMap<string, Command>;
  llmChat: LlmResponder;
  passiveSnarks: Pick<PassiveSnarks, "replyFor">;
  conversationLeases: LlmConversationLeases;
  typingActivity: TypingActivityTracker;
  startTyping?: (message: Message) => () => void;
};

export async function handleMessageCreate(message: Message, dependencies: MessageHandlerDependencies): Promise<void> {
  try {
    await handleMessageCreateUnsafe(message, dependencies);
  } catch (error) {
    dependencies.logger.error("Message handler failed.", errorMeta(error));
  }
}

async function handleMessageCreateUnsafe(message: Message, dependencies: MessageHandlerDependencies): Promise<void> {
  const { config, llmChat, passiveSnarks, typingActivity } = dependencies;

  if (message.author.bot) return;
  if (!isAllowedChannel(message, config)) return;

  const passiveResponse = passiveSnarks.replyFor(message.content);
  if (passiveResponse) {
    if (passiveResponse.kind === "reply") {
      await message.reply(passiveResponse.content);
    } else if (passiveResponse.kind === "spongebob") {
      await replyWithSpongebob(message);
    } else if (llmChat.enabled) {
      const response = await llmChat.replyTo(message, passiveResponse.prompt);
      if (response && !await hasInterveningHumanActivity(message, typingActivity)) {
        await message.reply(response);
      }
    }
    return;
  }

  const parsed = parseCommand(message.content, config.commandPrefix);
  if (!parsed) {
    await maybeReplyWithLlm(message, dependencies);
    return;
  }

  const command = dependencies.commands.get(parsed.name);
  if (!command) return;

  const stopTyping = (dependencies.startTyping ?? startDelayedTyping)(message);
  try {
    const response = await command.execute({
      message,
      config,
      logger: dependencies.logger,
      commandName: parsed.name,
    }, parsed.args);
    if (response) {
      if (typeof response === "string") {
        await message.reply(response);
      } else {
        const { afterSend, ...replyOptions } = response;
        const reply = await message.reply(replyOptions);
        await afterSend?.(reply);
      }
    }
  } catch (error) {
    if (error instanceof UserFacingCommandError) {
      await message.reply(error.message);
      return;
    }

    dependencies.logger.error("Command failed.", {
      command: parsed.name,
      ...errorMeta(error),
    });
    await message.reply("Sorry, that command failed while Banjo is still being rebuilt.");
  } finally {
    stopTyping();
  }
}

function isAllowedChannel(message: Message, config: AppConfig): boolean {
  if (!config.channels) return true;
  if (message.channel.type === ChannelType.DM) return true;

  const channel = message.channel as GuildTextBasedChannel;
  return config.channels.has(channel.id) || config.channels.has(channel.name);
}

async function maybeReplyWithLlm(message: Message, dependencies: MessageHandlerDependencies): Promise<void> {
  const { config, conversationLeases, llmChat, typingActivity } = dependencies;
  if (!llmChat.enabled) return;

  const prompt = llmPrompt(message, config.commandPrefix, conversationLeases);
  if (!prompt) return;

  if ("sendTyping" in message.channel) {
    await message.channel.sendTyping();
  }

  const response = await llmChat.replyTo(message, prompt);
  if (response && !await hasInterveningHumanActivity(message, typingActivity)) {
    await message.reply(response);
    conversationLeases.noteBotReply(message);
  } else {
    conversationLeases.closeForMessage(message);
  }
}

async function replyWithSpongebob(message: Message): Promise<void> {
  const reply = await message.reply("**Sponge**");
  await sleep(250);
  await reply.edit("**Spongebob**");
  await sleep(250);
  await reply.edit("**Spongebob Square**");
  await sleep(250);
  await reply.edit("**Spongebob Squarepants!**");
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMeta(error: unknown): { error: string; stack?: string } {
  if (error instanceof Error) {
    return {
      error: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }

  return { error: String(error) };
}
