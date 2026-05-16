import {
  ChannelType,
  Client,
  GatewayIntentBits,
  Partials,
  type GuildTextBasedChannel,
  type Message,
} from "discord.js";
import { parseCommand } from "./command-parser.js";
import { loadConfig } from "./config.js";
import { registerCommands } from "./commands/index.js";
import { LlmChat } from "./llm/chat.js";
import { logger } from "./logger.js";

const config = loadConfig();
const llmChat = new LlmChat(config, logger);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

registerCommands(client);

client.once("ready", () => {
  logger.info("Banjo is ready.", {
    user: client.user?.tag,
    commands: client.commands.size,
    prefix: config.commandPrefix,
    llmEnabled: llmChat.enabled,
  });
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!isAllowedChannel(message)) return;

  const parsed = parseCommand(message.content, config.commandPrefix);
  if (!parsed) {
    await maybeReplyWithLlm(message);
    return;
  }

  const command = client.commands.get(parsed.name);
  if (!command) return;

  try {
    const response = await command.execute({ message, config, logger, commandName: parsed.name }, parsed.args);
    if (response) await message.reply(response);
  } catch (error) {
    logger.error("Command failed.", {
      command: parsed.name,
      error: error instanceof Error ? error.message : String(error),
    });
    await message.reply("Sorry, that command failed while Banjo is still being rebuilt.");
  }
});

await client.login(config.discordToken);

function isAllowedChannel(message: Message): boolean {
  if (!config.channels) return true;
  if (message.channel.type === ChannelType.DM) return true;

  const channel = message.channel as GuildTextBasedChannel;
  return config.channels.has(channel.id) || config.channels.has(channel.name);
}

async function maybeReplyWithLlm(message: Message) {
  if (!llmChat.enabled) return;

  const prompt = llmPrompt(message);
  if (!prompt) return;

  if ("sendTyping" in message.channel) {
    await message.channel.sendTyping();
  }

  const response = await llmChat.replyTo(message, prompt);
  if (response) await message.reply(response);
}

function llmPrompt(message: Message): string | null {
  if (message.channel.type === ChannelType.DM) {
    return message.content.trim();
  }

  const botUser = message.client.user;
  if (!botUser || !message.mentions.has(botUser)) return null;

  const mentionPatterns = [`<@${botUser.id}>`, `<@!${botUser.id}>`];
  const prompt = mentionPatterns.reduce(
    (content, mention) => content.replaceAll(mention, ""),
    message.content,
  ).trim();

  return prompt || null;
}
