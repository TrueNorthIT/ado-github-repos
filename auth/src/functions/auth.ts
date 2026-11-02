import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { callback, parseAllowedOrigins, refresh, start, type AuthConfig } from "../handlers";

/** Reads settings per request so a missing one fails that request closed rather than the host. */
function loadConfig(): AuthConfig | null {
  const env = process.env;
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS ?? ""); // null if any entry is invalid
  const config = {
    clientId: env.GITHUB_CLIENT_ID ?? "",
    clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
    stateSecret: env.STATE_SECRET ?? "",
    baseUrl: (env.AUTH_BASE_URL ?? "").replace(/\/+$/, ""),
  };
  return Object.values(config).every(Boolean) && allowedOrigins?.length ? { ...config, allowedOrigins } : null;
}

function withConfig(handler: (request: HttpRequest, config: AuthConfig) => Promise<HttpResponseInit>) {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const config = loadConfig();
    if (!config) {
      context.error("Auth function is misconfigured: a required app setting is missing.");
      return { status: 500, body: "Server misconfigured." };
    }
    return handler(request, config);
  };
}

app.http("authStart", {
  route: "auth/start",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: withConfig((req, config) => start(req, config)),
});

app.http("authCallback", {
  route: "auth/callback",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: withConfig((req, config) => callback(req, config, fetch)),
});

app.http("authRefresh", {
  route: "auth/refresh",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: withConfig((req, config) => refresh(req, config, fetch)),
});
