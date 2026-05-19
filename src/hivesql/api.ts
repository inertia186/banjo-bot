import sql from "mssql";
import type { AppConfig } from "../config.js";
import type { HiveProposal } from "../hive/api.js";
import type { Logger } from "../logger.js";

export type HiveSqlApi = {
  findAccountNamesByPattern(pattern: string, limit: number): Promise<string[]>;
  searchComments(options: HiveSqlSearchOptions): Promise<HiveSqlSearchResult>;
  getTopPost(options: HiveSqlTopPostOptions): Promise<HiveSqlTopPost | null>;
  getAppPayouts(options: HiveSqlAppPayoutOptions): Promise<HiveSqlAppPayout[]>;
  getProposalById(proposalId: number): Promise<HiveProposal | null>;
  getProposalPayments(proposalId: number): Promise<HiveSqlProposalPayments>;
  getProposalTimeline(proposalId: number): Promise<HiveSqlProposalTimelineEvent[]>;
  getPromotedSummary(timeframe: HiveSqlPromotedTimeframe): Promise<HiveSqlPromotedSummary>;
  getDistribution(daysAgo: number): Promise<HiveSqlDistributionSummary>;
  findBadges(terms: string[], limit: number): Promise<HiveSqlBadge[]>;
  getBadgeStats(account: string): Promise<HiveSqlBadgeStats>;
  getDelegations(account: string, direction: "incoming" | "outgoing"): Promise<HiveSqlDelegation[]>;
  getDelegateesByMinimumMvests(minMvests: number): Promise<HiveSqlDelegatee[]>;
  getClaimSummary(timeframe: HiveSqlClaimTimeframe): Promise<HiveSqlClaimSummary>;
  getAccountSummary(): Promise<HiveSqlAccountSummary>;
};

export type HiveSqlDistributionBucket = {
  level: string;
  mvests: number;
  accountCount: number;
  vestingShares: number;
};

export type HiveSqlDistributionSummary = {
  daysAgo: number;
  activeAccountCount: number;
  inactiveAccountCount: number;
  activeVestingShares: number;
  inactiveVestingShares: number;
  buckets: HiveSqlDistributionBucket[];
};

export type HiveSqlPromotedTimeframe = "today" | "yesterday";

export type HiveSqlPromotedPost = {
  author: string;
  permlink: string;
  title: string | null;
  promoted: number;
  symbol: string;
};

export type HiveSqlPromotedTotal = {
  symbol: string;
  total: number;
};

export type HiveSqlPromotedSummary = {
  timeframe: HiveSqlPromotedTimeframe;
  count: number;
  totals: HiveSqlPromotedTotal[];
  posts: HiveSqlPromotedPost[];
};

export type HiveSqlSearchOptions = {
  keywords: string[];
  tags: string[];
  excludedTags: string[];
  after: Date;
  before: Date;
  limit: number;
};

export type HiveSqlSearchComment = {
  author: string;
  permlink: string;
  title: string | null;
  created: Date | null;
};

export type HiveSqlSearchResult = {
  total: number;
  authorCount: number;
  comments: HiveSqlSearchComment[];
};

export type HiveSqlTopKind = "upvoted" | "downvoted" | "children" | "rep" | "-rep" | "promoted" | "reply";

export type HiveSqlTopPostOptions = {
  kind: HiveSqlTopKind;
  since: Date;
  keywords: string[];
};

export type HiveSqlTopPost = {
  author: string;
  permlink: string;
  title: string | null;
  url: string | null;
  score: number | null;
};

export type HiveSqlAppPayoutOptions = {
  since: Date;
  limit: number;
};

export type HiveSqlAppPayout = {
  app: string;
  payout: number;
};

export type HiveSqlProposalPayments = {
  total: number;
  count: number;
  symbol: string;
  firstPaidAt: Date | null;
  lastPaidAt: Date | null;
  runs: HiveSqlProposalPaymentRun[];
};

export type HiveSqlProposalPaymentRun = {
  startedAt: Date;
  endedAt: Date;
  total: number;
  count: number;
  symbol: string;
};

export type HiveSqlProposalTimelineEvent = {
  timestamp: Date;
  kind: "created" | "updated";
  dailyPay: number | null;
  symbol: string;
  subject: string | null;
  permlink: string | null;
  txId: string | null;
  blockNum: number | null;
  transactionNum: number | null;
};

export type HiveSqlBadge = {
  name: string;
  recoveryAccount: string;
  jsonMetadata: string | null;
  created: Date | null;
};

export type HiveSqlBadgeStats = {
  recipients: number;
  subscribers: number;
};

export type HiveSqlDelegation = {
  account: string;
  vests: number;
};

export type HiveSqlDelegatee = {
  delegatee: string;
  vests: number;
  delegatorCount: number;
  singleDelegator: string;
};

export type HiveSqlClaimTimeframe = "today" | "yesterday" | "all";

export type HiveSqlClaimSummary = {
  timeframe: HiveSqlClaimTimeframe;
  count: number;
  uniqueAccounts: number;
  rewardHbd: number;
  rewardHive: number;
  rewardVests: number;
};

export type HiveSqlAccountSummary = {
  total: number;
  mined: number;
  communities: number;
  badges: number;
};

export class HiveSqlClient implements HiveSqlApi {
  private static loggedConnection = false;
  private pool: sql.ConnectionPool | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async findAccountNamesByPattern(pattern: string, limit: number): Promise<string[]> {
    const pool = await this.connection();
    const response = await pool.request()
      .input("pattern", sql.VarChar(128), wildcardToSqlLike(pattern))
      .input("limit", sql.Int, limit)
      .query<{ name: string }>(`
        SELECT TOP (@limit) [name]
        FROM [Accounts]
        WHERE [name] LIKE @pattern ESCAPE '\\'
        ORDER BY [name]
      `);

    return response.recordset.map((row) => row.name);
  }

  async searchComments(options: HiveSqlSearchOptions): Promise<HiveSqlSearchResult> {
    const pool = await this.connection();
    const request = pool.request()
      .input("after", sql.DateTime, options.after)
      .input("before", sql.DateTime, options.before)
      .input("limit", sql.Int, options.limit);

    const filters = [
      "[created] >= @after",
      "[created] <= @before",
      "[depth] BETWEEN 0 AND 255",
    ];

    options.keywords.forEach((keyword, index) => {
      const input = `keyword${index}`;
      request.input(input, sql.NVarChar(256), `%${keyword.toLowerCase()}%`);
      filters.push(`(LOWER(COALESCE([title], '')) LIKE @${input} OR LOWER(COALESCE([body], '')) LIKE @${input} OR LOWER(COALESCE([json_metadata], '')) LIKE @${input})`);
    });

    options.tags.forEach((tag, index) => {
      const input = `tag${index}`;
      request.input(input, sql.VarChar(64), tag.toLowerCase());
      filters.push(`EXISTS (SELECT 1 FROM [Tags] WHERE [Tags].[comment_ID] = [Comments].[ID] AND LOWER([Tags].[tag]) = @${input})`);
    });

    options.excludedTags.forEach((tag, index) => {
      const input = `excludedTag${index}`;
      request.input(input, sql.VarChar(64), tag.toLowerCase());
      filters.push(`NOT EXISTS (SELECT 1 FROM [Tags] WHERE [Tags].[comment_ID] = [Comments].[ID] AND LOWER([Tags].[tag]) = @${input})`);
    });

    const where = filters.join("\n          AND ");
    const response = await request.query<{
      total: number;
      authorCount: number;
      author: string | null;
      permlink: string | null;
      title: string | null;
      created: Date | null;
    }>(`
      WITH [matched] AS (
        SELECT DISTINCT
          [author],
          [permlink],
          [title],
          [created]
        FROM [Comments]
        WHERE ${where}
      ),
      [totals] AS (
        SELECT
          COUNT(*) AS [total],
          COUNT(DISTINCT [author]) AS [authorCount]
        FROM [matched]
      ),
      [limited] AS (
        SELECT TOP (@limit)
          [author],
          [permlink],
          [title],
          [created]
        FROM [matched]
        ORDER BY [created] DESC
      )
      SELECT
        [totals].[total],
        [totals].[authorCount],
        [limited].[author],
        [limited].[permlink],
        [limited].[title],
        [limited].[created]
      FROM [totals]
      LEFT JOIN [limited] ON 1 = 1
      ORDER BY [limited].[created] DESC
    `);

    const first = response.recordset[0];
    return {
      total: Number(first?.total ?? 0),
      authorCount: Number(first?.authorCount ?? 0),
      comments: response.recordset
        .filter((row) => row.author && row.permlink)
        .map((row) => ({
          author: row.author ?? "",
          permlink: row.permlink ?? "",
          title: row.title,
          created: row.created,
        })),
    };
  }

  async getTopPost(options: HiveSqlTopPostOptions): Promise<HiveSqlTopPost | null> {
    const pool = await this.connection();
    const request = pool.request()
      .input("since", sql.DateTime, options.since);

    const keywordFilters = options.keywords.map((keyword, index) => {
      const input = `keyword${index}`;
      request.input(input, sql.NVarChar(256), `%${keyword.toLowerCase()}%`);
      return `LOWER(COALESCE([reply].[body], '')) LIKE @${input}`;
    });
    const keywordWhere = keywordFilters.length > 0 ? `AND ${keywordFilters.join(" AND ")}` : "";

    const order = topPostOrder(options.kind);
    const replyExists = options.kind === "reply"
      ? `
          AND EXISTS (
            SELECT 1
            FROM [Comments] AS [reply]
            WHERE [reply].[parent_author] = [post].[author]
              AND [reply].[parent_permlink] = [post].[permlink]
              AND [reply].[depth] = 1
              AND [reply].[created] >= @since
              ${keywordWhere}
          )
        `
      : "";
    const accountJoin = options.kind === "rep" || options.kind === "-rep"
      ? "LEFT JOIN [Accounts] AS [account] ON [account].[name] = [post].[author]"
      : "";
    const promotedWhere = options.kind === "promoted"
      ? "AND [post].[promoted] IS NOT NULL AND [post].[promoted] <> '' AND [post].[promoted] <> '0.000 HBD'"
      : "";

    const response = await request.query<{
      author: string;
      permlink: string;
      title: string | null;
      url: string | null;
      score: number | null;
    }>(`
      SELECT TOP 1
        [post].[author],
        [post].[permlink],
        [post].[title],
        [post].[url],
        ${topPostScore(options.kind)} AS [score]
      FROM [Comments] AS [post]
      ${accountJoin}
      WHERE [post].[created] >= @since
        AND [post].[depth] = 0
        ${promotedWhere}
        ${replyExists}
      ORDER BY ${order}
    `);
    const row = response.recordset[0];
    if (!row?.author || !row.permlink) return null;

    return {
      author: row.author,
      permlink: row.permlink,
      title: row.title,
      url: row.url,
      score: row.score === null || row.score === undefined ? null : Number(row.score),
    };
  }

  async getAppPayouts(options: HiveSqlAppPayoutOptions): Promise<HiveSqlAppPayout[]> {
    const pool = await this.connection();
    const createdAfter = new Date(options.since.getTime() - 8 * 24 * 60 * 60 * 1000);
    const response = await pool.request()
      .input("since", sql.DateTime, options.since)
      .input("createdAfter", sql.DateTime, createdAfter)
      .input("limit", sql.Int, options.limit)
      .query<{ app: string | null; payout: number }>(`
        SELECT TOP (@limit)
          COALESCE(JSON_VALUE([json_metadata], '$.app'), 'unknown') AS [app],
          SUM([total_payout_value]) AS [payout]
        FROM [Comments]
        WHERE [last_payout] > @since
          AND [created] > @createdAfter
          AND [total_payout_value] > 0.02
          AND [json_metadata] LIKE '{%'
          AND ISJSON([json_metadata]) > 0
        GROUP BY COALESCE(JSON_VALUE([json_metadata], '$.app'), 'unknown')
        ORDER BY SUM([total_payout_value]) DESC
      `);

    return response.recordset.map((row) => ({
      app: row.app || "unknown",
      payout: Number(row.payout),
    }));
  }

  async getProposalPayments(proposalId: number): Promise<HiveSqlProposalPayments> {
    const pool = await this.connection();
    const response = await pool.request()
      .input("proposalId", sql.Int, proposalId)
      .query<{
        total: number;
        count: number;
        symbol: string | null;
        firstPaidAt: Date | null;
        lastPaidAt: Date | null;
        startedAt: Date;
        endedAt: Date;
      }>(`
        SELECT
          COALESCE(SUM(CASE WHEN [payment] > 0 THEN [payment] ELSE 0 END), 0) AS [total],
          COALESCE(SUM(CASE WHEN [payment] > 0 THEN 1 ELSE 0 END), 0) AS [count],
          COALESCE(MIN([payment_symbol]), 'HBD') AS [symbol],
          MIN(CASE WHEN [payment] > 0 THEN [timestamp] END) AS [firstPaidAt],
          MAX(CASE WHEN [payment] > 0 THEN [timestamp] END) AS [lastPaidAt]
        FROM [VOProposalPays]
        WHERE [proposal_id] = @proposalId

        ;WITH [positive_pays] AS (
          SELECT
            [timestamp],
            [payment],
            [payment_symbol],
            LAG([timestamp]) OVER (ORDER BY [timestamp]) AS [previousTimestamp]
          FROM [VOProposalPays]
          WHERE [proposal_id] = @proposalId
            AND [payment] > 0
        ),
        [marked_pays] AS (
          SELECT
            [timestamp],
            [payment],
            [payment_symbol],
            CASE
              WHEN [previousTimestamp] IS NULL OR DATEDIFF(minute, [previousTimestamp], [timestamp]) > 720 THEN 1
              ELSE 0
            END AS [newRun]
          FROM [positive_pays]
        ),
        [grouped_pays] AS (
          SELECT
            [timestamp],
            [payment],
            [payment_symbol],
            SUM([newRun]) OVER (ORDER BY [timestamp] ROWS UNBOUNDED PRECEDING) AS [runId]
          FROM [marked_pays]
        )
        SELECT
          MIN([timestamp]) AS [startedAt],
          MAX([timestamp]) AS [endedAt],
          SUM([payment]) AS [total],
          COUNT(*) AS [count],
          COALESCE(MIN([payment_symbol]), 'HBD') AS [symbol]
        FROM [grouped_pays]
        GROUP BY [runId]
        ORDER BY [startedAt]
      `);
    const row = response.recordset[0];
    const runs = (response.recordsets[1] ?? []).map((run) => ({
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      total: Number(run.total ?? 0),
      count: Number(run.count ?? 0),
      symbol: run.symbol ?? "HBD",
    }));

    return {
      total: Number(row?.total ?? 0),
      count: Number(row?.count ?? 0),
      symbol: row?.symbol ?? "HBD",
      firstPaidAt: row?.firstPaidAt ?? null,
      lastPaidAt: row?.lastPaidAt ?? null,
      runs,
    };
  }

  async getProposalById(proposalId: number): Promise<HiveProposal | null> {
    const pool = await this.connection();
    const response = await pool.request()
      .input("proposalId", sql.Int, proposalId)
      .query<{
        id: number;
        creator: string;
        receiver: string;
        startDate: Date;
        endDate: Date;
        dailyPay: number;
        symbol: string | null;
        subject: string | null;
        permlink: string | null;
        totalVotes: string | number | null;
      }>(`
        SELECT
          [id],
          [creator],
          [receiver],
          [start_date] AS [startDate],
          [end_date] AS [endDate],
          [daily_pay] AS [dailyPay],
          [daily_pay_symbol] AS [symbol],
          [subject],
          [permlink],
          [total_votes] AS [totalVotes]
        FROM [Proposals]
        WHERE [id] = @proposalId
      `);
    const row = response.recordset[0];
    if (!row) return null;

    const symbol = row.symbol ?? "HBD";
    return {
      id: Number(row.id),
      proposal_id: Number(row.id),
      creator: row.creator,
      receiver: row.receiver,
      subject: row.subject ?? `Proposal #${row.id}`,
      permlink: row.permlink ?? "",
      start_date: row.startDate.toISOString().replace(".000Z", ""),
      end_date: row.endDate.toISOString().replace(".000Z", ""),
      daily_pay: `${Number(row.dailyPay ?? 0).toFixed(3)} ${symbol}`,
      total_votes: String(row.totalVotes ?? "0"),
      status: row.endDate.getTime() < Date.now() ? "expired" : "active",
    };
  }

  async getProposalTimeline(proposalId: number): Promise<HiveSqlProposalTimelineEvent[]> {
    const pool = await this.connection();
    const proposal = await pool.request()
      .input("proposalId", sql.Int, proposalId)
      .query<{
        creator: string;
        receiver: string;
        startDate: Date;
        endDate: Date;
        subject: string | null;
        permlink: string | null;
      }>(`
        SELECT
          [creator],
          [receiver],
          [start_date] AS [startDate],
          [end_date] AS [endDate],
          [subject],
          [permlink]
        FROM [Proposals]
        WHERE [id] = @proposalId
      `);
    const proposalRow = proposal.recordset[0];
    const events: HiveSqlProposalTimelineEvent[] = [];

    if (proposalRow) {
      const creates = await pool.request()
        .input("creator", sql.VarChar(16), proposalRow.creator)
        .input("receiver", sql.VarChar(16), proposalRow.receiver)
        .input("startDate", sql.DateTime, proposalRow.startDate)
        .input("endDate", sql.DateTime, proposalRow.endDate)
        .input("permlink", sql.VarChar(256), proposalRow.permlink)
        .query<{
          timestamp: Date;
          dailyPay: number | null;
          symbol: string | null;
          subject: string | null;
          permlink: string | null;
          txId: string | number | null;
          blockNum: number | null;
          transactionNum: number | null;
        }>(`
          SELECT TOP 1
            [proposal_create].[timestamp],
            [proposal_create].[daily_pay] AS [dailyPay],
            [proposal_create].[daily_pay_symbol] AS [symbol],
            [proposal_create].[subject],
            [proposal_create].[permlink],
            [proposal_create].[tx_id] AS [txId],
            [transaction].[block_num] AS [blockNum],
            [transaction].[transaction_num] AS [transactionNum]
          FROM [TxProposalCreates] AS [proposal_create]
          LEFT JOIN [Transactions] AS [transaction]
            ON [transaction].[tx_id] = [proposal_create].[tx_id]
          WHERE [proposal_create].[creator] = @creator
            AND [proposal_create].[receiver] = @receiver
            AND [proposal_create].[start_date] = @startDate
            AND [proposal_create].[end_date] = @endDate
          ORDER BY CASE WHEN [proposal_create].[permlink] = @permlink THEN 0 ELSE 1 END, [proposal_create].[timestamp] ASC
        `);

      for (const row of creates.recordset) {
        events.push({
          timestamp: row.timestamp,
          kind: "created",
          dailyPay: row.dailyPay === null || row.dailyPay === undefined ? null : Number(row.dailyPay),
          symbol: row.symbol ?? "HBD",
          subject: row.subject,
          permlink: row.permlink,
          txId: row.txId === null || row.txId === undefined ? null : String(row.txId),
          blockNum: row.blockNum === null || row.blockNum === undefined ? null : Number(row.blockNum),
          transactionNum: row.transactionNum === null || row.transactionNum === undefined ? null : Number(row.transactionNum),
        });
      }
    }

    const updates = await pool.request()
      .input("proposalId", sql.Int, proposalId)
      .query<{
        timestamp: Date;
        dailyPay: number | null;
        symbol: string | null;
        subject: string | null;
        permlink: string | null;
        txId: string | number | null;
        blockNum: number | null;
        transactionNum: number | null;
      }>(`
        SELECT
          [proposal_update].[timestamp],
          [proposal_update].[daily_pay] AS [dailyPay],
          [proposal_update].[daily_pay_symbol] AS [symbol],
          [proposal_update].[subject],
          [proposal_update].[permlink],
          [proposal_update].[tx_id] AS [txId],
          [transaction].[block_num] AS [blockNum],
          [transaction].[transaction_num] AS [transactionNum]
        FROM [TxProposalUpdates] AS [proposal_update]
        LEFT JOIN [Transactions] AS [transaction]
          ON [transaction].[tx_id] = [proposal_update].[tx_id]
        WHERE [proposal_update].[proposal_id] = @proposalId
        ORDER BY [proposal_update].[timestamp] ASC
      `);

    for (const row of updates.recordset) {
      events.push({
        timestamp: row.timestamp,
        kind: "updated",
        dailyPay: row.dailyPay === null || row.dailyPay === undefined ? null : Number(row.dailyPay),
        symbol: row.symbol ?? "HBD",
        subject: row.subject,
        permlink: row.permlink,
        txId: row.txId === null || row.txId === undefined ? null : String(row.txId),
        blockNum: row.blockNum === null || row.blockNum === undefined ? null : Number(row.blockNum),
        transactionNum: row.transactionNum === null || row.transactionNum === undefined ? null : Number(row.transactionNum),
      });
    }

    return events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  async getPromotedSummary(timeframe: HiveSqlPromotedTimeframe): Promise<HiveSqlPromotedSummary> {
    const pool = await this.connection();
    const { start, end } = promotedTimeframeRange(timeframe);
    const request = pool.request()
      .input("start", sql.DateTime, start)
      .input("end", sql.DateTime, end);

    const totals = await request.query<{
      count: number;
      symbol: string;
      total: number;
    }>(`
      WITH [parsed] AS (
        SELECT
          TRY_CONVERT(money, LEFT([promoted], CHARINDEX(' ', [promoted] + ' ') - 1)) AS [amount],
          RIGHT([promoted], LEN([promoted]) - CHARINDEX(' ', [promoted] + ' ')) AS [symbol]
        FROM [Comments]
        WHERE [created] >= @start
          AND [created] < @end
          AND [promoted] IS NOT NULL
          AND [promoted] <> ''
          AND [promoted] <> '0.000 HBD'
      )
      SELECT
        COUNT(*) AS [count],
        [symbol],
        COALESCE(SUM([amount]), 0) AS [total]
      FROM [parsed]
      WHERE [amount] IS NOT NULL
      GROUP BY [symbol]
      ORDER BY [symbol]
    `);

    const posts = await pool.request()
      .input("start", sql.DateTime, start)
      .input("end", sql.DateTime, end)
      .query<{
        author: string;
        permlink: string;
        title: string | null;
        promoted: number;
        symbol: string;
      }>(`
        SELECT TOP 5
          [author],
          [permlink],
          [title],
          TRY_CONVERT(money, LEFT([promoted], CHARINDEX(' ', [promoted] + ' ') - 1)) AS [promoted],
          RIGHT([promoted], LEN([promoted]) - CHARINDEX(' ', [promoted] + ' ')) AS [symbol]
        FROM [Comments]
        WHERE [created] >= @start
          AND [created] < @end
          AND [promoted] IS NOT NULL
          AND [promoted] <> ''
          AND [promoted] <> '0.000 HBD'
        ORDER BY TRY_CONVERT(money, LEFT([promoted], CHARINDEX(' ', [promoted] + ' ') - 1)) DESC
      `);

    return {
      timeframe,
      count: totals.recordset.reduce((sum, row) => sum + Number(row.count), 0),
      totals: totals.recordset.map((row) => ({
        symbol: row.symbol,
        total: Number(row.total),
      })),
      posts: posts.recordset
        .filter((row) => row.author && row.permlink && Number.isFinite(Number(row.promoted)))
        .map((row) => ({
          author: row.author,
          permlink: row.permlink,
          title: row.title,
          promoted: Number(row.promoted),
          symbol: row.symbol,
        })),
    };
  }

  async getDistribution(daysAgo: number): Promise<HiveSqlDistributionSummary> {
    const pool = await this.connection();
    const start = new Date(Date.now() - Math.max(0, daysAgo) * 24 * 60 * 60 * 1000);
    const end = new Date();
    const request = pool.request()
      .input("start", sql.DateTime, start)
      .input("end", sql.DateTime, end);
    const response = await request.query<{
      level: string;
      mvests: number;
      accountCount: number;
      vestingShares: number;
      activeAccountCount: number;
      inactiveAccountCount: number;
      activeVestingShares: number;
      inactiveVestingShares: number;
    }>(`
      WITH [parsed] AS (
        SELECT
          TRY_CONVERT(float, REPLACE([vesting_shares], ' VESTS', '')) AS [vestingShares],
          CASE WHEN [last_vote_time] >= @start AND [last_vote_time] <= @end THEN 1 ELSE 0 END AS [active]
        FROM [Accounts]
      ),
      [usable] AS (
        SELECT
          [vestingShares],
          [active],
          CASE
            WHEN [vestingShares] < 10000 THEN 'dust'
            WHEN [vestingShares] < 100000 THEN 'newbie'
            WHEN [vestingShares] < 1000000 THEN 'user'
            WHEN [vestingShares] < 10000000 THEN 'superuser'
            WHEN [vestingShares] < 100000000 THEN 'hero'
            WHEN [vestingShares] < 1000000000 THEN 'superhero'
            ELSE 'legend'
          END AS [level],
          CASE
            WHEN [vestingShares] < 10000 THEN 0
            WHEN [vestingShares] < 100000 THEN 0.01
            WHEN [vestingShares] < 1000000 THEN 0.1
            WHEN [vestingShares] < 10000000 THEN 1
            WHEN [vestingShares] < 100000000 THEN 10
            WHEN [vestingShares] < 1000000000 THEN 100
            ELSE 1000
          END AS [mvests]
        FROM [parsed]
        WHERE [vestingShares] IS NOT NULL
      ),
      [totals] AS (
        SELECT
          SUM(CASE WHEN [active] = 1 THEN 1 ELSE 0 END) AS [activeAccountCount],
          SUM(CASE WHEN [active] = 0 THEN 1 ELSE 0 END) AS [inactiveAccountCount],
          SUM(CASE WHEN [active] = 1 THEN [vestingShares] ELSE 0 END) AS [activeVestingShares],
          SUM(CASE WHEN [active] = 0 THEN [vestingShares] ELSE 0 END) AS [inactiveVestingShares]
        FROM [usable]
      ),
      [buckets] AS (
        SELECT
          [level],
          [mvests],
          COUNT(*) AS [accountCount],
          SUM([vestingShares]) AS [vestingShares]
        FROM [usable]
        WHERE [active] = 1
        GROUP BY [level], [mvests]
      )
      SELECT
        [buckets].[level],
        [buckets].[mvests],
        [buckets].[accountCount],
        [buckets].[vestingShares],
        [totals].[activeAccountCount],
        [totals].[inactiveAccountCount],
        [totals].[activeVestingShares],
        [totals].[inactiveVestingShares]
      FROM [buckets]
      CROSS JOIN [totals]
      ORDER BY [buckets].[mvests]
    `);
    const first = response.recordset[0];

    return {
      daysAgo,
      activeAccountCount: Number(first?.activeAccountCount ?? 0),
      inactiveAccountCount: Number(first?.inactiveAccountCount ?? 0),
      activeVestingShares: Number(first?.activeVestingShares ?? 0),
      inactiveVestingShares: Number(first?.inactiveVestingShares ?? 0),
      buckets: response.recordset.map((row) => ({
        level: row.level,
        mvests: Number(row.mvests),
        accountCount: Number(row.accountCount),
        vestingShares: Number(row.vestingShares),
      })),
    };
  }

  async findBadges(terms: string[], limit: number): Promise<HiveSqlBadge[]> {
    const pool = await this.connection();
    const request = pool.request()
      .input("limit", sql.Int, limit);
    const filters = terms.map((term, index) => {
      const input = `term${index}`;
      request.input(input, sql.NVarChar(256), `%${term.toLowerCase()}%`);
      return `([name] LIKE @${input} OR [recovery_account] LIKE @${input} OR LOWER(COALESCE([json_metadata], '')) LIKE @${input})`;
    });
    const response = await request.query<{
      name: string;
      recoveryAccount: string;
      jsonMetadata: string | null;
      created: Date | null;
    }>(`
      SELECT TOP (@limit)
        [name],
        [recovery_account] AS [recoveryAccount],
        [json_metadata] AS [jsonMetadata],
        [created] AS [created]
      FROM [Accounts]
      WHERE [name] LIKE 'badge-%'
        ${filters.length > 0 ? `AND ${filters.join(" AND ")}` : ""}
      ORDER BY [id] DESC
    `);

    return response.recordset.map((row) => ({
      name: row.name,
      recoveryAccount: row.recoveryAccount,
      jsonMetadata: row.jsonMetadata,
      created: row.created,
    }));
  }

  async getBadgeStats(account: string): Promise<HiveSqlBadgeStats> {
    const pool = await this.connection();
    const response = await pool.request()
      .input("account", sql.VarChar(16), account)
      .query<{ recipients: number; subscribers: number }>(`
        SELECT
          (SELECT COUNT(*) FROM [Followers] WHERE [follower] = @account) AS [recipients],
          (SELECT COUNT(*) FROM [Followers] WHERE [following] = @account) AS [subscribers]
      `);
    const row = response.recordset[0];

    return {
      recipients: Number(row?.recipients ?? 0),
      subscribers: Number(row?.subscribers ?? 0),
    };
  }

  async getDelegations(account: string, direction: "incoming" | "outgoing"): Promise<HiveSqlDelegation[]> {
    const pool = await this.connection();
    const accountColumn = direction === "incoming" ? "delegator" : "delegatee";
    const filterColumn = direction === "incoming" ? "delegatee" : "delegator";
    const response = await pool.request()
      .input("account", sql.VarChar(16), account)
      .query<{ account: string; vests: number }>(`
        SELECT [${accountColumn}] AS [account], SUM([vests]) AS [vests]
        FROM [Delegations]
        WHERE [${filterColumn}] = @account
        GROUP BY [${accountColumn}]
        ORDER BY SUM([vests]) DESC
      `);

    return response.recordset.map((row) => ({
      account: row.account,
      vests: Number(row.vests),
    }));
  }

  async getDelegateesByMinimumMvests(minMvests: number): Promise<HiveSqlDelegatee[]> {
    const pool = await this.connection();
    const minVests = Math.max(0, minMvests) * 1_000_000;
    const response = await pool.request()
      .input("minVests", sql.Float, minVests)
      .query<{ delegatee: string; vests: number; delegatorCount: number; singleDelegator: string }>(`
        SELECT
          [delegatee],
          SUM([vests]) AS [vests],
          COUNT(DISTINCT [delegator]) AS [delegatorCount],
          MIN([delegator]) AS [singleDelegator]
        FROM [Delegations]
        GROUP BY [delegatee]
        HAVING SUM([vests]) >= @minVests
        ORDER BY SUM([vests]) DESC
      `);

    return response.recordset.map((row) => ({
      delegatee: row.delegatee,
      vests: Number(row.vests),
      delegatorCount: Number(row.delegatorCount),
      singleDelegator: row.singleDelegator,
    }));
  }

  async getClaimSummary(timeframe: HiveSqlClaimTimeframe): Promise<HiveSqlClaimSummary> {
    const pool = await this.connection();
    const request = pool.request();
    const whereClause = addClaimTimeframeInputs(request, timeframe);
    const response = await request.query<{
      count: number;
      uniqueAccounts: number;
      rewardHbd: number;
      rewardHive: number;
      rewardVests: number;
    }>(`
      SELECT
        COUNT(*) AS [count],
        COUNT(DISTINCT [account]) AS [uniqueAccounts],
        COALESCE(SUM([reward_hbd]), 0) AS [rewardHbd],
        COALESCE(SUM([reward_hive]), 0) AS [rewardHive],
        COALESCE(SUM([reward_vests]), 0) AS [rewardVests]
      FROM [TxClaimRewardBalances]
      ${whereClause}
    `);
    const row = response.recordset[0];

    return {
      timeframe,
      count: Number(row?.count ?? 0),
      uniqueAccounts: Number(row?.uniqueAccounts ?? 0),
      rewardHbd: Number(row?.rewardHbd ?? 0),
      rewardHive: Number(row?.rewardHive ?? 0),
      rewardVests: Number(row?.rewardVests ?? 0),
    };
  }

  async getAccountSummary(): Promise<HiveSqlAccountSummary> {
    const pool = await this.connection();
    const response = await pool.request().query<{
      total: number;
      communities: number;
      badges: number;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM [Accounts]) AS [total],
        (
          SELECT COUNT(DISTINCT [accounts].[name])
          FROM [Accounts] AS [accounts]
          INNER JOIN [TxCustoms] AS [customs]
            ON [customs].[required_posting_auth] = [accounts].[name]
          WHERE [accounts].[id] >= 1290109
            AND [accounts].[name] LIKE 'hive-[123][0-9]%'
            AND [customs].[id] >= 217640816
            AND [customs].[tid] = 'community'
        ) AS [communities],
        (
          SELECT COUNT(*)
          FROM [Accounts] AS [accounts]
          WHERE [accounts].[id] >= 1362496
            AND [accounts].[name] LIKE 'badge-[0-9]%'
        ) AS [badges]
    `);
    const row = response.recordset[0];

    return {
      total: Number(row?.total ?? 0),
      mined: 13_696,
      communities: Number(row?.communities ?? 0),
      badges: Number(row?.badges ?? 0),
    };
  }

  private async connection(): Promise<sql.ConnectionPool> {
    if (this.pool?.connected) return this.pool;

    if (!this.config.hiveSql.enabled || !this.config.hiveSql.username || !this.config.hiveSql.password) {
      throw new Error("HiveSQL is not configured.");
    }

    this.pool = await new sql.ConnectionPool({
      server: this.config.hiveSql.server,
      database: this.config.hiveSql.database,
      user: this.config.hiveSql.username,
      password: this.config.hiveSql.password,
      options: {
        encrypt: true,
        trustServerCertificate: true,
      },
      pool: {
        max: 3,
        min: 0,
        idleTimeoutMillis: 30_000,
      },
    }).connect();

    if (!HiveSqlClient.loggedConnection) {
      HiveSqlClient.loggedConnection = true;
      this.logger.info("Connected to HiveSQL.", {
        server: this.config.hiveSql.server,
        database: this.config.hiveSql.database,
      });
    }

    return this.pool;
  }
}

function addClaimTimeframeInputs(request: sql.Request, timeframe: HiveSqlClaimTimeframe): string {
  if (timeframe === "all") return "";

  const now = new Date();
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = timeframe === "today" ? new Date(todayStart) : new Date(todayStart - 24 * 60 * 60 * 1000);
  const end = timeframe === "today" ? new Date(todayStart + 24 * 60 * 60 * 1000) : new Date(todayStart);

  request
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end);

  return "WHERE [timestamp] >= @start AND [timestamp] < @end";
}

function promotedTimeframeRange(timeframe: HiveSqlPromotedTimeframe): { start: Date; end: Date } {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (timeframe === "today") {
    return {
      start: today,
      end: new Date(today.getTime() + 24 * 60 * 60 * 1000),
    };
  }

  return {
    start: new Date(today.getTime() - 24 * 60 * 60 * 1000),
    end: today,
  };
}

function topPostScore(kind: HiveSqlTopKind): string {
  switch (kind) {
    case "upvoted":
    case "downvoted":
      return "[post].[net_votes]";
    case "children":
    case "reply":
      return "[post].[children]";
    case "rep":
    case "-rep":
      return "[account].[reputation_ui]";
    case "promoted":
      return "TRY_CONVERT(money, LEFT([post].[promoted], CHARINDEX(' ', [post].[promoted] + ' ') - 1))";
  }
}

function topPostOrder(kind: HiveSqlTopKind): string {
  const score = topPostScore(kind);
  return kind === "downvoted" || kind === "-rep"
    ? `${score} ASC, [post].[created] DESC`
    : `${score} DESC, [post].[created] DESC`;
}

export function wildcardToSqlLike(pattern: string): string {
  let like = "";

  for (const char of pattern) {
    switch (char) {
      case "*":
      case "%":
        like += "%";
        break;
      case "\\":
      case "_":
      case "[":
      case "]":
        like += `\\${char}`;
        break;
      default:
        like += char;
    }
  }

  return like;
}
