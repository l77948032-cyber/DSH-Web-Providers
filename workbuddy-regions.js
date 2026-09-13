const REGIONS = Object.freeze({
  cn: Object.freeze({
    key: "cn",
    provider: "workbuddy-cn",
    aliases: Object.freeze(["codebuddy-cn"]),
    displayName: "WorkBuddy 中国区",
    siteName: "WorkBuddy 中国站",
    apiKeyEnv: "WORKBUDDY_API_KEY",
    legacyApiKeyEnvs: Object.freeze(["CODEBUDDY_API_KEY"]),
    apiKeysRef: "WORKBUDDY_API_KEYS",
    legacyApiKeysRefs: Object.freeze(["CODEBUDDY_API_KEYS"]),
    sessionRef: "WORKBUDDY_LOGIN_SESSION",
    sessionsRef: "WORKBUDDY_LOGIN_SESSIONS",
    legacySessionRefs: Object.freeze(["CODEBUDDY_LOGIN_SESSION"]),
    legacySessionsRefs: Object.freeze(["CODEBUDDY_LOGIN_SESSIONS"]),
    baseUrl: "https://copilot.tencent.com/v2",
    configUrl: "https://copilot.tencent.com/v3/config",
    authBaseUrl: "https://copilot.tencent.com/v2/plugin",
    billingHost: "https://www.codebuddy.cn",
    billingHosts: Object.freeze([
      "codebuddy.cn",
      "www.codebuddy.cn",
      "workbuddy.cn",
      "www.workbuddy.cn",
    ]),
  }),
  global: Object.freeze({
    key: "global",
    provider: "workbuddy-global",
    aliases: Object.freeze(["codebuddy-global", "workbuddy-international", "codebuddy-international"]),
    displayName: "WorkBuddy 国际版",
    siteName: "WorkBuddy 国际站",
    apiKeyEnv: "WORKBUDDY_GLOBAL_API_KEY",
    legacyApiKeyEnvs: Object.freeze(["CODEBUDDY_GLOBAL_API_KEY"]),
    apiKeysRef: "WORKBUDDY_GLOBAL_API_KEYS",
    legacyApiKeysRefs: Object.freeze([]),
    sessionRef: "WORKBUDDY_GLOBAL_LOGIN_SESSION",
    sessionsRef: "WORKBUDDY_GLOBAL_LOGIN_SESSIONS",
    legacySessionRefs: Object.freeze([]),
    legacySessionsRefs: Object.freeze([]),
    baseUrl: "https://www.codebuddy.ai/v2",
    configUrl: "https://www.codebuddy.ai/v3/config",
    authBaseUrl: "https://www.codebuddy.ai/v2/plugin",
    billingHost: "https://www.codebuddy.ai",
    billingHosts: Object.freeze(["codebuddy.ai", "www.codebuddy.ai"]),
  }),
});

export const WORKBUDDY_REGIONS = Object.freeze([REGIONS.cn, REGIONS.global]);
export const WORKBUDDY_CN = REGIONS.cn;
export const WORKBUDDY_GLOBAL = REGIONS.global;

const REGION_BY_PROVIDER = new Map(WORKBUDDY_REGIONS.flatMap((region) =>
  [region.provider, ...region.aliases].map((provider) => [provider, region]),
));

export function workBuddyRegion(value, fallback = WORKBUDDY_CN) {
  if (value && typeof value === "object" && WORKBUDDY_REGIONS.includes(value)) return value;
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "cn" || normalized === "china") return WORKBUDDY_CN;
  if (normalized === "global" || normalized === "international") return WORKBUDDY_GLOBAL;
  return REGION_BY_PROVIDER.get(normalized) ?? fallback;
}

export function isWorkBuddyProvider(value) {
  return typeof value === "string" && REGION_BY_PROVIDER.has(value.trim().toLowerCase());
}

export function allWorkBuddyProviderIds() {
  return WORKBUDDY_REGIONS.flatMap((region) => [region.provider, ...region.aliases]);
}
