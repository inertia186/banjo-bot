import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, type ButtonInteraction, type MessageEditOptions, type StringSelectMenuInteraction } from "discord.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { SplinterlandsHttpClient, type SplinterlandsApi, type SplinterlandsBalance, type SplinterlandsCardDetail, type SplinterlandsCollectionCard, type SplinterlandsPlayer, type SplinterlandsRulesetStats } from "../splinterlands/api.js";
import { asEmbedResponse, banjoEmbed, dataField } from "./embeds.js";
import type { Command, CommandContext, CommandReplyOptions } from "./types.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { version: string };

const leagueNames = [
  "None",
  "Novice",
  "Bronze III",
  "Bronze II",
  "Bronze I",
  "Silver III",
  "Silver II",
  "Silver I",
  "Gold III",
  "Gold II",
  "Gold I",
  "Diamond III",
  "Diamond II",
  "Diamond I",
  "Champion III",
  "Champion II",
  "Champion I",
];

const displayedBalanceTokens = ["DEC", "SPS", "SPSP", "VOUCHER", "CREDITS", "PLOT"];
const rewardBalanceTokens = [...displayedBalanceTokens, "ECR", "FECR"];
const splinterlandsSelectPrefix = "spl:section";
const splinterlandsRefreshPrefix = "spl:refresh";
type SplinterlandsSection = "overview" | "rewards" | "collection";

export const splinterlandsCommands: Command[] = [
  {
    name: "splinterlands",
    aliases: ["splinter", "spl"],
    description: "Report on a Splinterlands player account.",
    usage: "splinterlands <player>",
    category: "hive",
    execute: async (context, args) => {
      const playerName = args[0]?.replace(/^@/, "").toLowerCase();
      if (!playerName) return "Usage: `$splinterlands <player>`";

      const splinterlands = splinterlandsApi(context);
      const [player, balances] = await Promise.all([
        splinterlands.getPlayer(playerName),
        splinterlands.getBalances(playerName),
      ]);

      if (!player) return `Unable to find Splinterlands player **${playerName}**.`;

      return formatSplinterlandsResponse("overview", player, balances);
    },
  },
];

function splinterlandsApi(context: CommandContext): SplinterlandsApi {
  return context.services?.splinterlands ?? new SplinterlandsHttpClient(context.config, context.logger);
}

export async function handleSplinterlandsInteraction(interaction: ButtonInteraction | StringSelectMenuInteraction, config: AppConfig, logger: Logger): Promise<boolean> {
  const request = parseInteractionRequest(interaction);
  if (!request) return false;

  await interaction.deferUpdate();

  const { account, section } = request;
  const splinterlands = new SplinterlandsHttpClient(config, logger);
  const player = await splinterlands.getPlayer(account);

  if (!player) {
    await interaction.message.edit({
      content: `Unable to find Splinterlands player **${account}**.`,
      embeds: [],
      components: [],
    });
    return true;
  }

  if (section === "collection") {
    try {
      const [collection, cardDetails] = await Promise.all([
        splinterlands.getCollection(player.name),
        splinterlands.getCardDetails(),
      ]);
      await interaction.message.edit(asMessageEdit(formatSplinterlandsResponse("collection", player, [], collection, cardDetails)));
    } catch {
      await interaction.message.edit(asMessageEdit(formatSplinterlandsResponse("collection", player, [], null, [])));
    }
    return true;
  }

  const balances = await splinterlands.getBalances(player.name);
  await interaction.message.edit(asMessageEdit(formatSplinterlandsResponse(section, player, balances)));
  return true;
}

function parseInteractionRequest(interaction: ButtonInteraction | StringSelectMenuInteraction): { account: string; section: SplinterlandsSection } | null {
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${splinterlandsSelectPrefix}:`)) {
    return {
      account: interaction.customId.slice(`${splinterlandsSelectPrefix}:`.length),
      section: parseSection(interaction.values[0]),
    };
  }

  if (interaction.isButton() && interaction.customId.startsWith(`${splinterlandsRefreshPrefix}:`)) {
    const [, , sectionValue, ...accountParts] = interaction.customId.split(":");
    const account = accountParts.join(":");
    if (!account) return null;

    return {
      account,
      section: parseSection(sectionValue),
    };
  }

  return null;
}

function parseSection(value: string | undefined): SplinterlandsSection {
  return value === "rewards" || value === "collection" ? value : "overview";
}

function formatSplinterlandsResponse(
  section: SplinterlandsSection,
  player: SplinterlandsPlayer,
  balances: SplinterlandsBalance[],
  collection?: SplinterlandsCollectionCard[] | null,
  cardDetails: SplinterlandsCardDetail[] = [],
): CommandReplyOptions {
  const embed = section === "rewards"
    ? formatRewards(player, balances)
    : section === "collection"
      ? formatCollection(player, collection, cardDetails)
      : formatOverview(player, balances);
  const components = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(sectionSelect(player.name, section)),
    section === "overview" ? overviewActionButtons(player.name) : refreshButton(player.name, section),
    ...(section === "rewards" ? [claimButtons(player.name)] : []),
  ];

  return {
    ...asEmbedResponse(embed),
    components,
  };
}

function asMessageEdit(response: CommandReplyOptions): MessageEditOptions {
  const options: MessageEditOptions = { content: response.content ?? null };
  if (response.embeds) options.embeds = response.embeds;
  if (response.components) options.components = response.components;

  return options;
}

function sectionSelect(account: string, selected: SplinterlandsSection): StringSelectMenuBuilder {
  return new StringSelectMenuBuilder()
    .setCustomId(`${splinterlandsSelectPrefix}:${account}`)
    .setPlaceholder("Choose a Splinterlands report")
    .addOptions([
      {
        label: "Overview",
        value: "overview",
        description: "Account status, league, ratings, guild, and balances.",
        default: selected === "overview",
      },
      {
        label: "Rewards",
        value: "rewards",
        description: "Balances, ECR/FECR, and claim links.",
        default: selected === "rewards",
      },
      {
        label: "Collection",
        value: "collection",
        description: "Collection totals, rentals, delegation, and top cards.",
        default: selected === "collection",
      },
    ]);
}

function overviewActionButtons(account: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${splinterlandsRefreshPrefix}:overview:${account}`)
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setLabel("Splinterlands")
      .setStyle(ButtonStyle.Link)
      .setURL(`https://splinterlands.com/@${encodeURIComponent(account)}`),
    new ButtonBuilder()
      .setLabel("PeakMonsters")
      .setStyle(ButtonStyle.Link)
      .setURL(`https://peakmonsters.com/@${encodeURIComponent(account)}/cards`),
    new ButtonBuilder()
      .setLabel("Hive Profile")
      .setStyle(ButtonStyle.Link)
      .setURL(`https://peakd.com/@${encodeURIComponent(account)}`),
  );
}

function refreshButton(account: string, section: SplinterlandsSection): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${splinterlandsRefreshPrefix}:${section}:${account}`)
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Secondary),
  );
}

function claimButtons(account: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Claim SPS Rewards")
      .setStyle(ButtonStyle.Link)
      .setURL(buildSpsClaimUrl(account)),
    new ButtonBuilder()
      .setLabel("Claim Game Rewards")
      .setStyle(ButtonStyle.Link)
      .setURL(buildGameRewardsClaimUrl(account)),
  );
}

function basePlayerEmbed(player: SplinterlandsPlayer, titleSuffix: string, badges: string[]): EmbedBuilder {
  const displayName = player.displayName && player.displayName !== player.name ? ` (${player.displayName})` : "";
  const title = `${player.name}${displayName}`;
  const url = `https://splinterlands.com/@${encodeURIComponent(player.name)}`;

  return banjoEmbed()
    .setTitle(`Splinterlands ${titleSuffix}: ${title}`)
    .setURL(url)
    .setThumbnail(`https://images.hive.blog/u/${encodeURIComponent(player.name)}/avatar`)
    .setDescription(formatAccountSummary(player, badges))
    .setFooter({ text: "Splinterlands public API" });
}

function formatOverview(player: SplinterlandsPlayer, balances: SplinterlandsBalance[]): EmbedBuilder {
  const balanceSummary = formatBalances(balances);
  const fields = [
    dataField("Ranked", formatRuleset(player.ranked), false),
    dataField("Modern", formatRuleset(player.modern), false),
    dataField("Survival", formatRuleset(player.survival), false),
    dataField("Foundation", formatRuleset(player.foundation), false),
    dataField("Collection Power", formatInteger(player.collectionPower)),
    dataField("Capture Rate", formatPercent(player.captureRate)),
    dataField("Champion Points", formatInteger(player.championPoints)),
    dataField("Guild", player.guildName),
    dataField("Balances", balanceSummary, false),
  ].filter((field): field is NonNullable<typeof field> => field !== null);

  return basePlayerEmbed(player, "Overview", overviewBadges(player, balances)).addFields(fields);
}

function formatRewards(player: SplinterlandsPlayer, balances: SplinterlandsBalance[]): EmbedBuilder {
  const fields = [
    dataField("Balances", formatBalances(balances, rewardBalanceTokens), false),
    dataField("Capture Rate", formatPercent(player.captureRate)),
    dataField("Champion Points", formatInteger(player.championPoints)),
  ].filter((field): field is NonNullable<typeof field> => field !== null);

  return basePlayerEmbed(player, "Rewards", rewardsBadges(balances)).addFields(fields);
}

function formatCollection(player: SplinterlandsPlayer, collection: SplinterlandsCollectionCard[] | null | undefined, cardDetails: SplinterlandsCardDetail[]): EmbedBuilder {
  const embed = basePlayerEmbed(player, "Collection", collectionBadges(collection));

  if (collection === null || collection === undefined) {
    return embed.addFields({
      name: "Collection",
      value: "Collection summary is unavailable right now.",
      inline: false,
    });
  }

  const summary = summarizeCollection(collection, cardDetails);
  const fields = [
    dataField("Cards", formatInteger(summary.cardCount)),
    dataField("Unique Types", formatInteger(summary.uniqueTypes)),
    dataField("Collection Power", formatInteger(summary.collectionPower)),
    dataField("Gold Foils", formatInteger(summary.goldFoils)),
    dataField("Rented Out", formatInteger(summary.rented)),
    dataField("Delegated Out", formatInteger(summary.delegated)),
    dataField("Listed", formatInteger(summary.listed)),
    dataField("Land Staked", formatInteger(summary.landStaked)),
    dataField("Top Cards", summary.topCards.length > 0 ? summary.topCards.join("\n") : "No cards found.", false),
  ].filter((field): field is NonNullable<typeof field> => field !== null);

  return embed.addFields(fields);
}

function buildSpsClaimUrl(account: string): string {
  return buildCustomJsonUrl({
    account,
    authority: "active",
    id: "sm_claim_staking_rewards",
    json: {
      token: "SPS",
      app: `banjo-bot/${packageJson.version}`,
      n: randomNonce(),
    },
  });
}

function buildGameRewardsClaimUrl(account: string): string {
  return buildCustomJsonUrl({
    account,
    authority: "posting",
    id: "sm_claim_rewards",
    json: {
      app: `banjo-bot/${packageJson.version}`,
      n: randomNonce(),
    },
  });
}

function buildCustomJsonUrl({
  account,
  authority,
  id,
  json,
}: {
  account: string;
  authority: "active" | "posting";
  id: string;
  json: Record<string, string>;
}): string {
  const url = new URL("https://hivesigner.com/sign/custom-json");

  url.searchParams.set("authority", authority);
  url.searchParams.set("required_auths", JSON.stringify(authority === "active" ? [account] : []));
  url.searchParams.set("required_posting_auths", JSON.stringify(authority === "posting" ? [account] : []));
  url.searchParams.set("id", id);
  url.searchParams.set("json", JSON.stringify(json));

  return url.toString();
}

function randomNonce(): string {
  return randomBytes(12).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10);
}

function formatAccountSummary(player: SplinterlandsPlayer, badges: string[]): string {
  const lines = [
    badges.length > 0 ? badges.join(" | ") : null,
    player.joinDate ? `Joined ${formatDate(player.joinDate)}` : null,
  ].filter(Boolean);

  return lines.join("\n");
}

function overviewBadges(player: SplinterlandsPlayer, balances: SplinterlandsBalance[]): string[] {
  return [
    player.starterPackPurchase ? "Spellbook" : "No Spellbook",
    player.guildName ? "Guilded" : null,
    balanceValue(balances, "SPSP") || balanceValue(balances, "SPS") ? "SPS" : null,
    player.collectionPower && player.collectionPower > 0 ? "Collection" : null,
    player.isBanned ? "Banned" : null,
  ].filter((badge): badge is string => Boolean(badge));
}

function rewardsBadges(balances: SplinterlandsBalance[]): string[] {
  return [
    "SPS Claim",
    "Game Claim",
    balanceValue(balances, "ECR") !== null ? `ECR ${formatNumber(balanceValue(balances, "ECR")!, 2)}%` : null,
    balanceValue(balances, "FECR") !== null ? `FECR ${formatNumber(balanceValue(balances, "FECR")!, 2)}%` : null,
  ].filter((badge): badge is string => Boolean(badge));
}

function collectionBadges(collection: SplinterlandsCollectionCard[] | null | undefined): string[] {
  if (collection === null || collection === undefined) return ["Collection unavailable"];

  const summary = summarizeCollection(collection, []);
  return [
    `${formatInteger(summary.cardCount)} cards`,
    `${formatInteger(summary.uniqueTypes)} unique`,
    summary.goldFoils > 0 ? `${formatInteger(summary.goldFoils)} gold` : null,
    summary.landStaked > 0 ? `${formatInteger(summary.landStaked)} land-staked` : null,
  ].filter((badge): badge is string => Boolean(badge));
}

function balanceValue(balances: SplinterlandsBalance[], token: string): number | null {
  return balances.find((balance) => balance.token === token)?.balance ?? null;
}

function formatRuleset(stats: SplinterlandsRulesetStats): string | null {
  if (stats.battles === null && stats.rating === null && stats.league === null) return null;

  const winRate = stats.battles && stats.wins !== null ? ` (${formatPercent((stats.wins / stats.battles) * 100)} win rate)` : "";
  const rank = stats.maxRank && stats.maxRank > 0 ? `, best rank #${formatInteger(stats.maxRank)}` : "";
  const streak = stats.currentStreak && stats.currentStreak !== 0 ? `, streak ${formatInteger(stats.currentStreak)}` : "";

  return [
    `League: ${formatLeague(stats.league)}`,
    `Rating: ${formatInteger(stats.rating)}`,
    `Record: ${formatInteger(stats.wins)} / ${formatInteger(stats.battles)}${winRate}`,
    `Best: ${formatInteger(stats.maxRating)} rating${rank}${streak}`,
  ].join("\n");
}

function formatBalances(balances: SplinterlandsBalance[], tokens = displayedBalanceTokens): string | null {
  const byToken = new Map(balances.map((balance) => [balance.token, balance.balance]));
  const lines = tokens
    .map((token) => {
      const balance = byToken.get(token);
      if (balance === undefined || balance === null || balance === 0) return null;

      return `${token}: ${formatNumber(balance, balance >= 100 ? 0 : 3)}`;
    })
    .filter(Boolean);

  return lines.length > 0 ? lines.join("\n") : null;
}

function summarizeCollection(collection: SplinterlandsCollectionCard[], cardDetails: SplinterlandsCardDetail[]) {
  const details = new Map(cardDetails.map((detail) => [detail.id, detail]));
  const uniqueTypes = new Set(collection.map((card) => card.cardDetailId).filter((id): id is number => id !== null));
  const topCards = [...collection]
    .sort((left, right) => (right.collectionPower ?? 0) - (left.collectionPower ?? 0))
    .slice(0, 5)
    .map((card) => `${cardName(card, details)}: ${formatInteger(card.collectionPower)} CP`);

  return {
    cardCount: collection.length,
    uniqueTypes: uniqueTypes.size,
    collectionPower: collection.reduce((sum, card) => sum + (card.collectionPower ?? 0), 0),
    goldFoils: collection.filter((card) => card.gold || card.foil === 1).length,
    rented: collection.filter((card) => card.marketListingType === "RENT" && card.delegatedTo).length,
    delegated: collection.filter((card) => card.delegatedTo && card.marketListingType !== "RENT").length,
    listed: collection.filter((card) => card.marketId && !card.delegatedTo).length,
    landStaked: collection.filter((card) => card.stakeRefUid).length,
    topCards,
  };
}

function cardName(card: SplinterlandsCollectionCard, details: Map<number, SplinterlandsCardDetail>): string {
  if (card.cardDetailId === null) return card.uid ?? "Unknown card";

  return details.get(card.cardDetailId)?.name ?? `Card #${card.cardDetailId}`;
}

function formatLeague(value: number | null): string {
  if (value === null) return "n/a";

  return leagueNames[value] ?? `League ${value}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatPercent(value: number | null): string | null {
  if (value === null) return null;

  return `${formatNumber(value, 2)}%`;
}

function formatInteger(value: number | null): string {
  if (value === null) return "n/a";

  return formatNumber(value, 0);
}

function formatNumber(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value);
}
