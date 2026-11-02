// Injected at build time by build.mjs from the AUTH_BASE env var (no trailing slash).
declare const __AUTH_BASE__: string;
export const AUTH_BASE: string = __AUTH_BASE__.replace(/\/+$/, "");
