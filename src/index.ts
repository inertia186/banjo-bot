import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  type GuildTextBasedChannel,
  type Message,
} from "discord.js";
import { parseCommand } from "./command-parser.js";
import { loadConfig } from "./config.js";
import { handleHelpInteraction } from "./commands/core.js";
import { registerCommands } from "./commands/index.js";
import { handleNftShowroomInteraction, handleProposalInteraction, handleSearchInteraction, UserFacingCommandError } from "./commands/hive.js";
import { handleSplinterlandsInteraction } from "./commands/splinterlands.js";
import { LlmChat } from "./llm/chat.js";
import { ChannelAmbientContextProvider, CompositeAmbientContextProvider } from "./llm/channel-context.js";
import { LlmConversationLeases } from "./llm/conversation-lease.js";
import { HiveAmbientContextProvider } from "./llm/hive-context.js";
import { HiveReferenceContextProvider } from "./llm/hive-reference-context.js";
import { llmPrompt } from "./llm/prompt.js";
import { hasInterveningHumanActivity, TypingActivityTracker } from "./llm/turn-taking.js";
import { logger } from "./logger.js";
import { PassiveSnarks } from "./passive-snarks.js";
import { startDelayedTyping } from "./typing.js";

const config = loadConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageTyping,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageTyping,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

registerCommands(client);
const llmChat = new LlmChat(
  config,
  logger,
  undefined,
  client.commands,
  new CompositeAmbientContextProvider([
    new HiveAmbientContextProvider(config, logger),
    new HiveReferenceContextProvider(config, logger),
    new ChannelAmbientContextProvider(logger),
  ]),
);
const passiveSnarks = new PassiveSnarks();
const conversationLeases = new LlmConversationLeases();
const typingActivity = new TypingActivityTracker();

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
    await maybeReplyWithLlm(message);
    return;
  }

  const command = client.commands.get(parsed.name);
  if (!command) return;

  const stopTyping = startDelayedTyping(message);
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
  } finally {
    stopTyping();
  }
});

client.on(Events.TypingStart, (typing) => {
  typingActivity.noteTyping(typing);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

  try {
    if (await handleHelpInteraction(interaction, config.commandPrefix)) return;
    if (await handleProposalInteraction(interaction, config, logger)) return;
    if (await handleSplinterlandsInteraction(interaction, config, logger)) return;
    if (interaction.isButton() && await handleNftShowroomInteraction(interaction, config, logger)) return;
    if (interaction.isButton() && await handleSearchInteraction(interaction, config, logger)) return;
  } catch (error) {
    logger.error("Interaction failed.", {
      customId: interaction.customId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({ content: "Sorry, that control failed.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
    } else if (interaction.isRepliable()) {
      await interaction.followUp({ content: "Sorry, that control failed.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
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

async function replyWithSpongebob(message: Message) {
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
