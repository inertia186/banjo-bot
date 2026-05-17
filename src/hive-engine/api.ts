import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";

export type HiveEngineApi = {
  getToken(symbol: string): Promise<HiveEngineToken | null>;
  getNft(symbol: string): Promise<HiveEngineNft | null>;
  getNftShowroomArt(account: string | null, index: number): Promise<NftShowroomArt | null>;
  getTokenBalances(symbol: string): Promise<HiveEngineBalanceResult>;
  getLatestTrade(symbol: string): Promise<HiveEngineTrade | null>;
  getBuyBook(symbol: string, limit: number): Promise<HiveEngineBuyOrder[]>;
  getMarketMetrics(symbol: string): Promise<HiveEngineMarketMetrics | null>;
};

export type HiveEngineToken = {
  symbol: string;
  issuer?: string;
  name?: string;
  metadata?: string;
  circulatingSupply?: string;
  supply?: string;
  maxSupply?: string;
  precision?: number;
};

export type HiveEngineNft = {
  symbol: string;
  issuer?: string;
  name?: string;
  metadata?: string;
  circulatingSupply?: string;
  supply?: string;
};

export type HiveEngineNftInstance = {
  _id?: number;
  account?: string;
  properties?: {
    artSeries?: string;
    art_series?: string;
    notes?: string;
    cid?: string;
  };
};

export type NftShowroomArt = {
  series: string;
  artist: string;
  title: string;
  collection: string | null;
  description: string | null;
  thumbnail: string | null;
  image: string | null;
  nsfw: boolean;
  published: boolean;
  createdAt: string | null;
  note: string | null;
};

export type HiveEngineTrade = {
  price?: string;
  timestamp?: number;
};

export type HiveEngineBuyOrder = {
  quantity?: string;
  price?: string;
};

export type HiveEngineMarketMetrics = {
  volume?: string;
  lowestAsk?: string;
  highestBid?: string;
  priceChangePercent?: string;
};

export type HiveEngineBalance = {
  account: string;
  symbol: string;
  balance?: string;
  stake?: string;
  pendingUnstake?: string;
};

export type HiveEngineBalanceResult = {
  balances: HiveEngineBalance[];
  truncated: boolean;
};

type RpcResponse<T> = {
  result?: T;
  error?: {
    message?: string;
  };
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function readNestedString(value: Record<string, unknown>, path: string[]): string | null {
  let current: unknown = value;
  for (const part of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }

  return readString(current);
}

export class HiveEngineRpcClient implements HiveEngineApi {
  private nextId = 1;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async getToken(symbol: string): Promise<HiveEngineToken | null> {
    return this.findOne<HiveEngineToken>("tokens", "tokens", { symbol });
  }

  async getNft(symbol: string): Promise<HiveEngineNft | null> {
    return this.findOne<HiveEngineNft>("nft", "nfts", { symbol });
  }

  async getNftShowroomArt(account: string | null, index: number): Promise<NftShowroomArt | null> {
    const query = account ? { account } : {};
    const instances = await this.find<HiveEngineNftInstance>("nft", "NFTSRinstances", query, 1, Math.max(0, index), [
      { index: "_id", descending: true },
    ]);
    const instance = instances[0];
    if (!instance) return null;

    const series = instance?.properties?.artSeries ?? instance?.properties?.art_series;
    if (!series) return null;

    const response = await fetch(`https://nftshowroom.com/api/arts/info?series=${encodeURIComponent(series)}`);
    if (!response.ok) throw new Error(`NFT Showroom API HTTP ${response.status}`);

    const info = (await response.json()) as Record<string, unknown>;
    const artist = readNestedString(info, ["artist", "username"]) ?? readString(info.artist) ?? readString(info.creator);
    const title = readString(info.title);
    if (!artist || !title) return null;

    return {
      series,
      artist,
      title,
      collection: readString(info.name),
      description: readString(info.description),
      thumbnail: readString(info.thumbnail),
      image: readString(info.file) ?? readString(info.thumbnail),
      nsfw: info.nsfw === true,
      published: info.published === true,
      createdAt: readString(info.createdAt),
      note: instance.properties?.notes ?? null,
    };
  }

  async getTokenBalances(symbol: string): Promise<HiveEngineBalanceResult> {
    const balances: HiveEngineBalance[] = [];
    const limit = 1000;
    const maxOffset = 10_000;

    while (true) {
      const offset = balances.length;
      if (offset > maxOffset) return { balances, truncated: true };

      const page = await this.find<HiveEngineBalance>("tokens", "balances", { symbol }, limit, offset, []);
      if (page.length === 0) return { balances, truncated: false };
      balances.push(...page);

      if (page.length < limit) return { balances, truncated: false };
    }
  }

  async getLatestTrade(symbol: string): Promise<HiveEngineTrade | null> {
    const trades = await this.find<HiveEngineTrade>("market", "tradesHistory", { symbol }, 1, 0, [
      { index: "_id", descending: true },
    ]);
    return trades[0] ?? null;
  }

  async getBuyBook(symbol: string, limit: number): Promise<HiveEngineBuyOrder[]> {
    return this.find<HiveEngineBuyOrder>("market", "buyBook", { symbol }, limit, 0, [
      { index: "priceDec", descending: true },
    ]);
  }

  async getMarketMetrics(symbol: string): Promise<HiveEngineMarketMetrics | null> {
    return this.findOne<HiveEngineMarketMetrics>("market", "metrics", { symbol });
  }

  private async findOne<T>(contract: string, table: string, query: Record<string, unknown>): Promise<T | null> {
    return this.call<T | null>("findOne", {
      contract,
      table,
      query,
    });
  }

  private async find<T>(
    contract: string,
    table: string,
    query: Record<string, unknown>,
    limit: number,
    offset: number,
    indexes: Array<{ index: string; descending: boolean }>,
  ): Promise<T[]> {
    return this.call<T[]>("find", {
      contract,
      table,
      query,
      limit,
      offset,
      indexes,
    });
  }

  private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.config.hiveEngine.contractsUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.nextId++,
        method,
        params,
      }),
    });

    if (!response.ok) throw new Error(`Hive Engine RPC HTTP ${response.status}`);

    const payload = (await response.json()) as RpcResponse<T>;
    if (payload.error) {
      throw new Error(payload.error.message ?? "Hive Engine RPC error");
    }
    if (!("result" in payload)) {
      throw new Error("Hive Engine RPC response did not include a result.");
    }

    return payload.result as T;
  }
}
