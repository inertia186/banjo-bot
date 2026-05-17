import type { Message } from "discord.js";

type TypingChannel = {
  sendTyping(): Promise<void>;
};

type TimerHandle = unknown;

type TypingTimers = {
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(callback: () => void, delayMs: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
};

export type DelayedTypingOptions = {
  delayMs?: number;
  repeatMs?: number;
  timers?: TypingTimers;
};

const DEFAULT_TYPING_DELAY_MS = 3_000;
const DEFAULT_TYPING_REPEAT_MS = 9_000;

export function startDelayedTyping(message: Message, options: DelayedTypingOptions = {}): () => void {
  const channel = message.channel;
  if (!isTypingChannel(channel)) return () => undefined;

  const timers = options.timers ?? globalThis;
  const delayMs = options.delayMs ?? DEFAULT_TYPING_DELAY_MS;
  const repeatMs = options.repeatMs ?? DEFAULT_TYPING_REPEAT_MS;
  let stopped = false;
  let repeatTimer: TimerHandle | undefined;

  const sendTyping = async () => {
    try {
      await channel.sendTyping();
    } catch {
      return;
    }

    if (!stopped && repeatTimer === undefined) {
      repeatTimer = timers.setInterval(() => {
        void channel.sendTyping().catch(() => undefined);
      }, repeatMs);
    }
  };

  const startTimer = timers.setTimeout(() => {
    void sendTyping();
  }, delayMs);

  return () => {
    stopped = true;
    timers.clearTimeout(startTimer);
    if (repeatTimer !== undefined) {
      timers.clearInterval(repeatTimer);
    }
  };
}

function isTypingChannel(channel: Message["channel"]): channel is Message["channel"] & TypingChannel {
  return "sendTyping" in channel && typeof channel.sendTyping === "function";
}
