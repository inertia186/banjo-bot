import { ChannelType, type Message, type Typing } from "discord.js";

const DEFAULT_TYPING_TTL_MS = 10_000;

export class TypingActivityTracker {
  private readonly typingByChannel = new Map<string, TypingActivity[]>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = DEFAULT_TYPING_TTL_MS,
  ) {}

  noteTyping(typing: Typing): void {
    if (!typing.guild || typing.channel?.type === ChannelType.DM || typing.user.bot) return;

    const channelId = typing.channel.id;
    const activity = {
      userId: typing.user.id,
      at: this.now(),
    };
    const recent = this.recent(channelId).filter((entry) => entry.userId !== activity.userId);
    recent.push(activity);
    this.typingByChannel.set(channelId, recent);
  }

  hasHumanTypingAfter(message: Message): boolean {
    if (!message.guild || message.channel.type === ChannelType.DM) return false;

    return this.recent(message.channel.id).some((entry) =>
      entry.at >= message.createdTimestamp &&
      entry.userId !== message.client.user?.id
    );
  }

  private recent(channelId: string): TypingActivity[] {
    const threshold = this.now() - this.ttlMs;
    const recent = (this.typingByChannel.get(channelId) ?? []).filter((entry) => entry.at >= threshold);
    this.typingByChannel.set(channelId, recent);
    return recent;
  }
}

type TypingActivity = {
  userId: string;
  at: number;
};

export async function hasInterveningHumanActivity(message: Message, typing?: TypingActivityTracker): Promise<boolean> {
  return typing?.hasHumanTypingAfter(message) === true || await hasInterveningHumanMessage(message);
}

export async function hasInterveningHumanMessage(message: Message): Promise<boolean> {
  if (!message.guild || message.channel.type === ChannelType.DM || !("messages" in message.channel)) return false;

  const messages = await message.channel.messages.fetch({ limit: 10, after: message.id }).catch(() => null);
  if (!messages) return false;

  return [...messages.values()].some((candidate) =>
    candidate.author.id !== message.author.id &&
    candidate.author.id !== message.client.user?.id &&
    !candidate.author.bot
  );
}
