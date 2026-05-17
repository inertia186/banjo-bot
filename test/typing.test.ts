import assert from "node:assert/strict";
import test from "node:test";
import type { Message } from "discord.js";
import { startDelayedTyping } from "../src/typing.js";

class ManualTimers {
  private nextId = 1;
  private timeouts = new Map<number, () => void>();
  private intervals = new Map<number, () => void>();

  setTimeout(callback: () => void): number {
    const id = this.nextId++;
    this.timeouts.set(id, callback);
    return id;
  }

  clearTimeout(id: number) {
    this.timeouts.delete(id);
  }

  setInterval(callback: () => void): number {
    const id = this.nextId++;
    this.intervals.set(id, callback);
    return id;
  }

  clearInterval(id: number) {
    this.intervals.delete(id);
  }

  runTimeouts() {
    const callbacks = [...this.timeouts.values()];
    this.timeouts.clear();
    for (const callback of callbacks) callback();
  }

  runIntervals() {
    for (const callback of this.intervals.values()) callback();
  }
}

function messageWithTyping(sendTyping: () => Promise<void>): Message {
  return {
    channel: {
      sendTyping,
    },
  } as unknown as Message;
}

test("delayed typing does not send when stopped before the threshold", () => {
  let typingCalls = 0;
  const timers = new ManualTimers();
  const stopTyping = startDelayedTyping(messageWithTyping(async () => {
    typingCalls += 1;
  }), { timers });

  stopTyping();
  timers.runTimeouts();

  assert.equal(typingCalls, 0);
});

test("delayed typing sends once after the threshold and repeats until stopped", async () => {
  let typingCalls = 0;
  const timers = new ManualTimers();
  const stopTyping = startDelayedTyping(messageWithTyping(async () => {
    typingCalls += 1;
  }), { timers });

  timers.runTimeouts();
  await Promise.resolve();

  assert.equal(typingCalls, 1);

  timers.runIntervals();
  assert.equal(typingCalls, 2);

  stopTyping();
  timers.runIntervals();
  assert.equal(typingCalls, 2);
});

test("delayed typing ignores channels that cannot show typing", () => {
  const timers = new ManualTimers();
  const stopTyping = startDelayedTyping({ channel: {} } as unknown as Message, { timers });

  assert.doesNotThrow(stopTyping);
  timers.runTimeouts();
});
