import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";

export type HiveAccount = {
  name: string;
  created?: string;
  json_metadata?: string;
  posting_json_metadata?: string;
  proxy?: string;
  recovery_account?: string;
  hbd_balance?: string;
  voting_power?: number;
  last_vote_time?: string;
  vesting_shares?: string;
  received_vesting_shares?: string;
  delegated_vesting_shares?: string;
  witness_votes?: string[] | string;
};

export type HiveAccountReputation = {
  account: string;
  reputation: string | number;
};

type HiveAccountReputationResponse = {
  reputations: HiveAccountReputation[];
};

export type HiveDynamicGlobalProperties = {
  current_hbd_supply?: string;
  current_supply?: string;
  hbd_interest_rate?: number;
  hbd_print_rate?: number;
  hbd_start_percent?: number;
  hbd_stop_percent?: number;
  participation_count?: number;
  total_vesting_fund_hive: string;
  total_vesting_shares: string;
  virtual_supply?: string;
};

export type HiveFeedHistory = {
  current_max_history?: {
    base: string;
    quote: string;
  };
  current_median_history: {
    base: string;
    quote: string;
  };
  current_min_history?: {
    base: string;
    quote: string;
  };
  market_median_history?: {
    base: string;
    quote: string;
  };
};

export type HiveMarketTicker = {
  latest?: string;
  lowest_ask?: string;
  highest_bid?: string;
  percent_change?: string;
  hive_volume?: string;
  hbd_volume?: string;
};

export type HiveFollowCount = {
  account: string;
  follower_count: number;
  following_count: number;
};

export type HiveWitness = {
  owner: string;
  votes?: string | number;
  signing_key?: string;
  total_missed?: number;
  running_version?: string;
  hardfork_version_vote?: string;
  hardfork_time_vote?: string;
  props?: {
    account_creation_fee?: string;
    maximum_block_size?: number;
    hbd_interest_rate?: number;
  };
};

export type HiveRewardFund = {
  name: string;
  reward_balance: string;
  recent_claims: string;
  last_update?: string;
  percent_curation_rewards?: number;
};

export type HiveWitnessSchedule = {
  majority_version: string;
};

export type HiveScheduledHardfork = {
  hf_version: string;
  live_time: string;
};

export type HivePost = {
  author: string;
  permlink: string;
  title?: string;
  body?: string;
  json_metadata?: string;
  url?: string;
  created?: string;
  cashout_time?: string;
  pending_payout_value?: string;
};

export type HiveConfig = {
  HIVE_PROPOSAL_FUND_PERCENT_HF21?: number;
  HIVE_TREASURY_ACCOUNT?: string;
};

export type HiveAssetObject = {
  amount: string;
  precision: number;
  nai: string;
};

export type HiveProposalVote = {
  voter: string;
  proposal: {
    id?: number;
    proposal_id?: number;
    receiver: string;
    status: string;
    daily_pay: string | HiveAssetObject;
  };
};

export type HiveProposal = {
  id?: number;
  proposal_id?: number;
  creator: string;
  receiver: string;
  subject: string;
  permlink: string;
  start_date: string;
  end_date: string;
  daily_pay: string | HiveAssetObject;
  total_votes: string | number;
};

export type HiveRewardOperation = {
  type: string;
  timestamp: string;
  value: Record<string, unknown>;
};

export type HiveAccountOperation = {
  index: number;
  block: number;
  timestamp: string;
  type: string;
  value: Record<string, unknown>;
};

export type HiveCommunity = {
  name: string;
  title?: string;
  about?: string;
  description?: string;
  subscribers?: number;
  sum_pending?: number;
  num_authors?: number;
  created_at?: string;
  team?: Array<[string, string, string]>;
};

export type HiveApi = {
  getAccount(name: string): Promise<HiveAccount | null>;
  getAccounts(names: string[]): Promise<HiveAccount[]>;
  getAccountReputation(name: string): Promise<HiveAccountReputation | null>;
  getConfig(): Promise<HiveConfig>;
  getDynamicGlobalProperties(): Promise<HiveDynamicGlobalProperties>;
  getFeedHistory(): Promise<HiveFeedHistory>;
  getMarketTicker(): Promise<HiveMarketTicker>;
  getFollowCount(name: string): Promise<HiveFollowCount | null>;
  getFirstPost(name: string, offset: number): Promise<HivePost | null>;
  getLatestPosts(name: string, limit: number): Promise<HivePost[]>;
  getPostCreation(author: string, permlink: string): Promise<HivePost | null>;
  getCommunity(nameOrQuery: string): Promise<HiveCommunity | null>;
  getLatestAccountOperation(name: string): Promise<HiveAccountOperation | null>;
  getRewardOperations(name: string, pages?: number): Promise<HiveRewardOperation[]>;
  getRewardFund(name: string): Promise<HiveRewardFund>;
  listProposals(): Promise<HiveProposal[]>;
  listProposalVotesByProposal(proposalId: number): Promise<HiveProposalVote[]>;
  listProposalVotes(voter: string): Promise<HiveProposalVote[]>;
  getHardforkVersion(): Promise<string>;
  getNextScheduledHardfork(): Promise<HiveScheduledHardfork>;
  getWitnessByAccount(name: string): Promise<HiveWitness | null>;
  getWitnessesByVote(limit: number): Promise<HiveWitness[]>;
  getWitnessSchedule(): Promise<HiveWitnessSchedule>;
};

type RpcResponse<T> = {
  result?: T;
  error?: {
    message?: string;
  };
};

type AccountHistoryEntry = [
  number,
  {
    block: number;
    timestamp: string;
    op: [string, Record<string, unknown>];
  },
];

function isRewardOperation(type: string): boolean {
  return type.endsWith("_reward") || type === "interest";
}

export class HiveRpcClient implements HiveApi {
  private static reputationApiAvailable: boolean | null = null;
  private static loggedReputationFallback = false;

  private nextId = 1;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async getAccount(name: string): Promise<HiveAccount | null> {
    const accounts = await this.getAccounts([name]);
    return accounts[0] ?? null;
  }

  async getAccounts(names: string[]): Promise<HiveAccount[]> {
    return this.call<HiveAccount[]>("condenser_api.get_accounts", [names]);
  }

  async getAccountReputation(name: string): Promise<HiveAccountReputation | null> {
    const reputations = await this.getAccountReputations(name);
    const reputation = reputations[0];
    return reputation?.account === name ? reputation : null;
  }

  private async getAccountReputations(name: string): Promise<HiveAccountReputation[]> {
    if (HiveRpcClient.reputationApiAvailable === false) {
      return this.getCondenserAccountReputations(name);
    }

    try {
      const response = await this.call<HiveAccountReputationResponse>("reputation_api.get_account_reputations", {
        account_lower_bound: name,
        limit: 1,
      }, { logFailures: false });
      HiveRpcClient.reputationApiAvailable = true;
      return response.reputations;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isMissingApiError(message)) {
        HiveRpcClient.reputationApiAvailable = false;
        this.logReputationFallback("Hive reputation_api is unavailable; using condenser reputation lookup.");
      } else {
        this.logger.warn("Falling back to condenser reputation lookup.", { error: message });
      }

      return this.getCondenserAccountReputations(name);
    }
  }

  private async getCondenserAccountReputations(name: string): Promise<HiveAccountReputation[]> {
    return this.call<HiveAccountReputation[]>("condenser_api.get_account_reputations", [name, 1]);
  }

  private logReputationFallback(message: string) {
    if (HiveRpcClient.loggedReputationFallback) return;
    HiveRpcClient.loggedReputationFallback = true;
    this.logger.info(message);
  }

  async getConfig(): Promise<HiveConfig> {
    return this.call<HiveConfig>("condenser_api.get_config", []);
  }

  async getDynamicGlobalProperties(): Promise<HiveDynamicGlobalProperties> {
    return this.call<HiveDynamicGlobalProperties>("condenser_api.get_dynamic_global_properties", []);
  }

  async getFeedHistory(): Promise<HiveFeedHistory> {
    return this.call<HiveFeedHistory>("condenser_api.get_feed_history", []);
  }

  async getMarketTicker(): Promise<HiveMarketTicker> {
    return this.call<HiveMarketTicker>("condenser_api.get_ticker", []);
  }

  async getFollowCount(name: string): Promise<HiveFollowCount | null> {
    const count = await this.call<HiveFollowCount>("condenser_api.get_follow_count", [name]);
    return count.account === name ? count : null;
  }

  async getFirstPost(name: string, offset: number): Promise<HivePost | null> {
    const pageSize = 1000;
    const maxPages = 100;
    const seenPermlinks = new Set<string>();
    let start = pageSize - 1;

    for (let page = 0; page < maxPages; page++) {
      const history = await this.call<AccountHistoryEntry[]>("condenser_api.get_account_history", [name, start, pageSize]);
      if (history.length === 0) return null;

      for (const [, item] of history) {
        const post = creationPostFromHistory(name, item);
        if (!post || seenPermlinks.has(post.permlink)) continue;

        seenPermlinks.add(post.permlink);
        if (seenPermlinks.size === offset + 1) {
          return post;
        }
      }

      if (history.length < pageSize) return null;
      start += pageSize;
    }

    return null;
  }

  async getPostCreation(author: string, permlink: string): Promise<HivePost | null> {
    return this.getContentPost(author, permlink);
  }

  async getCommunity(nameOrQuery: string): Promise<HiveCommunity | null> {
    const value = nameOrQuery.toLowerCase();
    if (/^hive-\d+$/.test(value)) {
      return this.getCommunityByName(value);
    }

    const communities = await this.call<HiveCommunity[]>("bridge.list_communities", {
      query: nameOrQuery,
      limit: 1,
    });
    const first = communities[0];
    if (!first?.name) return null;

    return this.getCommunityByName(first.name);
  }

  private async getCommunityByName(name: string): Promise<HiveCommunity | null> {
    const community = await this.call<HiveCommunity>("bridge.get_community", {
      name,
      observer: "banjo",
    });
    return community?.name === name ? community : null;
  }

  async getLatestAccountOperation(name: string): Promise<HiveAccountOperation | null> {
    const history = await this.call<AccountHistoryEntry[]>("condenser_api.get_account_history", [name, -1, 1]);
    const entry = history.at(-1);
    if (!entry) return null;

    const [index, item] = entry;
    const [type, value] = item.op;

    return {
      index,
      block: item.block,
      timestamp: item.timestamp,
      type,
      value,
    };
  }

  async getRewardOperations(name: string, pages = 4): Promise<HiveRewardOperation[]> {
    const pageSize = 1000;
    const rewards: HiveRewardOperation[] = [];
    const seenIndexes = new Set<number>();
    let start = -1;

    for (let page = 0; page < pages; page++) {
      const history = await this.call<AccountHistoryEntry[]>("condenser_api.get_account_history", [name, start, pageSize]);
      if (history.length === 0) break;

      for (const [index, item] of history) {
        seenIndexes.add(index);
        const [type, value] = item.op;
        if (!isRewardOperation(type)) continue;

        rewards.push({
          type,
          timestamp: item.timestamp,
          value,
        });
      }

      const firstIndex = history[0]?.[0];
      if (typeof firstIndex !== "number" || firstIndex <= 0) break;
      start = firstIndex - 1;
    }

    return rewards;
  }

  private async getContentPost(author: string, permlink: string): Promise<HivePost | null> {
    let content: Record<string, unknown>;
    try {
      content = await this.call<Record<string, unknown>>(
        "condenser_api.get_content",
        [author, permlink],
        { logFailures: false },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isMissingContentError(message)) return null;
      throw error;
    }

    if (content.author !== author || content.permlink !== permlink) return null;

    const created = typeof content.created === "string" && content.created ? content.created : null;
    if (!created) return null;

    const title = typeof content.title === "string" && content.title ? content.title : null;
    const body = typeof content.body === "string" && content.body ? content.body : null;
    const jsonMetadata = typeof content.json_metadata === "string" && content.json_metadata ? content.json_metadata : null;
    const url = typeof content.url === "string" && content.url ? content.url : null;
    const cashoutTime = typeof content.cashout_time === "string" && content.cashout_time ? content.cashout_time : null;
    const pendingPayoutValue = typeof content.pending_payout_value === "string" && content.pending_payout_value ? content.pending_payout_value : null;

    return {
      author,
      permlink,
      created,
      ...(title ? { title } : {}),
      ...(body ? { body } : {}),
      ...(jsonMetadata ? { json_metadata: jsonMetadata } : {}),
      ...(url ? { url } : {}),
      ...(cashoutTime ? { cashout_time: cashoutTime } : {}),
      ...(pendingPayoutValue ? { pending_payout_value: pendingPayoutValue } : {}),
    };
  }

  async getLatestPosts(name: string, limit: number): Promise<HivePost[]> {
    return this.call<HivePost[]>("bridge.get_account_posts", {
      sort: "posts",
      account: name,
      limit,
    });
  }

  async getRewardFund(name: string): Promise<HiveRewardFund> {
    return this.call<HiveRewardFund>("condenser_api.get_reward_fund", [name]);
  }

  async listProposals(): Promise<HiveProposal[]> {
    return this.call<HiveProposal[]>("condenser_api.list_proposals", [
      [""],
      1000,
      "by_start_date",
      "descending",
      "votable",
    ]);
  }

  async listProposalVotesByProposal(proposalId: number): Promise<HiveProposalVote[]> {
    const voters: HiveProposalVote[] = [];

    while (true) {
      const startVoter = voters.at(-1)?.voter;
      const response = await this.call<{ proposal_votes: HiveProposalVote[] }>("database_api.list_proposal_votes", {
        start: [proposalId, startVoter],
        limit: 1000,
        order: "by_proposal_voter",
        order_direction: "ascending",
        status: "all",
      });
      const exactVotes = (response.proposal_votes ?? []).filter((vote) => {
        const voteProposalId = vote.proposal.id ?? vote.proposal.proposal_id;
        return voteProposalId === proposalId;
      });
      const previousSize = voters.length;

      for (const vote of exactVotes) {
        if (!voters.some((existing) => existing.voter === vote.voter)) voters.push(vote);
      }

      if (voters.length === previousSize) return voters;
    }
  }

  async listProposalVotes(voter: string): Promise<HiveProposalVote[]> {
    const response = await this.call<{ proposal_votes: HiveProposalVote[] }>("database_api.list_proposal_votes", {
      start: [voter],
      limit: 1000,
      order: "by_voter_proposal",
      order_direction: "ascending",
      status: "all",
    });
    return response.proposal_votes ?? [];
  }

  async getHardforkVersion(): Promise<string> {
    return this.call<string>("condenser_api.get_hardfork_version", []);
  }

  async getNextScheduledHardfork(): Promise<HiveScheduledHardfork> {
    return this.call<HiveScheduledHardfork>("condenser_api.get_next_scheduled_hardfork", []);
  }

  async getWitnessByAccount(name: string): Promise<HiveWitness | null> {
    return this.call<HiveWitness | null>("condenser_api.get_witness_by_account", [name]);
  }

  async getWitnessesByVote(limit: number): Promise<HiveWitness[]> {
    return this.call<HiveWitness[]>("condenser_api.get_witnesses_by_vote", [null, limit]);
  }

  async getWitnessSchedule(): Promise<HiveWitnessSchedule> {
    return this.call<HiveWitnessSchedule>("condenser_api.get_witness_schedule", []);
  }

  private async call<T>(
    method: string,
    params: unknown[] | Record<string, unknown>,
    options: { logFailures?: boolean } = {},
  ): Promise<T> {
    const errors: string[] = [];
    const logFailures = options.logFailures ?? true;

    for (const node of this.config.hive.nodes) {
      try {
        const response = await fetch(node, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: this.nextId++,
            method,
            params,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = (await response.json()) as RpcResponse<T>;
        if (payload.error) {
          throw new Error(payload.error.message ?? "Hive RPC error");
        }
        if (!("result" in payload)) {
          throw new Error("Hive RPC response did not include a result");
        }

        return payload.result as T;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${node}: ${message}`);
        if (logFailures) {
          this.logger.warn("Hive RPC call failed.", { node, method, error: message });
        }
      }
    }

    throw new Error(`All Hive RPC nodes failed: ${errors.join("; ")}`);
  }
}

function creationPostFromHistory(
  author: string,
  item: AccountHistoryEntry[1],
): HivePost | null {
  const [type, value] = item.op;
  if (type !== "comment") return null;
  if (value.author !== author || value.parent_author) return null;

  const permlink = typeof value.permlink === "string" ? value.permlink : null;
  if (!permlink) return null;

  const title = typeof value.title === "string" ? value.title : null;

  return {
    author,
    permlink,
    created: item.timestamp,
    ...(title ? { title } : {}),
  };
}

function isMissingApiError(message: string): boolean {
  return message.includes("Could not find API reputation_api");
}

function isMissingContentError(message: string): boolean {
  return message.includes("does not exist");
}
