// Frozen contract between the ADO extension (extension/) and the GitHub auth function (auth/).
// Change only by agreement between both sides.
//
// Flow (GitHub App user-to-server OAuth, popup):
//   1. Extension opens a popup at  GET {AUTH_BASE}/api/auth/start?origin={window.location.origin}
//      - origin must be in ALLOWED_ORIGINS, else 400 (no redirect).
//      - Responds 302 to https://github.com/login/oauth/authorize with client_id, redirect_uri
//        ({AUTH_BASE}/api/auth/callback) and a state value. The state is bound to the browser
//        with an HttpOnly, Secure, SameSite=Lax cookie and carries the requesting origin.
//   2. GitHub redirects to  GET {AUTH_BASE}/api/auth/callback?code&state
//      - Missing/invalid/expired state, or state not matching the cookie: 400, nothing posted.
//      - Otherwise exchanges code (with client secret) at https://github.com/login/oauth/access_token
//        and returns an HTML page that calls
//        window.opener.postMessage(AuthMessage, <origin from state>) then window.close().
//        A failed exchange posts { ok: false } rather than leaving the popup hanging.
//   3. Before access token expiry the extension calls
//      POST {AUTH_BASE}/api/auth/refresh   body: RefreshRequest   -> 200 GitHubTokenSet | 401 AuthError
//      CORS: only ALLOWED_ORIGINS.
//
// Function app settings: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, ALLOWED_ORIGINS (comma-separated,
// exact origins), STATE_SECRET (key for signing state), AUTH_BASE_URL (the function's own public
// base URL, no trailing slash).
//
// The extension stores GitHubTokenSet in ADO extension data with scopeType "User" (REQ-11).

export const AUTH_MESSAGE_TYPE = "tn-gh-auth";

export interface GitHubTokenSet {
  accessToken: string;
  /** ISO 8601 */
  expiresAt: string;
  refreshToken: string;
  /** ISO 8601 */
  refreshTokenExpiresAt: string;
}

export type AuthMessage =
  | { type: typeof AUTH_MESSAGE_TYPE; ok: true; tokens: GitHubTokenSet }
  | { type: typeof AUTH_MESSAGE_TYPE; ok: false; error: string };

export interface RefreshRequest {
  refreshToken: string;
}

export interface AuthError {
  error: string;
}
