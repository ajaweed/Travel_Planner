import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function getClaudeClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Get a key at https://console.anthropic.com and put it in .env.local.",
      );
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

// Centralized model choice so upgrading is a one-line change, not a grep-and-replace.
export const AGENT_MODEL = "claude-sonnet-5" as const;
