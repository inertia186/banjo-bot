import type { AppConfig } from "../config.js";

type Fetch = typeof fetch;

export type HyperionSession = {
  authenticated: boolean;
  accountName?: string;
  loginUrl?: string;
  authChallengeUrl?: string;
};

export type HyperionAuthChallenge = {
  challengeId: string;
  hivesignerLoginUrl: string;
  keychain?: {
    message?: string;
    digest?: string;
  };
};

export type HyperionAuthResult = {
  bearerToken: string;
  accountName?: string;
};

export type HyperionDigestOptions = {
  limit?: number;
  tag?: string;
  author?: string;
  query?: string;
};

export type HyperionDigest = {
  raw: Record<string, unknown>;
};

export type HyperionApi = {
  getSession(): Promise<HyperionSession>;
  startAuthChallenge(): Promise<HyperionAuthChallenge>;
  redeemAuthChallenge(challengeId: string, code: string): Promise<HyperionAuthResult>;
  getDigest(options?: HyperionDigestOptions): Promise<HyperionDigest>;
};

export class HyperionAgentClient implements HyperionApi {
  private readonly baseUrl: string;
  private readonly bearerToken: string | null;

  constructor(config: AppConfig, private readonly fetchFn: Fetch = fetch) {
    this.baseUrl = config.hyperion.baseUrl;
    this.bearerToken = config.hyperion.bearerToken;
  }

  async getSession(): Promise<HyperionSession> {
    const payload = await this.request("GET", "/api/v1/agent/session");
    const accountName = stringValue(payload.account_name) ?? stringValue(payload.accountName);
    const loginUrl = stringValue(payload.login_url) ?? stringValue(payload.loginUrl);
    const authChallengeUrl = stringValue(payload.auth_challenge_url) ?? stringValue(payload.authChallengeUrl);
    return {
      authenticated: booleanValue(payload.authenticated),
      ...(accountName ? { accountName } : {}),
      ...(loginUrl ? { loginUrl } : {}),
      ...(authChallengeUrl ? { authChallengeUrl } : {}),
    };
  }

  async startAuthChallenge(): Promise<HyperionAuthChallenge> {
    const payload = await this.request("POST", "/api/v1/agent/auth_challenges", undefined, { auth: false });
    const challengeId = stringValue(payload.challenge_id) ?? stringValue(payload.challengeId) ?? stringValue(payload.id);
    const hivesignerLoginUrl = stringValue(payload.hivesigner_login_url) ?? stringValue(payload.hivesignerLoginUrl);

    if (!challengeId || !hivesignerLoginUrl) {
      throw new Error("Hyperion auth challenge response was missing challenge_id or hivesigner_login_url.");
    }

    const keychain = objectValue(payload.keychain);
    const message = stringValue(keychain?.message);
    const digest = stringValue(keychain?.digest);
    return {
      challengeId,
      hivesignerLoginUrl,
      ...(message || digest ? {
        keychain: {
          ...(message ? { message } : {}),
          ...(digest ? { digest } : {}),
        },
      } : {}),
    };
  }

  async redeemAuthChallenge(challengeId: string, code: string): Promise<HyperionAuthResult> {
    const payload = await this.request(
      "POST",
      `/api/v1/agent/auth_challenges/${encodeURIComponent(challengeId)}/redeem`,
      { code },
      { auth: false },
    );
    const bearerToken = stringValue(payload.bearer_token) ?? stringValue(payload.bearerToken);
    if (!bearerToken) throw new Error("Hyperion redeem response was missing bearer_token.");

    const accountName = stringValue(payload.account_name) ?? stringValue(payload.accountName);
    return {
      bearerToken,
      ...(accountName ? { accountName } : {}),
    };
  }

  async getDigest(options: HyperionDigestOptions = {}): Promise<HyperionDigest> {
    const params = new URLSearchParams();
    setParam(params, "limit", options.limit);
    setParam(params, "tag", options.tag);
    setParam(params, "author", options.author);
    setParam(params, "query", options.query);
    const suffix = params.size > 0 ? `?${params}` : "";
    const raw = await this.request("GET", `/api/v1/agent/digest${suffix}`);
    return { raw };
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
    options: { auth?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (body) headers["Content-Type"] = "application/json";
    if (options.auth !== false && this.bearerToken) headers.Authorization = `Bearer ${this.bearerToken}`;

    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      throw new Error(`Hyperion API HTTP ${response.status}`);
    }

    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Hyperion API response was not a JSON object.");
    }

    return parsed as Record<string, unknown>;
  }
}

function setParam(params: URLSearchParams, name: string, value: string | number | undefined) {
  if (value === undefined || value === null || value === "") return;
  params.set(name, String(value));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
