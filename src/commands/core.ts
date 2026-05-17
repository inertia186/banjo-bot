import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type GuildEmoji,
  type Message,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { Command, CommandReplyOptions } from "./types.js";

export const coreCommands: Command[] = [
  {
    name: "ping",
    description: "Check whether Banjo is awake.",
    usage: "ping",
    category: "core",
    execute: () => "Pong.",
  },
  {
    name: "register",
    description: "Account registration is disabled.",
    usage: "register <account>",
    category: "core",
    execute: () => "Registration is currently disabled.",
  },
  {
    name: "upvote",
    description: "Voting is disabled.",
    usage: "upvote [post]",
    category: "core",
    execute: () => "Upvote is currently disabled.",
  },
  {
    name: "verify",
    description: "Cosgrove account verification is unavailable.",
    usage: "verify <account-or-user> [chain]",
    category: "core",
    execute: () => "Account verification is not available.",
  },
  {
    name: "version",
    description: "Show Cosgrove upstream status.",
    usage: "version",
    category: "core",
    execute: () => "Cosgrove version lookup is not available in this Banjo build.",
  },
  {
    name: "slap",
    description: "Cosgrove slap command is unavailable.",
    usage: "slap [target]",
    category: "core",
    execute: () => "Slap command is not available.",
  },
  {
    name: "catfact",
    aliases: ["catfacts"],
    description: "Cosgrove cat fact lookup is unavailable.",
    usage: "catfact",
    category: "core",
    execute: () => "Cat fact lookup is not available.",
  },
  {
    name: "voting",
    description: "Voting statistics are disabled.",
    usage: "voting [minutes] [accounts...]",
    category: "core",
    execute: () => "Sorry, voting stats are currently not available.",
  },
  {
    name: "play",
    description: "Voice sound playback is unavailable.",
    usage: "play [sound]",
    category: "core",
    execute: () => "Voice sound playback is not available.",
  },
  {
    name: "disconnect_voice",
    description: "Voice playback control is unavailable.",
    usage: "disconnect_voice",
    category: "core",
    execute: () => "Voice playback is not available.",
  },
  {
    name: "stats",
    description: "Bot statistics are disabled.",
    usage: "stats",
    category: "core",
    execute: () => "Stats are currently disabled.",
  },
  {
    name: "payout",
    description: "Pending payout summary is unavailable.",
    usage: "payout",
    category: "core",
    execute: () => "Payout summary is not available.",
  },
  {
    name: "flagwars",
    description: "Flagwars report is unavailable.",
    usage: "flagwars",
    category: "core",
    execute: () => "Flagwars report is not available.",
  },
  {
    name: "regex",
    description: "Regex content scan is unavailable.",
    usage: "regex <pattern>",
    category: "core",
    execute: () => "Regex content scan is not available. Use `$search` for indexed keyword search.",
  },
  {
    name: "poll",
    description: "Poll rendering is unavailable.",
    usage: "poll <url-or-@author/permlink>",
    category: "core",
    execute: () => "Poll rendering is not available.",
  },
  {
    name: "mod",
    description: "Moderation report is unavailable.",
    usage: "mod <symbol> [tribe tags] [payout]",
    category: "core",
    execute: () => "Moderation report is not available.",
  },
  {
    name: "woodwork",
    description: "Woodwork report is unavailable.",
    usage: "woodwork [tag...]",
    category: "core",
    execute: () => "Woodwork report is not available.",
  },
  {
    name: "investors",
    description: "Investor report is unavailable.",
    usage: "investors [days]",
    category: "core",
    execute: () => "Investor report is not available.",
  },
  {
    name: "predict",
    aliases: ["prediction"],
    description: "Dublup prediction lookup is unavailable.",
    usage: "predict [market-id|query]",
    category: "core",
    execute: () => "Prediction lookup is not available. The legacy Dublup API is no longer usable.",
  },
  {
    name: "bidbots",
    description: "Bidbot report is unavailable.",
    usage: "bidbots [tag...]",
    category: "core",
    execute: () => "Bidbot report is not available.",
  },
  {
    name: "birthday",
    description: "Show the birthday age for Hive and a few historical chains/events.",
    usage: "birthday [hive|steem|golos|banjo|bitcoin|aggrandizement]",
    category: "core",
    execute: (_context, args) => formatBirthday(args[0] ?? "hive"),
  },
  {
    name: "trail",
    description: "Show the status of the retired Banjo curation trail.",
    usage: "trail",
    category: "core",
    execute: () => "The legacy Streemian curation trail is no longer available.",
  },
  {
    name: "about",
    description: "Show Banjo project information.",
    usage: "about",
    category: "core",
    execute: () =>
      [
        "Banjo is being reimplemented in TypeScript with Discord.js.",
        "The migration notes track parity with the legacy Ruby bot.",
      ].join("\n"),
  },
  {
    name: "help",
    description: "List available commands.",
    usage: "help [command]",
    category: "core",
    execute: async ({ message, config }, args) => {
      const registry = message.client.commands;
      const prefix = config.commandPrefix;
      const selectedName = args[0]?.toLowerCase();
      const categoryLabels = await resolveCategoryLabels(message);

      if (selectedName) {
        const command = registry.get(selectedName);
        if (!command) return `Cannot find help for: ${selectedName}`;

        return helpCommandEmbed(command, prefix, categoryLabels);
      }

      return paginatedHelpEmbed(visibleCommands(registry), prefix, categoryLabels);
    },
  },
];

type HelpPage = {
  title: string;
  description: string;
  fields: Array<{ name: string; value: string; inline?: boolean }>;
  commands: Command[];
  category: Command["category"] | null;
};

type HelpCategory = {
  category: Command["category"];
  commands: Command[];
};

const categoryEmoji: Record<Command["category"], string> = {
  core: "Banjo",
  links: "🔗",
  snarks: "Snarks",
  hive: "Hive",
  legacy: "🗄️",
};

function helpCommandEmbed(command: Command, prefix: string, categoryLabels: Record<Command["category"], string>): CommandReplyOptions {
  const embed = baseHelpEmbed(`Help: ${prefix}${command.name}`, `\`${prefix}${command.usage ?? command.name}\``)
    .addFields(
      { name: "What it does", value: command.description },
      ...(command.aliases?.length ? [{ name: "Aliases", value: command.aliases.map((alias) => `\`${prefix}${alias}\``).join(", ") }] : []),
      { name: "Category", value: categoryLabel(command.category, categoryLabels), inline: true },
    );

  return { embeds: [embed] };
}

function paginatedHelpEmbed(commands: Command[], prefix: string, categoryLabels: Record<Command["category"], string>): CommandReplyOptions {
  const pages = buildHelpPages(commands, prefix, categoryLabels);

  return {
    embeds: [renderHelpPage(pages[0]!, 0, pages.length)],
    components: renderHelpComponents(pages[0]!, 0, pages, prefix),
  };
}

function buildHelpPages(commands: Command[], prefix: string, categoryLabels: Record<Command["category"], string>): HelpPage[] {
  const byCategory = commands.reduce<Record<string, Command[]>>((memo, command) => {
    const categoryCommands = (memo[command.category] ??= []);
    categoryCommands.push(command);
    return memo;
  }, {});

  const categories: HelpCategory[] = Object.entries(byCategory)
    .map(([category, categoryCommands]) => ({
      category: category as Command["category"],
      commands: categoryCommands.sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => categoryOrder(left.category) - categoryOrder(right.category));

  const overview: HelpPage = {
    title: "Banjo Help",
    description: [
      "Browse command groups with buttons and the command menu.",
      `Use \`${prefix}help <command>\` for a focused command card.`,
    ].join("\n"),
    fields: categories.map(({ category, commands }) => ({
      name: categoryLabel(category, categoryLabels),
      value: `${commands.length} command${commands.length === 1 ? "" : "s"}`,
      inline: true,
    })),
    commands: [],
    category: null,
  };

  const categoryPages = categories.flatMap(({ category, commands }) =>
    chunk(commands, 10).map((commandChunk, index, categoryChunks) => ({
      title: `${categoryLabel(category, categoryLabels)} Commands${categoryChunks.length > 1 ? ` ${index + 1}/${categoryChunks.length}` : ""}`,
      description: `Use \`${prefix}help <command>\` for usage and aliases.`,
      fields: commandChunk.map((command) => ({
        name: `${prefix}${command.name}`,
        value: command.description,
      })),
      commands: commandChunk,
      category,
    })),
  );

  return [overview, ...categoryPages];
}

function renderHelpPage(page: HelpPage, pageIndex: number, pageCount: number): EmbedBuilder {
  return baseHelpEmbed(page.title, page.description)
    .addFields(page.fields)
    .setFooter({
      text: `Page ${pageIndex + 1}/${pageCount}`,
    });
}

const helpComponentPrefix = "help";
const helpCommandSelectPrefix = `${helpComponentPrefix}:select`;
const helpCategorySelectId = `${helpComponentPrefix}:category`;
const helpPageButtonPrefix = `${helpComponentPrefix}:page`;
const helpCloseButtonId = `${helpComponentPrefix}:close`;

function renderHelpCommandEmbed(command: Command, prefix: string, categoryLabels: Record<Command["category"], string>): EmbedBuilder {
  return baseHelpEmbed(`Help: ${prefix}${command.name}`, `\`${prefix}${command.usage ?? command.name}\``)
    .addFields(
      { name: "What it does", value: command.description },
      ...(command.aliases?.length ? [{ name: "Aliases", value: command.aliases.map((alias) => `\`${prefix}${alias}\``).join(", ") }] : []),
      { name: "Category", value: categoryLabel(command.category, categoryLabels), inline: true },
    );
}

function renderHelpComponents(page: HelpPage, pageIndex: number, pages: HelpPage[], prefix: string): Array<ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>> {
  const pageCount = pages.length;
  const options = page.commands.slice(0, 25).map((command) => ({
    label: `${prefix}${command.name}`,
    value: command.name,
    description: truncateSelectDescription(command.description),
  }));

  const categoryOptions = firstCategoryPageIndexes(pages).map(({ category, pageIndex: categoryPageIndex }) => ({
    label: titleCase(category),
    value: String(categoryPageIndex),
    default: page.category === category,
  }));

  const categorySelect = new StringSelectMenuBuilder()
    .setCustomId(helpCategorySelectId)
    .setPlaceholder(page.category ? `Category: ${titleCase(page.category)}` : "Choose a category")
    .addOptions(categoryOptions);

  const commandSelect = new StringSelectMenuBuilder()
    .setCustomId(`${helpCommandSelectPrefix}:${pageIndex}`)
    .setPlaceholder(page.commands.length > 0 ? "Choose a command for details" : "Choose a category first")
    .setDisabled(options.length === 0)
    .addOptions(options.length > 0 ? options : [{ label: "No commands on this page", value: "none" }]);

  const previousPage = (pageIndex - 1 + pageCount) % pageCount;
  const nextPage = (pageIndex + 1) % pageCount;
  const navigation = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${helpPageButtonPrefix}:previous:${previousPage}`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${helpPageButtonPrefix}:home:0`)
      .setLabel("Home")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${helpPageButtonPrefix}:next:${nextPage}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(helpCloseButtonId)
      .setLabel("Close")
      .setStyle(ButtonStyle.Danger),
  );

  return [
    navigation,
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(categorySelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(commandSelect),
  ];
}

function firstCategoryPageIndexes(pages: HelpPage[]): Array<{ category: Command["category"]; pageIndex: number }> {
  const seen = new Set<Command["category"]>();
  const indexes: Array<{ category: Command["category"]; pageIndex: number }> = [];

  pages.forEach((page, pageIndex) => {
    if (!page.category || seen.has(page.category)) return;

    seen.add(page.category);
    indexes.push({ category: page.category, pageIndex });
  });

  return indexes;
}

function truncateSelectDescription(value: string): string {
  return value.length <= 100 ? value : `${value.slice(0, 97)}...`;
}

export async function handleHelpInteraction(interaction: ButtonInteraction | StringSelectMenuInteraction, prefix: string): Promise<boolean> {
  if (!isHelpInteraction(interaction)) return false;

  await interaction.deferUpdate();

  if (interaction.isButton() && interaction.customId === helpCloseButtonId) {
    await interaction.message.delete().catch(() => undefined);
    return true;
  }

  const commands = visibleCommands(interaction.client.commands);
  const categoryLabels = await resolveCategoryLabels(interaction);
  const pages = buildHelpPages(commands, prefix, categoryLabels);

  if (interaction.isButton()) {
    const pageIndex = boundedPageIndex(Number(interaction.customId.split(":").at(-1)), pages.length);

    await interaction.message.edit({
      embeds: [renderHelpPage(pages[pageIndex]!, pageIndex, pages.length)],
      components: renderHelpComponents(pages[pageIndex]!, pageIndex, pages, prefix),
    });
    return true;
  }

  if (interaction.customId === helpCategorySelectId) {
    const pageIndex = boundedPageIndex(Number(interaction.values[0]), pages.length);

    await interaction.message.edit({
      embeds: [renderHelpPage(pages[pageIndex]!, pageIndex, pages.length)],
      components: renderHelpComponents(pages[pageIndex]!, pageIndex, pages, prefix),
    });
    return true;
  }

  const pageIndex = boundedPageIndex(Number(interaction.customId.slice(`${helpCommandSelectPrefix}:`.length)), pages.length);
  const command = commands.find((candidate) => candidate.name === interaction.values[0]);
  if (!command) {
    return true;
  }

  await interaction.message.edit({
    embeds: [renderHelpCommandEmbed(command, prefix, categoryLabels)],
    components: renderHelpComponents(pages[pageIndex]!, pageIndex, pages, prefix),
  });
  return true;
}

function isHelpInteraction(interaction: ButtonInteraction | StringSelectMenuInteraction): boolean {
  return (interaction.isButton() && (interaction.customId.startsWith(`${helpPageButtonPrefix}:`) || interaction.customId === helpCloseButtonId))
    || (interaction.isStringSelectMenu() && (interaction.customId.startsWith(`${helpCommandSelectPrefix}:`) || interaction.customId === helpCategorySelectId));
}

function visibleCommands(registry: Map<string, Command>): Command[] {
  return [...new Map([...registry.values()].map((command) => [command.name, command])).values()];
}

function boundedPageIndex(value: number, pageCount: number): number {
  return Number.isInteger(value) && value >= 0 && value < pageCount ? value : 0;
}

function baseHelpEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf5a623)
    .setAuthor({ name: "Banjo Command Guide" })
    .setTitle(title)
    .setDescription(description);
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function categoryLabel(category: Command["category"], categoryLabels: Record<Command["category"], string>): string {
  return categoryLabels[category];
}

type HelpEmojiSource = Pick<Message, "client" | "guild">;

async function resolveCategoryLabels(source: HelpEmojiSource): Promise<Record<Command["category"], string>> {
  const cachedEmojis = [
    ...source.guild?.emojis.cache.values() ?? [],
    ...source.client.emojis?.cache.values() ?? [],
  ];

  const fetchedEmojis = await source.guild?.emojis.fetch().catch(() => null);
  const emojis = fetchedEmojis ? [...cachedEmojis, ...fetchedEmojis.values()] : cachedEmojis;

  return {
    core: customCategoryLabel("banjo", "Banjo", emojis),
    links: `${categoryEmoji.links} ${titleCase("links")}`,
    snarks: customCategoryLabel("nicetry001", "Snarks", emojis),
    hive: customCategoryLabel("hivertinyji", "Hive", emojis),
    legacy: `${categoryEmoji.legacy} ${titleCase("legacy")}`,
  };
}

function customCategoryLabel(emojiName: string, label: string, emojis: GuildEmoji[]): string {
  const emoji = findEmoji(emojiName, emojis);
  return emoji ? `${emoji} ${label}` : label;
}

function findEmoji(name: string, emojis: GuildEmoji[]): GuildEmoji | null {
  const normalizedTarget = normalizeEmojiName(name);
  return emojis.find((emoji) => normalizeEmojiName(emoji.name ?? "") === normalizedTarget) ?? null;
}

function normalizeEmojiName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function categoryOrder(category: Command["category"]): number {
  return ["core", "hive", "links", "snarks", "legacy"].indexOf(category);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

type BirthdayEntry = {
  name: string;
  birthYear: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const birthdays: Record<string, BirthdayEntry> = {
  steem: { name: "STEEM", birthYear: 2016, month: 2, day: 24, hour: 17, minute: 0, second: 0 },
  golos: { name: "GOLOS", birthYear: 2016, month: 9, day: 18, hour: 11, minute: 1, second: 48 },
  banjo: { name: "Banjo", birthYear: 2017, month: 0, day: 24, hour: 11, minute: 1, second: 48 },
  bitcoin: { name: "Bitcoin", birthYear: 2009, month: 0, day: 3, hour: 18, minute: 15, second: 5 },
  aggrandizement: { name: "Aggrandizement Day", birthYear: 2018, month: 1, day: 3, hour: 19, minute: 2, second: 36 },
  hive: { name: "HIVE", birthYear: 2020, month: 2, day: 20, hour: 14, minute: 0, second: 0 },
};

function formatBirthday(value: string): string {
  const key = value.toLowerCase();
  const birthday = birthdays[key];
  if (!birthday) return `Not tracking ${value}'s birthday.`;

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const thisBirthday = new Date(Date.UTC(currentYear, birthday.month, birthday.day, birthday.hour, birthday.minute, birthday.second));
  const age = currentYear - birthday.birthYear;

  if (thisBirthday.getTime() > now.getTime()) {
    return `\`${birthday.name} is ${pluralize(age, "year")} old in ${formatDuration(Math.floor((thisBirthday.getTime() - now.getTime()) / 1000))}\``;
  }

  return `\`${birthday.name} became ${pluralize(age, "year")} old ${formatDuration(Math.floor((now.getTime() - thisBirthday.getTime()) / 1000))} ago\``;
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function formatDuration(seconds: number): string {
  const units = [
    ["year", 365 * 24 * 60 * 60],
    ["month", 30 * 24 * 60 * 60],
    ["day", 24 * 60 * 60],
    ["hour", 60 * 60],
    ["minute", 60],
  ] as const;

  for (const [name, unitSeconds] of units) {
    const value = Math.floor(seconds / unitSeconds);
    if (value >= 1) return pluralize(value, name);
  }

  return "less than a minute";
}
