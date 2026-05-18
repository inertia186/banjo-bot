import { EmbedBuilder, type APIEmbedField } from "discord.js";

export const BANJO_EMBED_COLOR = 0xff8a00;

export function banjoEmbed(): EmbedBuilder {
  return new EmbedBuilder().setColor(BANJO_EMBED_COLOR);
}

export function dataField(name: string, value: string | null | undefined, inline = true): APIEmbedField | null {
  if (!value) return null;

  return {
    name,
    value,
    inline,
  };
}

export function asEmbedResponse(embed: EmbedBuilder, content?: string): { content?: string; embeds: EmbedBuilder[] } {
  return {
    ...(content ? { content } : {}),
    embeds: [embed],
  };
}

export function truncateEmbedText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 3))}...`;
}

