import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder, type ButtonInteraction, type StringSelectMenuInteraction } from "discord.js";
import type { AppConfig } from "../config.js";
import { HiveRpcClient, type HiveAccount, type HiveApi, type HivePost, type HiveProposal } from "../hive/api.js";
import { type HiveSqlApi, type HiveSqlProposalPayments, type HiveSqlProposalTimelineEvent } from "../hivesql/api.js";
import { OpenAiHivePostSummarizer, type HivePostSummarizer } from "../llm/post-summary.js";
import type { Logger } from "../logger.js";
import { asEmbedResponse, banjoEmbed, truncateEmbedText } from "./embeds.js";
import type { Command } from "./types.js";
import { HIVE_TOKEN_ICON_URL, hiveApi, hiveSqlApi, configuredHistoryApi, historyProviderName, requireAccountName, pluralize, proposalPostPreview, parseHiveDate, truncateText, unknownAccount, formatRelativeTime, formatDuration, formatUtc, calculateHivePerMvest, parseAsset, parseHiveAssetAmount, formatNumber, formatInteger } from "./hive-shared.js";

export const approvalCommand: Command = {
  name: "approval",
  aliases: ["approve", "approved"],
  description: "Show Hive witness and proposal approvals for an account.",
  usage: "approval <account>",
  category: "hive",
  execute: async (context, args) => {
    const hive = hiveApi(context);
    const accountName = requireAccountName(args);
    const account = await hive.getAccount(accountName);
    if (!account) return unknownAccount(accountName);

    if (account.proxy) {
      return asEmbedResponse(formatApproval(account, [], "hive.fund"));
    }

    const [config, proposalVotes] = await Promise.all([
      hive.getConfig(),
      hive.listProposalVotes(account.name),
    ]);

    return asEmbedResponse(formatApproval(account, proposalVotes, config.HIVE_TREASURY_ACCOUNT ?? "hive.fund"));
  },
};

export const proposalCommand: Command = {
  name: "proposal",
  description: "Look up active Hive DHF proposals.",
  usage: "proposal [id|text]",
  category: "hive",
  execute: async (context, args) => {
    const hive = hiveApi(context);
    const hiveSql = hiveSqlApi(context);
    const query = args.join(" ").trim();
    const [config, globals, votableProposals, allProposals] = await Promise.all([
      hive.getConfig(),
      hive.getDynamicGlobalProperties(),
      hive.listProposals(),
      query ? hive.listProposals("all") : Promise.resolve([]),
    ]);
    const proposals = query ? allProposals : votableProposals;
    const treasuryAccount = config.HIVE_TREASURY_ACCOUNT ?? "hive.fund";
    const treasury = await hive.getAccount(treasuryAccount);
    const proposalFundPercent = (config.HIVE_PROPOSAL_FUND_PERCENT_HF21 ?? 0) / 100_000;
    const remainingDailyFund = parseAsset(treasury?.hbd_balance) * proposalFundPercent;
    const funding = calculateProposalFunding(votableProposals, treasuryAccount, remainingDailyFund);
    let matches = findProposals(proposals, query);
    if (matches.length === 0) matches = await findHistoricalProposals(hiveSql, query);

    if (matches.length === 0) {
      return `Proposal "${query}" not found.`;
    }

    const basePerMvest = calculateHivePerMvest(globals.total_vesting_fund_hive, globals.total_vesting_shares) ?? 0;
    const returnProposal = findReturnProposal(votableProposals, treasuryAccount);
    const selected = matches
      .sort((a, b) => parseProposalVotes(a) - parseProposalVotes(b))
      .slice(-10)
      .reverse();
    return formatProposalResponse({
      hive,
      selected,
      selectedIndex: 0,
      funding,
      basePerMvest,
      returnProposal,
      hiveSql,
    });
  },
};

const HIVE_HARDFORK_TIME = new Date("2020-03-20T14:00:00Z");

const proposalButtonPrefix = "proposal";

const proposalTxSelectId = "proposal-tx";

const proposalSummaryReplies = new Map<string, { delete(): Promise<unknown> }>();

const proposalResultCache = new Map<string, ProposalResultCacheEntry>();

type ProposalDetailsCacheEntry = {
  voterCount: number;
  payments: HiveSqlProposalPayments | null;
  timeline: HiveSqlProposalTimelineEvent[] | null;
  post: HivePost | null;
  providerName: string | null;
};

type ProposalResultCacheEntry = {
  selected: HiveProposal[];
  funding: Map<number, number>;
  basePerMvest: number;
  returnProposal: HiveProposal | null;
  details: Map<number, ProposalDetailsCacheEntry>;
  createdAt: number;
};

export async function handleProposalInteraction(interaction: ButtonInteraction | StringSelectMenuInteraction, config: AppConfig, logger: Logger): Promise<boolean> {
  if (interaction.isStringSelectMenu()) return handleProposalTxInteraction(interaction);

  const request = parseProposalButtonId(interaction.customId);
  if (!request) return false;

  const hive = new HiveRpcClient(config, logger);
  const hiveSql = configuredHistoryApi(config, logger);

  if (request.action === "summary") {
    await interaction.deferReply();
    await clearProposalSummaryReply(interaction);
    const response = await formatProposalSummaryResponse(request, hive, hiveSql, new OpenAiHivePostSummarizer(config, logger));
    await interaction.editReply(response);
    await rememberProposalSummaryReply(interaction);
    return true;
  }

  await interaction.deferUpdate();
  await clearProposalSummaryReply(interaction);
  await interaction.message.edit({ components: renderProposalLoadingComponents() }).catch(() => undefined);

  try {
    const cached = readProposalResultCache(proposalCacheKey(request.ids));
    if (cached) {
      await interaction.message.edit(await formatProposalResponse({
        hive,
        selected: cached.selected,
        selectedIndex: Math.min(request.selectedIndex, cached.selected.length - 1),
        funding: cached.funding,
        basePerMvest: cached.basePerMvest,
        returnProposal: cached.returnProposal,
        hiveSql,
      }));
      return true;
    }

    const [chainConfig, globals, votableProposals, allProposals] = await Promise.all([
      hive.getConfig(),
      hive.getDynamicGlobalProperties(),
      hive.listProposals(),
      hive.listProposals("all"),
    ]);
    const treasuryAccount = chainConfig.HIVE_TREASURY_ACCOUNT ?? "hive.fund";
    const treasury = await hive.getAccount(treasuryAccount);
    const proposalFundPercent = (chainConfig.HIVE_PROPOSAL_FUND_PERCENT_HF21 ?? 0) / 100_000;
    const funding = calculateProposalFunding(votableProposals, treasuryAccount, parseAsset(treasury?.hbd_balance) * proposalFundPercent);
    const basePerMvest = calculateHivePerMvest(globals.total_vesting_fund_hive, globals.total_vesting_shares) ?? 0;
    const returnProposal = findReturnProposal(votableProposals, treasuryAccount);
    const selected = await hydrateProposalIds(request.ids, allProposals, hiveSql);

    if (selected.length === 0) {
      await interaction.followUp({ content: "Unable to find those proposals anymore.", flags: MessageFlags.Ephemeral });
      return true;
    }

    await interaction.message.edit(await formatProposalResponse({
      hive,
      selected,
      selectedIndex: Math.min(request.selectedIndex, selected.length - 1),
      funding,
      basePerMvest,
      returnProposal,
      hiveSql,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("Proposal navigation failed.", { error: message });
    await interaction.message.edit({ components: renderProposalFallbackComponents(request.ids, request.selectedIndex) }).catch(() => undefined);
    await interaction.followUp({ content: "Unable to advance proposal navigation. Try that click again.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
  return true;
}

async function formatProposalSummaryResponse(
  request: { selectedIndex: number; ids: number[] },
  hive: HiveApi,
  hiveSql: HiveSqlApi | null,
  summarizer: HivePostSummarizer,
) {
  const cached = readProposalResultCache(proposalCacheKey(request.ids));
  if (!cached) return { content: "That proposal result cache expired. Run the proposal lookup again." };

  const proposal = cached.selected[Math.max(0, Math.min(request.selectedIndex, cached.selected.length - 1))];
  if (!proposal) return { content: "No cached proposal to summarize." };

  const details = await readProposalDetails(cached, proposal, hive, hiveSql);
  if (!details.post) return { content: `Unable to find discussion post @${proposal.creator}/${proposal.permlink} on Hive.` };

  const summary = await summarizer.summarizePost(details.post);
  if (!summary) return { content: "LLM summarization is not configured." };

  return { content: summary };
}

async function rememberProposalSummaryReply(interaction: ButtonInteraction): Promise<void> {
  const reply = await interaction.fetchReply().catch(() => null);
  if (reply && typeof (reply as { delete?: unknown }).delete === "function") {
    proposalSummaryReplies.set(interaction.message.id, reply as { delete(): Promise<unknown> });
  }
}

async function clearProposalSummaryReply(interaction: ButtonInteraction): Promise<void> {
  const reply = proposalSummaryReplies.get(interaction.message.id);
  if (!reply) return;

  proposalSummaryReplies.delete(interaction.message.id);
  await reply.delete().catch(() => undefined);
}

async function handleProposalTxInteraction(interaction: StringSelectMenuInteraction): Promise<boolean> {
  if (interaction.customId !== proposalTxSelectId) return false;

  const target = interaction.values[0];
  const url = proposalExplorerUrl(target);
  if (!url) {
    await interaction.reply({ content: "Unable to read that proposal transaction.", flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.reply({
    content: url,
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

function proposalExplorerUrl(value: string | undefined): string | null {
  if (!value) return null;
  const [kind, id, transactionIndex] = value.split(":");
  if (kind === "tx" && id && /^[0-9a-f]{40}$/i.test(id)) return `https://www.hivehub.dev/tx/${id}`;
  if (kind === "block" && id && /^\d+$/.test(id)) return `https://www.hivehub.dev/b/${id}`;
  if (kind === "blocktx" && id && /^\d+$/.test(id)) {
    return /^\d+$/.test(transactionIndex ?? "")
      ? `https://www.hivehub.dev/b/${id}#tx_idx_${transactionIndex}`
      : `https://www.hivehub.dev/b/${id}`;
  }
  return null;
}

function parseProposalButtonId(customId: string): { action: "page" | "summary"; selectedIndex: number; ids: number[] } | null {
  const parts = customId.split(":");
  const [prefix] = parts;
  if (prefix !== proposalButtonPrefix) return null;

  const action = parts[1] === "summary" ? "summary" : "page";
  const selectedIndexValue = action === "summary" ? parts[2] : parts[1];
  const idsValue = action === "summary" ? parts[3] : parts[2];
  if (!idsValue) return null;

  const selectedIndex = Number.parseInt(selectedIndexValue ?? "", 10);
  const ids = idsValue.split(",").map((value) => Number.parseInt(value, 10)).filter(Number.isFinite);
  if (!Number.isFinite(selectedIndex) || selectedIndex < 0 || ids.length === 0) return null;

  return { action, selectedIndex, ids };
}

function formatApproval(
  account: HiveAccount,
  proposalVotes: Array<{
    voter: string;
    proposal: {
      id?: number;
      proposal_id?: number;
      receiver: string;
      status: string;
      daily_pay: string | { amount: string; precision: number; nai: string };
    };
  }>,
  treasuryAccount: string,
): EmbedBuilder {
  const witnessVotes = readWitnessVotes(account.witness_votes);
  const embed = banjoEmbed()
    .setTitle(`Approved by ${account.name}`)
    .setURL(`https://hiveblocks.com/@${account.name}`)
    .setThumbnail(`https://images.hive.blog/u/${encodeURIComponent(account.name)}/avatar`)
    .setFooter({ text: "Hive governance", iconURL: HIVE_TOKEN_ICON_URL });

  if (account.proxy) {
    return embed.setDescription(`Proxied to: **${account.proxy}**`);
  }

  const active = new Map<string, number[]>();
  const inactive = new Map<string, number[]>();
  let activeDailyPay = 0;

  for (const vote of proposalVotes) {
    if (vote.voter !== account.name) continue;

    const proposalId = vote.proposal.id ?? vote.proposal.proposal_id;
    if (typeof proposalId !== "number") continue;

    const receiver = normalizeTreasuryReceiver(vote.proposal.receiver, treasuryAccount);
    if (vote.proposal.status === "active") {
      appendProposalId(active, receiver, proposalId);
      if (!isTreasuryLikeReceiver(receiver, treasuryAccount)) {
        activeDailyPay += parseHiveAssetAmount(vote.proposal.daily_pay);
      }
    } else if (vote.proposal.status === "inactive") {
      appendProposalId(inactive, receiver, proposalId);
    }
  }

  embed.addFields({
    name: `Witnesses (${witnessVotes.length})`,
    value: witnessVotes.length > 0 ? truncateEmbedText(witnessVotes.join(", "), 1024) : "None",
    inline: false,
  });

  const activeCount = countProposalIds(active);
  if (activeCount > 0) {
    embed.addFields(
      {
        name: `Proposals (${activeCount})`,
        value: formatProposalGroups(active),
        inline: false,
      },
      {
        name: "Proposal Pay Approved",
        value: `${formatNumber(activeDailyPay, 3)} HBD daily`,
        inline: true,
      },
    );
  } else {
    embed.addFields({ name: "Proposals", value: "None", inline: false });
  }

  const inactiveCount = countProposalIds(inactive);
  if (inactiveCount > 0) {
    embed.addFields({
      name: `Upcoming Proposals (${inactiveCount})`,
      value: formatProposalGroups(inactive),
      inline: false,
    });
  }

  return embed;
}

function readWitnessVotes(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function appendProposalId(groups: Map<string, number[]>, receiver: string, proposalId: number) {
  groups.set(receiver, [...(groups.get(receiver) ?? []), proposalId]);
}

function normalizeTreasuryReceiver(receiver: string, treasuryAccount: string): string {
  return receiver === "steem.dao" ? treasuryAccount : receiver;
}

function isTreasuryLikeReceiver(receiver: string, treasuryAccount: string): boolean {
  return receiver === "null" || receiver === "steem.dao" || receiver === "hive.fund" || receiver === treasuryAccount;
}

function countProposalIds(groups: Map<string, number[]>): number {
  return [...groups.values()].reduce((sum, ids) => sum + ids.length, 0);
}

function formatProposalGroups(groups: Map<string, number[]>): string {
  return truncateText([...groups.entries()].map(([receiver, ids]) => `${receiver} (${ids.join(", ")})`).join(", "), 500);
}

async function formatProposalResponse(options: {
  hive: HiveApi;
  hiveSql: HiveSqlApi | null;
  selected: HiveProposal[];
  selectedIndex: number;
  funding: Map<number, number>;
  basePerMvest: number;
  returnProposal: HiveProposal | null;
}) {
  const proposal = options.selected[options.selectedIndex];
  if (!proposal) return { embeds: [] };

  const cacheEntry = rememberProposalResultCache(options);
  const details = await readProposalDetails(cacheEntry, proposal, options.hive, options.hiveSql);

  return {
    embeds: [formatProposal(proposal, {
      approvedDailyPay: options.funding.get(proposalId(proposal)) ?? 0,
      basePerMvest: options.basePerMvest,
      returnProposal: options.returnProposal,
      voterCount: details.voterCount,
      payments: details.payments,
      timeline: details.timeline,
      post: details.post,
      providerName: details.providerName,
    })],
    components: renderProposalComponents(options.selected, options.selectedIndex, details.timeline),
  };
}

async function readProposalDetails(
  cacheEntry: ProposalResultCacheEntry,
  proposal: HiveProposal,
  hive: HiveApi,
  hiveSql: HiveSqlApi | null,
): Promise<ProposalDetailsCacheEntry> {
  const id = proposalId(proposal);
  const cached = cacheEntry.details.get(id);
  const providerName = hiveSql ? historyProviderName(hiveSql) : null;
  if (cached && cached.providerName === providerName) return cached;

  const [voters, post, timeline, payments] = await Promise.all([
    hive.listProposalVotesByProposal(id),
    hive.getPostCreation(proposal.creator, proposal.permlink),
    hiveSql ? readProposalTimeline(hiveSql, id) : Promise.resolve(null),
    hiveSql ? readProposalPayments(hiveSql, id) : Promise.resolve(null),
  ]);
  const details = {
    voterCount: new Set(voters.map((vote) => vote.voter)).size,
    payments,
    timeline,
    post,
    providerName,
  };

  cacheEntry.details.set(id, details);
  return details;
}

function rememberProposalResultCache(options: {
  selected: HiveProposal[];
  funding: Map<number, number>;
  basePerMvest: number;
  returnProposal: HiveProposal | null;
}): ProposalResultCacheEntry {
  const now = Date.now();
  for (const [key, cached] of proposalResultCache.entries()) {
    if (now - cached.createdAt > 10 * 60 * 1000) proposalResultCache.delete(key);
  }

  const key = proposalCacheKey(options.selected.map((proposal) => proposalId(proposal)));
  const existing = proposalResultCache.get(key);
  if (existing) return existing;

  const entry = {
    selected: options.selected,
    funding: options.funding,
    basePerMvest: options.basePerMvest,
    returnProposal: options.returnProposal,
    details: new Map<number, ProposalDetailsCacheEntry>(),
    createdAt: now,
  };
  proposalResultCache.set(key, entry);
  return entry;
}

function readProposalResultCache(key: string): ProposalResultCacheEntry | null {
  const cached = proposalResultCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > 10 * 60 * 1000) {
    proposalResultCache.delete(key);
    return null;
  }

  return cached;
}

function proposalCacheKey(ids: number[]): string {
  return ids.join(",");
}

async function readProposalPayments(hiveSql: HiveSqlApi, proposalId: number): Promise<HiveSqlProposalPayments | null> {
  try {
    return await hiveSql.getProposalPayments(proposalId);
  } catch {
    return null;
  }
}

async function readProposalTimeline(hiveSql: HiveSqlApi, proposalId: number): Promise<HiveSqlProposalTimelineEvent[] | null> {
  try {
    return await hiveSql.getProposalTimeline(proposalId);
  } catch {
    return null;
  }
}

async function readProposalById(hiveSql: HiveSqlApi | null, proposalId: number): Promise<HiveProposal | null> {
  if (!hiveSql?.getProposalById) return null;

  try {
    return await hiveSql.getProposalById(proposalId);
  } catch {
    return null;
  }
}

function findProposals(proposals: HiveProposal[], query: string): HiveProposal[] {
  const normalized = query.toLowerCase();
  if (parseWholeNumber(query) !== null) {
    return proposals.filter((proposal) => String(proposalId(proposal)) === query);
  }

  return proposals.filter((proposal) => {
    if (!normalized) return true;
    return [
      String(proposalId(proposal)),
      proposal.creator,
      proposal.receiver,
      proposal.subject,
      proposal.permlink,
    ].some((value) => value.toLowerCase().includes(normalized));
  });
}

async function findHistoricalProposals(hiveSql: HiveSqlApi | null, query: string): Promise<HiveProposal[]> {
  const id = parseWholeNumber(query);
  if (!hiveSql || id === null) return [];

  const proposal = await readProposalById(hiveSql, id);
  return proposal ? [proposal] : [];
}

async function hydrateProposalIds(ids: number[], proposals: HiveProposal[], hiveSql: HiveSqlApi | null): Promise<HiveProposal[]> {
  const selected: HiveProposal[] = [];

  for (const id of ids) {
    const proposal = proposals.find((item) => proposalId(item) === id) ?? await readProposalById(hiveSql, id);
    if (proposal) selected.push(proposal);
  }

  return selected;
}

function parseWholeNumber(value: string): number | null {
  if (!value || Number.parseInt(value, 10).toString() !== value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function calculateProposalFunding(
  proposals: HiveProposal[],
  treasuryAccount: string,
  initialDailyFund: number,
): Map<number, number> {
  const funding = new Map<number, number>();
  let remainingDailyFund = initialDailyFund;

  for (const proposal of proposalsByVotes(proposals)) {
    const startDate = parseHiveDate(proposal.start_date);
    const requestedDailyPay = parseHiveAssetAmount(proposal.daily_pay);
    const approvedDailyPay = startDate.getTime() > Date.now()
      ? 0
      : Math.min(Math.max(remainingDailyFund, 0), requestedDailyPay);

    funding.set(proposalId(proposal), approvedDailyPay);
    remainingDailyFund -= approvedDailyPay;
  }

  return funding;
}

function findReturnProposal(proposals: HiveProposal[], treasuryAccount: string): HiveProposal | null {
  return proposalsByVotes(proposals)
    .filter((proposal) => proposal.receiver === "steem.dao" || proposal.receiver === treasuryAccount)
    .at(-1) ?? null;
}

function proposalsByVotes(proposals: HiveProposal[]): HiveProposal[] {
  return [...proposals].sort((a, b) => parseProposalVotes(b) - parseProposalVotes(a));
}

function formatProposal(
  proposal: HiveProposal,
  context: {
    approvedDailyPay: number;
    basePerMvest: number;
    returnProposal: HiveProposal | null;
    voterCount: number;
    payments: HiveSqlProposalPayments | null;
    timeline: HiveSqlProposalTimelineEvent[] | null;
    post: HivePost | null;
    providerName: string | null;
  },
): EmbedBuilder {
  const startDate = parseHiveDate(proposal.start_date);
  const endDate = parseHiveDate(proposal.end_date);
  const days = Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));
  const daysRemaining = Math.max(0, Math.floor((endDate.getTime() - Math.max(Date.now(), startDate.getTime())) / (24 * 60 * 60 * 1000)));
  const dailyPay = parseHiveAssetAmount(proposal.daily_pay);
  const dailyPaySymbol = assetSymbol(proposal.daily_pay) ?? "HBD";
  const totalVotesMhp = proposalVotesMhp(proposal, context.basePerMvest);
  const returnVotesMhp = context.returnProposal ? proposalVotesMhp(context.returnProposal, context.basePerMvest) : 0;
  const approvalPercent = returnVotesMhp > 0 ? (totalVotesMhp / returnVotesMhp) * 100 : 0;
  const votesApproved = context.returnProposal ? parseProposalVotes(proposal) >= parseProposalVotes(context.returnProposal) : false;
  const postPreview = proposalPostPreview(context.post);
  const hasRecordedPayments = Boolean(context.payments && context.payments.count > 0);
  const totalRequested = dailyPay * days;
  const fundingStatus = proposalFundingStatus({
    votesApproved,
    approvedDailyPay: context.approvedDailyPay,
    dailyPay,
    endDate,
    payments: context.payments,
  });
  const listedSchedulePay = `${formatNumber(totalRequested, 0)} ${dailyPaySymbol}`;
  const actualPaid = hasRecordedPayments && context.payments
    ? `${formatNumber(context.payments.total, 3)} ${context.payments.symbol}${context.payments.count > 0 ? ` across ${formatInteger(context.payments.count)} payments` : ""}`
    : null;
  const maxRequested = proposalMaxRequestedPay(proposal.daily_pay, startDate, endDate, context.timeline);
  const paymentResult = proposalPaymentResultSummary(startDate, endDate, context.payments, maxRequested);
  const paymentCoverage = proposalPaymentCoverageSummary(startDate, endDate, context.payments, maxRequested);
  const hiveForkIndicator = proposalHiveForkIndicator(context.payments);
  const timeline = proposalTimelineCodeBlock(proposal, startDate, endDate, context.timeline, context.payments);
  const partialDailyPay = votesApproved && context.approvedDailyPay !== 0 && context.approvedDailyPay < dailyPay
    ? `${formatNumber(context.approvedDailyPay, 3)} ${dailyPaySymbol}`
    : null;
  const embed = banjoEmbed()
    .setTitle(`Proposal #${proposalId(proposal)}: ${proposal.subject}`)
    .setURL(`https://peakd.com/proposals/${proposalId(proposal)}`)
    .setFooter({ text: proposalFooterText(context.payments, context.timeline, context.providerName), iconURL: HIVE_TOKEN_ICON_URL });

  embed.setDescription([
    proposal.status ? `**Status:** ${capitalizeWord(proposal.status)}` : null,
    paymentResult ? `**Payment Result:** ${paymentResult}` : null,
    paymentCoverage ? `**Payment Coverage:** ${paymentCoverage}` : null,
    `**Current Votes vs Sweep:** ${votesApproved ? "Above sweep" : "Below sweep"} (${formatNumber(approvalPercent, 2)}%)`,
    fundingStatus ? `**Live Funding:** ${fundingStatus}` : null,
    `**Discussion:** [${proposal.creator}/${proposal.permlink}](https://peakd.com/@${proposal.creator}/${proposal.permlink})`,
    proposalMetricTable({
      proposal,
      startDate,
      endDate,
      days,
      daysRemaining,
      dailyPay,
      dailyPaySymbol,
      totalVotesMhp,
      voterCount: context.voterCount,
    }),
    timeline,
    !paymentResult && actualPaid ? `**Actual Paid:** ${actualPaid}` : null,
    !paymentResult && maxRequested ? `**Max Requested:** ${maxRequested.text}` : null,
    hasRecordedPayments || maxRequested ? null : `**Listed Schedule Pay:** ${listedSchedulePay}`,
    hiveForkIndicator ? `**Hive Hardfork:** ${hiveForkIndicator}` : null,
    partialDailyPay ? `**Partial Daily Pay:** ${partialDailyPay}` : null,
    postPreview.description,
  ].filter(Boolean).join("\n\n"));
  if (postPreview.image) embed.setImage(postPreview.image);

  return embed;
}

function proposalMaxRequestedPay(
  fallback: HiveProposal["daily_pay"],
  startDate: Date,
  endDate: Date,
  timeline: HiveSqlProposalTimelineEvent[] | null,
): { total: number; expectedPayments: number; symbol: string; text: string } | null {
  const segments = proposalPaySegments(fallback, startDate, endDate, timeline);
  const total = segments.reduce((sum, segment) => sum + segment.amount * segment.hours / 24, 0);
  const expectedPayments = segments.reduce((sum, segment) => sum + segment.hours, 0);
  const symbol = segments.find((segment) => segment.amount > 0)?.symbol ?? assetSymbol(fallback) ?? "HBD";

  return expectedPayments > 0
    ? {
        total,
        expectedPayments,
        symbol,
        text: `${formatNumber(total, 3)} ${symbol} across ${formatInteger(expectedPayments)} expected payments`,
      }
    : null;
}

function proposalPaymentResultSummary(
  startDate: Date,
  endDate: Date,
  payments: HiveSqlProposalPayments | null,
  requested: { total: number; expectedPayments: number; symbol: string; text: string } | null,
): string | null {
  if (!payments?.count) {
    if (requested && endDate.getTime() < Date.now()) {
      return `0 / ${formatNumber(requested.total, 3)} ${requested.symbol} paid; 0.00%; 0 / ${formatInteger(requested.expectedPayments)} expected payments`;
    }
    if (requested && startDate.getTime() <= Date.now()) {
      return `0 paid so far; requested up to ${requested.text}`;
    }
    return requested ? `Requested up to ${requested.text}` : null;
  }

  if (requested && requested.symbol === payments.symbol && requested.total > 0) {
    return [
      `${formatNumber(payments.total, 3)} / ${formatNumber(requested.total, 3)} ${payments.symbol} paid`,
      `${formatNumber(payments.total / requested.total * 100, 2)}%`,
      requested.expectedPayments > 0 ? `${formatInteger(payments.count)} / ${formatInteger(requested.expectedPayments)} expected payments` : null,
    ].filter(Boolean).join("; ");
  }

  return `${formatNumber(payments.total, 3)} ${payments.symbol} paid across ${formatInteger(payments.count)} payments`;
}

function proposalFooterText(
  payments: HiveSqlProposalPayments | null,
  timeline: HiveSqlProposalTimelineEvent[] | null,
  providerName: string | null,
): string {
  return payments || timeline ? `Hive DHF Proposal | Hive RPC + ${providerName ?? "HiveSQL"}` : "Hive DHF Proposal | Hive RPC";
}

function proposalPaymentCoverageSummary(
  startDate: Date,
  endDate: Date,
  payments: HiveSqlProposalPayments | null,
  requested: { total: number; expectedPayments: number; symbol: string; text: string } | null,
): string | null {
  if (!payments?.count || !payments.firstPaidAt || !payments.lastPaidAt) return null;

  const runs = proposalPaymentRunsInSchedule(startDate, endDate, payments);
  const firstRun = runs[0];
  const lastRun = runs.at(-1);
  const parts = [
    runs.length > 0 ? pluralize(runs.length, "pay-active run") : null,
    requested?.expectedPayments ? `${formatInteger(payments.count)} / ${formatInteger(requested.expectedPayments)} expected payments` : null,
  ];

  if (firstRun) {
    const delaySeconds = Math.floor((firstRun.startedAt.getTime() - startDate.getTime()) / 1000);
    parts.push(delaySeconds >= 60 * 60 ? `first paid ${formatDuration(delaySeconds)} after start` : "paid from scheduled start");
  }

  if (runs.length > 1) {
    const largestGapSeconds = largestProposalPaymentRunGapSeconds(runs);
    if (largestGapSeconds >= 2 * 60 * 60) parts.push(`largest gap ${formatDuration(largestGapSeconds)}`);
  }

  if (lastRun) {
    const earlySeconds = Math.floor((endDate.getTime() - lastRun.endedAt.getTime()) / 1000);
    parts.push(earlySeconds >= 2 * 60 * 60 ? `last paid ${formatDuration(earlySeconds)} before end` : "paid through scheduled end");
  }

  return parts.filter(Boolean).join("; ") || null;
}

function largestProposalPaymentRunGapSeconds(runs: Array<{ startedAt: Date; endedAt: Date }>): number {
  return runs.slice(1).reduce((largest, run, index) => {
    const previous = runs[index];
    if (!previous) return largest;
    const seconds = Math.floor((run.startedAt.getTime() - previous.endedAt.getTime()) / 1000);
    return Math.max(largest, seconds);
  }, 0);
}

function proposalPaySegments(
  fallback: HiveProposal["daily_pay"],
  startDate: Date,
  endDate: Date,
  timeline: HiveSqlProposalTimelineEvent[] | null,
): Array<{ amount: number; symbol: string; hours: number }> {
  const startPay = proposalDailyPayAt(startDate, fallback, timeline);
  const changePoints = [
    {
      timestamp: startDate,
      amount: startPay.amount,
      symbol: startPay.symbol,
    },
    ...(timeline ?? [])
      .filter((event) => event.dailyPay !== null && event.timestamp.getTime() > startDate.getTime() && event.timestamp.getTime() < endDate.getTime())
      .map((event) => ({
        timestamp: event.timestamp,
        amount: event.dailyPay ?? 0,
        symbol: event.symbol,
      })),
  ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return changePoints.map((point, index) => {
    const next = changePoints[index + 1]?.timestamp ?? endDate;
    return {
      amount: point.amount,
      symbol: point.symbol,
      hours: Math.max(0, Math.ceil((next.getTime() - point.timestamp.getTime()) / (60 * 60 * 1000))),
    };
  }).filter((segment) => segment.hours > 0 && segment.amount > 0);
}

function proposalTimelineCodeBlock(
  proposal: HiveProposal,
  startDate: Date,
  endDate: Date,
  timeline: HiveSqlProposalTimelineEvent[] | null,
  payments: HiveSqlProposalPayments | null,
): string {
  const startDailyPay = proposalDailyPayAt(startDate, proposal.daily_pay, timeline);
  const rows: Array<{ date: Date; label: string; detail: string }> = [
    { date: startDate, label: "Starts", detail: `${formatNumber(startDailyPay.amount, 3)} ${startDailyPay.symbol} / day` },
    { date: endDate, label: "Ends", detail: "" },
  ];

  for (const event of timeline ?? []) {
    rows.push({
      date: event.timestamp,
      label: event.kind === "created" ? "Created" : "Updated",
      detail: proposalTimelineEventDetail(event),
    });
  }
  rows.push(...proposalPaymentTimelineRows(startDate, endDate, payments));

  rows.sort((a, b) => a.date.getTime() - b.date.getTime() || a.label.localeCompare(b.label));

  const labelWidth = Math.max(...rows.map((row) => row.label.length));
  return [
    "**Timeline:**",
    "```",
    ...rows.map((row) => [
      formatUtcDate(row.date),
      row.label.padEnd(labelWidth),
      row.detail,
    ].filter(Boolean).join("  ").trimEnd()),
    "```",
  ].join("\n");
}

function proposalPaymentTimelineRows(
  startDate: Date,
  endDate: Date,
  payments: HiveSqlProposalPayments | null,
): Array<{ date: Date; label: string; detail: string }> {
  if (!payments?.count || !payments.firstPaidAt || !payments.lastPaidAt) return [];

  const runs = proposalPaymentRunsInSchedule(startDate, endDate, payments);
  if (runs.length > 8) return compactProposalPaymentTimelineRows(startDate, endDate, runs);

  const rows: Array<{ date: Date; label: string; detail: string }> = [];
  for (const [index, run] of runs.entries()) {
    const previousRun = runs[index - 1];
    const nextRun = runs[index + 1];
    const detail = proposalPaymentRunDetail(run, proposalPaymentRunStartDetail(startDate, previousRun?.endedAt ?? null, run.startedAt));

    rows.push({
      date: run.startedAt,
      label: runs.length === 1 ? "Paid" : "Pay active",
      detail,
    });

    const inactiveDetail = nextRun
      ? proposalPaymentInactiveDetail(run.endedAt, nextRun.startedAt, "gap")
      : proposalFinalPaymentInactiveDetail(run.endedAt, endDate);
    if (inactiveDetail) {
      rows.push({
        date: run.endedAt,
        label: "Pay inactive",
        detail: inactiveDetail,
      });
    }
  }

  return rows;
}

function compactProposalPaymentTimelineRows(
  startDate: Date,
  endDate: Date,
  runs: Array<{ startedAt: Date; endedAt: Date; total: number; count: number; symbol: string }>,
): Array<{ date: Date; label: string; detail: string }> {
  const visibleStart = runs.slice(0, 3);
  const visibleEnd = runs.slice(-3);
  const omitted = Math.max(0, runs.length - visibleStart.length - visibleEnd.length);
  const rows: Array<{ date: Date; label: string; detail: string }> = [];

  for (const [index, run] of visibleStart.entries()) {
    rows.push({
      date: run.startedAt,
      label: "Pay active",
      detail: proposalPaymentRunDetail(run, proposalPaymentRunStartDetail(startDate, visibleStart[index - 1]?.endedAt ?? null, run.startedAt)),
    });
  }

  if (omitted > 0) {
    const largestGapSeconds = largestProposalPaymentRunGapSeconds(runs);
    rows.push({
      date: visibleStart.at(-1)?.endedAt ?? runs[0]?.endedAt ?? startDate,
      label: "Pay runs",
      detail: `${formatInteger(omitted)} middle pay-active runs omitted${largestGapSeconds >= 2 * 60 * 60 ? `; largest gap ${formatDuration(largestGapSeconds)}` : ""}`,
    });
  }

  for (const [index, run] of visibleEnd.entries()) {
    const previousRun = index === 0 ? runs[runs.length - visibleEnd.length - 1] : visibleEnd[index - 1];
    rows.push({
      date: run.startedAt,
      label: "Pay active",
      detail: proposalPaymentRunDetail(run, proposalPaymentRunStartDetail(startDate, previousRun?.endedAt ?? null, run.startedAt)),
    });
  }

  const lastRun = runs.at(-1);
  if (lastRun) {
    const inactiveDetail = proposalFinalPaymentInactiveDetail(lastRun.endedAt, endDate);
    if (inactiveDetail) {
      rows.push({
        date: lastRun.endedAt,
        label: "Pay inactive",
        detail: inactiveDetail,
      });
    }
  }

  return rows;
}

function proposalPaymentRunDetail(
  run: { total: number; count: number; symbol: string },
  startDetail: string | null,
): string {
  return [
    `${formatInteger(run.count)} payments, ${formatNumber(run.total, 3)} ${run.symbol}`,
    startDetail,
  ].filter(Boolean).join(" | ");
}

function proposalPaymentRunsInSchedule(
  startDate: Date,
  endDate: Date,
  payments: HiveSqlProposalPayments,
): Array<{ startedAt: Date; endedAt: Date; total: number; count: number; symbol: string }> {
  return ((payments.runs ?? []).length > 0
    ? payments.runs
    : [{
        startedAt: payments.firstPaidAt ?? startDate,
        endedAt: payments.lastPaidAt ?? endDate,
        total: payments.total,
        count: payments.count,
        symbol: payments.symbol,
      }]).filter((run) => run.endedAt.getTime() >= startDate.getTime() && run.startedAt.getTime() <= endDate.getTime());
}

function proposalPaymentRunStartDetail(startDate: Date, previousRunEnd: Date | null, runStart: Date): string | null {
  const reference = previousRunEnd ?? startDate;
  const seconds = Math.floor((runStart.getTime() - reference.getTime()) / 1000);
  if (seconds < 60 * 60) return null;

  return previousRunEnd
    ? `after ${formatDuration(seconds)} gap`
    : `${formatDuration(seconds)} after start`;
}

function proposalPaymentInactiveDetail(runEnd: Date, nextDate: Date, suffix: "gap" | "before end"): string | null {
  const seconds = Math.floor((nextDate.getTime() - runEnd.getTime()) / 1000);
  if (seconds < 2 * 60 * 60) return null;

  return `${formatDuration(seconds)} ${suffix}`;
}

function proposalFinalPaymentInactiveDetail(runEnd: Date, endDate: Date, now = new Date()): string | null {
  const comparisonDate = endDate.getTime() <= now.getTime() ? endDate : now;
  const seconds = Math.floor((comparisonDate.getTime() - runEnd.getTime()) / 1000);
  if (seconds < 2 * 60 * 60) return null;

  return endDate.getTime() <= now.getTime()
    ? `${formatDuration(seconds)} before end`
    : `${formatDuration(seconds)} since last payment`;
}

function proposalDailyPayAt(
  date: Date,
  fallback: HiveProposal["daily_pay"],
  timeline: HiveSqlProposalTimelineEvent[] | null,
): { amount: number; symbol: string } {
  const fallbackPay = {
    amount: parseHiveAssetAmount(fallback),
    symbol: assetSymbol(fallback) ?? "HBD",
  };
  const event = (timeline ?? [])
    .filter((item) => item.dailyPay !== null && item.timestamp.getTime() <= date.getTime())
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .at(0);

  return event?.dailyPay === null || event?.dailyPay === undefined
    ? fallbackPay
    : { amount: event.dailyPay, symbol: event.symbol };
}

function proposalTimelineEventDetail(event: HiveSqlProposalTimelineEvent): string {
  return [
    event.dailyPay === null ? null : `${formatNumber(event.dailyPay, 3)} ${event.symbol} / day`,
    event.subject ? truncateText(event.subject, 48) : null,
    event.permlink ? truncateText(event.permlink, 48) : null,
  ].filter(Boolean).join(" | ");
}

function proposalFundingStatus(options: {
  votesApproved: boolean;
  approvedDailyPay: number;
  dailyPay: number;
  endDate: Date;
  payments: HiveSqlProposalPayments | null;
}): string | null {
  if (!options.votesApproved) return null;

  if (options.payments && options.payments.count > 0) return null;

  if (options.endDate.getTime() < Date.now()) return null;

  if (options.approvedDailyPay === 0) return "Not pay active";
  if (options.approvedDailyPay < options.dailyPay) return "Not fully funded";

  return null;
}

function proposalHiveForkIndicator(payments: HiveSqlProposalPayments | null): string | null {
  if (payments?.count && payments.firstPaidAt && payments.lastPaidAt) {
    if (payments.lastPaidAt.getTime() < HIVE_HARDFORK_TIME.getTime()) {
      return `paid before Hive launch (${formatUtcDateTime(HIVE_HARDFORK_TIME)})`;
    }
    if (payments.firstPaidAt.getTime() < HIVE_HARDFORK_TIME.getTime()) {
      return `paid across Hive launch (${formatUtcDateTime(HIVE_HARDFORK_TIME)})`;
    }
  }

  return null;
}

function proposalMetricTable(options: {
  proposal: HiveProposal;
  startDate: Date;
  endDate: Date;
  days: number;
  daysRemaining: number;
  dailyPay: number;
  dailyPaySymbol: string;
  totalVotesMhp: number;
  voterCount: number;
}): string {
  const rows = [
    ["Creator", "Receiver"],
    [`@${options.proposal.creator}`, `@${options.proposal.receiver}`],
    ["Start", "End"],
    [formatRelativeTime(options.startDate), formatRelativeTime(options.endDate)],
    ["Days", "Daily Pay"],
    [`${formatInteger(options.days - options.daysRemaining)} of ${formatInteger(options.days)}`, `${formatNumber(options.dailyPay, 3)} ${options.dailyPaySymbol}`],
    ["Total Votes (HP)", "Voters"],
    [`${formatNumber(options.totalVotesMhp, 1)}M`, formatInteger(options.voterCount)],
  ];
  const leftWidth = Math.max(...rows.map((row) => row[0]?.length ?? 0));
  return [
    "```",
    ...rows.map(([left, right]) => `${(left ?? "").padEnd(leftWidth)}  ${right ?? ""}`),
    "```",
  ].join("\n");
}

function renderProposalComponents(
  selected: HiveProposal[],
  selectedIndex: number,
  timeline: HiveSqlProposalTimelineEvent[] | null,
): Array<ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>> {
  const ids = selected.map((proposal) => proposalId(proposal));
  const rows: Array<ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>> = [];

  if (selected.length > 0) {
    const buttons: ButtonBuilder[] = [];
    if (selected.length > 1) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(proposalButtonId(ids, selectedIndex - 1))
          .setLabel("Previous")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(selectedIndex === 0),
      );
    }

    buttons.push(
      new ButtonBuilder()
        .setCustomId(proposalSummaryButtonId(ids, selectedIndex))
        .setLabel("Summarize")
        .setStyle(ButtonStyle.Primary),
    );

    if (selected.length > 1) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(proposalButtonId(ids, selectedIndex + 1))
          .setLabel("Next")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(selectedIndex >= selected.length - 1),
      );
    }

    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...buttons,
    ));
  }

  const txSelect = renderProposalTxSelect(timeline);
  if (txSelect) rows.push(txSelect);

  return rows;
}

function renderProposalLoadingComponents(): Array<ActionRowBuilder<ButtonBuilder>> {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${proposalButtonPrefix}:loading`)
        .setLabel("Loading...")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    ),
  ];
}

function renderProposalFallbackComponents(ids: number[], selectedIndex: number): Array<ActionRowBuilder<ButtonBuilder>> {
  if (ids.length <= 1) return [];
  const index = Math.max(0, Math.min(selectedIndex, ids.length - 1));

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(proposalButtonId(ids, index - 1))
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(index === 0),
      new ButtonBuilder()
        .setCustomId(proposalButtonId(ids, index + 1))
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(index >= ids.length - 1),
    ),
  ];
}

function renderProposalTxSelect(timeline: HiveSqlProposalTimelineEvent[] | null): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const events = (timeline ?? []).filter(proposalTimelineExplorerTarget).slice(0, 25);
  if (events.length === 0) return null;

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(proposalTxSelectId)
      .setPlaceholder("View timeline transaction")
      .addOptions(events.map((event, index) => ({
        label: truncateText(`${formatUtcDate(event.timestamp)} ${event.kind === "created" ? "Created" : "Updated"}`, 100),
        description: truncateText(proposalTimelineEventDetail(event) || `Transaction ${event.txId}`, 100),
        value: proposalTimelineExplorerTarget(event) ?? String(index),
      }))),
  );
}

function proposalTimelineExplorerTarget(event: HiveSqlProposalTimelineEvent): string | null {
  if (event.txId && /^[0-9a-f]{40}$/i.test(event.txId)) return `tx:${event.txId}`;
  if (
    typeof event.blockNum === "number"
    && Number.isFinite(event.blockNum)
    && typeof event.transactionNum === "number"
    && Number.isFinite(event.transactionNum)
  ) {
    return `blocktx:${event.blockNum}:${event.transactionNum}`;
  }
  if (typeof event.blockNum === "number" && Number.isFinite(event.blockNum)) return `block:${event.blockNum}`;
  return null;
}

function proposalButtonId(ids: number[], selectedIndex: number): string {
  return [proposalButtonPrefix, Math.max(0, selectedIndex), ids.join(",")].join(":");
}

function proposalSummaryButtonId(ids: number[], selectedIndex: number): string {
  return [proposalButtonPrefix, "summary", Math.max(0, selectedIndex), ids.join(",")].join(":");
}

function proposalId(proposal: HiveProposal): number {
  return proposal.proposal_id ?? proposal.id ?? 0;
}

function parseProposalVotes(proposal: HiveProposal): number {
  const votes = typeof proposal.total_votes === "number"
    ? proposal.total_votes
    : Number.parseFloat(proposal.total_votes);
  return Number.isFinite(votes) ? votes : 0;
}

function proposalVotesMhp(proposal: HiveProposal, basePerMvest: number): number {
  return (((parseProposalVotes(proposal) / 1_000_000) * basePerMvest) / 1_000_000) / 1_000_000;
}

function assetSymbol(value: string | { nai: string } | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.split(" ").at(-1) ?? null;
  if (value.nai === "@@000000013") return "HBD";
  if (value.nai === "@@000000021") return "HIVE";
  if (value.nai === "@@000000037") return "VESTS";
  return null;
}

function capitalizeWord(value: string): string {
  return value ? `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` : value;
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatUtcDateTime(date: Date): string {
  return `${formatUtc(date)} UTC`;
}
