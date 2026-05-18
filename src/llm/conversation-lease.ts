import type { Message } from "discord.js";
import { ChannelType } from "discord.js";

const DEFAULT_TTL_MS = 3 * 60 * 1000;
const DEFAULT_MAX_UNMENTIONED_TURNS = 3;

type Lease = {
  expiresAt: number;
  remainingTurns: number;
};

export class LlmConversationLeases {
  private readonly leases = new Map<string, Lease>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly maxUnmentionedTurns = DEFAULT_MAX_UNMENTIONED_TURNS,
  ) {}

  noteExplicitInteraction(message: Message): void {
    if (!message.guild) return;
    this.leases.set(conversationLeaseKey(message), {
      expiresAt: this.now() + this.ttlMs,
      remainingTurns: this.maxUnmentionedTurns,
    });
  }

  noteBotReply(message: Message): void {
    this.noteExplicitInteraction(message);
  }

  claimFollowUp(message: Message, commandPrefix: string): boolean {
    if (!message.guild || message.channel.type === ChannelType.DM) return false;
    if (!looksLikeFollowUp(message.content, commandPrefix)) return false;

    const key = conversationLeaseKey(message);
    const lease = this.leases.get(key);
    if (!lease || lease.expiresAt <= this.now() || lease.remainingTurns <= 0) {
      this.leases.delete(key);
      return false;
    }

    lease.remainingTurns -= 1;
    lease.expiresAt = this.now() + this.ttlMs;
    return true;
  }

  closeForMessage(message: Message): void {
    if (!message.guild) return;
    this.leases.delete(conversationLeaseKey(message));
  }
}

export function conversationLeaseKey(message: Message): string {
  return `${message.guild?.id ?? "dm"}:${message.channel.id}:${message.author.id}`;
}

function looksLikeFollowUp(content: string, commandPrefix: string): boolean {
  const value = content.trim();
  if (!value || isBareCommand(value, commandPrefix)) return false;
  if (/^(?:lol|lmao|rofl|haha|yeah|yep|yes|no|nah|ok|okay|same|true|fair|nice|cool|thanks|thx)[.!?]*$/i.test(value)) {
    return false;
  }

  return /\?$/.test(value) ||
    /^(?:why|how|what|where|when|who|which|can|could|would|will|do|does|did|is|are)\b/i.test(value) ||
    /\b(?:you|your|yours|banjo)\b/i.test(value) ||
    /^(?:that|this|those|these|it|so|but|and|also|ok but|okay but|what about|how about)\b/i.test(value);
}

function isBareCommand(prompt: string, commandPrefix: string): boolean {
  return prompt.startsWith(commandPrefix) && !/\s/.test(prompt);
}
