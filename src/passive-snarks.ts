const POPCORN_URL = "https://media.giphy.com/media/guufsF0Az3Lpu/giphy.gif";

export type PassiveSnarkResponse =
  | { kind: "reply"; content: string }
  | { kind: "spongebob" }
  | { kind: "llm"; prompt: string };

export class PassiveSnarks {
  private alreadyBlamedCanada = false;
  private alreadyBlamedCrim = false;
  private alreadyOnGolos = false;

  constructor(private readonly random: () => number = Math.random) {}

  replyFor(content: string): PassiveSnarkResponse | null {
    if (content === "Ping!") return this.reply("Pong!");

    if (/[a-z,' ]+[.?!]+/i.test(content) && this.almostNeverHappens() && hasSpongebobSyllables(content)) {
      return { kind: "spongebob" };
    }

    if (/^we need .*/i.test(content) && this.rarelyHappens()) {
      return { kind: "llm", prompt: content };
    }

    if (/^i know .*/i.test(content) && this.rarelyHappens()) {
      return this.reply("`* citation needed`");
    }

    if (/^.* you all .*/i.test(content) && this.rarelyHappens()) {
      return this.reply("Except Shane.");
    }

    if (/.*peasant.*/i.test(content) && this.rarelyHappens()) {
      return this.reply("*Help!  Help!  I'm being repressed!*");
    }

    if (/.*help.*help.*/i.test(content) && this.rarelyHappens()) {
      return this.reply("*Bloody peasant!*");
    }

    if (/.*porcelain.*/i.test(content) && this.oftenHappens()) {
      return this.reply("*Ugh. Porcelain.*");
    }

    if (/.*drama .*/i.test(content) && this.rarelyHappens()) {
      return this.reply(POPCORN_URL);
    }

    if (content === "up up down down left right left right b a start") {
      return this.reply("NDE1MjQ1NTE=");
    }

    if (/.*those.*/i.test(content) && this.rarelyHappens() && !this.alreadyBlamedCanada) {
      this.alreadyBlamedCanada = true;
      return this.reply("Blame Canada.");
    }

    if (/.*coded it.*/i.test(content) && this.almostNeverHappens() && !this.alreadyBlamedCrim) {
      this.alreadyBlamedCrim = true;
      return this.reply("... and maybe even Crim.");
    }

    if (/.* steemit.*/i.test(content) && this.almostNeverHappens() && !this.alreadyOnGolos) {
      this.alreadyOnGolos = true;
      return this.reply("On Golos, users are afflicted with an amusing juxtaposition of the aforementioned situation.");
    }

    return null;
  }

  private reply(content: string): PassiveSnarkResponse {
    return { kind: "reply", content };
  }

  private almostNeverHappens(): boolean {
    return Math.floor(this.random() * 100) < 1;
  }

  private rarelyHappens(): boolean {
    return Math.floor(this.random() * 100) > 75;
  }

  private oftenHappens(): boolean {
    return Math.floor(this.random() * 100) > 25;
  }
}

function hasSpongebobSyllables(content: string): boolean {
  const syllables = content
    .toLowerCase()
    .match(/[a-z]+/g)
    ?.reduce((sum, word) => sum + countSyllables(word), 0) ?? 0;

  return syllables >= 10 && syllables <= 12;
}

function countSyllables(word: string): number {
  const normalized = word.replace(/(?:e|es|ed)$/, "");
  const groups = normalized.match(/[aeiouy]+/g);
  return Math.max(1, groups?.length ?? 0);
}
