// How a bot account is shown wherever a GitHub user is: Copilot's code review bot as "Copilot" with an "AI" label (as GitHub does),
// any other app as its name with a "Bot" label. Neither has a person's profile, so their hover cards are built from this, not /users/{login}.

export interface BotIdentity {
  kind: "copilot" | "app";
  /** What to show instead of the login. */
  name: string;
  /** The pill beside the name. */
  label: "AI" | "Bot";
  /** The app's page on GitHub (https://github.com/apps/{slug}); Copilot links to its docs instead. */
  url: string;
  /** Copilot's avatar, for places that only have the login. */
  avatarUrl?: string;
}

/** Copilot code review's app avatar, as GitHub serves it on the bot's reviews and comments. */
export const COPILOT_AVATAR = "https://avatars.githubusercontent.com/in/946600?v=4";
export const COPILOT_REVIEW_DOCS = "https://docs.github.com/copilot/using-github-copilot/code-review/using-copilot-code-review";

// GraphQL: Bot "copilot-pull-request-reviewer"; REST: "copilot-pull-request-reviewer[bot]" on reviews and requests, "Copilot" on review comments.
const COPILOT = new Set(["copilot-pull-request-reviewer", "copilot-pull-request-reviewer[bot]", "copilot"]);

export interface ActorInfo {
  login: string | null | undefined;
  /** GraphQL __typename or REST user.type: "Bot" marks an app account whose GraphQL login has no "[bot]" suffix. */
  type?: string | null;
  /** REST is_copilot_code_review, where a comment carries it. */
  isCopilotReview?: boolean | null;
}

/** The bot's display identity, or null for a person (or no login). */
export function botIdentity(a: ActorInfo): BotIdentity | null {
  const login = a.login?.trim();
  if (!login) return null;
  if (a.isCopilotReview || COPILOT.has(login.toLowerCase())) return { kind: "copilot", name: "Copilot", label: "AI", url: COPILOT_REVIEW_DOCS, avatarUrl: COPILOT_AVATAR };
  const suffixed = /\[bot\]$/i.test(login);
  if (!suffixed && a.type !== "Bot") return null;
  const slug = login.replace(/\[bot\]$/i, "");
  return { kind: "app", name: slug, label: "Bot", url: `https://github.com/apps/${encodeURIComponent(slug)}` };
}

/** The name to show for a login: the bot's name, else the login itself. */
export const actorName = (login: string, type?: string | null): string => botIdentity({ login, type })?.name ?? login;
