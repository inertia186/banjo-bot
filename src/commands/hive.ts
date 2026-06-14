import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder, type ButtonInteraction, type Message, type StringSelectMenuInteraction } from "discord.js";
import type { AppConfig } from "../config.js";
import { HiveRpcClient, type HiveAccount, type HiveAccountOperation, type HiveApi, type HiveCommunity, type HiveDynamicGlobalProperties, type HiveFeedHistory, type HiveMarketTicker, type HivePost, type HiveProposal, type HiveRewardOperation, type HiveWitness } from "../hive/api.js";
import { HiveEngineRpcClient, type HiveEngineApi, type HiveEngineBalance, type HiveEngineBuyOrder, type HiveEngineMarketMetrics, type HiveEngineNft, type HiveEngineToken, type HiveEngineTrade, type NftShowroomArt } from "../hive-engine/api.js";
import { ScotHttpClient, type ScotAccountHistoryEntry, type ScotApi, type ScotConfigEntry, type ScotDiscussion } from "../hive-engine/scot.js";
import { HiveDeveloperNodeDirectory, type HiveNode, type HiveNodeDirectory } from "../hive/nodes.js";
import { HafSqlClient } from "../hafsql/api.js";
import { HiveSqlClient, type HiveSqlApi, type HiveSqlAppPayout, type HiveSqlBadge, type HiveSqlBadgeStats, type HiveSqlDistributionBucket, type HiveSqlDistributionSummary, type HiveSqlPromotedSummary, type HiveSqlProposalPayments, type HiveSqlProposalTimelineEvent, type HiveSqlSearchComment, type HiveSqlSearchOptions, type HiveSqlSearchResult, type HiveSqlTopKind, type HiveSqlTopPost, type HiveSqlTopPostOptions } from "../hivesql/api.js";
import { OpenAiHivePostSummarizer, type HivePostSummarizer } from "../llm/post-summary.js";
import { CoinGeckoMarketClient, type FearGreedIndex, type MarketApi, type MarketTicker } from "../market/api.js";
import type { Logger } from "../logger.js";
import { asEmbedResponse, banjoEmbed, dataField, truncateEmbedText } from "./embeds.js";
import type { Command, CommandContext } from "./types.js";

const HIVE_TOKEN_ICON_URL = "https://assets.coingecko.com/coins/images/10840/standard/logo_transparent_4x.png";
const HIVE_HARDFORK_TIME = new Date("2020-03-20T14:00:00Z");
const WRAPPED_TOKEN_SYMBOLS = new Set(["STEEM", "SBD", "BTC", "LTC"]);
const nftsrButtonPrefix = "nftsr";
const nftsrNoAccount = "~";
const proposalButtonPrefix = "proposal";
const proposalTxSelectId = "proposal-tx";
const proposalSummaryReplies = new Map<string, { delete(): Promise<unknown> }>();
const searchButtonPrefix = "search";
const searchResultCache = new Map<string, { options: HiveSqlSearchOptions; result: HiveSqlSearchResult; posts: Map<string, HivePost | null>; createdAt: number }>();
const searchSummaryReplies = new Map<string, { delete(): Promise<unknown> }>();
let searchResultCacheCounter = 0;
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

export const hiveCommands: Command[] = [
  {
    name: "rep",
    description: "Look up a Hive account reputation score.",
    usage: "rep <account>",
    category: "hive",
    execute: async (context, args) => {
      const accountName = requireAccountName(args);
      const reputation = await hiveApi(context).getAccountReputation(accountName);
      if (!reputation) return unknownAccount(accountName);

      return asEmbedResponse(formatReputationEmbed(reputation.account, reputation.reputation));
    },
  },
  {
    name: "power",
    description: "Look up a Hive account voting power and Hive Power.",
    usage: "power <account>",
    category: "hive",
    execute: async (context, args) => {
      const hive = hiveApi(context);
      const accountName = requireAccountName(args);
      const [account, globals] = await Promise.all([
        hive.getAccount(accountName),
        hive.getDynamicGlobalProperties(),
      ]);

      if (!account) return unknownAccount(accountName);

      const hivePower = calculateHivePower(account, globals.total_vesting_fund_hive, globals.total_vesting_shares);
      const votingPower = calculateVotingPower(account);

      return asEmbedResponse(formatPower(account, hivePower, votingPower));
    },
  },
  {
    name: "mvests",
    description: "Show the current HIVE value of MVESTS.",
    usage: "mvests [account ...]",
    category: "hive",
    execute: async (context, args) => {
      const hive = hiveApi(context);
      const market = marketApi(context);
      const requestedNames = args.map((arg) => arg.replace(/^@/, "").toLowerCase()).filter(Boolean);
      const exactRequestedNames = requestedNames.filter((name) => !isWildcardAccountPattern(name));
      const wildcardPatterns = requestedNames.filter(isWildcardAccountPattern);
      const validExactNames = exactRequestedNames.filter(isHiveAccountName);
      const invalidNames = exactRequestedNames.filter((name) => !isHiveAccountName(name));
      const expanded = await expandWildcardAccountNames(context, wildcardPatterns);
      if (typeof expanded === "string") return expanded;

      const accountNames = unique([...validExactNames, ...expanded.names]);
      if (accountNames.length === 0) {
        if (invalidNames.length > 0) {
          return `Unable to find Hive account${invalidNames.length === 1 ? "" : "s"} ${invalidNames.map((name) => `**${name}**`).join(", ")}.`;
        }
        if (expanded.unmatchedPatterns.length > 0) {
          return `No Hive accounts matched ${expanded.unmatchedPatterns.map((pattern) => `\`${pattern}\``).join(", ")}.`;
        }
      }

      const [globals, feedHistory, hiveUsdPrice] = await Promise.all([
        hive.getDynamicGlobalProperties(),
        hive.getFeedHistory(),
        market.getHiveUsdPrice(),
      ]);
      const hivePerMvest = calculateHivePerMvest(globals.total_vesting_fund_hive, globals.total_vesting_shares);
      const hbdPerMvest = calculateHbdPerMvest(hivePerMvest, feedHistory.current_median_history.base, feedHistory.current_median_history.quote);
      const usdPerMvest = hivePerMvest === null || hiveUsdPrice === null ? null : hivePerMvest * hiveUsdPrice;

      if (hivePerMvest === null) return "Unable to calculate MVESTS from current Hive globals.";

      if (accountNames.length > 0) {
        const accounts = await hive.getAccounts(accountNames);
        const foundNames = new Set(accounts.map((account) => account.name));
        const missingNames = [
          ...validExactNames.filter((name) => !foundNames.has(name)),
          ...invalidNames,
        ];
        const unmatchedPatterns = expanded.unmatchedPatterns;
        const truncatedPatterns = expanded.truncatedPatterns;
        const accountMvests = accounts.reduce((sum, account) => sum + calculateAccountMvests(account), 0);
        const hiveValue = accountMvests * hivePerMvest;
        const hbdValue = hbdPerMvest === null ? null : accountMvests * hbdPerMvest;
        const usdValue = hiveUsdPrice === null ? null : hiveValue * hiveUsdPrice;
        const label = accounts.length === 1 ? `@${accounts[0]?.name}` : `${accounts.length} accounts`;
        const breakout = [
          `${label}: ${formatNumber(accountMvests, 3)} MVESTS`,
          `${formatNumber(hiveValue, 3)} HIVE`,
          hbdValue === null ? null : `${formatNumber(hbdValue, 3)} HBD`,
          usdValue === null ? null : `$${formatNumber(usdValue, 3)}`,
        ]
          .filter(Boolean)
          .join(" = ");
        const missing = missingNames.length > 0 ? ` Missing: ${missingNames.map((name) => `@${name}`).join(", ")}.` : "";
        const unmatched = unmatchedPatterns.length > 0 ? ` No matches: ${unmatchedPatterns.map((pattern) => `\`${pattern}\``).join(", ")}.` : "";
        const truncated = truncatedPatterns.length > 0
          ? ` Truncated: ${truncatedPatterns.map((pattern) => `\`${pattern}\``).join(", ")} to ${context.config.hiveSql.wildcardLimit} accounts.`
          : "";

        return `\`${breakout}\`${missing}${unmatched}${truncated}`;
      }

      const breakout = [
        "1MV",
        "1M VESTS",
        `${formatNumber(hivePerMvest, 3)} HIVE`,
        hbdPerMvest === null ? null : `${formatNumber(hbdPerMvest, 3)} HBD`,
        usdPerMvest === null ? null : `$${formatNumber(usdPerMvest, 3)}`,
      ]
        .filter(Boolean)
        .join(" = ");

      return `\`${breakout}\``;
    },
  },
  {
    name: "proxy",
    description: "Show the witness proxy configured by a Hive account.",
    usage: "proxy <account>",
    category: "hive",
    execute: async (context, args) => {
      const account = await requireAccount(context, args);
      return asEmbedResponse(formatProxy(account));
    },
  },
  {
    name: "poke",
    description: "Show the latest Hive account operation as JSON.",
    usage: "poke <account>",
    category: "hive",
    execute: async (context, args) => {
      const hive = hiveApi(context);
      const accountName = requireAccountName(args);
      const account = await hive.getAccount(accountName);
      if (!account) return unknownAccount(accountName);

      const operation = await hive.getLatestAccountOperation(account.name);
      if (!operation) return `No account history found for **${account.name}**.`;

      return formatAccountOperation(operation);
    },
  },
  {
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
  },
  {
    name: "community",
    description: "Look up a Hive community.",
    usage: "community <hive-...|query>",
    category: "hive",
    execute: async (context, args) => {
      const query = args.join(" ").trim();
      if (!query) return "Usage: `$community <hive-...|query>`";

      const community = await hiveApi(context).getCommunity(query);
      if (!community) return `Unable to find community with: \`${query}\``;

      return asEmbedResponse(formatCommunity(community));
    },
  },
  {
    name: "search",
    description: "Search Hive content; defaults to the last 24 hours.",
    usage: "search <terms...> [tag:name] [!tag:name] [after:YYYY-MM-DD] [before:YYYY-MM-DD]",
    category: "hive",
    execute: async (context, args) => {
      const hiveSql = hiveSqlApi(context);
      if (!hiveSql) return `${configuredHistoryProviderName(context)} is not configured, so content search is unavailable.`;
      const unsupported = unsupportedHafSqlLookup(hiveSql, "content search");
      if (unsupported) return unsupported;

      const parsed = parseSearchArgs(args);
      if (typeof parsed === "string") return parsed;
      if (parsed.keywords.length === 0 && parsed.tags.length === 0) {
        return "Usage: `$search <terms...> [tag:name] [!tag:name] [after:YYYY-MM-DD] [before:YYYY-MM-DD]`";
      }

      const result = await hiveSql.searchComments(parsed);
      return formatSearchResult(parsed, result, hiveApi(context));
    },
  },
  {
    name: "promoted",
    description: "Show promoted post totals.",
    usage: "promoted",
    category: "hive",
    execute: async (context, args) => {
      const unsupportedChain = requireHiveChain(args[0]);
      if (unsupportedChain) return unsupportedChain;

      const hiveSql = hiveSqlApi(context);
      if (!hiveSql) return `${configuredHistoryProviderName(context)} is not configured, so promoted post lookup is unavailable.`;
      const unsupported = unsupportedHafSqlLookup(hiveSql, "promoted post lookup");
      if (unsupported) return unsupported;

      const [yesterday, today] = await Promise.all([
        hiveSql.getPromotedSummary("yesterday"),
        hiveSql.getPromotedSummary("today"),
      ]);

      return asEmbedResponse(formatPromotedSummaries(yesterday, today));
    },
  },
  {
    name: "top",
    description: "Show top Hive posts from the last week.",
    usage: "top <upvoted|downvoted|children|rep|-rep|promoted|reply> [reply keywords...]",
    category: "hive",
    execute: async (context, args) => {
      const hiveSql = hiveSqlApi(context);
      if (!hiveSql) return `${configuredHistoryProviderName(context)} is not configured, so top post lookup is unavailable.`;
      const unsupported = unsupportedHafSqlLookup(hiveSql, "top post lookup");
      if (unsupported) return unsupported;

      const parsed = parseTopPostArgs(args);
      if (typeof parsed === "string") return parsed;

      const post = await hiveSql.getTopPost(parsed);
      const hydratedPost = post ? await hiveApi(context).getPostCreation(post.author, post.permlink) : null;
      const response = formatTopPost(parsed, post, hydratedPost);
      return typeof response === "string" ? response : asEmbedResponse(response);
    },
  },
  {
    name: "app",
    aliases: ["apps"],
    description: "Show top paid posting apps.",
    usage: "app [limit]",
    category: "hive",
    execute: async (context, args) => {
      const hiveSql = hiveSqlApi(context);
      if (!hiveSql) return `${configuredHistoryProviderName(context)} is not configured, so app payout lookup is unavailable.`;
      const unsupported = unsupportedHafSqlLookup(hiveSql, "app payout lookup");
      if (unsupported) return unsupported;

      const limit = readAppLimit(args[0]);
      if (typeof limit === "string") return limit;

      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const apps = await hiveSql.getAppPayouts({ since, limit });
      return asEmbedResponse(formatAppPayouts(apps, since, limit));
    },
  },
  {
    name: "distribution",
    aliases: ["dist"],
    description: "Show native Hive stake distribution for recently active accounts.",
    usage: "distribution [days]",
    category: "hive",
    execute: async (context, args) => {
      const hiveSql = hiveSqlApi(context);
      if (!hiveSql) return `${configuredHistoryProviderName(context)} is not configured, so distribution lookup is unavailable.`;
      const unsupported = unsupportedHafSqlLookup(hiveSql, "distribution lookup");
      if (unsupported) return unsupported;

      const daysAgo = readDistributionDays(args[0]);
      if (typeof daysAgo === "string") return daysAgo;

      const hive = hiveApi(context);
      const [distribution, globals, feedHistory] = await Promise.all([
        hiveSql.getDistribution(daysAgo),
        hive.getDynamicGlobalProperties(),
        hive.getFeedHistory(),
      ]);

      const response = formatDistribution(distribution, globals.total_vesting_fund_hive, globals.total_vesting_shares, feedHistory.current_median_history.base, feedHistory.current_median_history.quote);
      return typeof response === "string" ? response : asEmbedResponse(response);
    },
  },
  {
    name: "badges",
    description: "Search PeakD badge accounts.",
    usage: "badges [terms...]",
    category: "hive",
    execute: async (context, args) => {
      const hiveSql = hiveSqlApi(context);
      if (!hiveSql) return `${configuredHistoryProviderName(context)} is not configured, so badge search is unavailable.`;
      const unsupported = unsupportedHafSqlLookup(hiveSql, "badge search");
      if (unsupported) return unsupported;

      const badges = await hiveSql.findBadges(args.map((arg) => arg.toLowerCase()), 20);
      if (badges.length === 0) return `Unable to find badges with: \`${args.join(" ")}\``;

      return asEmbedResponse(formatBadges(await hydrateBadges(context, badges), args));
    },
  },
  {
    name: "badge",
    description: "Look up a PeakD badge.",
    usage: "badge <terms...>",
    category: "hive",
    execute: async (context, args) => {
      const hiveSql = hiveSqlApi(context);
      if (!hiveSql) return `${configuredHistoryProviderName(context)} is not configured, so badge lookup is unavailable.`;
      const unsupported = unsupportedHafSqlLookup(hiveSql, "badge lookup");
      if (unsupported) return unsupported;

      const badges = await hiveSql.findBadges(args.map((arg) => arg.toLowerCase()), 1);
      const badge = badges[0];
      if (!badge) return `Unable to find badges with: \`${args.join(" ")}\``;

      const stats = await hiveSql.getBadgeStats(badge.name);
      const [hydratedBadge] = await hydrateBadges(context, [badge]);
      const hydratedStats = {
        ...stats,
        listedBy: await hydrateBadges(context, stats.listedBy),
      };
      return asEmbedResponse(formatBadge(hydratedBadge ?? badge, hydratedStats));
    },
  },
  {
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
  },
  {
    name: "consensus",
    description: "Show top Hive witness versions and participation.",
    usage: "consensus [hive] [top]",
    category: "hive",
    execute: async (context, args) => {
      const { chain, top } = parseConsensusArgs(args);
      const chainError = requireHiveChain(chain);
      if (chainError) return chainError;

      const hive = hiveApi(context);
      const [globals, witnesses] = await Promise.all([
        hive.getDynamicGlobalProperties(),
        hive.getWitnessesByVote(top),
      ]);

      return formatConsensus(globals.participation_count, witnesses);
    },
  },
  {
    name: "delegate",
    aliases: ["delegator", "delegatee"],
    description: "Show Hive vesting delegations for an account.",
    usage: "delegate <account> [hive]",
    category: "hive",
    execute: async (context, args) => {
      const accountName = requireAccountName(args);
      const chainError = requireHiveChain(args[1]);
      if (chainError) return chainError;

      const account = await hiveApi(context).getAccount(accountName);
      if (!account) return unknownAccount(accountName);

      const hiveSql = hiveSqlApi(context);
      if (!hiveSql) return `${configuredHistoryProviderName(context)} is not configured, so delegation lookup is unavailable.`;
      const provider = historyProviderName(hiveSql);

      const direction = context.commandName === "delegator"
        ? "incoming"
        : context.commandName === "delegatee"
          ? "outgoing"
          : "both";

      try {
        if (direction === "incoming") {
          return formatDelegations("incoming", account.name, await hiveSql.getDelegations(account.name, "incoming"));
        }
        if (direction === "outgoing") {
          return formatDelegations("outgoing", account.name, await hiveSql.getDelegations(account.name, "outgoing"));
        }

        const [incoming, outgoing] = await Promise.all([
          hiveSql.getDelegations(account.name, "incoming"),
          hiveSql.getDelegations(account.name, "outgoing"),
        ]);

        return [
          formatDelegations("incoming", account.name, incoming),
          formatDelegations("outgoing", account.name, outgoing),
        ].join("\n");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `${provider} delegation lookup failed: ${message}`;
      }
    },
  },
  {
    name: "delegated",
    description: "Show accounts receiving at least a threshold of delegated MVESTS.",
    usage: "delegated [min_mvests] [hive]",
    category: "hive",
    execute: async (context, args) => {
      const { minMvests, chain } = parseDelegatedArgs(args);
      const chainError = requireHiveChain(chain);
      if (chainError) return chainError;

      const hiveSql = hiveSqlApi(context);
      if (!hiveSql) return `${configuredHistoryProviderName(context)} is not configured, so delegated account lookup is unavailable.`;
      const provider = historyProviderName(hiveSql);

      try {
        const delegatees = await hiveSql.getDelegateesByMinimumMvests(minMvests);
        return formatDelegatedAccounts(delegatees);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `${provider} delegated account lookup failed: ${message}`;
      }
    },
  },
  {
    name: "claims",
    description: "Summarize Hive reward-claim transactions.",
    usage: "claims [today|yesterday|all] [hive]",
    category: "hive",
    execute: async (context, args) => {
      const { timeframe, chain } = parseClaimsArgs(args);
      const chainError = requireHiveChain(chain);
      if (chainError) return chainError;

      const hiveSql = hiveSqlApi(context);
      if (!hiveSql) return `${configuredHistoryProviderName(context)} is not configured, so claim lookup is unavailable.`;
      const provider = historyProviderName(hiveSql);

      try {
        return asEmbedResponse(formatClaimSummary(await hiveSql.getClaimSummary(timeframe), provider));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `${provider} claim lookup failed: ${message}`;
      }
    },
  },
  {
    name: "accounts",
    description: "Summarize Hive account totals.",
    usage: "accounts [hive]",
    category: "hive",
    execute: async (context, args) => {
      const chainError = requireHiveChain(args[0]);
      if (chainError) return chainError;

      const hiveSql = accountSummaryApi(context);
      if (!hiveSql) return "HafSQL or HiveSQL is not configured, so account summary lookup is unavailable.";
      const provider = historyProviderName(hiveSql);

      try {
        return asEmbedResponse(formatAccountSummary(await hiveSql.getAccountSummary(), provider));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `${provider} account summary lookup failed: ${message}`;
      }
    },
  },
  {
    name: "inflation",
    description: "Project the historical Hive inflation schedule.",
    usage: "inflation [years] [hive]",
    category: "hive",
    execute: async (_context, args) => {
      const { years, chain } = parseInflationArgs(args);
      const chainError = requireHiveChain(chain);
      if (chainError) return chainError;

      return asEmbedResponse(formatInflationProjection(years));
    },
  },
  {
    name: "rewardpool",
    description: "Show the current Hive post reward pool.",
    usage: "rewardpool [hive]",
    category: "hive",
    execute: async (context, args) => {
      const chainError = requireHiveChain(args[0]);
      if (chainError) return chainError;

      const rewardFund = await hiveApi(context).getRewardFund("post");
      return asEmbedResponse(formatRewardPool(rewardFund));
    },
  },
  {
    name: "calcreward",
    description: "Estimate a post's pending payout against the reward pool.",
    usage: "calcreward <url-or-@author/permlink>",
    category: "hive",
    execute: async (context, args) => {
      const input = args[0];
      const target = await resolveCalculatedRewardTarget(context, input);
      if (typeof target === "string") return target;

      const hive = hiveApi(context);
      const [post, rewardFund, feedHistory] = await Promise.all([
        hive.getPostCreation(target.ref.author, target.ref.permlink),
        hive.getRewardFund("post"),
        hive.getFeedHistory(),
      ]);
      if (!post) return `Unable to find post @${target.ref.author}/${target.ref.permlink}.`;

      const cashoutTime = post.cashout_time ? parseHiveDate(post.cashout_time) : null;
      if (cashoutTime && cashoutTime.getTime() < Date.now()) {
        return "Sorry, this calculation only makes sense for posts within the first payout timeframe.";
      }

      if (!target.unfurl) {
        return formatCalculatedRewardText(post, rewardFund.reward_balance, feedHistory.current_median_history.base, feedHistory.current_median_history.quote);
      }

      return asEmbedResponse(formatCalculatedRewardEmbed(post, rewardFund.reward_balance, feedHistory.current_median_history.base, feedHistory.current_median_history.quote));
    },
  },
  {
    name: "summarize",
    aliases: ["summary"],
    description: "Summarize a Hive post from the blockchain.",
    usage: "summarize <url-or-@author/permlink|^>",
    category: "hive",
    execute: async (context, args) => {
      const target = await resolvePostTarget(context, args[0], "summarize");
      if (typeof target === "string") return target;

      const post = await hiveApi(context).getPostCreation(target.ref.author, target.ref.permlink);
      if (!post) return `Unable to find post @${target.ref.author}/${target.ref.permlink} on Hive.`;

      const summary = await hivePostSummarizer(context).summarizePost(post);
      if (!summary) return "LLM summarization is not configured.";

      return asEmbedResponse(formatPostSummary(post, summary));
    },
  },
  {
    name: "rewards",
    description: "Summarize recent native Hive reward operations for an account.",
    usage: "rewards <account> [hive|token]",
    category: "hive",
    execute: async (context, args) => {
      const accountName = requireAccountName(args);
      const symbol = (args[1] ?? "HIVE").toUpperCase();

      const hive = hiveApi(context);
      if (symbol !== "HIVE") {
        const [account, rewards, token, trade, feedHistory] = await Promise.all([
          hive.getAccount(accountName),
          scotApi(context).getAccountHistory(accountName, symbol, 100000),
          hiveEngineApi(context).getToken(symbol),
          hiveEngineApi(context).getLatestTrade(symbol),
          hive.getFeedHistory(),
        ]);
        if (!account) return unknownAccount(accountName);

        const hbdPerHive = parseFeedPrice(feedHistory.current_median_history.base, feedHistory.current_median_history.quote);
        const summary = summarizeScotRewards(symbol, rewards, trade, hbdPerHive);
        if (!summary) return `No ${symbol} rewards for ${account.name} (bad timeframe or invalid symbol)`;

        return asEmbedResponse(formatScotRewards(account.name, symbol, summary, token));
      }

      const [account, globals, feedHistory, rewardOperations] = await Promise.all([
        hive.getAccount(accountName),
        hive.getDynamicGlobalProperties(),
        hive.getFeedHistory(),
        hive.getRewardOperations(accountName),
      ]);
      if (!account) return unknownAccount(accountName);

      const hivePerVest = parseAsset(globals.total_vesting_fund_hive) / parseAsset(globals.total_vesting_shares);
      const hbdPerHive = parseFeedPrice(feedHistory.current_median_history.base, feedHistory.current_median_history.quote);
      const summary = summarizeRewards(account.name, rewardOperations, hivePerVest, hbdPerHive, hbdPerHive);
      if (!summary) return `No HIVE rewards for ${account.name} (bad timeframe or invalid symbol)`;

      return asEmbedResponse(formatRewards(account.name, summary));
    },
  },
  {
    name: "nodes",
    description: "Show public Hive API nodes.",
    usage: "nodes",
    category: "hive",
    execute: async (context) => {
      const nodes = await hiveNodeDirectory(context).getPublicNodes();
      const displayNodes: HiveNode[] = nodes.length > 0
        ? nodes
        : context.config.hive.nodes.map((url) => ({ url }));

      return asEmbedResponse(formatNodes(displayNodes, context.config.hive.nodesSourceUrl));
    },
  },
  {
    name: "ticker",
    aliases: ["ticker2"],
    description: "Show the current HIVE market ticker.",
    usage: "ticker [hive]",
    category: "hive",
    execute: async (context, args) => {
      const chainError = requireHiveChain(args[0]);
      if (chainError) return chainError;

      const [ticker, feedHistory] = await Promise.all([
        marketApi(context).getHiveTicker(),
        hiveApi(context).getFeedHistory(),
      ]);
      if (!ticker) return "Unable to load HIVE ticker data.";

      return asEmbedResponse(formatTicker(ticker, feedHistory.current_median_history.base, feedHistory.current_median_history.quote));
    },
  },
  {
    name: "price",
    description: "Show current USD prices for HIVE and HBD.",
    usage: "price [hive|hbd] [...]",
    category: "hive",
    execute: async (context, args) => {
      const symbols = args.length > 0 ? args.map(normalizePriceSymbol) : ["HIVE"];
      const unsupported = symbols.filter((symbol) => symbol !== "HIVE" && symbol !== "HBD");
      if (unsupported.length > 0) {
        return `Unsupported price symbol${unsupported.length === 1 ? "" : "s"}: ${unsupported.map((symbol) => `\`${symbol}\``).join(", ")}. Supported: \`HIVE\`, \`HBD\`.`;
      }

      const [prices, feedHistory] = await Promise.all([
        marketApi(context).getHiveHbdUsdPrices(),
        hiveApi(context).getFeedHistory(),
      ]);
      const feedPrice = parseFeedPrice(feedHistory.current_median_history.base, feedHistory.current_median_history.quote);
      const hbdFallback = prices.hbd ?? (prices.hive !== null && feedPrice !== null ? prices.hive / feedPrice : null);
      const uniqueSymbols = unique(symbols);

      return uniqueSymbols.map((symbol) => {
        const price = symbol === "HIVE" ? prices.hive : hbdFallback;
        return price === null
          ? `${symbol}: price unavailable`
          : `${symbol}: **$${formatNumber(price, priceDecimals(symbol, price))}**`;
      }).join("\n");
    },
  },
  {
    name: "fear",
    aliases: ["greed"],
    description: "Show the Crypto Fear & Greed Index.",
    usage: "fear [days-ago]",
    category: "hive",
    execute: async (context, args) => {
      const daysAgo = readFearGreedDays(args[0]);
      if (typeof daysAgo === "string") return daysAgo;

      const index = await marketApi(context).getFearGreedIndex(3);
      if (!index) return "Unable to load the Crypto Fear & Greed Index.";

      return asEmbedResponse(formatFearGreed(index, daysAgo));
    },
  },
  {
    name: "token",
    description: "Look up Hive Engine token metadata and market data.",
    usage: "token <symbol> [...]",
    category: "hive",
    execute: async (context, args) => {
      const symbols = unique(args.map(normalizeTokenSymbol).filter(Boolean));
      if (symbols.length === 0) return formatTokenDirectory();
      if (symbols.length > 3) return "Requesting more than 3 tokens is not supported in this Banjo build.";

      const hiveEngine = hiveEngineApi(context);
      const market = marketApi(context);
      let hiveUsdPrice: number | null | undefined;
      let scotConfig: ScotConfigEntry[] | null | undefined;
      const embeds: EmbedBuilder[] = [];
      const notes: string[] = [];

      for (const symbol of symbols) {
        const wrappedSuggestion = wrappedTokenSuggestion(symbol);
        if (wrappedSuggestion) {
          notes.push(wrappedSuggestion);
          continue;
        }

        if (isNativeHiveToken(symbol)) {
          const [globals, feedHistory, ticker] = await Promise.all([
            hiveApi(context).getDynamicGlobalProperties(),
            hiveApi(context).getFeedHistory(),
            hiveApi(context).getMarketTicker(),
          ]);
          embeds.push(formatNativeHiveToken(symbol, globals, feedHistory, ticker));
          continue;
        }

        hiveUsdPrice ??= await market.getHiveUsdPrice();

        const [token, trade, metrics] = await Promise.all([
          hiveEngine.getToken(symbol),
          hiveEngine.getLatestTrade(symbol),
          hiveEngine.getMarketMetrics(symbol),
        ]);
        if (!token) {
          notes.push(formatUnknownToken(symbol));
          continue;
        }

        scotConfig ??= await loadOptionalScotConfig(context);
        const scotHint = scotConfig ? await formatScotTokenHint(context, scotConfig, token.symbol) : null;

        embeds.push(formatHiveEngineToken(token, trade, metrics, hiveUsdPrice, scotHint));
      }

      if (embeds.length === 0 && notes.length > 0) return notes.join("\n");
      if (notes.length > 0) return { content: notes.join("\n"), embeds };
      return { embeds };
    },
  },
  {
    name: "richlist",
    description: "Show a Hive Engine token richlist.",
    usage: "richlist <symbol> [count]",
    category: "hive",
    execute: async (context, args) => {
      const symbol = normalizeTokenSymbol(args[0] ?? "");
      if (!symbol) return "Token symbol required.";
      if (["HIVE", "HBD", "VESTS", "MVESTS", "HP"].includes(symbol)) {
        return `Native ${symbol} richlist lookup has not been ported yet.`;
      }

      const count = readRichlistCount(args[1]);
      const hiveEngine = hiveEngineApi(context);
      const [token, balanceResult] = await Promise.all([
        hiveEngine.getToken(symbol),
        hiveEngine.getTokenBalances(symbol),
      ]);
      if (!token || balanceResult.balances.length === 0) return `Unknown token: ${symbol}`;

      return asEmbedResponse(formatHiveEngineRichlist(token, balanceResult.balances, count, balanceResult.truncated));
    },
  },
  {
    name: "staked",
    description: "Show top Hive Engine token stakers.",
    usage: "staked <symbol> [count]",
    category: "hive",
    execute: async (context, args) => {
      const symbol = normalizeTokenSymbol(args[0] ?? "");
      if (!symbol) return "Token symbol required.";

      const count = readStakedCount(args[1]);
      const hiveEngine = hiveEngineApi(context);
      const [token, balanceResult] = await Promise.all([
        hiveEngine.getToken(symbol),
        hiveEngine.getTokenBalances(symbol),
      ]);
      if (!token || balanceResult.balances.length === 0) return `Unknown token: ${symbol}`;

      const response = formatHiveEngineStaked(token, balanceResult.balances, count, balanceResult.truncated);
      return typeof response === "string" ? response : asEmbedResponse(response);
    },
  },
  {
    name: "nft",
    description: "Look up Hive Engine NFT metadata.",
    usage: "nft <symbol> [...]",
    category: "hive",
    execute: async (context, args) => {
      const symbols = unique(args.map(normalizeTokenSymbol).filter(Boolean));
      if (symbols.length === 0) return "NFT symbol required.";
      if (symbols.length > 3) return "Requesting more than 3 NFTs is not supported in this Banjo build.";

      const hiveEngine = hiveEngineApi(context);
      const embeds: EmbedBuilder[] = [];

      for (const symbol of symbols) {
        const nft = await hiveEngine.getNft(symbol);
        if (!nft) return `Unknown nft: ${symbol}`;

        embeds.push(formatHiveEngineNft(nft));
      }

      return { embeds };
    },
  },
  {
    name: "nftsr",
    description: "Look up NFT Showroom art.",
    usage: "nftsr [owner] [index]",
    category: "hive",
    execute: async (context, args) => {
      const account = args[0]?.replace(/^@/, "").toLowerCase() || null;
      const index = readOptionalIndex(args[1]);
      if (typeof index === "string") return index;

      const art = await hiveEngineApi(context).getNftShowroomArt(account, index);
      if (!art) return `Unable to find NFT: \`${args.join(" ")}\``;
      if (!art.published) return `That NFT is unpublished: \`${args.join(" ")}\``;

      return formatNftShowroomResponse(art, account, index);
    },
  },
  {
    name: "tt2x",
    description: "Estimate top trending SCOT payouts against Hive Engine exchange depth.",
    usage: "tt2x <symbol> [limit]",
    category: "hive",
    execute: async (context, args) => {
      const symbol = normalizeTokenSymbol(args[0] ?? "");
      if (!symbol) return "Usage: $tt2x <symbol> [limit]";

      const limit = readTt2xLimit(args[1]);
      if (typeof limit === "string") return limit;

      const hiveEngine = hiveEngineApi(context);
      const scot = scotApi(context);
      const market = marketApi(context);
      const [token, discussions, trade, buyBook, hiveUsdPrice] = await Promise.all([
        hiveEngine.getToken(symbol),
        scot.getTrendingDiscussions(symbol, limit),
        hiveEngine.getLatestTrade(symbol),
        hiveEngine.getBuyBook(symbol, 1000),
        market.getHiveUsdPrice(),
      ]);

      if (!token) return `Unknown token: ${symbol}`;
      if (discussions.length === 0) return `Unable to look up trending page for token ${symbol}.`;
      if (!trade) return `No trading history for ${symbol}.`;
      if (buyBook.length === 0) return `Empty buy book for ${symbol}.`;

      return asEmbedResponse(formatTt2x(token, limit, discussions, trade, buyBook, hiveUsdPrice));
    },
  },
  {
    name: "scottags",
    description: "Show SCOT tribe tags for Hive Engine tokens.",
    usage: "scottags <symbol> [...]",
    category: "hive",
    execute: async (context, args) => {
      const config = await scotApi(context).getConfig();
      const symbols = unique(args.map(normalizeTokenSymbol).filter(Boolean));
      if (symbols.length === 0) {
        return `Please specify a token, or tokens: \`${config.map((entry) => entry.token).join(" ")}\``;
      }

      return formatScotTags(config, symbols);
    },
  },
  {
    name: "feed",
    description: "Show Hive price feed and HBD policy values.",
    usage: "feed [price|apr] [hive]",
    category: "hive",
    execute: async (context, args) => {
      const type = args[0]?.toLowerCase() || "price";
      const chainError = requireHiveChain(args[1]);
      if (chainError) return chainError;

      const hive = hiveApi(context);

      if (type === "price") {
        const feedHistory = await hive.getFeedHistory();

        return asEmbedResponse(formatFeedPrice(feedHistory));
      }

      if (type === "apr") {
        const globals = await hive.getDynamicGlobalProperties();

        return asEmbedResponse(formatFeedPolicy(globals));
      }

      return `Unknown feed type: ${type}`;
    },
  },
  {
    name: "hardfork",
    description: "Show Hive hardfork status and witness version votes.",
    usage: "hardfork [hive]",
    category: "hive",
    execute: async (context, args) => {
      const chainError = requireHiveChain(args[0]);
      if (chainError) return chainError;

      const hive = hiveApi(context);
      const [currentVersion, witnessSchedule, nextHardfork, witnesses] = await Promise.all([
        hive.getHardforkVersion(),
        hive.getWitnessSchedule(),
        hive.getNextScheduledHardfork(),
        hive.getWitnessesByVote(100),
      ]);
      const nextLiveTime = new Date(`${nextHardfork.live_time}Z`);
      const nextLabel = nextLiveTime.getTime() <= Date.now() ? "Last" : "Next";

      return asEmbedResponse(formatHardfork(currentVersion, witnessSchedule.majority_version, nextLabel, nextHardfork.hf_version, nextLiveTime, witnesses));
    },
  },
  {
    name: "supply",
    description: "Show current Hive supply globals.",
    usage: "supply [hive]",
    category: "hive",
    execute: async (context, args) => {
      const chainError = requireHiveChain(args[0]);
      if (chainError) return chainError;

      const globals = await hiveApi(context).getDynamicGlobalProperties();

      return asEmbedResponse(formatSupply(globals));
    },
  },
  {
    name: "witness",
    description: "Look up basic Hive witness information.",
    usage: "witness <account>",
    category: "hive",
    execute: async (context, args) => {
      const accountName = requireAccountName(args);
      const witness = await hiveApi(context).getWitnessByAccount(accountName);
      if (!witness) return `${accountName} is not a Hive witness.`;

      return asEmbedResponse(formatWitness(witness));
    },
  },
  {
    name: "avatar",
    description: "Show the Hive avatar image for an account.",
    usage: "avatar <account>",
    category: "hive",
    execute: (_context, args) => {
      const accountName = requireAccountName(args);
      return `https://images.hive.blog/u/${encodeURIComponent(accountName)}/avatar`;
    },
  },
  {
    name: "latest",
    description: "Show the latest Hive root post for an account.",
    usage: "latest <account> [offset]",
    category: "hive",
    execute: async (context, args) => {
      const accountName = requireAccountName(args);
      const offset = readLatestOffset(args);
      const posts = await hiveApi(context).getLatestPosts(accountName, offset + 1);
      const post = posts[offset];

      if (!post) return `Unable to find latest blog entry for ${accountName}.`;

      return postUrl(post);
    },
  },
  {
    name: "first",
    description: "Show the first Hive root post for an account.",
    usage: "first <account> [offset]",
    category: "hive",
    execute: async (context, args) => {
      const accountName = requireAccountName(args);
      const offset = readOffset(args[1]);
      const post = await hiveApi(context).getFirstPost(accountName, offset);

      if (!post) return `Unable to find first blog entry for ${accountName}.`;

      return postUrl(post);
    },
  },
  {
    name: "follows",
    description: "Show follower and following counts for a Hive account.",
    usage: "follows <account>",
    category: "hive",
    execute: async (context, args) => {
      const accountName = requireAccountName(args);
      const followCount = await hiveApi(context).getFollowCount(accountName);
      if (!followCount) return unknownAccount(accountName);

      return asEmbedResponse(formatFollows(accountName, followCount.follower_count, followCount.following_count));
    },
  },
  {
    name: "age",
    description: "Show when a Hive post was created.",
    usage: "age <url-or-@author/permlink>",
    category: "hive",
    execute: async (context, args) => {
      const ref = parsePostRef(args[0]);
      if (!ref) {
        return "Usage: `$age <url-or-@author/permlink>`";
      }

      const post = await hiveApi(context).getPostCreation(ref.author, ref.permlink);
      if (!post?.created) {
        return `Unable to find post @${ref.author}/${ref.permlink}.`;
      }

      const createdAt = new Date(`${post.created}Z`);
      return asEmbedResponse(formatPostAge(post, createdAt));
    },
  },
];

function hiveApi(context: CommandContext): HiveApi {
  return context.services?.hive ?? new HiveRpcClient(context.config, context.logger);
}

function hivePostSummarizer(context: CommandContext): HivePostSummarizer {
  return context.services?.hivePostSummarizer ?? new OpenAiHivePostSummarizer(context.config, context.logger);
}

function formatAccountOperation(operation: HiveAccountOperation): string {
  const json = JSON.stringify({ [operation.type]: operation.value }).replace(/`/g, "\\u0060");
  return `\`\`\`json\n${json}\n\`\`\``;
}

function hiveNodeDirectory(context: CommandContext): HiveNodeDirectory {
  return context.services?.hiveNodes ?? new HiveDeveloperNodeDirectory(context.config, context.logger);
}

function marketApi(context: CommandContext): MarketApi {
  return context.services?.market ?? new CoinGeckoMarketClient(context.config, context.logger);
}

function hiveEngineApi(context: CommandContext): HiveEngineApi {
  return context.services?.hiveEngine ?? new HiveEngineRpcClient(context.config, context.logger);
}

function scotApi(context: CommandContext): ScotApi {
  return context.services?.scot ?? new ScotHttpClient(context.config, context.logger);
}

function formatNodes(nodes: HiveNode[], sourceUrl: string): EmbedBuilder {
  const embed = banjoEmbed()
    .setTitle("Hive Public Nodes")
    .setURL(sourceUrl)
    .setDescription(nodes.map((node, index) => {
      const owner = node.owner ? ` ${node.owner}` : "";
      return `${index + 1}. ${node.url}${owner}`;
    }).join("\n"))
    .setFooter({ text: "Hive Developer Portal", iconURL: HIVE_TOKEN_ICON_URL });

  embed.addFields([
    dataField("Nodes", String(nodes.length)),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function formatPower(account: HiveAccount, hivePower: number, votingPower: number | null): EmbedBuilder {
  const embed = banjoEmbed()
    .setTitle(account.name)
    .setURL(hiveHubAccountUrl(account.name))
    .setThumbnail(`https://images.hive.blog/u/${encodeURIComponent(account.name)}/avatar`)
    .setFooter({ text: "Hive Chain", iconURL: HIVE_TOKEN_ICON_URL });

  embed.addFields([
    dataField("Hive Power", `${formatNumber(hivePower, 3)} HP`),
    dataField("Voting Power", votingPower === null ? null : `${formatNumber(votingPower, 2)}%`),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function formatReputationEmbed(accountName: string, reputation: string | number): EmbedBuilder {
  const embed = banjoEmbed()
    .setTitle(accountName)
    .setURL(hiveHubAccountUrl(accountName))
    .setThumbnail(`https://images.hive.blog/u/${encodeURIComponent(accountName)}/avatar`)
    .setFooter({ text: "Hive Chain", iconURL: HIVE_TOKEN_ICON_URL });

  embed.addFields([
    dataField("Reputation", formatReputation(reputation)),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function formatProxy(account: HiveAccount): EmbedBuilder {
  const embed = banjoEmbed()
    .setTitle(account.name)
    .setURL(hiveHubAccountUrl(account.name))
    .setThumbnail(`https://images.hive.blog/u/${encodeURIComponent(account.name)}/avatar`)
    .setFooter({ text: "Hive Chain", iconURL: HIVE_TOKEN_ICON_URL });

  embed.addFields([
    dataField("Witness Proxy", account.proxy ? `@${account.proxy}` : "None"),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function formatFollows(accountName: string, followers: number, following: number): EmbedBuilder {
  const embed = banjoEmbed()
    .setTitle(accountName)
    .setURL(hiveHubAccountUrl(accountName))
    .setThumbnail(`https://images.hive.blog/u/${encodeURIComponent(accountName)}/avatar`)
    .setFooter({ text: "Hivemind Social", iconURL: HIVE_TOKEN_ICON_URL });

  embed.addFields([
    dataField("Followers", formatInteger(followers)),
    dataField("Following", formatInteger(following)),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function hiveHubAccountUrl(accountName: string): string {
  return `https://hivehub.dev/stats/account?username=${encodeURIComponent(accountName)}`;
}

function accountMarkdownLink(accountName: string): string {
  return `[@${accountName}](${hiveHubAccountUrl(accountName)})`;
}

function hiveSqlApi(context: CommandContext): HiveSqlApi | null {
  if (context.services?.hiveSql) return context.services.hiveSql;
  return configuredHistoryApi(context.config, context.logger);
}

function accountSummaryApi(context: CommandContext): HiveSqlApi | null {
  if (context.services?.hiveSql) return context.services.hiveSql;
  if (context.config.hafSql.enabled) return new HafSqlClient(context.config, context.logger);
  return configuredHistoryApi(context.config, context.logger);
}

function configuredHistoryApi(config: AppConfig, logger: Logger): HiveSqlApi | null {
  if (config.hiveSql.provider === "hafsql") {
    if (!config.hafSql.enabled) return null;
    return new HafSqlClient(config, logger);
  }
  if (!config.hiveSql.enabled) return null;
  return new HiveSqlClient(config, logger);
}

function historyProviderName(hiveSql: HiveSqlApi): string {
  return hiveSql.providerName ?? "HiveSQL";
}

function configuredHistoryProviderName(context: CommandContext): string {
  return context.config.hiveSql.provider === "hafsql" ? "HafSQL" : "HiveSQL";
}

function unsupportedHafSqlLookup(hiveSql: HiveSqlApi, lookup: string): string | null {
  return historyProviderName(hiveSql) === "HafSQL"
    ? `HafSQL ${lookup} is not implemented yet; switch HIVE_HISTORY_PROVIDER to hivesql for this command.`
    : null;
}

async function requireAccount(context: CommandContext, args: string[]): Promise<HiveAccount> {
  const accountName = requireAccountName(args);
  const account = await hiveApi(context).getAccount(accountName);
  if (!account) throw new UserFacingCommandError(unknownAccount(accountName));
  return account;
}

function requireAccountName(args: string[]): string {
  const accountName = args[0]?.replace(/^@/, "").toLowerCase();
  if (!accountName) {
    throw new UserFacingCommandError("Please provide a Hive account name.");
  }
  return accountName;
}

function isHiveAccountName(value: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{1,14}[a-z0-9]$/.test(value);
}

function isWildcardAccountPattern(value: string): boolean {
  return /[*%]/.test(value);
}

async function expandWildcardAccountNames(
  context: CommandContext,
  patterns: string[],
): Promise<{ names: string[]; unmatchedPatterns: string[]; truncatedPatterns: string[] } | string> {
  if (patterns.length === 0) return { names: [], unmatchedPatterns: [], truncatedPatterns: [] };

  const hiveSql = hiveSqlApi(context);
  if (!hiveSql) {
    return `${configuredHistoryProviderName(context)} is not configured, so wildcard account lookups are unavailable.`;
  }
  const provider = historyProviderName(hiveSql);

  const names: string[] = [];
  const unmatchedPatterns: string[] = [];
  const truncatedPatterns: string[] = [];

  for (const pattern of patterns) {
    let matches: string[];
    try {
      matches = await hiveSql.findAccountNamesByPattern(pattern, context.config.hiveSql.wildcardLimit + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `${provider} wildcard lookup failed: ${message}`;
    }

    if (matches.length === 0) {
      unmatchedPatterns.push(pattern);
    } else {
      if (matches.length > context.config.hiveSql.wildcardLimit) {
        truncatedPatterns.push(pattern);
      }
      names.push(...matches.slice(0, context.config.hiveSql.wildcardLimit));
    }
  }

  return { names: unique(names), unmatchedPatterns, truncatedPatterns };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function formatDelegations(
  direction: "incoming" | "outgoing",
  accountName: string,
  delegations: { account: string; vests: number }[],
): string {
  const label = direction === "incoming" ? "delegated to" : "delegated by";
  const party = direction === "incoming" ? "delegator" : "delegatee";
  const preposition = direction === "incoming" ? "by" : "to";

  if (delegations.length === 0) {
    return `No \`MVESTS\` ${label} \`${accountName}\`.`;
  }

  const total = delegations.reduce((sum, delegation) => sum + delegation.vests, 0) / 1_000_000;
  const summary = `\`MVESTS\` ${label} \`${accountName}\` ${preposition} ${pluralize(delegations.length, party)}: \`${formatNumber(total, 3)}\``;
  if (delegations.length > 50) return summary;

  const details = delegations
    .map((delegation) => `${delegation.account}: ${formatNumber(delegation.vests / 1_000_000, 3)}`)
    .join("; ");

  return `${summary}\n\`\`\`\n${details}\n\`\`\``;
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function parseDelegatedArgs(args: string[]): { minMvests: number; chain: string | undefined } {
  const [first, second] = args;
  if (!first) return { minMvests: 0, chain: undefined };

  const parsed = Number.parseFloat(first);
  if (Number.isFinite(parsed)) {
    return { minMvests: Math.max(0, Math.floor(parsed)), chain: second };
  }

  return { minMvests: 0, chain: first };
}

function formatDelegatedAccounts(
  delegatees: { delegatee: string; vests: number; delegatorCount: number; singleDelegator: string }[],
): string {
  const summary = `MVESTS delegated to ${pluralize(delegatees.length, "account")}`;
  if (delegatees.length === 0 || delegatees.length > 25) return summary;

  const details = delegatees
    .map((delegatee) => {
      const from = delegatee.delegatorCount === 1 ? delegatee.singleDelegator : "<multiple>";
      return `${from} to ${delegatee.delegatee}: ${formatNumber(delegatee.vests / 1_000_000, 0)}`;
    })
    .join("; ");

  return `${summary}\n\`\`\`\n${details}\n\`\`\``;
}

function parseClaimsArgs(args: string[]): { timeframe: "today" | "yesterday" | "all"; chain: string | undefined } {
  const [first, second] = args.map((arg) => arg.toLowerCase());
  if (!first) return { timeframe: "today", chain: undefined };
  if (first === "today" || first === "yesterday" || first === "all") return { timeframe: first, chain: second };
  return { timeframe: "all", chain: undefined };
}

function formatClaimSummary(summary: {
  timeframe: "today" | "yesterday" | "all";
  count: number;
  uniqueAccounts: number;
  rewardHbd: number;
  rewardHive: number;
  rewardVests: number;
}, providerName = "HiveSQL"): EmbedBuilder {
  const embed = banjoEmbed()
    .setTitle("Hive Reward Claims")
    .setDescription(summary.timeframe)
    .setFooter({ text: providerName, iconURL: HIVE_TOKEN_ICON_URL });

  embed.addFields([
    dataField("Claims", formatInteger(summary.count)),
    dataField("Unique Accounts", formatInteger(summary.uniqueAccounts)),
    dataField("Rewards", [
      `${formatNumber(summary.rewardHbd, 3)} HBD`,
      `${formatNumber(summary.rewardHive, 3)} HIVE`,
      `${formatNumber(summary.rewardVests / 1_000_000, 3)} MVESTS`,
    ].join(" / "), false),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function formatAccountSummary(summary: { total: number; mined: number; communities: number; badges: number }, providerName = "HiveSQL"): EmbedBuilder {
  const embed = banjoEmbed()
    .setTitle("Hive Accounts")
    .setFooter({ text: providerName, iconURL: HIVE_TOKEN_ICON_URL });

  embed.addFields([
    dataField("Total", formatInteger(summary.total)),
    dataField("Mined", formatInteger(summary.mined)),
    dataField("Communities", formatInteger(summary.communities)),
    dataField("Badges", formatInteger(summary.badges)),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function formatRewardPool(rewardFund: { reward_balance: string; recent_claims: string; percent_curation_rewards?: number }): EmbedBuilder {
  const claims = Number.parseFloat(rewardFund.recent_claims);
  const claimsText = Number.isFinite(claims) ? formatInteger(claims) : rewardFund.recent_claims;
  const embed = banjoEmbed()
    .setTitle("Hive Reward Pool")
    .setFooter({ text: "Hive Chain", iconURL: HIVE_TOKEN_ICON_URL });

  embed.addFields([
    dataField("Balance", formatAsset(rewardFund.reward_balance, 3)),
    dataField("Recent Claims", claimsText),
    dataField(
      "Curation Rewards",
      typeof rewardFund.percent_curation_rewards === "number" ? `${formatNumber(rewardFund.percent_curation_rewards / 100, 2)}%` : null,
    ),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

type RewardTotals = {
  producer: number;
  interest: number;
  curation: number;
  author: number;
  benefactor: number;
};

type RewardSummary = RewardTotals & {
  startingAt: Date;
  endingAt: Date;
  total: number;
  usd: number | null;
  usdPerDay: number | null;
};

type ScotRewardTotals = {
  staking: number;
  curation: number;
  author: number;
  benefactor: number;
  mining: number;
};

type ScotRewardSummary = ScotRewardTotals & {
  startingAt: Date;
  endingAt: Date;
  total: number;
  hive: number | null;
  usd: number | null;
  usdPerDay: number | null;
};

function summarizeScotRewards(
  symbol: string,
  rewards: ScotAccountHistoryEntry[],
  trade: HiveEngineTrade | null,
  hiveUsdPrice: number | null,
): ScotRewardSummary | null {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const totals: ScotRewardTotals = {
    staking: 0,
    curation: 0,
    author: 0,
    benefactor: 0,
    mining: 0,
  };
  let startingAt: Date | null = null;
  let endingAt: Date | null = null;

  for (const reward of rewards) {
    if ((reward.token ?? symbol).toUpperCase() !== symbol) continue;
    if (!reward.type || typeof reward.int_amount !== "number" || typeof reward.precision !== "number") continue;

    const timestamp = reward.timestamp ? parseHiveDate(reward.timestamp) : null;
    if (!timestamp || timestamp.getTime() < cutoff) continue;

    const amount = reward.int_amount * 10 ** -reward.precision;
    if (reward.type === "staking_reward" || reward.type === "stake_airdrop" || reward.type === "liquid_airdrop") totals.staking += amount;
    if (reward.type === "curation_reward") totals.curation += amount;
    if (reward.type === "author_reward") totals.author += amount;
    if (reward.type === "comment_benefactor_reward") totals.benefactor += amount;
    if (reward.type === "mining_reward") totals.mining += amount;

    startingAt = !startingAt || timestamp.getTime() < startingAt.getTime() ? timestamp : startingAt;
    endingAt = !endingAt || timestamp.getTime() > endingAt.getTime() ? timestamp : endingAt;
  }

  if (!startingAt || !endingAt) return null;

  const total = totals.staking + totals.curation + totals.author + totals.benefactor + totals.mining;
  const days = Math.max((endingAt.getTime() - startingAt.getTime()) / (24 * 60 * 60 * 1000), 0);
  if (days === 0) return null;

  const tradePrice = trade?.price ? Number.parseFloat(trade.price) : NaN;
  const hive = Number.isFinite(tradePrice) && tradePrice > 0 ? total * tradePrice : null;
  const usd = hive !== null && hiveUsdPrice !== null ? hive * hiveUsdPrice : null;
  const usdPerDay = usd === null ? null : usd / days;

  return {
    ...totals,
    startingAt,
    endingAt,
    total,
    hive,
    usd,
    usdPerDay,
  };
}

function summarizeRewards(
  accountName: string,
  operations: HiveRewardOperation[],
  hivePerVest: number,
  hbdPerHive: number | null,
  hiveUsdPrice: number | null,
): RewardSummary | null {
  const totals: RewardTotals = {
    producer: 0,
    interest: 0,
    curation: 0,
    author: 0,
    benefactor: 0,
  };
  let startingAt: Date | null = null;
  let endingAt: Date | null = null;

  for (const operation of operations) {
    const timestamp = parseHiveDate(operation.timestamp);
    startingAt = !startingAt || timestamp.getTime() < startingAt.getTime() ? timestamp : startingAt;
    endingAt = !endingAt || timestamp.getTime() > endingAt.getTime() ? timestamp : endingAt;
    applyRewardOperation(accountName, operation, totals, hivePerVest, hbdPerHive);
  }

  if (!startingAt || !endingAt) return null;

  const total = totals.producer + totals.interest + totals.curation + totals.author + totals.benefactor;
  const days = Math.max((endingAt.getTime() - startingAt.getTime()) / (24 * 60 * 60 * 1000), 0);
  if (days === 0) return null;

  const usd = hiveUsdPrice === null ? null : total * hiveUsdPrice;
  const usdPerDay = usd === null ? null : usd / days;

  return {
    ...totals,
    startingAt,
    endingAt,
    total,
    usd,
    usdPerDay,
  };
}

function applyRewardOperation(
  accountName: string,
  operation: HiveRewardOperation,
  totals: RewardTotals,
  hivePerVest: number,
  hbdPerHive: number | null,
) {
  const value = operation.value;
  const type = operation.type === "interest" ? "interest" : operation.type.replace(/_reward$/, "");

  if (type === "producer") {
    totals.producer += rewardValue(value, hivePerVest, hbdPerHive);
  } else if (type === "curation") {
    totals.curation += rewardValue(value, hivePerVest, hbdPerHive);
  } else if (type === "interest") {
    totals.interest += hbdToHive(parseAssetField(value, "interest"), hbdPerHive);
  } else if (type === "author" && value.author === accountName) {
    totals.author += payoutValue(value, hivePerVest, hbdPerHive);
  } else if (type === "comment_benefactor" && value.benefactor === accountName) {
    totals.benefactor += payoutValue(value, hivePerVest, hbdPerHive);
  }
}

function rewardValue(value: Record<string, unknown>, hivePerVest: number, hbdPerHive: number | null): number {
  if (typeof value.reward === "string") return assetToHive(value.reward, hivePerVest, hbdPerHive);
  if (typeof value.vesting_shares === "string") return parseAsset(value.vesting_shares) * hivePerVest;
  return 0;
}

function payoutValue(value: Record<string, unknown>, hivePerVest: number, hbdPerHive: number | null): number {
  return (
    hbdToHive(parseAssetField(value, "hbd_payout"), hbdPerHive) +
    parseAssetField(value, "hive_payout") +
    parseAssetField(value, "vesting_payout") * hivePerVest
  );
}

function parseAssetField(value: Record<string, unknown>, key: string): number {
  return typeof value[key] === "string" ? parseAsset(value[key]) : 0;
}

function assetToHive(asset: string, hivePerVest: number, hbdPerHive: number | null): number {
  const symbol = asset.split(" ").at(-1);
  if (symbol === "HIVE") return parseAsset(asset);
  if (symbol === "HBD") return hbdToHive(parseAsset(asset), hbdPerHive);
  if (symbol === "VESTS") return parseAsset(asset) * hivePerVest;
  return 0;
}

function hbdToHive(value: number, hbdPerHive: number | null): number {
  return hbdPerHive && hbdPerHive > 0 ? value * hbdPerHive : 0;
}

function parseFeedPrice(base: string, quote: string): number | null {
  const baseAmount = parseAsset(base);
  const quoteAmount = parseAsset(quote);
  if (baseAmount <= 0 || quoteAmount <= 0) return null;

  return baseAmount / quoteAmount;
}

function formatRewards(accountName: string, summary: RewardSummary): EmbedBuilder {
  const embed = banjoEmbed()
    .setTitle(`HIVE rewards for ${accountName}`)
    .setURL(hiveHubAccountUrl(accountName))
    .setThumbnail(`https://images.hive.blog/u/${encodeURIComponent(accountName)}/avatar`)
    .setDescription(`Since ${formatRelativeAge(summary.startingAt)} ago (${formatUtc(summary.startingAt)} UTC)`)
    .setFooter({ text: "Hive Account History", iconURL: HIVE_TOKEN_ICON_URL });

  embed.addFields([
    dataField("Producer", formatRewardValue(summary.producer)),
    dataField("Interest", formatRewardValue(summary.interest)),
    dataField("Curation / Author / Benefactor", [
      formatRewardValue(summary.curation),
      formatRewardValue(summary.author),
      formatRewardValue(summary.benefactor),
    ].join(" / "), false),
    dataField("Total / USD / USD Per Day", [
      formatRewardValue(summary.total),
      summary.usd === null ? "None" : formatNumber(summary.usd, 2),
      summary.usdPerDay === null ? "None" : formatNumber(summary.usdPerDay, 2),
    ].join(" / "), false),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function formatScotRewards(accountName: string, symbol: string, summary: ScotRewardSummary, token: HiveEngineToken | null): EmbedBuilder {
  const metadata = parseTokenMetadata(token?.metadata);
  const embed = banjoEmbed()
    .setTitle(`${symbol} rewards for ${accountName}`)
    .setURL(hiveHubAccountUrl(accountName))
    .setThumbnail(normalizeTokenIconUrl(symbol, metadata.icon))
    .setDescription(`Since ${formatRelativeAge(summary.startingAt)} ago (${formatUtc(summary.startingAt)} UTC)`)
    .setFooter({
      text: "SCOT + Hive Engine",
      iconURL: "https://hive-engine.com/images/hive_engine.png",
    });

  embed.addFields([
    dataField("Staking", formatRewardValue(summary.staking)),
    dataField("Mining", formatRewardValue(summary.mining)),
    dataField("HIVE", summary.hive === null ? "None" : formatNumber(summary.hive, 3)),
    dataField("Curation / Author / Benefactor", [
      formatRewardValue(summary.curation),
      formatRewardValue(summary.author),
      formatRewardValue(summary.benefactor),
    ].join(" / "), false),
    dataField("Total / USD / USD Per Day", [
      formatRewardValue(summary.total),
      summary.usd === null ? "None" : formatNumber(summary.usd, 2),
      summary.usdPerDay === null ? "None" : formatNumber(summary.usdPerDay, 2),
    ].join(" / "), false),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function formatRewardValue(value: number): string {
  return value === 0 ? "None" : formatNumber(value, 3);
}

function formatTicker(ticker: MarketTicker, feedBase: string, feedQuote: string): EmbedBuilder {
  const feedPrice = parseFeedPrice(feedBase, feedQuote);
  const embed = banjoEmbed()
    .setTitle("Hive Market Ticker")
    .setURL("https://www.coingecko.com/en/coins/hive")
    .setThumbnail(HIVE_TOKEN_ICON_URL)
    .setFooter({ text: "CoinGecko + Hive feed", iconURL: HIVE_TOKEN_ICON_URL });

  embed.addFields([
    dataField("HIVE/USD", `$${formatNumber(ticker.usd, ticker.usd >= 1 ? 2 : 4)}`),
    dataField("Feed", feedPrice === null ? null : `${formatNumber(feedPrice, 4)} HBD / HIVE`),
    dataField("24h", ticker.usd24hChange === null ? null : formatSignedPercent(ticker.usd24hChange)),
    dataField("Volume", ticker.usd24hVolume === null ? null : `$${formatNumber(ticker.usd24hVolume, 0)}`),
    dataField("Market Cap", ticker.usdMarketCap === null ? null : `$${formatNumber(ticker.usdMarketCap, 0)}`),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function formatFeedPrice(feedHistory: HiveFeedHistory): EmbedBuilder {
  const embed = banjoEmbed()
    .setTitle("Hive Feed Price")
    .setFooter({ text: "Hive feed", iconURL: HIVE_TOKEN_ICON_URL });

  embed.addFields([
    dataField("Median", formatPrice(feedHistory.current_median_history)),
    dataField("Market Median", feedHistory.market_median_history ? formatPrice(feedHistory.market_median_history) : null),
    dataField("Low", feedHistory.current_min_history ? formatPrice(feedHistory.current_min_history) : null),
    dataField("High", feedHistory.current_max_history ? formatPrice(feedHistory.current_max_history) : null),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function formatFeedPolicy(globals: HiveDynamicGlobalProperties): EmbedBuilder {
  const embed = banjoEmbed()
    .setTitle("Hive HBD Policy")
    .setFooter({ text: "Hive feed", iconURL: HIVE_TOKEN_ICON_URL });

  embed.addFields([
    dataField("HBD Interest Rate", typeof globals.hbd_interest_rate === "number" ? formatProtocolPercent(globals.hbd_interest_rate) : null),
    dataField("HBD Print Rate", typeof globals.hbd_print_rate === "number" ? formatProtocolPercent(globals.hbd_print_rate) : null),
    dataField("Start Reducing", typeof globals.hbd_start_percent === "number" ? formatProtocolPercent(globals.hbd_start_percent) : null),
    dataField("Stop Printing", typeof globals.hbd_stop_percent === "number" ? formatProtocolPercent(globals.hbd_stop_percent) : null),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function formatSupply(globals: HiveDynamicGlobalProperties): EmbedBuilder {
  const embed = banjoEmbed()
    .setTitle("Hive Supply")
    .setFooter({ text: "Hive dynamic global properties", iconURL: HIVE_TOKEN_ICON_URL });

  embed.addFields([
    dataField("Current HIVE", globals.current_supply ? formatAsset(globals.current_supply, 3) : null),
    dataField("Virtual HIVE", globals.virtual_supply ? formatAsset(globals.virtual_supply, 3) : null),
    dataField("Current HBD", globals.current_hbd_supply ? formatAsset(globals.current_hbd_supply, 3) : null),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function formatSignedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${formatNumber(value, 2)}%`;
}

function normalizePriceSymbol(value: string): string {
  return value.replace(/^\$/, "").toUpperCase();
}

function priceDecimals(symbol: string, price: number): number {
  if (symbol === "HBD") return 2;
  return price >= 1 ? 2 : 4;
}

function normalizeTokenSymbol(value: string): string {
  return value.replace(/^\$/, "").toUpperCase().trim();
}

function isNativeHiveToken(symbol: string): symbol is "HIVE" | "HBD" {
  return symbol === "HIVE" || symbol === "HBD";
}

function wrappedTokenSuggestion(symbol: string): string | null {
  return WRAPPED_TOKEN_SYMBOLS.has(symbol) ? `Did you mean: SWAP.${symbol}` : null;
}

async function loadOptionalScotConfig(context: CommandContext): Promise<ScotConfigEntry[] | null> {
  try {
    return await scotApi(context).getConfig();
  } catch (error) {
    context.logger.warn("Unable to load SCOT token hints.", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function readRichlistCount(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(25, Math.max(1, parsed)) : 13;
}

function readStakedCount(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(25, Math.max(1, parsed)) : 12;
}

function formatHiveEngineRichlist(token: HiveEngineToken, balances: HiveEngineBalance[], count: number, truncated: boolean): EmbedBuilder {
  const symbol = token.symbol;
  const metadata = parseTokenMetadata(token.metadata);
  const sorted = balances
    .map((balance) => ({
      account: balance.account,
      symbol: balance.symbol,
      total: hiveEngineBalanceTotal(balance),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, count);
  const nullBalance = sorted.find((balance) => balance.account === "null");
  const displayBalances = sorted.filter((balance) => balance.account !== "null");

  const embed = banjoEmbed()
    .setTitle(`Top ${displayBalances.length} by Total Balance: ${symbol}`)
    .setURL(`https://he.dtools.dev/richlist/${encodeURIComponent(symbol)}`)
    .setThumbnail(normalizeTokenIconUrl(symbol, metadata.icon))
    .setDescription(displayBalances.map((balance, index) =>
      `${index + 1}. [${balance.account}](https://he.dtools.dev/@${encodeURIComponent(balance.account)}?symbol=${encodeURIComponent(symbol)}) - \`${formatNumber(balance.total, 0)} ${balance.symbol}\``
    ).join("\n"))
    .setFooter({
      text: "Hive Engine",
      iconURL: "https://hive-engine.com/images/hive_engine.png",
    });

  embed.addFields([
    dataField("Null Balance", nullBalance ? `${formatNumber(nullBalance.total, 0)} ${nullBalance.symbol}` : null),
    dataField("Note", truncated ? "Hive Engine returned more balances than the RPC offset limit allows; ranked from the first 11,000 rows." : null, false),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function formatHiveEngineStaked(token: HiveEngineToken, balances: HiveEngineBalance[], count: number, truncated: boolean): string | EmbedBuilder {
  const symbol = token.symbol;
  const metadata = parseTokenMetadata(token.metadata);
  const totalStake = balances.reduce((sum, balance) => sum + parseHiveEngineNumber(balance.stake), 0);
  if (totalStake === 0) return `Nobody has staked \`${symbol}\` yet.`;

  const sorted = balances
    .map((balance) => ({
      account: balance.account,
      symbol: balance.symbol,
      stake: parseHiveEngineNumber(balance.stake),
    }))
    .filter((balance) => balance.stake > 0)
    .sort((a, b) => b.stake - a.stake)
    .slice(0, count);

  const embed = banjoEmbed()
    .setTitle(`Top ${sorted.length} by Stake: ${symbol}`)
    .setThumbnail(normalizeTokenIconUrl(symbol, metadata.icon))
    .setDescription(sorted.map((balance, index) =>
      `${index + 1}. [${balance.account}](${hiveEngineAccountUrl(balance.account, symbol)}) - \`${formatNumber(balance.stake, 0)} ${balance.symbol} POWER\` (${formatNumber((balance.stake / totalStake) * 100, 2)}%)`
    ).join("\n"))
    .setFooter({
      text: "Hive Engine",
      iconURL: "https://hive-engine.com/images/hive_engine.png",
    });

  embed.addFields([
    dataField("Total Stake", `${formatNumber(totalStake, 0)} ${symbol} POWER`),
    dataField("Results", String(sorted.length)),
    dataField("Note", truncated ? "Hive Engine returned more balances than the RPC offset limit allows; percentages use the first 11,000 rows." : null, false),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function hiveEngineAccountUrl(account: string, symbol: string): string {
  return `https://he.dtools.dev/@${encodeURIComponent(account)}?symbol=${encodeURIComponent(symbol)}`;
}

function hiveEngineBalanceTotal(balance: HiveEngineBalance): number {
  return (
    parseHiveEngineNumber(balance.balance) +
    parseHiveEngineNumber(balance.stake) +
    parseHiveEngineNumber(balance.pendingUnstake)
  );
}

function parseHiveEngineNumber(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTokenDirectory(): { embeds: EmbedBuilder[] } {
  const embed = new EmbedBuilder()
    .setTitle("Token Lookup")
    .setDescription("Hive Engine market: [BEE](https://hive-engine.com/trade/BEE)")
    .addFields(
      {
        name: "Native",
        value: "`HIVE` `HBD`",
        inline: false,
      },
      {
        name: "Wrapped",
        value: "`SWAP.HIVE` `SWAP.HBD` `SWAP.BTC` `SWAP.LTC`",
        inline: false,
      },
      {
        name: "Communities",
        value: "`LEO` `NEOXAG` `CENT` `POB`",
        inline: false,
      },
      {
        name: "Games",
        value: "`SPS` `DEC` `GLX` `SIM`",
        inline: false,
      },
      {
        name: "Hive Engine",
        value: "`BEE` `PIZZA` `WORKERBEE`",
        inline: false,
      },
    )
    .setFooter({
      text: "Use $token <symbol>",
      iconURL: "https://hive-engine.com/images/hive_engine.png",
    });

  return { embeds: [embed] };
}

function formatNativeHiveToken(
  symbol: "HIVE" | "HBD",
  globals: HiveDynamicGlobalProperties,
  feedHistory: HiveFeedHistory,
  ticker: HiveMarketTicker,
): EmbedBuilder {
  const feedPrice = parseFeedPrice(feedHistory.current_median_history.base, feedHistory.current_median_history.quote);
  const latest = parseHiveEngineNumber(ticker.latest);
  const highestBid = parseHiveEngineNumber(ticker.highest_bid);
  const lowestAsk = parseHiveEngineNumber(ticker.lowest_ask);
  const percentChange = Number.parseFloat(ticker.percent_change ?? "");
  const supply = symbol === "HIVE" ? globals.current_supply : globals.current_hbd_supply;
  const embed = new EmbedBuilder()
    .setTitle(`\`${symbol}\` native Hive asset`)
    .setURL("https://hive.io/")
    .setDescription([
      nativeHiveTokenDescription(symbol),
      "Trade [HIVE/HBD](https://wallet.hive.blog/market)",
    ].join("\n"))
    .setThumbnail(HIVE_TOKEN_ICON_URL)
    .setFooter({ text: "Hive", iconURL: HIVE_TOKEN_ICON_URL });

  if (supply) {
    embed.addFields({
      name: "Current Supply",
      value: `\`${formatAsset(supply, 3)}\``,
      inline: true,
    });
  }

  if (latest > 0) {
    embed.addFields({
      name: "Last Price",
      value: `\`${formatNativeHiveMarketPrice(symbol, latest)}\``,
      inline: true,
    });
  }

  if (lowestAsk > 0) {
    embed.addFields({
      name: "Lowest Ask",
      value: `\`${formatNativeHiveMarketPrice(symbol, lowestAsk)}\``,
      inline: true,
    });
  }

  if (highestBid > 0) {
    embed.addFields({
      name: "Highest Bid",
      value: `\`${formatNativeHiveMarketPrice(symbol, highestBid)}\``,
      inline: true,
    });
  }

  const volume = formatNativeHiveVolume(ticker);
  if (volume) {
    embed.addFields({
      name: "Volume",
      value: `\`${volume}\``,
      inline: true,
    });
  }

  if (Number.isFinite(percentChange)) {
    embed.addFields({
      name: "Change",
      value: `\`${formatSignedPercent(percentChange)}\``,
      inline: true,
    });
  }

  if (symbol === "HIVE" && globals.virtual_supply) {
    embed.addFields({
      name: "Virtual Supply",
      value: `\`${formatAsset(globals.virtual_supply, 3)}\``,
      inline: true,
    });
  }

  if (symbol === "HBD" && typeof globals.hbd_interest_rate === "number") {
    embed.addFields({
      name: "Interest Rate",
      value: `\`${formatNumber(globals.hbd_interest_rate / 100, 2)}%\``,
      inline: true,
    });
  }

  if (feedPrice !== null) {
    embed.addFields({
      name: "Feed",
      value: `\`${formatNumber(feedPrice, 4)} HBD / HIVE\``,
      inline: true,
    });
  }

  return embed;
}

function formatNativeHiveMarketPrice(symbol: "HIVE" | "HBD", hbdPerHive: number): string {
  if (symbol === "HBD") return `${formatNumber(1 / hbdPerHive, 3)} HIVE / HBD`;
  return `${formatNumber(hbdPerHive, 3)} HBD / HIVE`;
}

function formatNativeHiveVolume(ticker: HiveMarketTicker): string | null {
  const hiveVolume = ticker.hive_volume ? formatAsset(ticker.hive_volume, 3) : null;
  const hbdVolume = ticker.hbd_volume ? formatAsset(ticker.hbd_volume, 3) : null;
  return [hiveVolume, hbdVolume].filter(Boolean).join(" / ") || null;
}

function nativeHiveTokenDescription(symbol: "HIVE" | "HBD"): string {
  if (symbol === "HBD") {
    return "Hive-backed stable asset used for savings, payments, and the internal market.";
  }

  return "Native governance and resource token for the Hive blockchain.";
}

function formatHiveEngineToken(
  token: HiveEngineToken,
  trade: HiveEngineTrade | null,
  metrics: HiveEngineMarketMetrics | null,
  hiveUsdPrice: number | null,
  scotHint: string | null,
): EmbedBuilder {
  const metadata = parseTokenMetadata(token.metadata);
  const marketUrl = hiveEngineMarketUrl(token.symbol);
  const description = [
    metadata.desc ? truncateText(metadata.desc, 600) : null,
    metadata.url ? `See: [${token.name ?? token.symbol}](${normalizeMetadataUrl(metadata.url)})` : null,
    `Trade [${token.symbol}](${marketUrl})`,
    scotHint,
  ].filter(Boolean).join("\n");
  const embed = new EmbedBuilder()
    .setTitle(`\`${token.symbol}\` issued by \`@${token.issuer ?? "unknown"}\``)
    .setURL(hiveEngineTokenUrl(token.symbol))
    .setDescription(description)
    .setThumbnail(normalizeTokenIconUrl(token.symbol, metadata.icon))
    .setFooter({
      text: "Hive Engine",
      iconURL: "https://hive-engine.com/images/hive_engine.png",
    });

  const supply = Number.parseFloat(token.circulatingSupply ?? "");
  if (Number.isFinite(supply)) {
    embed.addFields({
      name: "Circulating Supply",
      value: `\`${formatNumber(supply, 0)} ${token.symbol}\``,
      inline: true,
    });
  }

  const tradeField = trade ? formatTokenTradeField(trade, hiveUsdPrice) : null;
  if (tradeField) embed.addFields(tradeField);

  if (metrics) embed.addFields(formatTokenMetricFields(metrics, hiveUsdPrice));

  return embed;
}

function formatHiveEngineNft(nft: HiveEngineNft): EmbedBuilder {
  const metadata = parseTokenMetadata(nft.metadata);
  const embed = banjoEmbed()
    .setTitle(`${nft.symbol} issued by @${nft.issuer ?? "unknown"}`)
    .setURL(`https://he.dtools.dev/nfts/${encodeURIComponent(nft.symbol)}`)
    .setFooter({
      text: "Hive Engine NFT",
      iconURL: "https://hive-engine.com/images/hive_engine.png",
    });

  if (metadata.desc) embed.setDescription(truncateEmbedText(metadata.desc, 600));

  embed.addFields([
    dataField("Name", nft.name ?? null),
    dataField(
      "Circulating Supply",
      nft.circulatingSupply ? `${formatNumber(Number.parseFloat(nft.circulatingSupply), 0)} ${nft.symbol}` : null,
    ),
    dataField("Metadata", metadata.url ? `[${nft.name ?? nft.symbol}](${normalizeMetadataUrl(metadata.url)})` : null, false),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function readOptionalIndex(value: string | undefined): number | string {
  if (!value) return 0;
  const index = Number.parseInt(value, 10);
  if (!Number.isFinite(index)) return "Usage: `$nftsr [owner] [index]`";

  return Math.abs(index);
}

function formatNftShowroomResponse(art: NftShowroomArt, account: string | null, index: number) {
  return {
    embeds: [formatNftShowroomArt(art)],
    components: renderNftShowroomComponents(account, index),
  };
}

function formatNftShowroomArt(art: NftShowroomArt): EmbedBuilder {
  const created = art.createdAt ? parseHiveDate(art.createdAt) : null;
  const embed = banjoEmbed()
    .setTitle(truncateEmbedText(art.title, 256))
    .setURL(`https://nftshowroom.com/gallery/${encodeURIComponent(art.series)}?collection=true`)
    .setFooter({ text: "NFT Showroom" });

  if (art.description) embed.setDescription(truncateEmbedText(art.description, 600));
  if (art.image) embed.setImage(art.image);
  embed.setThumbnail(`https://images.hive.blog/u/${encodeURIComponent(art.artist)}/avatar`);

  embed.addFields([
    dataField("Artist", `@${art.artist}`),
    dataField("Collection", art.collection ? truncateEmbedText(art.collection, 80) : null),
    dataField("Note", art.note ? truncateEmbedText(art.note, 80) : null),
    dataField("Created", created ? `${formatRelativeAge(created)} ago (${formatUtc(created)} UTC)` : null, false),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function renderNftShowroomComponents(account: string | null, index: number): Array<ActionRowBuilder<ButtonBuilder>> {
  const previousIndex = Math.max(0, index - 1);
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(nftsrButtonId("previous", account, previousIndex))
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(index === 0),
      new ButtonBuilder()
        .setCustomId(nftsrButtonId("next", account, index + 1))
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function nftsrButtonId(direction: "previous" | "next", account: string | null, index: number): string {
  return [
    nftsrButtonPrefix,
    direction,
    encodeURIComponent(account ?? nftsrNoAccount),
    String(index),
  ].join(":");
}

export async function handleNftShowroomInteraction(interaction: ButtonInteraction, config: AppConfig, logger: Logger): Promise<boolean> {
  const request = parseNftShowroomButtonId(interaction.customId);
  if (!request) return false;

  await interaction.deferUpdate();

  const hiveEngine = new HiveEngineRpcClient(config, logger);
  const art = await hiveEngine.getNftShowroomArt(request.account, request.index);
  if (!art) {
    await interaction.followUp({ content: "Unable to find another NFT Showroom item.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!art.published) {
    await interaction.followUp({ content: "That NFT Showroom item is unpublished.", flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.message.edit(formatNftShowroomResponse(art, request.account, request.index));
  return true;
}

function parseNftShowroomButtonId(customId: string): { account: string | null; index: number } | null {
  const [prefix, direction, accountValue, indexValue] = customId.split(":");
  if (prefix !== nftsrButtonPrefix || (direction !== "previous" && direction !== "next") || !accountValue) return null;

  const index = Number.parseInt(indexValue ?? "", 10);
  if (!Number.isFinite(index) || index < 0) return null;

  const decodedAccount = decodeURIComponent(accountValue);
  return {
    account: decodedAccount === nftsrNoAccount ? null : decodedAccount,
    index,
  };
}

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

function formatScotTags(config: ScotConfigEntry[], symbols: string[]): string {
  const symbolSet = new Set(symbols);
  const lines = config
    .filter((entry) => symbolSet.has(entry.token.toUpperCase()))
    .map(formatScotConfigEntry)
    .filter((line): line is string => typeof line === "string");

  if (lines.length === 0) {
    return `Unknown SCOT token${symbols.length === 1 ? "" : "s"}: ${symbols.join(", ")}`;
  }

  return ["```", ...lines, "```"].join("\n");
}

function formatScotConfigEntry(entry: ScotConfigEntry): string | null {
  const token = entry.token.toUpperCase();
  const metadataKey = entry.json_metadata_key;
  const metadataValue = entry.json_metadata_value ?? "";
  const community = entry.hive_community ?? "";

  if (metadataKey === "tags") {
    const tags = unique([community, ...metadataValue.split(/[ ,]/)].map((tag) => tag.trim()).filter(Boolean));
    return `${token}: ${tags.join(" ")}`;
  }
  if (metadataKey === "community") {
    return `${token} (community only): ${community || "none"}`;
  }
  if (metadataKey === "app") {
    return `${token} (app only): ${metadataValue || "none"}`;
  }

  return null;
}

async function formatScotTokenHint(context: CommandContext, config: ScotConfigEntry[], symbol: string): Promise<string | null> {
  const entry = config.find((item) => item.token.toUpperCase() === symbol.toUpperCase());
  if (!entry) return null;

  const community = entry.hive_community?.trim();
  if (community) {
    let label = community;
    try {
      label = (await hiveApi(context).getCommunity(community))?.title ?? community;
    } catch (error) {
      context.logger.warn("Unable to resolve SCOT community name.", {
        community,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return `Also see: [${label}](https://hive.blog/trending/${encodeURIComponent(community)})`;
  }

  const metadataValue = entry.json_metadata_value?.trim();
  if (entry.json_metadata_key === "app" && metadataValue) return `Also see app: \`${metadataValue}\``;

  return null;
}

function formatCommunity(community: HiveCommunity): EmbedBuilder {
  const owner = community.team?.find((member) => member[1] === "owner")?.[0];
  const title = community.title ?? community.name;
  const description = [community.about ? `**${community.about}**` : null, community.description ? truncateEmbedText(community.description, 600) : null]
    .filter(Boolean)
    .join("\n");
  const createdAt = community.created_at ? parseHiveDate(community.created_at.replace(" ", "T")) : null;
  const embed = banjoEmbed()
    .setTitle(title)
    .setURL(`https://hive.blog/trending/${community.name}${community.title ? `#${slugify(community.title)}` : ""}`)
    .setThumbnail(`https://images.hive.blog/u/${community.name}/avatar`)
    .setFooter({ text: "Hivemind Communities", iconURL: HIVE_TOKEN_ICON_URL });

  if (description) embed.setDescription(description);

  embed.addFields([
    dataField("Owner", owner ? `@${owner}` : null),
    dataField("Subscribers", typeof community.subscribers === "number" ? formatInteger(community.subscribers) : null),
    dataField("Pending Rewards", typeof community.sum_pending === "number" ? `$${formatNumber(community.sum_pending, 0)}` : null),
    dataField("Active Authors", typeof community.num_authors === "number" ? formatInteger(community.num_authors) : null),
    dataField("Created", createdAt ? `${formatRelativeAge(createdAt)} ago (${formatUtc(createdAt)} UTC)` : null, false),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function parseSearchArgs(args: string[], now = new Date()): HiveSqlSearchOptions | string {
  const keywords: string[] = [];
  const tags: string[] = [];
  const excludedTags: string[] = [];
  let after: Date | null = null;
  let before: Date | null = null;

  for (const arg of args) {
    const value = arg.trim();
    if (!value) continue;

    if (/^!tag:/i.test(value)) {
      const tag = value.slice(value.indexOf(":") + 1).toLowerCase();
      if (tag) excludedTags.push(tag);
      continue;
    }

    if (/^tag:/i.test(value)) {
      const tag = value.slice(value.indexOf(":") + 1).toLowerCase();
      if (tag) tags.push(tag);
      continue;
    }

    if (/^after:/i.test(value)) {
      const parsed = parseSearchDate(value.slice(value.indexOf(":") + 1), false);
      if (!parsed) return `Unable to parse search date: \`${value}\``;
      after = parsed;
      continue;
    }

    if (/^before:/i.test(value)) {
      const parsed = parseSearchDate(value.slice(value.indexOf(":") + 1), true);
      if (!parsed) return `Unable to parse search date: \`${value}\``;
      before = parsed;
      continue;
    }

    keywords.push(value.toLowerCase());
  }

  before ??= now;
  after ??= new Date(before.getTime() - 24 * 60 * 60 * 1000);
  if (after.getTime() > before.getTime()) return "`after:` must be earlier than `before:`.";

  return {
    keywords,
    tags: unique(tags),
    excludedTags: unique(excludedTags),
    after,
    before,
    limit: 81,
  };
}

function parseSearchDate(value: string, endOfDay: boolean): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
    const date = new Date(`${trimmed}${suffix}`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const normalized = trimmed.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(trimmed) ? trimmed : `${trimmed}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function formatSearchResult(options: HiveSqlSearchOptions, result: HiveSqlSearchResult, hive: HiveApi) {
  const keywords = options.keywords.join(" ");
  const subject = keywords || options.tags.map((tag) => `tag:${tag}`).join(" ");
  const tags = [
    options.tags.length > 0 ? ` in ${options.tags.join(", ")}` : "",
    options.excludedTags.length > 0 ? ` not in ${options.excludedTags.join(", ")}` : "",
  ].join("");
  const timeframe = searchTimeframe(options);

  if (result.total === 0) return `No authors wrote about \`${subject}\` ${timeframe}${tags}.`;
  if (result.authorCount > 500) return `Too many authors in \`${subject}\` timeframe (${result.authorCount}). Try a more narrow timeframe.`;
  if (result.total > 80) return `Too many results for \`${subject}\` (${result.total})${tags}.`;

  const cacheId = rememberSearchResult(options, result);
  return formatSearchResultPage(cacheId, 0, hive);
}

function rememberSearchResult(options: HiveSqlSearchOptions, result: HiveSqlSearchResult): string {
  const now = Date.now();
  for (const [cacheId, cached] of searchResultCache.entries()) {
    if (now - cached.createdAt > 30 * 60 * 1000) searchResultCache.delete(cacheId);
  }

  const cacheId = (++searchResultCacheCounter).toString(36);
  searchResultCache.set(cacheId, { options, result, posts: new Map(), createdAt: now });
  return cacheId;
}

async function formatSearchResultPage(cacheId: string, selectedIndex: number, hive: HiveApi) {
  const cached = searchResultCache.get(cacheId);
  if (!cached) return asEmbedResponse(banjoEmbed().setTitle("Hive Search Results").setDescription("That search result cache expired."));
  if (cached.result.comments.length === 0) return asEmbedResponse(banjoEmbed().setTitle("Hive Search Results").setDescription("No cached search results."));

  const index = Math.max(0, Math.min(selectedIndex, cached.result.comments.length - 1));
  const post = await hydrateSearchPost(cached, index, hive);
  return {
    embeds: [formatSearchResultEmbed(cached.options, cached.result, index, post)],
    components: renderSearchResultComponents(cacheId, cached.result.comments.length, index),
  };
}

async function hydrateSearchPost(
  cached: { result: HiveSqlSearchResult; posts: Map<string, HivePost | null> },
  selectedIndex: number,
  hive: HiveApi,
): Promise<HivePost | null> {
  const comment = cached.result.comments[selectedIndex];
  if (!comment) return null;

  const key = `${comment.author}/${comment.permlink}`;
  if (cached.posts.has(key)) return cached.posts.get(key) ?? null;

  const post = await hive.getPostCreation(comment.author, comment.permlink);
  cached.posts.set(key, post);
  return post;
}

function formatSearchResultEmbed(options: HiveSqlSearchOptions, result: HiveSqlSearchResult, selectedIndex: number, post: HivePost | null): EmbedBuilder {
  const comment = result.comments[selectedIndex];
  if (!comment) {
    return banjoEmbed()
      .setTitle("Hive Search Results")
      .setDescription("No cached search results.")
      .setFooter({ text: "HiveSQL", iconURL: HIVE_TOKEN_ICON_URL });
  }
  const keywords = options.keywords.join(" ");
  const subject = keywords || options.tags.map((tag) => `tag:${tag}`).join(" ");
  const timeframe = searchTimeframe(options);
  const resultNumber = selectedIndex + 1;
  const postPreview = proposalPostPreview(post);
  const title = post?.title || comment.title || `@${comment.author}/${comment.permlink}`;
  const embed = banjoEmbed()
    .setTitle(truncateEmbedText(title, 256))
    .setURL(searchCommentUrl(comment))
    .setThumbnail(`https://images.hive.blog/u/${encodeURIComponent(comment.author)}/avatar`)
    .setDescription([
      searchCommentLink(comment),
      postPreview.description,
    ].filter(Boolean).join("\n"))
    .setFooter({ text: `${formatInteger(result.total)} results by ${pluralize(result.authorCount, "author")}`, iconURL: HIVE_TOKEN_ICON_URL });

  if (postPreview.image) embed.setImage(postPreview.image);

  embed.addFields([
    dataField("Result", `${resultNumber} / ${formatInteger(result.total)}`),
    dataField("Author", `@${comment.author}`),
    dataField("Created", comment.created ? `${formatRelativeAge(comment.created)} ago (${formatUtc(comment.created)} UTC)` : null),
    dataField("Query", subject),
    dataField("Tags", formatSearchTags(options)),
    dataField("Timeframe", timeframe),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function renderSearchResultComponents(cacheId: string, resultCount: number, selectedIndex: number): Array<ActionRowBuilder<ButtonBuilder>> {
  if (resultCount <= 0) return [];

  const buttons: ButtonBuilder[] = [];
  if (resultCount > 1) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(searchButtonId(cacheId, selectedIndex - 1))
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(selectedIndex === 0),
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(searchSummaryButtonId(cacheId, selectedIndex))
      .setLabel("Summarize")
      .setStyle(ButtonStyle.Primary),
  );

  if (resultCount > 1) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(searchButtonId(cacheId, selectedIndex + 1))
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(selectedIndex >= resultCount - 1),
    );
  }

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons),
  ];
}

function searchButtonId(cacheId: string, selectedIndex: number): string {
  return [searchButtonPrefix, cacheId, Math.max(0, selectedIndex)].join(":");
}

function searchSummaryButtonId(cacheId: string, selectedIndex: number): string {
  return [searchButtonPrefix, "summary", cacheId, Math.max(0, selectedIndex)].join(":");
}

function renderSearchLoadingComponents(): Array<ActionRowBuilder<ButtonBuilder>> {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${searchButtonPrefix}:loading`)
        .setLabel("Loading...")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    ),
  ];
}

export async function handleSearchInteraction(interaction: ButtonInteraction, config: AppConfig, logger: Logger): Promise<boolean> {
  const request = parseSearchButtonId(interaction.customId);
  if (!request) return false;

  const hive = new HiveRpcClient(config, logger);
  if (request.action === "summary") {
    await interaction.deferReply();
    await clearSearchSummaryReply(interaction);

    if (!searchResultCache.has(request.cacheId)) {
      await interaction.editReply({ content: "That search result cache expired. Run the search again." });
      return true;
    }

    const summary = await formatSearchResultSummary(request.cacheId, request.selectedIndex, hive, new OpenAiHivePostSummarizer(config, logger));
    await interaction.editReply(summary);
    await rememberSearchSummaryReply(interaction);
    return true;
  }

  await interaction.deferUpdate();
  await clearSearchSummaryReply(interaction);

  if (!searchResultCache.has(request.cacheId)) {
    await interaction.followUp({ content: "That search result cache expired. Run the search again.", flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.message.edit({ components: renderSearchLoadingComponents() }).catch(() => undefined);
  await interaction.message.edit(await formatSearchResultPage(request.cacheId, request.selectedIndex, hive));
  return true;
}

async function rememberSearchSummaryReply(interaction: ButtonInteraction): Promise<void> {
  const reply = await interaction.fetchReply().catch(() => null);
  if (reply && typeof (reply as { delete?: unknown }).delete === "function") {
    searchSummaryReplies.set(interaction.message.id, reply as { delete(): Promise<unknown> });
  }
}

async function clearSearchSummaryReply(interaction: ButtonInteraction): Promise<void> {
  const reply = searchSummaryReplies.get(interaction.message.id);
  if (!reply) return;

  searchSummaryReplies.delete(interaction.message.id);
  await reply.delete().catch(() => undefined);
}

async function formatSearchResultSummary(cacheId: string, selectedIndex: number, hive: HiveApi, summarizer: HivePostSummarizer) {
  const cached = searchResultCache.get(cacheId);
  if (!cached) return { content: "That search result cache expired. Run the search again." };

  const index = Math.max(0, Math.min(selectedIndex, cached.result.comments.length - 1));
  const comment = cached.result.comments[index];
  if (!comment) return { content: "No cached search result to summarize." };

  const post = await hydrateSearchPost(cached, index, hive);
  if (!post) return { content: `Unable to find post @${comment.author}/${comment.permlink} on Hive.` };

  const summary = await summarizer.summarizePost(post);
  if (!summary) return { content: "LLM summarization is not configured." };

  return { content: summary };
}

function parseSearchButtonId(customId: string): { action: "page" | "summary"; cacheId: string; selectedIndex: number } | null {
  const parts = customId.split(":");
  const [prefix] = parts;
  if (prefix !== searchButtonPrefix) return null;

  const action = parts[1] === "summary" ? "summary" : "page";
  const cacheId = action === "summary" ? parts[2] : parts[1];
  const selectedIndexValue = action === "summary" ? parts[3] : parts[2];
  if (!cacheId) return null;

  const selectedIndex = Number.parseInt(selectedIndexValue ?? "", 10);
  if (!Number.isFinite(selectedIndex) || selectedIndex < 0) return null;

  return { action, cacheId, selectedIndex };
}

function formatSearchTags(options: HiveSqlSearchOptions): string | null {
  const tags = [
    options.tags.length > 0 ? `in ${options.tags.join(", ")}` : null,
    options.excludedTags.length > 0 ? `not in ${options.excludedTags.join(", ")}` : null,
  ].filter(Boolean);

  return tags.length > 0 ? tags.join("; ") : null;
}

function searchTimeframe(options: HiveSqlSearchOptions): string {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  if (Math.abs(options.before.getTime() - now) < 60_000 && Math.abs(options.before.getTime() - options.after.getTime() - oneDay) < 60_000) {
    return "today";
  }

  return `between ${formatUtc(options.after)} UTC and ${formatUtc(options.before)} UTC`;
}

function searchCommentLink(comment: HiveSqlSearchComment): string {
  return `[${comment.author}/${comment.permlink}](${searchCommentUrl(comment)})`;
}

function searchCommentUrl(comment: HiveSqlSearchComment): string {
  return `https://hive.blog/@${comment.author}/${comment.permlink}`;
}

type CalculatedRewardTarget = {
  ref: { author: string; permlink: string };
  unfurl: boolean;
};

async function resolveCalculatedRewardTarget(context: CommandContext, input: string | undefined): Promise<CalculatedRewardTarget | string> {
  const target = await resolvePostTarget(context, input, "calcreward");
  if (typeof target === "string") return target;

  return {
    ref: target.ref,
    unfurl: target.fromFollowUp ? false : !isUrl(target.input),
  };
}

async function resolvePostTarget(context: CommandContext, input: string | undefined, commandName: string): Promise<{ ref: { author: string; permlink: string }; input: string; fromFollowUp: boolean } | string> {
  if (!input || input === "^") {
    const ref = await findFollowUpPostRef(context.message);
    return ref ? { ref, input: "^", fromFollowUp: true } : "Sorry, I wasn't paying attention.";
  }

  const normalizedInput = stripDiscordUrlSuppression(input).replace(/^`|`$/g, "");
  const ref = parsePostRef(normalizedInput);
  if (!ref) return `Usage: \`$${commandName} <url-or-@author/permlink${commandName === "summarize" ? "|^" : ""}>\``;

  return { ref, input: normalizedInput, fromFollowUp: false };
}

async function findFollowUpPostRef(message: Message): Promise<{ author: string; permlink: string } | null> {
  const referencedMessage = typeof message.fetchReference === "function" ? await message.fetchReference().catch(() => null) : null;
  const referencedRef = referencedMessage ? findPostRefInMessage(referencedMessage) : null;
  if (referencedRef) return referencedRef;

  if (!message.channel || !("messages" in message.channel)) return null;

  const messages = await message.channel.messages.fetch({ limit: 20, before: message.id }).catch(() => null);
  if (!messages) return null;

  const recentMessages = [...messages.values()].sort((left, right) => right.createdTimestamp - left.createdTimestamp);
  for (const recentMessage of recentMessages) {
    const ref = findPostRefInMessage(recentMessage);
    if (ref) return ref;
  }

  return null;
}

function findPostRefInMessage(message: Message): { author: string; permlink: string } | null {
  return findPostRefInText(messagePostRefText(message));
}

function messagePostRefText(message: Message): string {
  const embedText = (message.embeds ?? []).flatMap((embed) => [
    embed.title,
    embed.description,
    embed.url,
    ...(embed.fields ?? []).flatMap((field) => [field.name, field.value]),
  ]);
  return [message.content, ...embedText]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");
}

function findPostRefInText(content: string): { author: string; permlink: string } | null {
  const urls = content.match(/https?:\/\/[^\s<>()]+/gi) ?? [];
  for (const url of urls) {
    const ref = parsePostRef(url.replace(/[),.?!]+$/g, ""));
    if (ref) return ref;
  }

  const rawRef = content.match(/(?:^|[\s`])@([a-z0-9][a-z0-9.-]{1,14}[a-z0-9])\/([a-z0-9][a-z0-9-]{0,255})(?=$|[\s`).,?!>])/i);
  if (rawRef?.[1] && rawRef[2]) {
    return {
      author: rawRef[1].toLowerCase(),
      permlink: rawRef[2],
    };
  }

  return null;
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function stripDiscordUrlSuppression(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1).trim() : trimmed;
}

function formatPostSummary(post: HivePost, summary: string): EmbedBuilder {
  const preview = proposalPostPreview(post);
  const embed = banjoEmbed()
    .setTitle(truncateEmbedText(post.title || `@${post.author}/${post.permlink}`, 256))
    .setURL(canonicalPostUrl(post))
    .setThumbnail(`https://images.hive.blog/u/${encodeURIComponent(post.author)}/avatar`)
    .setDescription([
      `[${post.author}/${post.permlink}](${canonicalPostUrl(post)})`,
      post.created ? `Created ${post.created}` : null,
      "",
      truncateEmbedText(summary, 1_000),
    ].filter((line) => line !== null).join("\n"));

  if (preview.image) embed.setImage(preview.image);
  return embed;
}

function calculatedRewardValues(post: HivePost, rewardBalance: string, feedBase: string, feedQuote: string): { pendingPayout: number; poolRatio: number | null } {
  const pendingPayout = parseHiveAssetAmount(post.pending_payout_value);
  const rewardPoolHive = parseHiveAssetAmount(rewardBalance);
  const hbdPerHive = calculateHbdPerMvest(1, feedBase, feedQuote);
  const rewardPoolHbd = hbdPerHive === null ? null : rewardPoolHive * hbdPerHive;
  const poolRatio = rewardPoolHbd && rewardPoolHbd > 0 && pendingPayout > 0 ? (pendingPayout / rewardPoolHbd) * 100 : null;

  return { pendingPayout, poolRatio };
}

function formatCalculatedRewardText(post: HivePost, rewardBalance: string, feedBase: string, feedQuote: string): string {
  const { pendingPayout, poolRatio } = calculatedRewardValues(post, rewardBalance, feedBase, feedQuote);
  const ratioText = poolRatio === null ? "" : ` (${formatNumber(poolRatio, 3)}% the size of reward pool)`;
  return `Total Pending Payout: $${formatNumber(pendingPayout, 3)}${ratioText}.`;
}

function formatCalculatedRewardEmbed(post: HivePost, rewardBalance: string, feedBase: string, feedQuote: string): EmbedBuilder {
  const { pendingPayout, poolRatio } = calculatedRewardValues(post, rewardBalance, feedBase, feedQuote);
  const postPreview = proposalPostPreview(post);
  const url = canonicalPostUrl(post);
  const embed = banjoEmbed()
    .setTitle(truncateEmbedText(post.title || `@${post.author}/${post.permlink}`, 256))
    .setURL(url)
    .setThumbnail(`https://images.hive.blog/u/${encodeURIComponent(post.author)}/avatar`)
    .setDescription([
      `[${post.author}/${post.permlink}](${url})`,
      postPreview.description,
    ].filter(Boolean).join("\n"))
    .setFooter({ text: "Hive Chain", iconURL: HIVE_TOKEN_ICON_URL });

  if (postPreview.image) embed.setImage(postPreview.image);

  embed.addFields([
    dataField("Pending Payout", `$${formatNumber(pendingPayout, 3)}`),
    dataField("Reward Pool Ratio", poolRatio === null ? null : `${formatNumber(poolRatio, 3)}%`),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function formatPostAge(post: HivePost, createdAt: Date): EmbedBuilder {
  const title = post.title || `@${post.author}/${post.permlink}`;
  return banjoEmbed()
    .setTitle(truncateEmbedText(title, 256))
    .setURL(canonicalPostUrl(post))
    .setThumbnail(`https://images.hive.blog/u/${encodeURIComponent(post.author)}/avatar`)
    .addFields([
      dataField("Author", accountMarkdownLink(post.author)),
      dataField("Created", `${formatUtc(createdAt)} UTC`),
      dataField("Age", `${formatRelativeAge(createdAt)} ago`),
    ].filter((field): field is NonNullable<typeof field> => field !== null))
    .setFooter({ text: "Hive Chain", iconURL: HIVE_TOKEN_ICON_URL });
}

function formatPromotedSummaries(yesterday: HiveSqlPromotedSummary, today: HiveSqlPromotedSummary): EmbedBuilder {
  const promotedPosts = [...yesterday.posts, ...today.posts];
  const embed = banjoEmbed()
    .setTitle("Promoted Posts")
    .setDescription(promotedPosts.length > 0
      ? promotedPosts.map((post, index) => `${index + 1}. ${promotedPostLink(post)} - \`${formatNumber(post.promoted, 3)} ${post.symbol}\``).join("\n")
      : "No promoted posts today or yesterday.")
    .setFooter({ text: "HiveSQL", iconURL: HIVE_TOKEN_ICON_URL });

  embed.addFields([
    dataField("Yesterday", `${formatInteger(yesterday.count)} posts / ${formatPromotedTotals(yesterday)}`),
    dataField("Today", `${formatInteger(today.count)} posts / ${formatPromotedTotals(today)}`),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function promotedPostLink(post: { author: string; permlink: string; title: string | null }): string {
  return `[${truncateEmbedText(post.title || `@${post.author}/${post.permlink}`, 80)}](https://hive.blog/@${post.author}/${post.permlink})`;
}

function formatPromotedTotals(summary: HiveSqlPromotedSummary): string {
  const totals = summary.totals.length > 0
    ? summary.totals.map((total) => `${formatNumber(total.total, 3)} ${total.symbol}`).join("; ")
    : "0.000 HBD";

  return totals;
}

function readDistributionDays(value: string | undefined): number | string {
  if (!value) return 90;
  const days = Number.parseFloat(value);
  if (!Number.isFinite(days) || days < 0) return "Usage: `$distribution [days]`";
  return Math.min(days, 3650);
}

function formatDistribution(summary: HiveSqlDistributionSummary, totalVestingFundHive: string, totalVestingShares: string, feedBase: string, feedQuote: string): string | EmbedBuilder {
  if (summary.activeAccountCount === 0) return "No match.";

  const hbdPerMvest = calculateHbdPerMvest(calculateHivePerMvest(totalVestingFundHive, totalVestingShares), feedBase, feedQuote) ?? 0;
  const totalAccounts = summary.activeAccountCount + summary.inactiveAccountCount;
  const totalStake = summary.activeVestingShares + summary.inactiveVestingShares;
  const rows = distributionBuckets().map((bucket) => {
    const actual = summary.buckets.find((item) => item.level === bucket.level) ?? {
      ...bucket,
      accountCount: 0,
      vestingShares: 0,
    };
    return formatDistributionRow(actual, hbdPerMvest, summary.activeAccountCount, totalStake);
  });
  const inactiveStakePercent = totalStake > 0 ? (summary.inactiveVestingShares / totalStake) * 100 : 0;

  const embed = banjoEmbed()
    .setTitle("Hive Stake Distribution")
    .setDescription([
      `Active since ${formatNumber(summary.daysAgo, summary.daysAgo % 1 === 0 ? 0 : 1)} days ago:`,
      "```markdown",
      "|     $     |   MV  |   level   |   accts  | accts % | stake % |",
      "|-----------|-------|-----------|----------|---------|---------|",
      ...rows,
      "```",
    ].join("\n"))
    .setFooter({ text: "HiveSQL", iconURL: HIVE_TOKEN_ICON_URL });

  embed.addFields([
    dataField("Active Accounts", `${formatInteger(summary.activeAccountCount)} / ${formatInteger(totalAccounts)}`),
    dataField("Inactive Stake", `${formatNumber(inactiveStakePercent, 2)}%`),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function formatDistributionRow(bucket: HiveSqlDistributionBucket, hbdPerMvest: number, activeAccounts: number, totalStake: number): string {
  const dollars = bucket.mvests * hbdPerMvest;
  const accountPercent = activeAccounts > 0 ? (bucket.accountCount / activeAccounts) * 100 : 0;
  const stakePercent = totalStake > 0 ? (bucket.vestingShares / totalStake) * 100 : 0;

  return [
    "|",
    `$${formatDistributionDollar(dollars, bucket.mvests).padEnd(8)}`,
    "|",
    formatDistributionMvests(bucket.mvests).padStart(5),
    "|",
    bucket.level.padEnd(9),
    "|",
    formatInteger(bucket.accountCount).padStart(8),
    "|",
    `${formatNumber(accountPercent, 2)}%`.padStart(7),
    "|",
    `${formatNumber(stakePercent, 2)}%`.padStart(7),
    "|",
  ].join(" ");
}

function distributionBuckets(): HiveSqlDistributionBucket[] {
  return [
    { level: "dust", mvests: 0, accountCount: 0, vestingShares: 0 },
    { level: "newbie", mvests: 0.01, accountCount: 0, vestingShares: 0 },
    { level: "user", mvests: 0.1, accountCount: 0, vestingShares: 0 },
    { level: "superuser", mvests: 1, accountCount: 0, vestingShares: 0 },
    { level: "hero", mvests: 10, accountCount: 0, vestingShares: 0 },
    { level: "superhero", mvests: 100, accountCount: 0, vestingShares: 0 },
    { level: "legend", mvests: 1000, accountCount: 0, vestingShares: 0 },
  ];
}

function formatDistributionDollar(value: number, mvests: number): string {
  return mvests === 0.01 ? formatNumber(value, 2) : formatNumber(value, 0);
}

function formatDistributionMvests(value: number): string {
  return value >= 1 ? formatInteger(value) : String(value);
}

function readFearGreedDays(value: string | undefined): number | string {
  if (!value) return 0;
  const days = Number.parseInt(value, 10);
  if (!Number.isFinite(days)) return "Usage: `$fear [days-ago]`";
  return Math.abs(days);
}

function formatFearGreed(index: FearGreedIndex, daysAgo: number): EmbedBuilder {
  const imageDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const imageSlug = [
    imageDate.getUTCFullYear(),
    imageDate.getUTCMonth() + 1,
    imageDate.getUTCDate(),
  ].join("-");
  const nextUpdate = index.entries.find((entry) => entry.timeUntilUpdate !== null)?.timeUntilUpdate;
  const embed = banjoEmbed()
    .setTitle(index.name)
    .setURL("https://alternative.me/crypto/fear-and-greed-index/")
    .setDescription(formatFearGreedPairs(index, nextUpdate))
    .setImage(`https://alternative.me/images/fng/crypto-fear-and-greed-index-${imageSlug}.png`)
    .setFooter({ text: "Alternative.me" });

  return embed;
}

function formatFearGreedPairs(index: FearGreedIndex, nextUpdate: number | null | undefined): string {
  const today = index.entries[0];
  const yesterday = index.entries[1];
  const previous = index.entries[2];
  const rows = [
    ["Yesterday", "Today", "Previous Entry", "Next Update"],
    [
      yesterday ? formatFearGreedEntry(yesterday) : "n/a",
      today ? formatFearGreedEntry(today) : "n/a",
      previous ? formatFearGreedEntry(previous) : "n/a",
      typeof nextUpdate === "number" ? `in ${formatDuration(nextUpdate)}` : "n/a",
    ],
  ];
  const widths = rows[0]?.map((_, index) => Math.max(...rows.map((row) => row[index]?.length ?? 0))) ?? [];
  return [
    "```",
    ...rows.map((row) => row.map((value, index) => value.padEnd(widths[index] ?? 0)).join("  ").trimEnd()),
    "```",
  ].join("\n");
}

function formatFearGreedEntry(entry: FearGreedIndex["entries"][number]): string {
  return `${entry.value} - ${entry.classification}`;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function formatBadges(badges: HiveSqlBadge[], args: string[]): EmbedBuilder {
  const visibleBadges = badges.slice(0, 15);
  const lines = visibleBadges.map((badge) => {
    const profile = badgeProfile(badge);
    const name = profile.name ?? badge.name;
    return `[${name}](${badgeUrl(badge.name, name)}) by @${badge.recoveryAccount}`;
  });
  const footer = badges.length === visibleBadges.length
    ? `${badges.length} ${badges.length === 1 ? "result" : "results"}`
    : `Showing ${visibleBadges.length} of ${badges.length} results`;

  return banjoEmbed()
    .setTitle(args.length > 0 ? `Latest Badges matching: ${args.join(" ")}` : "Latest Badges")
    .setDescription(truncateEmbedText(lines.join("\n"), 4000))
    .setFooter({ text: footer });
}

async function hydrateBadges(context: CommandContext, badges: HiveSqlBadge[]): Promise<HiveSqlBadge[]> {
  if (badges.length === 0) return badges;

  try {
    const accounts = await hiveApi(context).getAccounts(badges.map((badge) => badge.name));
    const accountsByName = new Map(accounts.map((account) => [account.name, account]));
    return badges.map((badge) => mergeBadgeAccount(badge, accountsByName.get(badge.name)));
  } catch (error) {
    context.logger.warn("Unable to hydrate badge metadata from live Hive accounts.", {
      error: error instanceof Error ? error.message : String(error),
    });
    return badges;
  }
}

function mergeBadgeAccount(badge: HiveSqlBadge, account: HiveAccount | undefined): HiveSqlBadge {
  if (!account) return badge;

  return {
    ...badge,
    recoveryAccount: account.recovery_account || badge.recoveryAccount,
    jsonMetadata: account.posting_json_metadata || account.json_metadata || badge.jsonMetadata,
    created: account.created ? parseHiveDate(account.created) : badge.created,
  };
}

function formatBadge(badge: HiveSqlBadge, stats: HiveSqlBadgeStats): EmbedBuilder {
  const profile = badgeProfile(badge);
  const name = profile.name ?? badge.name;
  const created = badge.created ? new Date(badge.created) : null;
  const url = badgeUrl(badge.name, name);
  const avatarUrl = badgeAvatarUrl(badge.name);
  const embed = banjoEmbed()
    .setTitle(name)
    .setURL(url)
    .setAuthor({ name: `@${badge.name}`, iconURL: avatarUrl, url })
    .setThumbnail(avatarUrl)
    .setFooter({ text: "PeakD Badge" });

  if (profile.about) embed.setDescription(truncateEmbedText(profile.about, 600));

  const listedBy = formatListedByBadges(stats.listedBy, stats.listedByTotal);
  embed.addFields([
    dataField("Creator", `@${badge.recoveryAccount}`),
    dataField("Recipients", formatInteger(stats.recipients)),
    dataField("Subscribers", formatInteger(stats.subscribers)),
    listedBy ? dataField("Listed By", listedBy, false) : null,
    dataField("Created", created ? `${formatRelativeAge(created)} ago (${formatUtc(created)} UTC)` : null, false),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function formatListedByBadges(badges: HiveSqlBadge[], total: number): string | null {
  if (badges.length === 0) return null;

  const visibleBadges = badges.slice(0, 5);
  const links = visibleBadges.map((badge) => {
    const profile = badgeProfile(badge);
    const name = profile.name ?? badge.name;
    return `[${name}](${badgeUrl(badge.name, name)})`;
  });
  const hiddenCount = Math.max(0, total - visibleBadges.length);
  if (hiddenCount > 0) links.push(`+${formatInteger(hiddenCount)} more`);

  return links.join(", ");
}

function badgeUrl(account: string, name: string): string {
  return `https://peakd.com/b/${account}#${slugify(name)}`;
}

function badgeAvatarUrl(account: string): string {
  return `https://images.hive.blog/u/${encodeURIComponent(account)}/avatar`;
}

function badgeProfile(badge: HiveSqlBadge): { name?: string; about?: string } {
  const metadata = parsePossiblyDoubleJson(badge.jsonMetadata);
  const profile = metadata.profile;
  if (!profile || typeof profile !== "object") return {};
  const record = profile as Record<string, unknown>;
  return {
    ...(typeof record.name === "string" && record.name ? { name: record.name } : {}),
    ...(typeof record.about === "string" && record.about ? { about: record.about } : {}),
  };
}

function parsePossiblyDoubleJson(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "string") return parsePossiblyDoubleJson(parsed);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readTt2xLimit(value: string | undefined): number | string {
  const parsed = Number.parseInt(value ?? "10", 10);
  const limit = Number.isFinite(parsed) ? parsed : 10;
  if (limit > 1000) return "Maximum limit: 1000";
  return Math.max(1, limit);
}

function formatTt2x(
  token: HiveEngineToken,
  limit: number,
  discussions: ScotDiscussion[],
  trade: HiveEngineTrade,
  buyBook: HiveEngineBuyOrder[],
  hiveUsdPrice: number | null,
): EmbedBuilder {
  const symbol = token.symbol;
  const metadata = parseTokenMetadata(token.metadata);
  const precision = discussions.find((discussion) => typeof discussion.precision === "number")?.precision ?? 3;
  const pendingPayouts = discussions.map((discussion) => {
    const pending = typeof discussion.pending_token === "number" ? discussion.pending_token : 0;
    const discussionPrecision = typeof discussion.precision === "number" ? discussion.precision : precision;
    return pending * 10 ** -discussionPrecision;
  });
  const sumPendingPayout = pendingPayouts.reduce((sum, payout) => sum + payout, 0);
  const averagePendingPayout = sumPendingPayout / discussions.length;
  const uniqueAuthors = new Set(discussions.map((discussion) => discussion.author).filter(Boolean)).size;
  const price = parseHiveEngineNumber(trade.price);
  const usdPrice = hiveUsdPrice === null ? null : price * hiveUsdPrice;
  const yieldResult = calculateTt2xYield(sumPendingPayout, buyBook);
  const change = price > 0 ? -(100 * ((price - yieldResult.priceAtDepth) / price)) : 0;

  const embed = banjoEmbed()
    .setTitle(`Top ${limit} Trending to Exchange: ${symbol}`)
    .setURL(`https://hive-engine.com/?p=history&t=${encodeURIComponent(symbol)}&utm_source=banjo`)
    .setThumbnail(normalizeTokenIconUrl(symbol, metadata.icon))
    .setDescription(`[Trade ${symbol}](https://hive-engine.com/?p=market&t=${encodeURIComponent(symbol)}&utm_source=banjo)`)
    .setFooter({
      text: "SCOT + Hive Engine",
      iconURL: "https://hive-engine.com/images/hive_engine.png",
    });

  embed.addFields([
    dataField(
      "Last Price",
      `${formatNumber(price, 3)} HIVE${usdPrice === null ? "" : ` / $${formatNumber(usdPrice, 6)}`}${trade.timestamp ? ` (${formatRelativeTime(new Date(trade.timestamp * 1000))})` : ""}`,
    ),
    dataField(
      "Average Pending Payout",
      `${formatNumber(averagePendingPayout, precision)} ${symbol} / ${formatNumber(price * averagePendingPayout, 3)} HIVE${usdPrice === null ? "" : ` / $${formatNumber(usdPrice * averagePendingPayout, 6)}`} (${pluralize(uniqueAuthors, "unique author")})`,
      false,
    ),
    dataField(
      `Sum of Top ${limit} Pending Payout`,
      `${formatNumber(sumPendingPayout, precision)} ${symbol} / ${formatNumber(price * sumPendingPayout, 3)} HIVE${usdPrice === null ? "" : ` / $${formatNumber(usdPrice * sumPendingPayout, 6)}`}`,
      false,
    ),
    dataField(
      "Actual Yield",
      `${formatNumber(sumPendingPayout, precision)} ${symbol} would sell for ${formatNumber(yieldResult.hive, 3)} HIVE${hiveUsdPrice === null ? "" : ` / $${formatNumber(hiveUsdPrice * yieldResult.hive, 6)}`}`,
      false,
    ),
    dataField("Price at Final Yield", `${formatNumber(yieldResult.priceAtDepth, precision)} HIVE${hiveUsdPrice === null ? "" : ` / $${formatNumber(hiveUsdPrice * yieldResult.priceAtDepth, 6)}`}`),
    dataField("Change at Final Yield", formatSignedPercent(change)),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function calculateTt2xYield(sumPendingPayout: number, buyBook: HiveEngineBuyOrder[]): { hive: number; priceAtDepth: number } {
  let remaining = sumPendingPayout;
  let hive = 0;
  let priceAtDepth = 0;

  for (const buy of buyBook) {
    if (remaining <= 0) break;
    const quantity = parseHiveEngineNumber(buy.quantity);
    const price = parseHiveEngineNumber(buy.price);
    if (quantity <= 0 || price <= 0) continue;

    const sold = Math.min(quantity, remaining);
    priceAtDepth = price;
    hive += sold * price;
    remaining -= sold;
  }

  return { hive, priceAtDepth };
}

function formatTokenTradeField(
  trade: HiveEngineTrade,
  hiveUsdPrice: number | null,
): { name: string; value: string; inline: true } | null {
  const price = Number.parseFloat(trade.price ?? "");
  if (!Number.isFinite(price)) return null;

  const usd = hiveUsdPrice === null ? null : price * hiveUsdPrice;
  const age = typeof trade.timestamp === "number" ? ` (${formatRelativeTime(new Date(trade.timestamp * 1000))})` : "";
  return {
    name: "Last Price",
    value: `\`${formatNumber(price, 3)} SWAP.HIVE${usd === null ? "" : ` / $${formatNumber(usd, 6)}`}\`${age}`,
    inline: true,
  };
}

function formatTokenMetricFields(
  metrics: HiveEngineMarketMetrics,
  hiveUsdPrice: number | null,
): Array<{ name: string; value: string; inline: true }> {
  const ask = Number.parseFloat(metrics.lowestAsk ?? "");
  const bid = Number.parseFloat(metrics.highestBid ?? "");
  const volume = Number.parseFloat(metrics.volume ?? "");
  const change = Number.parseFloat(metrics.priceChangePercent ?? "");
  return [
    Number.isFinite(ask) ? { name: "Lowest Ask", value: `\`${formatNumber(ask, 3)} SWAP.HIVE\``, inline: true } : null,
    Number.isFinite(bid) ? { name: "Highest Bid", value: `\`${formatNumber(bid, 3)} SWAP.HIVE\``, inline: true } : null,
    Number.isFinite(volume)
      ? {
          name: "Volume",
          value: `\`${formatNumber(volume, 3)} SWAP.HIVE${hiveUsdPrice === null ? "" : ` / $${formatNumber(volume * hiveUsdPrice, 6)}`}\``,
          inline: true,
        }
      : null,
    Number.isFinite(change) ? { name: "Change", value: `\`${formatSignedPercent(change)}\``, inline: true } : null,
  ].filter((field): field is { name: string; value: string; inline: true } => field !== null);
}

function parseTokenMetadata(value: string | undefined): { desc?: string; url?: string; icon?: string } {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const record = parsed as Record<string, unknown>;
    return {
      ...(typeof record.desc === "string" && record.desc ? { desc: record.desc } : {}),
      ...(typeof record.url === "string" && record.url ? { url: record.url } : {}),
      ...(typeof record.icon === "string" && record.icon ? { icon: record.icon } : {}),
    };
  } catch {
    return {};
  }
}

function normalizeMetadataUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function normalizeTokenIconUrl(symbol: string, value: string | undefined): string {
  const fallback = "https://hive-engine.com/images/hive_engine.png";
  const icon = value?.trim() || fallback;
  const normalized = normalizeTokenImageUrl(icon)
    .replace(/^https:\/\/steemitimages\.com\/640x0\//i, "")
    .replace(/^https:\/\/hive\.blog\/640x0\//i, "")
    .replace(/^https:\/\/media\.giphy\.com\/media\/(.+)\/giphy\.gif$/i, "https://giphy.com/gifs/$1");

  if (normalized.toLowerCase().endsWith(".svg")) {
    return symbol === "APX" ? "https://i.imgur.com/hubmE9i.png" : fallback;
  }

  try {
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:" ? normalized : fallback;
  } catch {
    return fallback;
  }
}

function normalizeTokenImageUrl(value: string): string {
  if (value.startsWith("ipfs://ipfs/")) return `https://ipfs.io/ipfs/${value.slice("ipfs://ipfs/".length)}`;
  if (value.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${value.slice("ipfs://".length)}`;
  if (value.match(/^Qm[1-9A-HJ-NP-Za-km-z]{44}/)) return `https://ipfs.io/ipfs/${value}`;
  return normalizeMetadataUrl(value);
}

function hiveEngineTokenUrl(symbol: string): string {
  return `https://hive-engine.com/?p=history&t=${encodeURIComponent(symbol)}&utm_source=banjo`;
}

function hiveEngineMarketUrl(symbol: string): string {
  return `https://hive-engine.com/trade/${encodeURIComponent(symbol)}`;
}

function formatUnknownToken(symbol: string): string {
  const hint = symbol.startsWith("SWAP.")
    ? "Try `$token` for examples."
    : `Try \`$token\` for examples or \`SWAP.${symbol}\` if it is a wrapped asset.`;
  return `Unknown token: ${symbol}. ${hint}`;
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

function parseConsensusArgs(args: string[]): { chain: string | undefined; top: number } {
  const [first, second] = args;
  if (first?.match(/^\d+$/)) {
    return { chain: undefined, top: clampTopWitnesses(Number.parseInt(first, 10)) };
  }

  return {
    chain: first,
    top: second?.match(/^\d+$/) ? clampTopWitnesses(Number.parseInt(second, 10)) : 21,
  };
}

function clampTopWitnesses(value: number): number {
  return Math.min(100, Math.max(1, value));
}

const topPostOptions = ["upvoted", "downvoted", "children", "rep", "-rep", "promoted", "reply"] as const;

function parseTopPostArgs(args: string[]): HiveSqlTopPostOptions | string {
  const [rawKind, ...keywords] = args;
  if (!rawKind) return `Expected options: ${topPostOptions.join(", ")}`;

  const kind = normalizeTopKind(rawKind);
  if (!kind) return `Unknown option: \`${rawKind}\`. Expected options: ${topPostOptions.join(", ")}`;
  if (kind === "reply" && keywords.length === 0) return "Expected keywords for `$top reply`.";
  if (kind !== "reply" && keywords.length > 0) return `Did not expect keywords for \`$top ${rawKind}\`.`;

  return {
    kind,
    since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    keywords: keywords.map((keyword) => keyword.toLowerCase()),
  };
}

function normalizeTopKind(value: string): HiveSqlTopKind | null {
  switch (value.toLowerCase()) {
    case "upvoted":
    case "upvote":
    case "!upvoted":
      return "upvoted";
    case "downvoted":
    case "downvote":
    case "flagged":
    case "flag":
      return "downvoted";
    case "children":
      return "children";
    case "rep":
    case "reputation":
      return "rep";
    case "-rep":
    case "!rep":
      return "-rep";
    case "promoted":
      return "promoted";
    case "reply":
      return "reply";
    default:
      return null;
  }
}

function formatTopPost(options: HiveSqlTopPostOptions, post: HiveSqlTopPost | null, hydratedPost: HivePost | null): string | EmbedBuilder {
  const keywordText = options.kind === "reply" ? ` with \`${options.keywords.join(" ")}\`` : "";
  const title = `Top ${options.kind}${keywordText} since ${formatRelativeAge(options.since)} ago ...`;
  if (!post) return `${title}\nNo result.`;

  const postPreview = proposalPostPreview(hydratedPost);
  const postTitle = hydratedPost?.title || post.title || `@${post.author}/${post.permlink}`;
  const embed = banjoEmbed()
    .setTitle(truncateEmbedText(postTitle, 256))
    .setURL(topPostUrl(options.kind, post))
    .setThumbnail(`https://images.hive.blog/u/${encodeURIComponent(post.author)}/avatar`)
    .setDescription([
      `[${post.author}/${post.permlink}](${topPostUrl(options.kind, post)})`,
      postPreview.description,
    ].filter(Boolean).join("\n"))
    .setFooter({ text: "HiveSQL", iconURL: HIVE_TOKEN_ICON_URL });

  if (postPreview.image) embed.setImage(postPreview.image);

  embed.addFields([
    dataField("Kind", options.kind),
    dataField("Since", `${formatRelativeAge(options.since)} ago`),
    dataField("Score", post.score === null ? null : formatNumber(post.score, 0)),
    dataField("Keywords", options.keywords.length > 0 ? options.keywords.join(" ") : null, false),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function readAppLimit(value: string | undefined): number | string {
  if (!value) return 10;

  const limit = Number.parseInt(value, 10);
  if (!Number.isFinite(limit) || limit < 1) return "Usage: `$app [limit]`";

  return Math.min(25, limit);
}

function formatAppPayouts(apps: HiveSqlAppPayout[], since: Date, limit: number): EmbedBuilder {
  const rows = apps.length > 0
    ? apps.map((app, index) => `${index + 1}. \`${truncateEmbedText(app.app, 80)}\` - ${formatNumber(app.payout, 0)} HBD`)
    : ["1. `unknown` - 0 HBD"];

  const embed = banjoEmbed()
    .setTitle(`Top ${limit} ${limit === 1 ? "App" : "Apps"} Paid`)
    .setDescription(rows.join("\n"))
    .setFooter({ text: "HiveSQL", iconURL: HIVE_TOKEN_ICON_URL });

  embed.addFields([
    dataField("Since", `${formatRelativeAge(since)} ago`),
    dataField("Results", String(apps.length)),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function formatConsensus(participationCount: number | undefined, witnesses: HiveWitness[]): string {
  const participation = typeof participationCount === "number"
    ? formatNumber((participationCount / 128) * 100, 1)
    : "unknown";
  const versions = new Map<string, number>();

  for (const witness of witnesses) {
    const version = witness.running_version || "unknown";
    versions.set(version, (versions.get(version) ?? 0) + 1);
  }

  return [
    `**Witnesses (${participation}% participation)**`,
    "https://hiveblocks.com/witnesses",
    "```",
    ...witnesses.map((witness, index) => `${String(index + 1).padStart(2)}. ${witness.owner.padEnd(16)} ${witness.running_version || "unknown"}`),
    "```",
    [...versions.entries()].map(([version, count]) => `${version}: ${count}`).join(" | "),
  ].join("\n");
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

function proposalPostPreview(post: HivePost | null): { description?: string; image?: string } {
  if (!post) return {};

  const metadata = parsePossiblyDoubleJson(post.json_metadata ?? null);
  const description = readMetadataDescription(metadata) ?? postBodyExcerpt(post.body);
  const image = readMetadataImage(metadata);

  return {
    ...(description ? { description: truncateEmbedText(description, 600) } : {}),
    ...(image ? { image } : {}),
  };
}

function readMetadataDescription(metadata: Record<string, unknown>): string | null {
  const description = metadata.description;
  return typeof description === "string" && description.trim() ? description.trim() : null;
}

function readMetadataImage(metadata: Record<string, unknown>): string | null {
  const image = metadata.image;
  if (typeof image === "string" && image.trim()) return normalizeMetadataUrl(image.trim());
  if (Array.isArray(image)) {
    const first = image.find((value) => typeof value === "string" && value.trim());
    return typeof first === "string" ? normalizeMetadataUrl(first.trim()) : null;
  }

  return null;
}

function postBodyExcerpt(body: string | undefined): string | null {
  if (!body) return null;
  const text = body
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[[^\]]+]\(([^)]+)\)/g, "$1")
    .replace(/[#>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return text || null;
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

function parseHiveDate(value: string): Date {
  return new Date(value.endsWith("Z") ? value : `${value}Z`);
}

function assetSymbol(value: string | { nai: string } | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.split(" ").at(-1) ?? null;
  if (value.nai === "@@000000013") return "HBD";
  if (value.nai === "@@000000021") return "HIVE";
  if (value.nai === "@@000000037") return "VESTS";
  return null;
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function capitalizeWord(value: string): string {
  return value ? `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` : value;
}

function parseInflationArgs(args: string[]): { years: number; chain: string | undefined } {
  const [first, second] = args;
  if (!first) return { years: 5, chain: undefined };

  const parsed = Number.parseInt(first, 10);
  if (Number.isFinite(parsed)) {
    return { years: Math.min(100, Math.max(0, parsed)), chain: second };
  }

  return { years: 5, chain: first };
}

function formatInflationProjection(years: number): EmbedBuilder {
  const rows = calculateInflationProjection(years);

  const embed = banjoEmbed()
    .setTitle("Hive Inflation Projection")
    .setDescription([
      "```",
      "| Year |   Supply    | Inflation | New Supply |",
      "|------|-------------|-----------|------------|",
      ...rows.map((row) =>
        `| ${row.year} | ${formatInteger(row.supply)} |     ${formatNumber(row.inflation * 100, 2)}% | ${formatInteger(row.newSupply)} |`
      ),
      "```",
    ].join("\n"))
    .setFooter({ text: "Hive Chain", iconURL: HIVE_TOKEN_ICON_URL });

  embed.addFields([
    dataField("Years", String(years)),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function calculateInflationProjection(years: number): Array<{ year: number; supply: number; inflation: number; newSupply: number }> {
  const targetRate = 0.0095;
  const blockStep = 250_000;
  const rateStep = 0.0001;
  const yearlyBlocks = (60 / 3) * 60 * 24 * 365.25;
  const yearRate = (yearlyBlocks / blockStep) * rateStep;
  const rows: Array<{ year: number; supply: number; inflation: number; newSupply: number }> = [];
  let supply = 250_000_000;
  let inflation = 0.095;

  for (let i = 0; i < years; i++) {
    const newSupply = supply * inflation;
    rows.push({
      year: 2016 + i,
      supply,
      inflation,
      newSupply,
    });

    inflation = Math.max(targetRate, inflation - yearRate);
    supply += newSupply;
  }

  return rows;
}

function unknownAccount(accountName: string): string {
  return `Could not find Hive account **${accountName}**.`;
}

function requireHiveChain(value: string | undefined): string | null {
  const chain = value?.toLowerCase();
  if (!chain || chain === "hive") return null;

  return `Chain \`${value}\` is not configured in this Banjo build.`;
}

function readOffset(value: string | undefined): number {
  if (!value) return 0;
  const offset = Number.parseInt(value, 10);
  return Number.isFinite(offset) ? Math.abs(offset) : 0;
}

function readLatestOffset(args: string[]): number {
  return readOffset(args[1]?.match(/^-?\d+$/) ? args[1] : args[2]);
}

function postUrl(post: { author: string; permlink: string; url?: string | null }): string {
  if (post.url?.startsWith("https://")) {
    return normalizeHiveUrl(post.url);
  }
  if (post.url?.startsWith("/")) {
    return normalizeHiveUrl(`https://hive.blog${post.url}`);
  }

  return `https://hive.blog/@${post.author}/${post.permlink}`;
}

function canonicalPostUrl(post: { author: string; permlink: string }): string {
  return `https://hive.blog/@${post.author}/${post.permlink}`;
}

function topPostUrl(kind: HiveSqlTopKind, post: { author: string; permlink: string }): string {
  if (kind === "-rep" || kind === "downvoted") {
    return `https://peakd.com/@${post.author}/${post.permlink}`;
  }

  return canonicalPostUrl(post);
}

function parsePostRef(value: string | undefined): { author: string; permlink: string } | null {
  if (!value) return null;

  const normalized = normalizeHiveUrl(value.trim().replace(/^`|`$/g, ""));
  const path = postPath(normalized);
  const match = path.match(/(?:^|\/)@([^/]+)\/([^/?#]+)/);
  if (!match?.[1] || !match[2]) return null;

  return {
    author: match[1].toLowerCase(),
    permlink: match[2],
  };
}

function postPath(value: string): string {
  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).pathname;
    } catch {
      return value;
    }
  }

  return value;
}

function normalizeHiveUrl(url: string): string {
  return url.replace(/^https:\/\/(?:www\.)?steemit\.com\b/i, "https://hive.blog");
}

function formatRelativeAge(date: Date, now = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  return formatDuration(seconds);
}

function formatRelativeTime(date: Date, now = new Date()): string {
  const seconds = Math.floor((date.getTime() - now.getTime()) / 1000);
  const suffix = seconds >= 0 ? "from now" : "ago";
  return `${formatDuration(Math.abs(seconds))} ${suffix}`;
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
    if (value >= 1) return `${value} ${name}${value === 1 ? "" : "s"}`;
  }

  return "less than a minute";
}

function formatUtc(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 16);
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatUtcDateTime(date: Date): string {
  return `${formatUtc(date)} UTC`;
}

function formatHardfork(
  currentVersion: string,
  majorityVersion: string,
  nextLabel: "Last" | "Next",
  hardforkVersion: string,
  hardforkTime: Date,
  witnesses: HiveWitness[],
): EmbedBuilder {
  const embed = banjoEmbed()
    .setTitle("Hive Hardfork Status")
    .setDescription(["Version Votes by Top 100 Witnesses:", "```markdown", hardforkVersionTable(witnesses), "```"].join("\n"))
    .setFooter({ text: "Hive Chain", iconURL: HIVE_TOKEN_ICON_URL });

  embed.addFields([
    dataField("Current", currentVersion),
    dataField("Witness Majority", majorityVersion),
    dataField(nextLabel, `${hardforkVersion} (${formatRelativeTime(hardforkTime)})`),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function hardforkVersionTable(witnesses: HiveWitness[]): string {
  const grouped = new Map<string, { count: number; votes: bigint }>();

  for (const witness of witnesses) {
    const version = witness.hardfork_version_vote || "unknown";
    const existing = grouped.get(version) ?? { count: 0, votes: 0n };
    existing.count += 1;
    existing.votes += parseBigInt(witness.votes);
    grouped.set(version, existing);
  }

  const rows = [...grouped.entries()]
    .map(([version, value]) => ({
      version,
      witnesses: String(value.count),
      mvests: formatInteger(Number(value.votes / 1_000_000_000_000n)),
    }))
    .sort((a, b) => Number.parseFloat(b.mvests.replace(/,/g, "")) - Number.parseFloat(a.mvests.replace(/,/g, "")));

  const versionWidth = Math.max("Version".length, ...rows.map((row) => row.version.length));
  const witnessWidth = Math.max("Witnesses".length, ...rows.map((row) => row.witnesses.length));
  const mvestsWidth = Math.max("MVESTS".length, ...rows.map((row) => row.mvests.length));

  return [
    `| ${"Version".padStart(versionWidth)} | ${"Witnesses".padStart(witnessWidth)} | ${"MVESTS".padStart(mvestsWidth)} |`,
    `|-${"-".repeat(versionWidth)}-|-` + `${"-".repeat(witnessWidth)}-|-` + `${"-".repeat(mvestsWidth)}-|`,
    ...rows.map((row) => `| ${row.version.padStart(versionWidth)} | ${row.witnesses.padStart(witnessWidth)} | ${row.mvests.padStart(mvestsWidth)} |`),
  ].join("\n");
}

function parseBigInt(value: string | number | undefined): bigint {
  const text = typeof value === "number" ? value.toFixed(0) : value;
  if (!text?.match(/^\d+$/)) return 0n;
  return BigInt(text);
}

function formatReputation(raw: string | number): string {
  const reputation = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
  if (!Number.isFinite(reputation) || reputation === 0) return "25.00";

  const score = (Math.log10(Math.abs(reputation)) - 9) * 9 + 25;
  return formatNumber(reputation < 0 ? -score : score, 2);
}

function calculateHivePower(account: HiveAccount, totalFund: string, totalShares: string): number {
  const ownVests =
    calculateEffectiveVests(account);
  const hivePerVest = parseAsset(totalFund) / parseAsset(totalShares);
  return ownVests * hivePerVest;
}

function calculateAccountMvests(account: HiveAccount): number {
  return calculateEffectiveVests(account) / 1_000_000;
}

function calculateEffectiveVests(account: HiveAccount): number {
  return (
    parseAsset(account.vesting_shares) +
    parseAsset(account.received_vesting_shares) -
    parseAsset(account.delegated_vesting_shares)
  );
}

function calculateHivePerMvest(totalFund: string, totalShares: string): number | null {
  const totalVestingFundHive = parseAsset(totalFund);
  const totalVestingSharesMvest = parseAsset(totalShares) / 1_000_000;
  if (totalVestingFundHive <= 0 || totalVestingSharesMvest <= 0) return null;

  return totalVestingFundHive / totalVestingSharesMvest;
}

function calculateHbdPerMvest(hivePerMvest: number | null, base: string, quote: string): number | null {
  if (hivePerMvest === null) return null;

  const baseAmount = parseAsset(base);
  const quoteAmount = parseAsset(quote);
  if (baseAmount <= 0 || quoteAmount <= 0) return null;

  return (baseAmount / quoteAmount) * hivePerMvest;
}

function calculateVotingPower(account: HiveAccount): number | null {
  if (typeof account.voting_power !== "number" || !account.last_vote_time) return null;

  const lastVote = Date.parse(`${account.last_vote_time}Z`);
  if (!Number.isFinite(lastVote)) return account.voting_power / 100;

  const elapsedSeconds = Math.max(0, (Date.now() - lastVote) / 1000);
  const regenerated = (elapsedSeconds * 10_000) / (5 * 24 * 60 * 60);
  return Math.min(10_000, account.voting_power + regenerated) / 100;
}

function parseAsset(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseHiveAssetAmount(value: string | { amount: string; precision: number } | undefined): number {
  if (!value) return 0;
  if (typeof value === "string") return parseAsset(value);

  const amount = Number.parseFloat(value.amount);
  if (!Number.isFinite(amount)) return 0;

  return amount / 10 ** value.precision;
}

function formatWitness(witness: HiveWitness): EmbedBuilder {
  const embed = banjoEmbed()
    .setTitle(`${witness.owner} is a Hive witness`)
    .setURL(`https://hivehub.dev/witnesses/@${witness.owner}`)
    .setThumbnail(`https://images.hive.blog/u/${encodeURIComponent(witness.owner)}/avatar`)
    .setFooter({ text: "Hive Witness", iconURL: HIVE_TOKEN_ICON_URL });

  embed.addFields([
    dataField("Version", witness.running_version ?? null),
    dataField("Votes", witness.votes === undefined ? null : String(witness.votes)),
    dataField("Missed Blocks", typeof witness.total_missed === "number" ? formatInteger(witness.total_missed) : null),
    dataField("Signing Key", witness.signing_key ? `\`${witness.signing_key}\`` : null, false),
  ].filter((field): field is NonNullable<typeof field> => field !== null));

  return embed;
}

function formatNumber(value: number, digits: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatAsset(value: string, digits: number): string {
  const [amount, symbol] = value.split(/\s+/);
  const parsed = Number.parseFloat(amount ?? "");
  if (!Number.isFinite(parsed) || !symbol) return value;

  return `${formatNumber(parsed, digits)} ${symbol}`;
}

function formatPrice(price: { base: string; quote: string }): string {
  return `${formatAsset(price.base, 3)} / ${formatAsset(price.quote, 3)}`;
}

function formatProtocolPercent(value: number): string {
  return `${formatNumber(value / 100, 2)}%`;
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
}

export class UserFacingCommandError extends Error {}
