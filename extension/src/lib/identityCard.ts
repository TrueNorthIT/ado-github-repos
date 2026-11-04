// Which hover card a person gets, from whatever identity we have for them: a bot (botIdentity.ts), a GitHub account, or a git-only
// identity (a commit whose email is not on any GitHub account: a name and an email, no login).
import { botIdentity, type BotIdentity } from "./botIdentity";
import { isLogin } from "./hoverCard";

export interface IdentityInfo {
  login?: string | null;
  /** GraphQL __typename or REST user.type. */
  type?: string | null;
  isCopilotReview?: boolean | null;
  /** The git or profile name. */
  name?: string | null;
  /** The git email. */
  email?: string | null;
}

export type CardChoice =
  | { kind: "bot"; bot: BotIdentity }
  /** The GitHub person card (GET /users/{login}). */
  | { kind: "github"; login: string }
  /** No login: look the email up in Azure DevOps' directory, else show the name and email. Never /users/{login}. */
  | { kind: "git"; name: string; email?: string };

const GHOST = "ghost";

/** The card for an identity, or null when there is nothing to show (no login, name or email; GitHub's deleted-account "ghost"). */
export function chooseCard(a: IdentityInfo): CardChoice | null {
  const login = a.login?.trim();
  if (login && login.toLowerCase() === GHOST) return null;
  const bot = login ? botIdentity({ login, type: a.type, isCopilotReview: a.isCopilotReview }) : null;
  if (bot) return { kind: "bot", bot };
  if (isLogin(login)) return { kind: "github", login };
  const email = a.email?.trim() || undefined;
  const name = a.name?.trim() || "";
  if (!email && (!name || name.toLowerCase() === GHOST)) return null;
  return { kind: "git", name: name || email!, ...(email ? { email } : {}) };
}

/** An identity as Azure DevOps' identity service returns it (the fields this reads). */
export interface AdoIdentityLike {
  entityType?: string;
  mail?: string;
  signInAddress?: string;
}

/** The search result that IS this email (mail or sign-in address, ignoring case), else null: the search also matches names, which is not good enough. */
export function pickAdoIdentity<T extends AdoIdentityLike>(email: string, results: readonly (T | null | undefined)[] | null | undefined): T | null {
  const want = email.trim().toLowerCase();
  if (!want) return null;
  return (results ?? []).find((r): r is T => !!r && (r.entityType ?? "User").toLowerCase() === "user" && [r.mail, r.signInAddress].some((v) => v?.trim().toLowerCase() === want)) ?? null;
}
