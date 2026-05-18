import assert from "node:assert/strict";
import test from "node:test";
import { PassiveSnarks } from "../src/passive-snarks.js";

test("PassiveSnarks ignores messages without the legacy trigger word", () => {
  const snarks = new PassiveSnarks(() => 0.99);

  assert.equal(snarks.replyFor("these are not the droids"), null);
});

test("PassiveSnarks replies to exact legacy ping and Konami messages", () => {
  const snarks = new PassiveSnarks(() => 0);

  assert.deepEqual(snarks.replyFor("Ping!"), { kind: "reply", content: "Pong!" });
  assert.deepEqual(snarks.replyFor("up up down down left right left right b a start"), {
    kind: "reply",
    content: "NDE1MjQ1NTE=",
  });
});

test("PassiveSnarks ports the almost-never SpongeBob syllable trigger", () => {
  const snarks = new PassiveSnarks(() => 0);

  assert.deepEqual(snarks.replyFor("this sentence has exactly eleven beats!"), { kind: "spongebob" });
});

test("PassiveSnarks ports the rarely-triggered text replies", () => {
  const snarks = new PassiveSnarks(() => 0.99);

  assert.deepEqual(snarks.replyFor("i know this is true"), { kind: "reply", content: "`* citation needed`" });
  assert.deepEqual(snarks.replyFor("well, you all should listen"), { kind: "reply", content: "Except Shane." });
  assert.deepEqual(snarks.replyFor("hello peasant"), { kind: "reply", content: "*Help!  Help!  I'm being repressed!*" });
  assert.deepEqual(snarks.replyFor("help me help you"), { kind: "reply", content: "*Bloody peasant!*" });
  assert.deepEqual(snarks.replyFor("too much drama today "), {
    kind: "reply",
    content: "https://media.giphy.com/media/guufsF0Az3Lpu/giphy.gif",
  });
});

test("PassiveSnarks ports the often-triggered porcelain reply", () => {
  const snarks = new PassiveSnarks(() => 0.26);

  assert.deepEqual(snarks.replyFor("that porcelain thing again"), { kind: "reply", content: "*Ugh. Porcelain.*" });
});

test("PassiveSnarks returns an LLM action for the legacy we need cleverbot trigger", () => {
  const snarks = new PassiveSnarks(() => 0.99);

  assert.deepEqual(snarks.replyFor("we need better docs"), { kind: "llm", prompt: "we need better docs" });
});

test("PassiveSnarks rarely replies to messages containing those", () => {
  const belowThreshold = new PassiveSnarks(() => 0.75);
  const aboveThreshold = new PassiveSnarks(() => 0.76);

  assert.equal(belowThreshold.replyFor("what about those rewards?"), null);
  assert.deepEqual(aboveThreshold.replyFor("what about those rewards?"), { kind: "reply", content: "Blame Canada." });
});

test("PassiveSnarks does not require a Banjo mention", () => {
  const snarks = new PassiveSnarks(() => 0.99);

  assert.deepEqual(snarks.replyFor("those witnesses are moving fast"), { kind: "reply", content: "Blame Canada." });
});

test("PassiveSnarks only blames Canada once per instance", () => {
  const snarks = new PassiveSnarks(() => 0.99);

  assert.deepEqual(snarks.replyFor("those rewards"), { kind: "reply", content: "Blame Canada." });
  assert.equal(snarks.replyFor("those votes"), null);
});

test("PassiveSnarks ports the other one-shot almost-never replies", () => {
  const crim = new PassiveSnarks(() => 0);
  const golos = new PassiveSnarks(() => 0);

  assert.deepEqual(crim.replyFor("we coded it."), { kind: "reply", content: "... and maybe even Crim." });
  assert.equal(crim.replyFor("they coded it."), null);
  assert.deepEqual(golos.replyFor("remember steemit?"), {
    kind: "reply",
    content: "On Golos, users are afflicted with an amusing juxtaposition of the aforementioned situation.",
  });
  assert.equal(golos.replyFor("more steemit talk"), null);
});
