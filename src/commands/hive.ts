import { HiveRpcClient, type HiveAccount, type HiveAccountOperation, type HiveApi, type HiveCommunity, type HivePost, type HiveProposal, type HiveRewardOperation, type HiveWitness } from "../hive/api.js";
import { HiveEngineRpcClient, type HiveEngineApi, type HiveEngineBalance, type HiveEngineBuyOrder, type HiveEngineMarketMetrics, type HiveEngineNft, type HiveEngineToken, type HiveEngineTrade, type NftShowroomArt } from "../hive-engine/api.js";
import { ScotHttpClient, type ScotAccountHistoryEntry, type ScotApi, type ScotConfigEntry, type ScotDiscussion } from "../hive-engine/scot.js";
import { HiveDeveloperNodeDirectory, type HiveNode, type HiveNodeDirectory } from "../hive/nodes.js";
import { HiveSqlClient, type HiveSqlApi, type HiveSqlAppPayout, type HiveSqlBadge, type HiveSqlBadgeStats, type HiveSqlDistributionBucket, type HiveSqlDistributionSummary, type HiveSqlPromotedSummary, type HiveSqlSearchComment, type HiveSqlSearchOptions, type HiveSqlSearchResult, type HiveSqlTopKind, type HiveSqlTopPost, type HiveSqlTopPostOptions } from "../hivesql/api.js";
import { CoinGeckoMarketClient, type FearGreedIndex, type MarketApi, type MarketTicker } from "../market/api.js";
import type { Command, CommandContext } from "./types.js";

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

      return `${reputation.account} has reputation **${formatReputation(reputation.reputation)}**.`;
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

      return [
        `**${account.name}**`,
        `Hive Power: **${formatNumber(hivePower, 3)} HP**`,
        votingPower === null ? null : `Voting Power: **${formatNumber(votingPower, 2)}%**`,
      ]
        .filter(Boolean)
        .join("\n");
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
      return account.proxy
        ? `${account.name} is proxied to **${account.proxy}**.`
        : `${account.name} is not using a witness proxy.`;
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
        return [
          `**Approved by: ${account.name}**`,
          `https://hiveblocks.com/@${account.name}`,
          `Proxied to: **${account.proxy}**`,
        ].join("\n");
      }

      const [config, proposalVotes] = await Promise.all([
        hive.getConfig(),
        hive.listProposalVotes(account.name),
      ]);

      return formatApproval(account, proposalVotes, config.HIVE_TREASURY_ACCOUNT ?? "hive.fund");
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

      return formatCommunity(community);
    },
  },
  {
    name: "search",
    description: "Search recent Hive content.",
    usage: "search <terms...> [tag:name] [!tag:name] [after:YYYY-MM-DD] [before:YYYY-MM-DD]",
    category: "hive",
    execute: async (context, args) => {
      const hiveSql = hiveSqlApi(context);
      if (!hiveSql) return "HiveSQL is not configured, so content search is unavailable.";

      const parsed = parseSearchArgs(args);
      if (typeof parsed === "string") return parsed;
      if (parsed.keywords.length === 0 && parsed.tags.length === 0) {
        return "Usage: `$search <terms...> [tag:name] [!tag:name] [after:YYYY-MM-DD] [before:YYYY-MM-DD]`";
      }

      const result = await hiveSql.searchComments(parsed);
      return formatSearchResult(parsed, result);
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
      if (!hiveSql) return "HiveSQL is not configured, so promoted post lookup is unavailable.";

      const [yesterday, today] = await Promise.all([
        hiveSql.getPromotedSummary("yesterday"),
        hiveSql.getPromotedSummary("today"),
      ]);

      return [formatPromotedSummary(yesterday), formatPromotedSummary(today)].join("\n");
    },
  },
  {
    name: "top",
    description: "Show top Hive posts from the last week.",
    usage: "top <upvoted|downvoted|children|rep|-rep|promoted|reply> [reply keywords...]",
    category: "hive",
    execute: async (context, args) => {
      const hiveSql = hiveSqlApi(context);
      if (!hiveSql) return "HiveSQL is not configured, so top post lookup is unavailable.";

      const parsed = parseTopPostArgs(args);
      if (typeof parsed === "string") return parsed;

      const post = await hiveSql.getTopPost(parsed);
      return formatTopPost(parsed, post);
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
      if (!hiveSql) return "HiveSQL is not configured, so app payout lookup is unavailable.";

      const limit = readAppLimit(args[0]);
      if (typeof limit === "string") return limit;

      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const apps = await hiveSql.getAppPayouts({ since, limit });
      return formatAppPayouts(apps, since, limit);
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
      if (!hiveSql) return "HiveSQL is not configured, so distribution lookup is unavailable.";

      const daysAgo = readDistributionDays(args[0]);
      if (typeof daysAgo === "string") return daysAgo;

      const hive = hiveApi(context);
      const [distribution, globals, feedHistory] = await Promise.all([
        hiveSql.getDistribution(daysAgo),
        hive.getDynamicGlobalProperties(),
        hive.getFeedHistory(),
      ]);

      return formatDistribution(distribution, globals.total_vesting_fund_hive, globals.total_vesting_shares, feedHistory.current_median_history.base, feedHistory.current_median_history.quote);
    },
  },
  {
    name: "badges",
    description: "Search PeakD badge accounts.",
    usage: "badges [terms...]",
    category: "hive",
    execute: async (context, args) => {
      const hiveSql = hiveSqlApi(context);
      if (!hiveSql) return "HiveSQL is not configured, so badge search is unavailable.";

      const badges = await hiveSql.findBadges(args.map((arg) => arg.toLowerCase()), 20);
      if (badges.length === 0) return `Unable to find badges with: \`${args.join(" ")}\``;

      return formatBadges(await hydrateBadges(context, badges), args);
    },
  },
  {
    name: "badge",
    description: "Look up a PeakD badge.",
    usage: "badge <terms...>",
    category: "hive",
    execute: async (context, args) => {
      const hiveSql = hiveSqlApi(context);
      if (!hiveSql) return "HiveSQL is not configured, so badge lookup is unavailable.";

      const badges = await hiveSql.findBadges(args.map((arg) => arg.toLowerCase()), 1);
      const badge = badges[0];
      if (!badge) return `Unable to find badges with: \`${args.join(" ")}\``;

      const stats = await hiveSql.getBadgeStats(badge.name);
      const [hydratedBadge] = await hydrateBadges(context, [badge]);
      return formatBadge(hydratedBadge ?? badge, stats);
    },
  },
  {
    name: "proposal",
    description: "Look up active Hive DHF proposals.",
    usage: "proposal [id|text]",
    category: "hive",
    execute: async (context, args) => {
      const hive = hiveApi(context);
      const query = args.join(" ").trim();
      const [config, globals, proposals] = await Promise.all([
        hive.getConfig(),
        hive.getDynamicGlobalProperties(),
        hive.listProposals(),
      ]);
      const treasuryAccount = config.HIVE_TREASURY_ACCOUNT ?? "hive.fund";
      const treasury = await hive.getAccount(treasuryAccount);
      const proposalFundPercent = (config.HIVE_PROPOSAL_FUND_PERCENT_HF21 ?? 0) / 100_000;
      const remainingDailyFund = parseAsset(treasury?.hbd_balance) * proposalFundPercent;
      const funding = calculateProposalFunding(proposals, treasuryAccount, remainingDailyFund);
      const matches = findProposals(proposals, query);

      if (matches.length === 0) {
        return `Proposal "${query}" not found (or not active).`;
      }

      const basePerMvest = calculateHivePerMvest(globals.total_vesting_fund_hive, globals.total_vesting_shares) ?? 0;
      const returnProposal = findReturnProposal(proposals, treasuryAccount);
      const selected = matches
        .sort((a, b) => parseProposalVotes(a) - parseProposalVotes(b))
        .slice(-3)
        .reverse();
      const responses: string[] = [];

      for (const proposal of selected) {
        const voters = await hive.listProposalVotesByProposal(proposalId(proposal));
        responses.push(formatProposal(proposal, {
          approvedDailyPay: funding.get(proposalId(proposal)) ?? 0,
          basePerMvest,
          returnProposal,
          voterCount: new Set(voters.map((vote) => vote.voter)).size,
        }));
      }

      return responses.join("\n\n");
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
      if (!hiveSql) return "HiveSQL is not configured, so delegation lookup is unavailable.";

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
        return `HiveSQL delegation lookup failed: ${message}`;
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
      if (!hiveSql) return "HiveSQL is not configured, so delegated account lookup is unavailable.";

      try {
        const delegatees = await hiveSql.getDelegateesByMinimumMvests(minMvests);
        return formatDelegatedAccounts(delegatees);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `HiveSQL delegated account lookup failed: ${message}`;
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
      if (!hiveSql) return "HiveSQL is not configured, so claim lookup is unavailable.";

      try {
        return formatClaimSummary(await hiveSql.getClaimSummary(timeframe));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `HiveSQL claim lookup failed: ${message}`;
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

      const hiveSql = hiveSqlApi(context);
      if (!hiveSql) return "HiveSQL is not configured, so account summary lookup is unavailable.";

      try {
        return formatAccountSummary(await hiveSql.getAccountSummary());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `HiveSQL account summary lookup failed: ${message}`;
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

      return formatInflationProjection(years);
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
      const claims = Number.parseFloat(rewardFund.recent_claims);
      const claimsText = Number.isFinite(claims) ? formatInteger(claims) : rewardFund.recent_claims;

      return [
        "**Hive reward pool**",
        `Balance: **${formatAsset(rewardFund.reward_balance, 3)}**`,
        `Recent claims: **${claimsText}**`,
        typeof rewardFund.percent_curation_rewards === "number"
          ? `Curation rewards: **${formatNumber(rewardFund.percent_curation_rewards / 100, 2)}%**`
          : null,
      ]
        .filter(Boolean)
        .join("\n");
    },
  },
  {
    name: "calcreward",
    description: "Estimate a post's pending payout against the reward pool.",
    usage: "calcreward <url-or-@author/permlink>",
    category: "hive",
    execute: async (context, args) => {
      const input = args[0];
      if (!input || input === "^") return "Sorry, I wasn't paying attention.";

      const ref = parsePostRef(input);
      if (!ref) return "Usage: `$calcreward <url-or-@author/permlink>`";

      const hive = hiveApi(context);
      const [post, rewardFund, feedHistory] = await Promise.all([
        hive.getPostCreation(ref.author, ref.permlink),
        hive.getRewardFund("post"),
        hive.getFeedHistory(),
      ]);
      if (!post) return `Unable to find post @${ref.author}/${ref.permlink}.`;

      const cashoutTime = post.cashout_time ? parseHiveDate(post.cashout_time) : null;
      if (cashoutTime && cashoutTime.getTime() < Date.now()) {
        return "Sorry, this calculation only makes sense for posts within the first payout timeframe.";
      }

      return formatCalculatedReward(post, rewardFund.reward_balance, feedHistory.current_median_history.base, feedHistory.current_median_history.quote);
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
      const market = marketApi(context);
      if (symbol !== "HIVE") {
        const [account, rewards, trade, hiveUsdPrice] = await Promise.all([
          hive.getAccount(accountName),
          scotApi(context).getAccountHistory(accountName, symbol, 100000),
          hiveEngineApi(context).getLatestTrade(symbol),
          market.getHiveUsdPrice(),
        ]);
        if (!account) return unknownAccount(accountName);

        const summary = summarizeScotRewards(symbol, rewards, trade, hiveUsdPrice);
        if (!summary) return `No ${symbol} rewards for ${account.name} (bad timeframe or invalid symbol)`;

        return formatScotRewards(account.name, symbol, summary);
      }

      const [account, globals, feedHistory, hiveUsdPrice, rewardOperations] = await Promise.all([
        hive.getAccount(accountName),
        hive.getDynamicGlobalProperties(),
        hive.getFeedHistory(),
        market.getHiveUsdPrice(),
        hive.getRewardOperations(accountName),
      ]);
      if (!account) return unknownAccount(accountName);

      const hivePerVest = parseAsset(globals.total_vesting_fund_hive) / parseAsset(globals.total_vesting_shares);
      const hbdPerHive = parseFeedPrice(feedHistory.current_median_history.base, feedHistory.current_median_history.quote);
      const summary = summarizeRewards(account.name, rewardOperations, hivePerVest, hbdPerHive, hiveUsdPrice);
      if (!summary) return `No HIVE rewards for ${account.name} (bad timeframe or invalid symbol)`;

      return formatRewards(account.name, summary);
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

      return [
        "**Hive public nodes**",
        ...displayNodes.map((node) => node.owner ? `${node.url} ${node.owner}` : node.url),
      ].join("\n");
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

      return formatTicker(ticker, feedHistory.current_median_history.base, feedHistory.current_median_history.quote);
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

      return formatFearGreed(index, daysAgo);
    },
  },
  {
    name: "token",
    description: "Look up Hive Engine token metadata and market data.",
    usage: "token <symbol> [...]",
    category: "hive",
    execute: async (context, args) => {
      const symbols = unique(args.map(normalizeTokenSymbol).filter(Boolean));
      if (symbols.length === 0) return "Token symbol required.";
      if (symbols.length > 3) return "Requesting more than 3 tokens is not supported in this Banjo build.";

      const hiveEngine = hiveEngineApi(context);
      const market = marketApi(context);
      const hiveUsdPrice = await market.getHiveUsdPrice();
      const results: string[] = [];

      for (const symbol of symbols) {
        const [token, trade, metrics] = await Promise.all([
          hiveEngine.getToken(symbol),
          hiveEngine.getLatestTrade(symbol),
          hiveEngine.getMarketMetrics(symbol),
        ]);
        if (!token) return `Unknown token: ${symbol}`;

        results.push(formatHiveEngineToken(token, trade, metrics, hiveUsdPrice));
      }

      return results.join("\n\n");
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

      return formatHiveEngineRichlist(symbol, balanceResult.balances, count, balanceResult.truncated);
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

      return formatHiveEngineStaked(symbol, balanceResult.balances, count, balanceResult.truncated);
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
      const results: string[] = [];

      for (const symbol of symbols) {
        const nft = await hiveEngine.getNft(symbol);
        if (!nft) return `Unknown nft: ${symbol}`;

        results.push(formatHiveEngineNft(nft));
      }

      return results.join("\n\n");
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

      return formatNftShowroomArt(art);
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

      return formatTt2x(symbol, limit, discussions, trade, buyBook, hiveUsdPrice);
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

        return [
          "**Hive feed price**",
          `Median: **${formatPrice(feedHistory.current_median_history)}**`,
          feedHistory.market_median_history ? `Market median: **${formatPrice(feedHistory.market_median_history)}**` : null,
          feedHistory.current_min_history ? `Low: **${formatPrice(feedHistory.current_min_history)}**` : null,
          feedHistory.current_max_history ? `High: **${formatPrice(feedHistory.current_max_history)}**` : null,
        ]
          .filter(Boolean)
          .join("\n");
      }

      if (type === "apr") {
        const globals = await hive.getDynamicGlobalProperties();

        return [
          "**Hive HBD policy**",
          typeof globals.hbd_interest_rate === "number" ? `HBD interest rate: **${formatProtocolPercent(globals.hbd_interest_rate)}**` : null,
          typeof globals.hbd_print_rate === "number" ? `HBD print rate: **${formatProtocolPercent(globals.hbd_print_rate)}**` : null,
          typeof globals.hbd_start_percent === "number" ? `Start reducing HBD printing at: **${formatProtocolPercent(globals.hbd_start_percent)}**` : null,
          typeof globals.hbd_stop_percent === "number" ? `Stop HBD printing at: **${formatProtocolPercent(globals.hbd_stop_percent)}**` : null,
        ]
          .filter(Boolean)
          .join("\n");
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

      return [
        `Current: \`${currentVersion}\`; Witness Majority: \`${witnessSchedule.majority_version}\`; ${nextLabel}: \`${nextHardfork.hf_version}\` (${formatRelativeTime(nextLiveTime)})`,
        "Version Votes by Top 100 Witnesses:",
        "```markdown",
        hardforkVersionTable(witnesses),
        "```",
      ].join("\n");
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

      return [
        "**Hive supply**",
        globals.current_supply ? `Current HIVE: **${formatAsset(globals.current_supply, 3)}**` : null,
        globals.virtual_supply ? `Virtual HIVE: **${formatAsset(globals.virtual_supply, 3)}**` : null,
        globals.current_hbd_supply ? `Current HBD: **${formatAsset(globals.current_hbd_supply, 3)}**` : null,
      ]
        .filter(Boolean)
        .join("\n");
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

      return formatWitness(witness);
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

      return [
        `**${accountName}'s followers:** \`${formatInteger(followCount.follower_count)}\``,
        `**following:** \`${formatInteger(followCount.following_count)}\``,
      ].join("; ");
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
      const title = post.title || `@${post.author}/${post.permlink}`;

      return `${title} by @${post.author} was posted ${formatRelativeAge(createdAt)} ago (${formatUtc(createdAt)} UTC).`;
    },
  },
];

function hiveApi(context: CommandContext): HiveApi {
  return context.services?.hive ?? new HiveRpcClient(context.config, context.logger);
}

function formatAccountOperation(operation: HiveAccountOperation): string {
  return `\`\`\`json\n${JSON.stringify({ [operation.type]: operation.value })}\n\`\`\``;
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

function hiveSqlApi(context: CommandContext): HiveSqlApi | null {
  if (context.services?.hiveSql) return context.services.hiveSql;
  if (!context.config.hiveSql.enabled) return null;
  return new HiveSqlClient(context.config, context.logger);
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
    return "HiveSQL is not configured, so wildcard account lookups are unavailable.";
  }

  const names: string[] = [];
  const unmatchedPatterns: string[] = [];
  const truncatedPatterns: string[] = [];

  for (const pattern of patterns) {
    let matches: string[];
    try {
      matches = await hiveSql.findAccountNamesByPattern(pattern, context.config.hiveSql.wildcardLimit + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `HiveSQL wildcard lookup failed: ${message}`;
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
}): string {
  return [
    `${pluralize(summary.count, "claim")} ${summary.timeframe} (by ${pluralize(summary.uniqueAccounts, "unique account")}):`,
    `\`${formatNumber(summary.rewardHbd, 3)} HBD\`;`,
    `\`${formatNumber(summary.rewardHive, 3)} HIVE\`;`,
    `\`${formatNumber(summary.rewardVests / 1_000_000, 3)} MVESTS\``,
  ].join(" ");
}

function formatAccountSummary(summary: { total: number; mined: number; communities: number; badges: number }): string {
  return [
    "```",
    [
      `Total Hive accounts: ${formatInteger(summary.total)}`,
      `mined: ${formatInteger(summary.mined)}`,
      `communities: ${formatInteger(summary.communities)}`,
      `badges: ${formatInteger(summary.badges)}`,
    ].join("; "),
    "```",
  ].join("\n");
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

function formatRewards(accountName: string, summary: RewardSummary): string {
  const lines = [
    `**HIVE rewards for ${accountName} since ${formatRelativeAge(summary.startingAt)} ago**`,
    `producer: ${formatRewardValue(summary.producer)}`,
    `interest: ${formatRewardValue(summary.interest)}`,
    `curation: ${formatRewardValue(summary.curation)}`,
    `author: ${formatRewardValue(summary.author)}`,
    `benefactor: ${formatRewardValue(summary.benefactor)}`,
    `total: ${formatRewardValue(summary.total)}`,
    `USD: ${summary.usd === null ? "None" : formatNumber(summary.usd, 2)}`,
    `USD per day: ${summary.usdPerDay === null ? "None" : formatNumber(summary.usdPerDay, 2)}`,
  ];

  return lines.join("\n");
}

function formatScotRewards(accountName: string, symbol: string, summary: ScotRewardSummary): string {
  return [
    `**${symbol} rewards for ${accountName} since ${formatRelativeAge(summary.startingAt)} ago**`,
    `staking: ${formatRewardValue(summary.staking)}`,
    `curation: ${formatRewardValue(summary.curation)}`,
    `author: ${formatRewardValue(summary.author)}`,
    `benefactor: ${formatRewardValue(summary.benefactor)}`,
    `mining: ${formatRewardValue(summary.mining)}`,
    `total: ${formatRewardValue(summary.total)}`,
    `HIVE: ${summary.hive === null ? "None" : formatNumber(summary.hive, 3)}`,
    `USD: ${summary.usd === null ? "None" : formatNumber(summary.usd, 2)}`,
    `USD per day: ${summary.usdPerDay === null ? "None" : formatNumber(summary.usdPerDay, 2)}`,
  ].join("\n");
}

function formatRewardValue(value: number): string {
  return value === 0 ? "None" : formatNumber(value, 3);
}

function formatTicker(ticker: MarketTicker, feedBase: string, feedQuote: string): string {
  const feedPrice = parseFeedPrice(feedBase, feedQuote);
  return [
    "**Hive ticker**",
    `HIVE/USD: **$${formatNumber(ticker.usd, ticker.usd >= 1 ? 2 : 4)}**`,
    feedPrice === null ? null : `Feed: **${formatNumber(feedPrice, 4)} HBD / HIVE**`,
    ticker.usd24hChange === null ? null : `24h: **${formatSignedPercent(ticker.usd24hChange)}**`,
    ticker.usd24hVolume === null ? null : `Volume: **$${formatNumber(ticker.usd24hVolume, 0)}**`,
    ticker.usdMarketCap === null ? null : `Market cap: **$${formatNumber(ticker.usdMarketCap, 0)}**`,
  ]
    .filter(Boolean)
    .join("\n");
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

function readRichlistCount(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(25, Math.max(1, parsed)) : 13;
}

function readStakedCount(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(25, Math.max(1, parsed)) : 12;
}

function formatHiveEngineRichlist(symbol: string, balances: HiveEngineBalance[], count: number, truncated: boolean): string {
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

  return [
    `**Top ${displayBalances.length} by Total Balance: ${symbol}**`,
    `https://he.dtools.dev/richlist/${encodeURIComponent(symbol)}`,
    "```",
    ...displayBalances.map((balance, index) =>
      `${String(index + 1).padStart(2)}. ${balance.account.padEnd(16)} ${formatNumber(balance.total, 0)} ${balance.symbol}`
    ),
    "```",
    nullBalance ? `null: ${formatNumber(nullBalance.total, 0)} ${nullBalance.symbol}` : null,
    truncated ? "Note: Hive Engine returned more balances than the RPC offset limit allows; ranked from the first 11,000 rows." : null,
  ].filter(Boolean).join("\n");
}

function formatHiveEngineStaked(symbol: string, balances: HiveEngineBalance[], count: number, truncated: boolean): string {
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

  return [
    `**Top ${sorted.length} by Stake: ${symbol}**`,
    ...sorted.map((balance, index) =>
      `${index + 1}. [${balance.account}](${hiveEngineAccountUrl(balance.account, symbol)}) - \`${formatNumber(balance.stake, 0)} ${balance.symbol} POWER\` (${formatNumber((balance.stake / totalStake) * 100, 2)}%)`
    ),
    truncated ? "Note: Hive Engine returned more balances than the RPC offset limit allows; percentages use the first 11,000 rows." : null,
  ].filter(Boolean).join("\n");
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

function formatHiveEngineToken(
  token: HiveEngineToken,
  trade: HiveEngineTrade | null,
  metrics: HiveEngineMarketMetrics | null,
  hiveUsdPrice: number | null,
): string {
  const metadata = parseTokenMetadata(token.metadata);
  const lines = [
    `**${token.symbol}** issued by **@${token.issuer ?? "unknown"}**`,
    `https://hive-engine.com/?p=history&t=${encodeURIComponent(token.symbol)}&utm_source=banjo`,
    token.name ? `Name: ${token.name}` : null,
    metadata.desc ? truncateText(metadata.desc, 240) : null,
    metadata.url ? `See: ${normalizeMetadataUrl(metadata.url)}` : null,
    token.circulatingSupply ? `Circulating Supply: \`${formatNumber(Number.parseFloat(token.circulatingSupply), 0)} ${token.symbol}\`` : null,
    trade ? formatTokenTrade(trade, hiveUsdPrice) : null,
    metrics ? formatTokenMetrics(metrics, hiveUsdPrice) : null,
    `Trade: https://hive-engine.com/?p=market&t=${encodeURIComponent(token.symbol)}&utm_source=banjo`,
  ];

  return lines.filter(Boolean).join("\n");
}

function formatHiveEngineNft(nft: HiveEngineNft): string {
  const metadata = parseTokenMetadata(nft.metadata);
  const lines = [
    `**${nft.symbol}** issued by **@${nft.issuer ?? "unknown"}**`,
    `https://he.dtools.dev/nfts/${encodeURIComponent(nft.symbol)}`,
    nft.name ? `Name: ${nft.name}` : null,
    nft.circulatingSupply ? `Circulating Supply: \`${formatNumber(Number.parseFloat(nft.circulatingSupply), 0)} ${nft.symbol}\`` : null,
    metadata.desc ? truncateText(metadata.desc, 240) : null,
    metadata.url ? `See: ${normalizeMetadataUrl(metadata.url)}` : null,
  ];

  return lines.filter(Boolean).join("\n");
}

function readOptionalIndex(value: string | undefined): number | string {
  if (!value) return 0;
  const index = Number.parseInt(value, 10);
  if (!Number.isFinite(index)) return "Usage: `$nftsr [owner] [index]`";

  return Math.abs(index);
}

function formatNftShowroomArt(art: NftShowroomArt): string {
  const lines = [
    `**${truncateText(art.title, 80)} by @${art.artist}**`,
    `https://nftshowroom.com/gallery/${encodeURIComponent(art.series)}?collection=true`,
    art.collection ? `Collection: ${truncateText(art.collection, 80)}` : null,
    art.note ? `Note: ${truncateText(art.note, 80)}` : null,
    art.createdAt ? `Created: ${formatRelativeAge(parseHiveDate(art.createdAt))} ago (${formatUtc(parseHiveDate(art.createdAt))} UTC)` : null,
  ];

  return lines.filter(Boolean).join("\n");
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

function formatCommunity(community: HiveCommunity): string {
  const owner = community.team?.find((member) => member[1] === "owner")?.[0];
  const title = community.title ?? community.name;
  const description = [community.about ? `**${community.about}**` : null, community.description ? truncateText(community.description, 600) : null]
    .filter(Boolean)
    .join("\n");
  const createdAt = community.created_at ? parseHiveDate(community.created_at.replace(" ", "T")) : null;

  return [
    `**${title}${owner ? ` created by @${owner}` : ""}**`,
    `https://hive.blog/trending/${community.name}${community.title ? `#${slugify(community.title)}` : ""}`,
    description || null,
    typeof community.subscribers === "number" ? `Subscribers: **${formatInteger(community.subscribers)}**` : null,
    typeof community.sum_pending === "number" ? `Pending Rewards: **$${formatNumber(community.sum_pending, 0)}**` : null,
    typeof community.num_authors === "number" ? `Active Authors: **${formatInteger(community.num_authors)}**` : null,
    createdAt ? `Created: ${formatRelativeAge(createdAt)} ago (${formatUtc(createdAt)} UTC)` : null,
    `Avatar: https://images.hive.blog/u/${community.name}/avatar`,
  ].filter(Boolean).join("\n");
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

function formatSearchResult(options: HiveSqlSearchOptions, result: HiveSqlSearchResult): string {
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

  const links = result.comments.map(searchCommentLink).join(" ");
  return `Authors writing \`${subject}\`${tags} ${timeframe} (${result.total}):\n\n${links}`;
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
  return `[${comment.author}](https://hive.blog/@${comment.author}/${comment.permlink})`;
}

function formatCalculatedReward(post: HivePost, rewardBalance: string, feedBase: string, feedQuote: string): string {
  const pendingPayout = parseHiveAssetAmount(post.pending_payout_value);
  const rewardPoolHive = parseHiveAssetAmount(rewardBalance);
  const hbdPerHive = calculateHbdPerMvest(1, feedBase, feedQuote);
  const rewardPoolHbd = hbdPerHive === null ? null : rewardPoolHive * hbdPerHive;
  const poolRatio = rewardPoolHbd && rewardPoolHbd > 0 && pendingPayout > 0
    ? ` (${formatNumber((pendingPayout / rewardPoolHbd) * 100, 3)}% the size of reward pool).`
    : "";

  return `Total Pending Payout: $${formatNumber(pendingPayout, 3)}${poolRatio}`;
}

function formatPromotedSummary(summary: HiveSqlPromotedSummary): string {
  const totals = summary.totals.length > 0
    ? summary.totals.map((total) => `\`${formatNumber(total.total, 3)} ${total.symbol}\``).join("; ")
    : "`0.000 HBD`";
  const posts = summary.posts.length > 0
    ? `\n${summary.posts.map((post, index) => `${index + 1}. [${truncateText(post.title || `@${post.author}/${post.permlink}`, 80)}](https://hive.blog/@${post.author}/${post.permlink}) - \`${formatNumber(post.promoted, 3)} ${post.symbol}\``).join("\n")}`
    : "";

  return `${formatInteger(summary.count)} promoted posts ${summary.timeframe}: ${totals}${posts}`;
}

function readDistributionDays(value: string | undefined): number | string {
  if (!value) return 90;
  const days = Number.parseFloat(value);
  if (!Number.isFinite(days) || days < 0) return "Usage: `$distribution [days]`";
  return Math.min(days, 3650);
}

function formatDistribution(summary: HiveSqlDistributionSummary, totalVestingFundHive: string, totalVestingShares: string, feedBase: string, feedQuote: string): string {
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

  return [
    `Active since ${formatNumber(summary.daysAgo, summary.daysAgo % 1 === 0 ? 0 : 1)} days ago:`,
    "```markdown",
    "|     $     |   MV  |   level   |   accts  | accts % | stake % |",
    "|-----------|-------|-----------|----------|---------|---------|",
    ...rows,
    "```",
    `Active accounts: \`${formatInteger(summary.activeAccountCount)} / ${formatInteger(totalAccounts)}\``,
    `Inactive stake: \`${formatNumber(inactiveStakePercent, 2)}%\``,
  ].join("\n");
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

function formatFearGreed(index: FearGreedIndex, daysAgo: number): string {
  const imageDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const imageSlug = [
    imageDate.getUTCFullYear(),
    imageDate.getUTCMonth() + 1,
    imageDate.getUTCDate(),
  ].join("-");
  const lines = [
    `**${index.name}**`,
    "https://alternative.me/crypto/fear-and-greed-index/",
    `Image: https://alternative.me/images/fng/crypto-fear-and-greed-index-${imageSlug}.png`,
    ...index.entries.map((entry) => `${formatRelativeAge(new Date(entry.timestamp * 1000))} ago: **${entry.value} - ${entry.classification}**`),
  ];
  const nextUpdate = index.entries.find((entry) => entry.timeUntilUpdate !== null)?.timeUntilUpdate;
  if (typeof nextUpdate === "number") lines.push(`Next update in ${formatDuration(nextUpdate)}.`);

  return lines.join("\n");
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function formatBadges(badges: HiveSqlBadge[], args: string[]): string {
  const title = args.length > 0 ? `**Latest Badges matching: ${args.join(" ")}**` : "**Latest Badges**";
  const lines = badges.map((badge) => {
    const profile = badgeProfile(badge);
    const name = profile.name ?? badge.name;
    return `[${name}](https://peakd.com/b/${badge.name}#${slugify(name)}) by @${badge.recoveryAccount}`;
  });

  return [title, ...lines].join("\n");
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

function formatBadge(badge: HiveSqlBadge, stats: HiveSqlBadgeStats): string {
  const profile = badgeProfile(badge);
  const name = profile.name ?? badge.name;
  const created = badge.created ? new Date(badge.created) : null;

  return [
    `**${name} created by @${badge.recoveryAccount}**`,
    `https://peakd.com/b/${badge.name}#${slugify(name)}`,
    profile.about ? truncateText(profile.about, 600) : null,
    `Recipients: **${formatInteger(stats.recipients)}**`,
    `Subscribers: **${formatInteger(stats.subscribers)}**`,
    created ? `Created: ${formatRelativeAge(created)} ago (${formatUtc(created)} UTC)` : null,
    `Avatar: https://images.hive.blog/u/${badge.name}/avatar`,
  ].filter(Boolean).join("\n");
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
  symbol: string,
  limit: number,
  discussions: ScotDiscussion[],
  trade: HiveEngineTrade,
  buyBook: HiveEngineBuyOrder[],
  hiveUsdPrice: number | null,
): string {
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

  return [
    `**Top ${limit} Trending to Exchange: ${symbol}**`,
    `https://hive-engine.com/?p=history&t=${encodeURIComponent(symbol)}&utm_source=banjo`,
    `Trade: https://hive-engine.com/?p=market&t=${encodeURIComponent(symbol)}&utm_source=banjo`,
    `Last Price: \`${formatNumber(price, 3)} HIVE${usdPrice === null ? "" : ` / $${formatNumber(usdPrice, 6)}`}\`${trade.timestamp ? ` (${formatRelativeTime(new Date(trade.timestamp * 1000))})` : ""}`,
    `Average Pending Payout: \`${formatNumber(averagePendingPayout, precision)} ${symbol}\` / \`${formatNumber(price * averagePendingPayout, 3)} HIVE\`${usdPrice === null ? "" : ` / \`$${formatNumber(usdPrice * averagePendingPayout, 6)}\``} (${pluralize(uniqueAuthors, "unique author")})`,
    `Sum of Top ${limit} Pending Payout: \`${formatNumber(sumPendingPayout, precision)} ${symbol}\` / \`${formatNumber(price * sumPendingPayout, 3)} HIVE\`${usdPrice === null ? "" : ` / \`$${formatNumber(usdPrice * sumPendingPayout, 6)}\``}`,
    `Actual Yield: \`${formatNumber(sumPendingPayout, precision)} ${symbol}\` would sell for \`${formatNumber(yieldResult.hive, 3)} HIVE\`${hiveUsdPrice === null ? "" : ` / \`$${formatNumber(hiveUsdPrice * yieldResult.hive, 6)}\``}`,
    `Price at Final Yield: \`${formatNumber(yieldResult.priceAtDepth, precision)} HIVE\`${hiveUsdPrice === null ? "" : ` / \`$${formatNumber(hiveUsdPrice * yieldResult.priceAtDepth, 6)}\``}`,
    `Change at Final Yield: \`${formatSignedPercent(change)}\``,
  ].join("\n");
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

function formatTokenTrade(trade: HiveEngineTrade, hiveUsdPrice: number | null): string | null {
  const price = Number.parseFloat(trade.price ?? "");
  if (!Number.isFinite(price)) return null;

  const usd = hiveUsdPrice === null ? null : price * hiveUsdPrice;
  const age = typeof trade.timestamp === "number" ? ` (${formatRelativeTime(new Date(trade.timestamp * 1000))})` : "";
  return `Last Price: \`${formatNumber(price, 3)} SWAP.HIVE${usd === null ? "" : ` / $${formatNumber(usd, 6)}`}\`${age}`;
}

function formatTokenMetrics(metrics: HiveEngineMarketMetrics, hiveUsdPrice: number | null): string {
  const ask = Number.parseFloat(metrics.lowestAsk ?? "");
  const bid = Number.parseFloat(metrics.highestBid ?? "");
  const volume = Number.parseFloat(metrics.volume ?? "");
  const change = Number.parseFloat(metrics.priceChangePercent ?? "");
  return [
    Number.isFinite(ask) ? `Lowest Ask: \`${formatNumber(ask, 3)} SWAP.HIVE\`` : null,
    Number.isFinite(bid) ? `Highest Bid: \`${formatNumber(bid, 3)} SWAP.HIVE\`` : null,
    Number.isFinite(volume) ? `Volume: \`${formatNumber(volume, 3)} SWAP.HIVE${hiveUsdPrice === null ? "" : ` / $${formatNumber(volume * hiveUsdPrice, 6)}`}\`` : null,
    Number.isFinite(change) ? `Change: \`${formatSignedPercent(change)}\`` : null,
  ].filter(Boolean).join("\n");
}

function parseTokenMetadata(value: string | undefined): { desc?: string; url?: string } {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const record = parsed as Record<string, unknown>;
    return {
      ...(typeof record.desc === "string" && record.desc ? { desc: record.desc } : {}),
      ...(typeof record.url === "string" && record.url ? { url: record.url } : {}),
    };
  } catch {
    return {};
  }
}

function normalizeMetadataUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
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
): string {
  const witnessVotes = readWitnessVotes(account.witness_votes);
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

  const lines = [
    `**Approved by: ${account.name}**`,
    `https://hiveblocks.com/@${account.name}`,
    witnessVotes.length > 0
      ? `Witnesses (total: ${witnessVotes.length}): ${truncateText(witnessVotes.join(", "), 500)}`
      : "Witnesses: None",
  ];

  const activeCount = countProposalIds(active);
  if (activeCount > 0) {
    lines.push(`Proposals (total: ${activeCount}): ${formatProposalGroups(active)}`);
    lines.push(`Proposal Pay Approved: ${formatNumber(activeDailyPay, 3)} HBD (daily)`);
  } else {
    lines.push("Proposals: None");
  }

  const inactiveCount = countProposalIds(inactive);
  if (inactiveCount > 0) {
    lines.push(`Upcoming Proposals (total: ${inactiveCount}): ${formatProposalGroups(inactive)}`);
  }

  return lines.join("\n");
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

function formatTopPost(options: HiveSqlTopPostOptions, post: HiveSqlTopPost | null): string {
  const keywordText = options.kind === "reply" ? ` with \`${options.keywords.join(" ")}\`` : "";
  const title = `Top ${options.kind}${keywordText} since ${formatRelativeAge(options.since)} ago ...`;
  if (!post) return `${title}\nNo result.`;

  return `${title}\n${topPostUrl(options.kind, post)}`;
}

function readAppLimit(value: string | undefined): number | string {
  if (!value) return 10;

  const limit = Number.parseInt(value, 10);
  if (!Number.isFinite(limit) || limit < 1) return "Usage: `$app [limit]`";

  return Math.min(25, limit);
}

function formatAppPayouts(apps: HiveSqlAppPayout[], since: Date, limit: number): string {
  const caption = `Top ${limit} ${limit === 1 ? "app" : "apps"} paid since ${formatRelativeAge(since)} ago ...`;
  const rows = apps.length > 0
    ? apps.map((app) => `| ${truncateText(app.app, 21).padEnd(21)} | ${formatNumber(app.payout, 0).padStart(13)} |`)
    : ["| unknown               |             0 |"];

  return [
    caption,
    "```markdown",
    "|          App          | Payout in HBD |",
    "|-----------------------|---------------|",
    ...rows,
    "```",
  ].join("\n");
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
  if (query && Number.parseInt(query, 10).toString() === query) {
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
  },
): string {
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
  const approvalLabel = votesApproved && context.approvedDailyPay === 0
    ? "Approved (not funded)"
    : votesApproved && context.approvedDailyPay < dailyPay
      ? "Approved (partially funded)"
      : "Approved";
  const lines = [
    `**Proposal #${proposalId(proposal)}: ${proposal.subject}**`,
    `https://peakd.com/proposals/${proposalId(proposal)}`,
    `Discussion: https://peakd.com/@${proposal.creator}/${proposal.permlink}`,
    proposal.creator === proposal.receiver
      ? `Creator: ${proposal.creator}`
      : `Creator: ${proposal.creator}; Receiver: ${proposal.receiver}`,
    `Start: ${formatRelativeTime(startDate)}`,
    `End: ${formatRelativeTime(endDate)}`,
    `Days: ${formatInteger(days - daysRemaining)} of ${formatInteger(days)}`,
    `Daily Pay: ${formatNumber(dailyPay, 3)} ${dailyPaySymbol}`,
    `Total Requested Pay: ${formatNumber(dailyPay * days, 0)} ${dailyPaySymbol}`,
    `Total Votes (HP): ${formatNumber(totalVotesMhp, 1)}M`,
    `Voters: ${formatInteger(context.voterCount)}`,
    `${approvalLabel}: ${votesApproved ? "Yes" : "No"} (${formatNumber(approvalPercent, 2)}%)`,
  ];

  if (votesApproved && context.approvedDailyPay !== 0 && context.approvedDailyPay < dailyPay) {
    lines.push(`Partial Daily Pay: ${formatNumber(context.approvedDailyPay, 3)} ${dailyPaySymbol}`);
  }

  return lines.join("\n");
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

function parseInflationArgs(args: string[]): { years: number; chain: string | undefined } {
  const [first, second] = args;
  if (!first) return { years: 5, chain: undefined };

  const parsed = Number.parseInt(first, 10);
  if (Number.isFinite(parsed)) {
    return { years: Math.min(100, Math.max(0, parsed)), chain: second };
  }

  return { years: 5, chain: first };
}

function formatInflationProjection(years: number): string {
  const rows = calculateInflationProjection(years);

  return [
    "```",
    "| Year |   Supply    | Inflation | New Supply |",
    "|------|-------------|-----------|------------|",
    ...rows.map((row) =>
      `| ${row.year} | ${formatInteger(row.supply)} |     ${formatNumber(row.inflation * 100, 2)}% | ${formatInteger(row.newSupply)} |`
    ),
    "```",
  ].join("\n");
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

  const normalized = normalizeHiveUrl(value.trim());
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

function formatWitness(witness: HiveWitness): string {
  return [
    `**${witness.owner}** is a Hive witness.`,
    witness.running_version ? `Version: **${witness.running_version}**` : null,
    typeof witness.total_missed === "number" ? `Missed blocks: **${witness.total_missed}**` : null,
    witness.signing_key ? `Signing key: \`${witness.signing_key}\`` : null,
  ]
    .filter(Boolean)
    .join("\n");
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
