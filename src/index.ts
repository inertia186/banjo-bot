import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type GuildTextBasedChannel,
  type Message,
} from "discord.js";
import { parseCommand } from "./command-parser.js";
import { loadConfig } from "./config.js";
import { handleHelpInteraction } from "./commands/core.js";
import { registerCommands } from "./commands/index.js";
import { UserFacingCommandError } from "./commands/hive.js";
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
  ],
  partials: [Partials.Channel, Partials.Message],
});

registerCommands(client);

client.once(Events.ClientReady, () => {
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

    logger.error("Command failed.", {
      command: parsed.name,
      error: error instanceof Error ? error.message : String(error),
    });
    await message.reply("Sorry, that command failed while Banjo is still being rebuilt.");
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

  try {
    await handleHelpInteraction(interaction, config.commandPrefix);
  } catch (error) {
    logger.error("Interaction failed.", {
      customId: interaction.customId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({ content: "Sorry, that control failed.", ephemeral: true }).catch(() => undefined);
    } else if (interaction.isRepliable()) {
      await interaction.followUp({ content: "Sorry, that control failed.", ephemeral: true }).catch(() => undefined);
    }
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
