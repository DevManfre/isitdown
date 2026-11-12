/**
 * The AI implementation settings — roadmap 6.10 — kept apart from
 * `incidentSummary.ts` so the settings schema can name them without loading
 * the Anthropic SDK at boot.
 */

export const AI_PROVIDERS = ["off", "anthropic", "openai", "claude-cli"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** The environment variable the API key lives in (secrets file or container). */
export const AI_KEY_ENV = "AI_API_KEY";

/**
 * The long-lived token `claude setup-token` prints, for the Local CLI provider
 * when Claude Code runs where no one can sign in interactively (a container).
 * Claude Code reads it from this variable itself; IsItDown only passes its
 * environment through.
 */
export const CLAUDE_TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";

export interface AiSettings {
  provider: AiProvider;
  /** Blank means the provider's default (`DEFAULT_MODELS` in incidentSummary.ts). */
  model: string;
  /** `openai` only. Blank means OpenAI's own endpoint. */
  baseUrl: string;
}
