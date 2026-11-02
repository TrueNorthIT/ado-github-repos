import * as SDK from "azure-devops-extension-sdk";
import type { IExtensionDataService } from "azure-devops-extension-api/Common/CommonServices";
import { AUTH_MESSAGE_TYPE, AuthMessage, GitHubTokenSet, RefreshRequest } from "../../shared/contract";
import { AUTH_BASE } from "./config";
import { tokenAction } from "./lib/tokens";

const COLLECTION = "github-auth";
const DOC_ID = "tokens";
// REQ-11: User scope, so tokens are private to the signed-in ADO user. Tokens are never logged.
const OPTS = { scopeType: "User" };

async function store() {
  const svc = await SDK.getService<IExtensionDataService>("ms.vss-features.extension-data-service");
  return svc.getExtensionDataManager(SDK.getExtensionContext().id, await SDK.getAccessToken());
}

async function save(t: GitHubTokenSet) {
  await (await store()).setDocument(COLLECTION, { id: DOC_ID, ...t }, OPTS);
}

export async function signOut() {
  try {
    await (await store()).deleteDocument(COLLECTION, DOC_ID, OPTS);
  } catch {
    /* nothing stored */
  }
}

/** Returns a usable token set (refreshing if needed) or null when signed out. */
export async function getTokens(): Promise<GitHubTokenSet | null> {
  let t: GitHubTokenSet | null = null;
  try {
    t = await (await store()).getDocument(COLLECTION, DOC_ID, OPTS);
  } catch {
    return null; // 404: nothing stored yet
  }
  const action = tokenAction(t);
  if (action === "use") return t;
  if (action === "refresh" && t) {
    try {
      const body: RefreshRequest = { refreshToken: t.refreshToken };
      const res = await fetch(`${AUTH_BASE}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const fresh: GitHubTokenSet = await res.json();
        await save(fresh);
        return fresh;
      }
    } catch {
      /* fall through: treat as signed out */
    }
  }
  await signOut();
  return null;
}

export type SignInResult = { ok: true; tokens: GitHubTokenSet } | { ok: false; reason: "blocked" | "closed" | "error"; error?: string };

/** Opens the GitHub popup; resolves on a valid message, or when the popup is closed/blocked. */
export function signIn(): Promise<SignInResult> {
  return new Promise((resolve) => {
    const authOrigin = new URL(AUTH_BASE).origin;
    const popup = window.open(`${AUTH_BASE}/api/auth/start?origin=${encodeURIComponent(window.location.origin)}`, "tn-gh-auth", "width=600,height=700");
    if (!popup) return resolve({ ok: false, reason: "blocked" });

    const finish = (r: SignInResult) => {
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
      resolve(r);
    };
    const onMessage = async (e: MessageEvent) => {
      const d = e.data as AuthMessage | undefined;
      if (e.source !== popup || e.origin !== authOrigin || !d || d.type !== AUTH_MESSAGE_TYPE) return;
      if (!d.ok) return finish({ ok: false, reason: "error", error: d.error });
      const t = d.tokens;
      if (!t || ![t.accessToken, t.expiresAt, t.refreshToken, t.refreshTokenExpiresAt].every((v) => typeof v === "string")) {
        return finish({ ok: false, reason: "error", error: "Invalid sign-in response." });
      }
      try {
        await save(d.tokens);
      } catch {
        return finish({ ok: false, reason: "error", error: "Could not store the sign-in." });
      }
      finish({ ok: true, tokens: d.tokens });
    };
    window.addEventListener("message", onMessage);
    // Cancelled / failed callbacks post nothing, so watch for the popup closing.
    // Short grace so a message posted just before window.close() is handled first.
    const timer = setInterval(() => {
      if (popup.closed) setTimeout(() => finish({ ok: false, reason: "closed" }), 300);
    }, 500);
  });
}
