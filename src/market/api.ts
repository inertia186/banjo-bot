import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";

export type MarketApi = {
  getHiveTicker(): Promise<MarketTicker | null>;
  getHiveHbdUsdPrices(): Promise<{ hive: number | null; hbd: number | null }>;
  getHiveUsdPrice(): Promise<number | null>;
  getFearGreedIndex(limit: number): Promise<FearGreedIndex | null>;
};

export type MarketTicker = {
  usd: number;
  usdMarketCap: number | null;
  usd24hVolume: number | null;
  usd24hChange: number | null;
};

export type FearGreedIndex = {
  name: string;
  entries: FearGreedEntry[];
};

export type FearGreedEntry = {
  value: number;
  classification: string;
  timestamp: number;
  timeUntilUpdate: number | null;
};

type CoinGeckoSimplePrice = {
  hive?: {
    usd?: number;
    usd_market_cap?: number;
    usd_24h_vol?: number;
    usd_24h_change?: number;
  };
  hive_dollar?: {
    usd?: number;
  };
};

type AlternativeFearGreedResponse = {
  name?: string;
  data?: Array<{
    value?: string;
    value_classification?: string;
    timestamp?: string;
    time_until_update?: string;
  }>;
};

export class CoinGeckoMarketClient implements MarketApi {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async getHiveTicker(): Promise<MarketTicker | null> {
    const url = new URL(`${this.config.market.coinGeckoBaseUrl}/simple/price`);
    url.searchParams.set("ids", "hive");
    url.searchParams.set("vs_currencies", "usd");
    url.searchParams.set("include_market_cap", "true");
    url.searchParams.set("include_24hr_vol", "true");
    url.searchParams.set("include_24hr_change", "true");

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as CoinGeckoSimplePrice;
      const hive = payload.hive;
      const price = hive?.usd;
      if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;

      return {
        usd: price,
        usdMarketCap: finiteNumber(hive?.usd_market_cap),
        usd24hVolume: finiteNumber(hive?.usd_24h_vol),
        usd24hChange: finiteNumber(hive?.usd_24h_change),
      };
    } catch (error) {
      this.logger.warn("CoinGecko ticker lookup failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async getHiveUsdPrice(): Promise<number | null> {
    const ticker = await this.getHiveTicker();
    if (ticker) return ticker.usd;

    return null;
  }

  async getHiveHbdUsdPrices(): Promise<{ hive: number | null; hbd: number | null }> {
    const url = new URL(`${this.config.market.coinGeckoBaseUrl}/simple/price`);
    url.searchParams.set("ids", "hive,hive_dollar");
    url.searchParams.set("vs_currencies", "usd");

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as CoinGeckoSimplePrice;
      return {
        hive: positiveNumber(payload.hive?.usd),
        hbd: positiveNumber(payload.hive_dollar?.usd),
      };
    } catch (error) {
      this.logger.warn("CoinGecko HIVE/HBD price lookup failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { hive: null, hbd: null };
    }
  }

  async getFearGreedIndex(limit: number): Promise<FearGreedIndex | null> {
    const url = new URL("https://api.alternative.me/fng/");
    url.searchParams.set("limit", String(Math.max(1, Math.min(10, limit))));

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as AlternativeFearGreedResponse;
      const entries = (payload.data ?? [])
        .map((entry) => {
          const value = Number.parseInt(entry.value ?? "", 10);
          const timestamp = Number.parseInt(entry.timestamp ?? "", 10);
          if (!Number.isFinite(value) || !Number.isFinite(timestamp) || !entry.value_classification) return null;

          const timeUntilUpdate = Number.parseInt(entry.time_until_update ?? "", 10);
          return {
            value,
            classification: entry.value_classification,
            timestamp,
            timeUntilUpdate: Number.isFinite(timeUntilUpdate) ? timeUntilUpdate : null,
          };
        })
        .filter((entry): entry is FearGreedEntry => entry !== null);

      if (entries.length === 0) return null;

      return {
        name: payload.name || "Crypto Fear & Greed Index",
        entries,
      };
    } catch (error) {
      this.logger.warn("Alternative.me fear and greed lookup failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

function finiteNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
