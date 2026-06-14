import pg from "pg";
import type { AppConfig } from "../config.js";
import type { HiveProposal } from "../hive/api.js";
import { wildcardToSqlLike, type HiveSqlAccountSummary, type HiveSqlApi, type HiveSqlAppPayout, type HiveSqlAppPayoutOptions, type HiveSqlBadge, type HiveSqlBadgeStats, type HiveSqlClaimSummary, type HiveSqlClaimTimeframe, type HiveSqlDelegatee, type HiveSqlDelegation, type HiveSqlDistributionSummary, type HiveSqlPromotedSummary, type HiveSqlPromotedTimeframe, type HiveSqlProposalPayments, type HiveSqlProposalTimelineEvent, type HiveSqlSearchOptions, type HiveSqlSearchResult, type HiveSqlTopPost, type HiveSqlTopPostOptions } from "../hivesql/api.js";
import type { Logger } from "../logger.js";

type PgPoolLike = Pick<pg.Pool, "query">;

type QueryRow = Record<string, unknown>;

export class HafSqlClient implements HiveSqlApi {
  readonly providerName = "HafSQL";

  private static loggedConnection = false;
  private pool: PgPoolLike | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    pool?: PgPoolLike,
  ) {
    this.pool = pool ?? null;
  }

  async findAccountNamesByPattern(pattern: string, limit: number): Promise<string[]> {
    const response = await this.query<{ name: string }>(`
      SELECT name
      FROM hafsql.accounts
      WHERE name LIKE $1 ESCAPE '\\'
      ORDER BY name
      LIMIT $2
    `, [wildcardToSqlLike(pattern), limit]);

    return response.rows.map((row) => row.name);
  }

  async getDelegations(account: string, direction: "incoming" | "outgoing"): Promise<HiveSqlDelegation[]> {
    const accountColumn = direction === "incoming" ? "delegator" : "delegatee";
    const filterColumn = direction === "incoming" ? "delegatee" : "delegator";
    const response = await this.query<{ account: string; vests: string | number }>(`
      SELECT ${accountColumn} AS account, vests
      FROM hafsql.delegations
      WHERE ${filterColumn} = $1
      ORDER BY vests DESC
    `, [account]);

    return response.rows.map((row) => ({
      account: row.account,
      vests: Number(row.vests),
    }));
  }

  async getDelegateesByMinimumMvests(minMvests: number): Promise<HiveSqlDelegatee[]> {
    const minVests = Math.max(0, minMvests) * 1_000_000;
    const response = await this.query<{
      delegatee: string;
      vests: string | number;
      delegator_count: string | number;
      single_delegator: string;
    }>(`
      SELECT
        delegatee,
        SUM(vests) AS vests,
        COUNT(DISTINCT delegator) AS delegator_count,
        MIN(delegator) AS single_delegator
      FROM hafsql.delegations
      GROUP BY delegatee
      HAVING SUM(vests) >= $1
      ORDER BY SUM(vests) DESC
    `, [minVests]);

    return response.rows.map((row) => ({
      delegatee: row.delegatee,
      vests: Number(row.vests),
      delegatorCount: Number(row.delegator_count),
      singleDelegator: row.single_delegator,
    }));
  }

  async getClaimSummary(timeframe: HiveSqlClaimTimeframe): Promise<HiveSqlClaimSummary> {
    const { where, params } = claimTimeframeClause(timeframe);
    const response = await this.query<{
      count: string | number;
      unique_accounts: string | number;
      reward_hbd: string | number;
      reward_hive: string | number;
      reward_vests: string | number;
    }>(`
      SELECT
        COUNT(*) AS count,
        COUNT(DISTINCT account) AS unique_accounts,
        COALESCE(SUM(reward_hbd), 0) AS reward_hbd,
        COALESCE(SUM(reward_hive), 0) AS reward_hive,
        COALESCE(SUM(reward_vests), 0) AS reward_vests
      FROM hafsql.operation_claim_reward_balance_table
      ${where}
    `, params);

    const row = response.rows[0];
    return {
      timeframe,
      count: Number(row?.count ?? 0),
      uniqueAccounts: Number(row?.unique_accounts ?? 0),
      rewardHbd: Number(row?.reward_hbd ?? 0),
      rewardHive: Number(row?.reward_hive ?? 0),
      rewardVests: Number(row?.reward_vests ?? 0),
    };
  }

  async getAccountSummary(): Promise<HiveSqlAccountSummary> {
    const response = await this.query<{
      total: string | number;
      communities: string | number;
      badges: string | number;
    }>(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE name ~ '^hive-[123][0-9]') AS communities,
        COUNT(*) FILTER (WHERE name ~ '^badge-[0-9]') AS badges
      FROM hafsql.accounts
    `);
    const row = response.rows[0];

    return {
      total: Number(row?.total ?? 0),
      mined: 13_696,
      communities: Number(row?.communities ?? 0),
      badges: Number(row?.badges ?? 0),
    };
  }

  async getProposalPayments(proposalId: number): Promise<HiveSqlProposalPayments> {
    const [totals, runs] = await Promise.all([
      this.query<{
        total: string | number;
        count: string | number;
        symbol: string | null;
        first_paid_at: Date | string | null;
        last_paid_at: Date | string | null;
      }>(`
        SELECT
          COALESCE(SUM(CASE WHEN payment > 0 THEN payment ELSE 0 END), 0) AS total,
          COALESCE(SUM(CASE WHEN payment > 0 THEN 1 ELSE 0 END), 0) AS count,
          COALESCE(MIN(symbol), 'HBD') AS symbol,
          MIN(CASE WHEN payment > 0 THEN hafsql.get_timestamp(id) END) AS first_paid_at,
          MAX(CASE WHEN payment > 0 THEN hafsql.get_timestamp(id) END) AS last_paid_at
        FROM hafsql.operation_proposal_pay_table
        WHERE proposal_id = $1
      `, [proposalId]),
      this.query<{
        started_at: Date | string;
        ended_at: Date | string;
        total: string | number;
        count: string | number;
        symbol: string | null;
      }>(`
        WITH positive_pays AS (
          SELECT
            hafsql.get_timestamp(id) AS timestamp,
            payment,
            symbol,
            LAG(hafsql.get_timestamp(id)) OVER (ORDER BY id) AS previous_timestamp
          FROM hafsql.operation_proposal_pay_table
          WHERE proposal_id = $1
            AND payment > 0
        ),
        marked_pays AS (
          SELECT
            timestamp,
            payment,
            symbol,
            CASE
              WHEN previous_timestamp IS NULL OR timestamp - previous_timestamp > interval '12 hours' THEN 1
              ELSE 0
            END AS new_run
          FROM positive_pays
        ),
        grouped_pays AS (
          SELECT
            timestamp,
            payment,
            symbol,
            SUM(new_run) OVER (ORDER BY timestamp ROWS UNBOUNDED PRECEDING) AS run_id
          FROM marked_pays
        )
        SELECT
          MIN(timestamp) AS started_at,
          MAX(timestamp) AS ended_at,
          SUM(payment) AS total,
          COUNT(*) AS count,
          COALESCE(MIN(symbol), 'HBD') AS symbol
        FROM grouped_pays
        GROUP BY run_id
        ORDER BY started_at
      `, [proposalId]),
    ]);

    const row = totals.rows[0];
    return {
      total: Number(row?.total ?? 0),
      count: Number(row?.count ?? 0),
      symbol: row?.symbol ?? "HBD",
      firstPaidAt: toDate(row?.first_paid_at),
      lastPaidAt: toDate(row?.last_paid_at),
      runs: runs.rows.map((run) => ({
        startedAt: toRequiredDate(run.started_at),
        endedAt: toRequiredDate(run.ended_at),
        total: Number(run.total ?? 0),
        count: Number(run.count ?? 0),
        symbol: run.symbol ?? "HBD",
      })),
    };
  }

  async getProposalTimeline(proposalId: number): Promise<HiveSqlProposalTimelineEvent[]> {
    const updates = await this.query<{
      timestamp: Date | string;
      daily_pay: string | number | null;
      symbol: string | null;
      subject: string | null;
      permlink: string | null;
      tx_id: string | number | null;
      block_num: string | number | null;
    }>(`
      SELECT
        hafsql.get_timestamp(id) AS timestamp,
        daily_pay,
        daily_pay_symbol AS symbol,
        subject,
        permlink,
        id AS tx_id,
        hafd.operation_id_to_block_num(id) AS block_num
      FROM hafsql.operation_update_proposal_table
      WHERE proposal_id = $1
      ORDER BY id ASC
    `, [proposalId]);

    return updates.rows.map((row) => ({
      timestamp: toRequiredDate(row.timestamp),
      kind: "updated",
      dailyPay: row.daily_pay === null || row.daily_pay === undefined ? null : Number(row.daily_pay),
      symbol: row.symbol ?? "HBD",
      subject: row.subject,
      permlink: row.permlink,
      txId: row.tx_id === null || row.tx_id === undefined ? null : String(row.tx_id),
      blockNum: row.block_num === null || row.block_num === undefined ? null : Number(row.block_num),
      transactionNum: null,
    }));
  }

  async getProposalById(_proposalId: number): Promise<HiveProposal | null> {
    return null;
  }

  async searchComments(_options: HiveSqlSearchOptions): Promise<HiveSqlSearchResult> {
    throw new Error("HafSQL content search is not implemented yet.");
  }

  async getTopPost(_options: HiveSqlTopPostOptions): Promise<HiveSqlTopPost | null> {
    throw new Error("HafSQL top post lookup is not implemented yet.");
  }

  async getAppPayouts(_options: HiveSqlAppPayoutOptions): Promise<HiveSqlAppPayout[]> {
    throw new Error("HafSQL app payout lookup is not implemented yet.");
  }

  async getPromotedSummary(_timeframe: HiveSqlPromotedTimeframe): Promise<HiveSqlPromotedSummary> {
    throw new Error("HafSQL promoted post lookup is not implemented yet.");
  }

  async getDistribution(_daysAgo: number): Promise<HiveSqlDistributionSummary> {
    throw new Error("HafSQL distribution lookup is not implemented yet.");
  }

  async findBadges(_terms: string[], _limit: number): Promise<HiveSqlBadge[]> {
    throw new Error("HafSQL badge search is not implemented yet.");
  }

  async getBadgeStats(_account: string): Promise<HiveSqlBadgeStats> {
    throw new Error("HafSQL badge lookup is not implemented yet.");
  }

  private async query<T extends QueryRow>(text: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    return this.connection().query<T>(text, values);
  }

  private connection(): PgPoolLike {
    if (this.pool) return this.pool;

    if (!this.config.hafSql.enabled || !this.config.hafSql.username || !this.config.hafSql.password) {
      throw new Error("HafSQL is not configured.");
    }

    this.pool = new pg.Pool({
      host: this.config.hafSql.host,
      port: this.config.hafSql.port,
      database: this.config.hafSql.database,
      user: this.config.hafSql.username,
      password: this.config.hafSql.password,
      ssl: this.config.hafSql.ssl,
      max: this.config.hafSql.maxPoolSize,
      idleTimeoutMillis: 30_000,
      query_timeout: this.config.hafSql.statementTimeoutMs,
    });

    if (!HafSqlClient.loggedConnection) {
      HafSqlClient.loggedConnection = true;
      this.logger.info("Connected to HafSQL.", {
        host: this.config.hafSql.host,
        database: this.config.hafSql.database,
      });
    }

    return this.pool;
  }
}

export function claimTimeframeClause(timeframe: HiveSqlClaimTimeframe): { where: string; params: Date[] } {
  if (timeframe === "all") return { where: "", params: [] };

  const now = new Date();
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = timeframe === "today" ? new Date(todayStart) : new Date(todayStart - 24 * 60 * 60 * 1000);
  const end = timeframe === "today" ? new Date(todayStart + 24 * 60 * 60 * 1000) : new Date(todayStart);

  return {
    where: "WHERE id >= hafsql.id_from_timestamp($1) AND id < hafsql.id_from_timestamp($2)",
    params: [start, end],
  };
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function toRequiredDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
