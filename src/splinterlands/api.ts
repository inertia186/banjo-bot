import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";

export type SplinterlandsApi = {
  getPlayer(name: string): Promise<SplinterlandsPlayer | null>;
  getBalances(name: string): Promise<SplinterlandsBalance[]>;
  getCollection(name: string): Promise<SplinterlandsCollectionCard[]>;
  getCardDetails(): Promise<SplinterlandsCardDetail[]>;
};

export type SplinterlandsPlayer = {
  name: string;
  displayName: string | null;
  joinDate: string | null;
  guildName: string | null;
  starterPackPurchase: boolean;
  isBanned: boolean;
  collectionPower: number | null;
  captureRate: number | null;
  championPoints: number | null;
  ranked: SplinterlandsRulesetStats;
  modern: SplinterlandsRulesetStats;
  survival: SplinterlandsRulesetStats;
  foundation: SplinterlandsRulesetStats;
};

export type SplinterlandsRulesetStats = {
  rating: number | null;
  league: number | null;
  battles: number | null;
  wins: number | null;
  currentStreak: number | null;
  longestStreak: number | null;
  maxRating: number | null;
  maxRank: number | null;
};

export type SplinterlandsBalance = {
  token: string;
  balance: number | null;
};

export type SplinterlandsCollectionCard = {
  uid: string | null;
  cardDetailId: number | null;
  gold: boolean;
  foil: number | null;
  edition: number | null;
  cardSet: string | null;
  collectionPower: number | null;
  delegatedTo: string | null;
  marketId: string | null;
  marketListingType: string | null;
  stakeRefUid: string | null;
};

export type SplinterlandsCardDetail = {
  id: number;
  name: string;
  color: string | null;
  type: string | null;
  rarity: number | null;
  gameType: string | null;
};

type SplinterlandsPlayerResponse = Record<string, unknown> & {
  error?: unknown;
  name?: unknown;
  display_name?: unknown;
  join_date?: unknown;
  guild?: unknown;
  starter_pack_purchase?: unknown;
  is_banned?: unknown;
  collection_power?: unknown;
  capture_rate?: unknown;
  champion_points?: unknown;
};

type SplinterlandsBalanceResponse = {
  token?: unknown;
  balance?: unknown;
};

type SplinterlandsCollectionResponse = {
  cards?: unknown;
};

type SplinterlandsCollectionCardResponse = {
  uid?: unknown;
  card_detail_id?: unknown;
  gold?: unknown;
  foil?: unknown;
  edition?: unknown;
  card_set?: unknown;
  collection_power?: unknown;
  delegated_to?: unknown;
  market_id?: unknown;
  market_listing_type?: unknown;
  stake_ref_uid?: unknown;
};

type SplinterlandsCardDetailResponse = {
  id?: unknown;
  name?: unknown;
  color?: unknown;
  type?: unknown;
  rarity?: unknown;
  game_type?: unknown;
};

const cardDetailsCacheTtlMs = 6 * 60 * 60 * 1000;

export class SplinterlandsHttpClient implements SplinterlandsApi {
  private cardDetailsCache: { details: SplinterlandsCardDetail[]; createdAt: number } | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async getPlayer(name: string): Promise<SplinterlandsPlayer | null> {
    const url = new URL(`${this.config.splinterlands.baseUrl}/players/details`);
    url.searchParams.set("name", name);

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as SplinterlandsPlayerResponse;
      if (payload.error || !readString(payload.name)) return null;

      return {
        name: readString(payload.name)!,
        displayName: readString(payload.display_name),
        joinDate: readString(payload.join_date),
        guildName: readGuildName(payload.guild),
        starterPackPurchase: payload.starter_pack_purchase === true,
        isBanned: payload.is_banned === true,
        collectionPower: readFiniteNumber(payload.collection_power),
        captureRate: readFiniteNumber(payload.capture_rate),
        championPoints: readFiniteNumber(payload.champion_points),
        ranked: readRulesetStats(payload, ""),
        modern: readRulesetStats(payload, "modern_"),
        survival: readRulesetStats(payload, "survival_"),
        foundation: readRulesetStats(payload, "foundation_"),
      };
    } catch (error) {
      this.logger.warn("Splinterlands player lookup failed.", {
        account: name,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async getBalances(name: string): Promise<SplinterlandsBalance[]> {
    const url = new URL(`${this.config.splinterlands.baseUrl}/players/balances`);
    url.searchParams.set("username", name);

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as SplinterlandsBalanceResponse[];
      if (!Array.isArray(payload)) return [];

      return payload
        .map((entry) => {
          const token = readString(entry.token);
          if (!token) return null;

          return {
            token,
            balance: readFiniteNumber(entry.balance),
          };
        })
        .filter((entry): entry is SplinterlandsBalance => entry !== null);
    } catch (error) {
      this.logger.warn("Splinterlands balance lookup failed.", {
        account: name,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async getCollection(name: string): Promise<SplinterlandsCollectionCard[]> {
    const url = new URL(`${this.config.splinterlands.baseUrl}/cards/collection/${encodeURIComponent(name)}`);

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as SplinterlandsCollectionResponse;
      if (!payload || !Array.isArray(payload.cards)) return [];

      return payload.cards
        .map((entry) => readCollectionCard(entry))
        .filter((entry): entry is SplinterlandsCollectionCard => entry !== null);
    } catch (error) {
      this.logger.warn("Splinterlands collection lookup failed.", {
        account: name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getCardDetails(): Promise<SplinterlandsCardDetail[]> {
    if (this.cardDetailsCache && Date.now() - this.cardDetailsCache.createdAt < cardDetailsCacheTtlMs) {
      return this.cardDetailsCache.details;
    }

    const url = new URL(`${this.config.splinterlands.baseUrl}/cards/get_details`);

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload)) return [];

      const details = payload
        .map((entry) => readCardDetail(entry))
        .filter((entry): entry is SplinterlandsCardDetail => entry !== null);
      this.cardDetailsCache = { details, createdAt: Date.now() };

      return details;
    } catch (error) {
      this.logger.warn("Splinterlands card details lookup failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

function readRulesetStats(payload: Record<string, unknown>, prefix: string): SplinterlandsRulesetStats {
  return {
    rating: readFiniteNumber(payload[`${prefix}rating`]),
    league: readFiniteNumber(payload[`${prefix}league`]),
    battles: readFiniteNumber(payload[`${prefix}battles`]),
    wins: readFiniteNumber(payload[`${prefix}wins`]),
    currentStreak: readFiniteNumber(payload[`${prefix}current_streak`]),
    longestStreak: readFiniteNumber(payload[`${prefix}longest_streak`]),
    maxRating: readFiniteNumber(payload[`${prefix}max_rating`]),
    maxRank: readFiniteNumber(payload[`${prefix}max_rank`]),
  };
}

function readGuildName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;

  return readString((value as { name?: unknown }).name);
}

function readCollectionCard(value: unknown): SplinterlandsCollectionCard | null {
  if (!value || typeof value !== "object") return null;

  const card = value as SplinterlandsCollectionCardResponse;
  return {
    uid: readString(card.uid),
    cardDetailId: readFiniteNumber(card.card_detail_id),
    gold: card.gold === true,
    foil: readFiniteNumber(card.foil),
    edition: readFiniteNumber(card.edition),
    cardSet: readString(card.card_set),
    collectionPower: readFiniteNumber(card.collection_power),
    delegatedTo: readString(card.delegated_to),
    marketId: readString(card.market_id),
    marketListingType: readString(card.market_listing_type),
    stakeRefUid: readString(card.stake_ref_uid),
  };
}

function readCardDetail(value: unknown): SplinterlandsCardDetail | null {
  if (!value || typeof value !== "object") return null;

  const detail = value as SplinterlandsCardDetailResponse;
  const id = readFiniteNumber(detail.id);
  const name = readString(detail.name);
  if (id === null || !name) return null;

  return {
    id,
    name,
    color: readString(detail.color),
    type: readString(detail.type),
    rarity: readFiniteNumber(detail.rarity),
    gameType: readString(detail.game_type),
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function readFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
