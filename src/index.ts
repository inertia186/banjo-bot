import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
} from "discord.js";
import { loadConfig } from "./config.js";
import { handleHelpInteraction } from "./commands/core.js";
import { registerCommands } from "./commands/index.js";
import { handleNftShowroomInteraction, handleProposalInteraction, handleSearchInteraction } from "./commands/hive.js";
import { handleSplinterlandsInteraction } from "./commands/splinterlands.js";
import { HyperionAgentClient } from "./hyperion/api.js";
import { LlmChat } from "./llm/chat.js";
import { ChannelAmbientContextProvider, CompositeAmbientContextProvider } from "./llm/channel-context.js";
import { LlmConversationLeases } from "./llm/conversation-lease.js";
import { HiveAmbientContextProvider } from "./llm/hive-context.js";
import { HiveReferenceContextProvider } from "./llm/hive-reference-context.js";
import { TypingActivityTracker } from "./llm/turn-taking.js";
import { logger } from "./logger.js";
import { handleMessageCreate } from "./message-handler.js";
import { PassiveSnarks } from "./passive-snarks.js";

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
const hyperion = new HyperionAgentClient(config);
const llmChat = new LlmChat(
  config,
  logger,
  undefined,
  client.commands,
  new CompositeAmbientContextProvider([
    new HiveAmbientContextProvider(config, logger, undefined, hyperion),
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

client.on("messageCreate", (message) => {
  void handleMessageCreate(message, {
    config,
    logger,
    commands: client.commands,
    llmChat,
    passiveSnarks,
    conversationLeases,
    typingActivity,
  });
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
