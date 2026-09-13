import { randomBytes } from "node:crypto";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import {
  activeWorkBuddySession,
  workBuddyApiKeyEntries,
  workBuddySessionAccounts,
  createWorkBuddyApiKeyStore,
  createWorkBuddySessionStore,
  parseWorkBuddyApiKeys,
  loginWorkBuddy,
  parseWorkBuddySession,
  parseWorkBuddySessions,
  refreshWorkBuddySession,
  serializeWorkBuddyApiKeys,
  serializeWorkBuddySession,
  serializeWorkBuddySessions,
  sessionNeedsRefresh,
  upsertWorkBuddyApiKey,
  upsertWorkBuddySession,
} from "./workbuddy-auth.js";
import { fetchWorkBuddyCredits } from "./workbuddy-credits.js";
import { WORKBUDDY_CN, workBuddyRegion } from "./workbuddy-regions.js";

const SETTINGS_NS = "llm-workbuddy";
const ROUTE = "/dsh-llm-workbuddy/auth";
const ENV_SOURCES = new Set(["env", "user-env", "project-env"]);

export function authenticationMode(config, regionValue = WORKBUDDY_CN) {
  const region = workBuddyRegion(regionValue);
  const providers = config?.providers ?? {};
  const profile = providers[region.provider]
    ?? region.aliases.map((provider) => providers[provider]).find((entry) => entry !== undefined);
  return profile && profile.apiKeyEnv === undefined ? "token" : "api-key";
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function localPost(req) {
  const address = req.socket.remoteAddress;
  const loopback = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  if (!loopback) return false;
  const origin = req.headers.origin;
  if (!origin) return req.headers["sec-fetch-site"] === "same-origin";
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

async function requestBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 64 * 1024) throw new Error("请求体过大");
  }
  if (!raw.trim()) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    throw new Error("请求参数格式无效");
  }
}

async function setMode(settings, mode, apiKeyRef, regionValue = WORKBUDDY_CN) {
  const region = workBuddyRegion(regionValue);
  const targetRef = apiKeyRef ?? region.apiKeyEnv;
  const config = settings.get(SETTINGS_NS);
  const providers = config?.providers ?? {};
  const exists = Object.hasOwn(providers, region.provider);
  const legacyProvider = !exists ? region.aliases.find((provider) => Object.hasOwn(providers, provider)) : undefined;
  const legacy = legacyProvider ? providers[legacyProvider] : undefined;
  const path = ["providers", region.provider];
  if (!exists) {
    const value = { ...(legacy ?? {}), ...(mode === "token" ? {} : { apiKeyEnv: targetRef }) };
    await settings.mutate(SETTINGS_NS, [
      { op: "set", path, value },
      ...(legacyProvider ? [{ op: "unset", path: ["providers", legacyProvider] }] : []),
    ]);
    return;
  }
  await settings.mutate(SETTINGS_NS, [
    {
      op: mode === "token" ? "unset" : "set",
      path: [...path, "apiKeyEnv"],
      ...(mode === "api-key" ? { value: targetRef } : {}),
    },
    ...region.aliases.filter((provider) => Object.hasOwn(providers, provider)).map((provider) => ({ op: "unset", path: ["providers", provider] })),
  ]);
}

function configuredApiKeyRef(settings, regionValue = WORKBUDDY_CN) {
  const region = workBuddyRegion(regionValue);
  const providers = settings.get(SETTINGS_NS)?.providers ?? {};
  const configured = providers[region.provider]
    ?? region.aliases.map((provider) => providers[provider]).find((entry) => entry !== undefined);
  return configured?.apiKeyEnv ?? region.apiKeyEnv;
}

function maskApiKey(value) {
  const text = typeof value === "string" ? value : "";
  return text.length > 4 ? `••••${text.slice(-4)}` : text ? "••••" : "";
}

function textLabel(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function storedApiKeyRef(regionValue = WORKBUDDY_CN) {
  const region = workBuddyRegion(regionValue);
  return `WORKBUDDY_${region.key.toUpperCase()}_API_KEY_DSH_${Date.now().toString(36).toUpperCase()}_${randomBytes(6).toString("hex").toUpperCase()}`;
}

async function readApiKeyStore(credentials, regionValue = WORKBUDDY_CN) {
  const region = workBuddyRegion(regionValue);
  for (const ref of [region.apiKeysRef, ...region.legacyApiKeysRefs]) {
    const stored = await credentials.resolve(credentialRef(ref));
    if (stored?.value) return parseWorkBuddyApiKeys(stored.value);
  }
  return createWorkBuddyApiKeyStore();
}

async function writeApiKeyStore(credentials, store, regionValue = WORKBUDDY_CN) {
  const region = workBuddyRegion(regionValue);
  const normalized = createWorkBuddyApiKeyStore(store?.entries ?? [], store?.activeId);
  if (normalized.entries.length === 0) {
    await credentials.unset(credentialRef(region.apiKeysRef));
    for (const ref of region.legacyApiKeysRefs) await credentials.unset(credentialRef(ref));
    return;
  }
  await credentials.set(credentialRef(region.apiKeysRef), serializeWorkBuddyApiKeys(normalized));
  for (const ref of region.legacyApiKeysRefs) await credentials.unset(credentialRef(ref));
}

async function currentApiKeyState(webCtx, regionValue = WORKBUDDY_CN) {
  const region = workBuddyRegion(regionValue);
  const store = await readApiKeyStore(webCtx.credentials, region);
  const apiMode = authenticationMode(webCtx.settings.get(SETTINGS_NS), region) === "api-key";
  const ref = apiMode ? configuredApiKeyRef(webCtx.settings, region) : undefined;
  const items = [];
  const seenRefs = new Set();
  for (const envRef of [region.apiKeyEnv, ...region.legacyApiKeyEnvs]) {
    const environment = await webCtx.credentials.resolve(credentialRef(envRef));
    if (environment?.value) {
      items.push({
        id: `env:${envRef}`,
        kind: "environment",
        label: `环境变量 ${envRef}`,
        ref: envRef,
        configured: true,
        masked: maskApiKey(environment.value),
        source: environment.source,
      });
      seenRefs.add(envRef);
    }
  }
  for (const entry of workBuddyApiKeyEntries(store)) {
    if (seenRefs.has(entry.ref)) continue;
    const resolved = await webCtx.credentials.resolve(credentialRef(entry.ref));
    items.push({
      ...entry,
      kind: "dsh",
      configured: Boolean(resolved?.value),
      ...(resolved?.value ? { masked: maskApiKey(resolved.value), source: resolved.source } : {}),
    });
    seenRefs.add(entry.ref);
  }
  if (ref && !seenRefs.has(ref)) {
    const resolved = await webCtx.credentials.resolve(credentialRef(ref));
    if (resolved?.value) {
      items.push({
        id: `dsh:${ref}`,
        kind: ENV_SOURCES.has(resolved.source) ? "environment" : "dsh",
        label: ENV_SOURCES.has(resolved.source) ? `环境变量 ${ref}` : "DSH 默认 API Key",
        ref,
        configured: true,
        masked: maskApiKey(resolved.value),
        source: resolved.source,
      });
    }
  }
  const configured = apiMode
    ? items.find((item) => item.ref === ref)
      ?? (ref === region.apiKeyEnv ? items.find((item) => region.legacyApiKeyEnvs.includes(item.ref)) : undefined)
    : undefined;
  const active = configured ?? items.find((item) => item.id === store.activeId) ?? items[0];
  return {
    apiKeys: items,
    activeApiKeyId: active?.id ?? null,
    apiKeyConfigured: Boolean(configured?.configured),
  };
}

async function readSessionStore(credentials, regionValue = WORKBUDDY_CN) {
  const region = workBuddyRegion(regionValue);
  for (const ref of [region.sessionsRef, ...region.legacySessionsRefs]) {
    const stored = await credentials.resolve(credentialRef(ref));
    if (stored?.value) return parseWorkBuddySessions(stored.value);
  }
  for (const ref of [region.sessionRef, ...region.legacySessionRefs]) {
    const legacy = await credentials.resolve(credentialRef(ref));
    if (legacy?.value) return createWorkBuddySessionStore([parseWorkBuddySession(legacy.value)]);
  }
  return createWorkBuddySessionStore();
}

async function writeSessionStore(credentials, store, regionValue = WORKBUDDY_CN) {
  const region = workBuddyRegion(regionValue);
  const active = activeWorkBuddySession(store);
  if (!active) {
    for (const ref of [region.sessionsRef, region.sessionRef, ...region.legacySessionsRefs, ...region.legacySessionRefs]) {
      await credentials.unset(credentialRef(ref));
    }
    return;
  }
  await credentials.set(credentialRef(region.sessionsRef), serializeWorkBuddySessions(store));
  // Keep the old single-session reference as a compatibility pointer for older plugin versions.
  await credentials.set(credentialRef(region.sessionRef), serializeWorkBuddySession(active));
  for (const ref of [...region.legacySessionsRefs, ...region.legacySessionRefs]) await credentials.unset(credentialRef(ref));
}

async function resolveSession(webCtx, accountId, regionValue = WORKBUDDY_CN) {
  const region = workBuddyRegion(regionValue);
  const store = await readSessionStore(webCtx.credentials, region);
  const requestedId = typeof accountId === "string" && accountId ? accountId : store.activeId;
  let session = store.sessions.find((entry) => entry.id === requestedId) ?? activeWorkBuddySession(store);
  if (!session) throw new Error("没有找到该 WorkBuddy 登录账号");
  if (sessionNeedsRefresh(session)) {
    session = { ...session, ...(await refreshWorkBuddySession(session, undefined, region)), updatedAt: Date.now() };
    const nextStore = upsertWorkBuddySession({ ...store, activeId: session.id }, session);
    await writeSessionStore(webCtx.credentials, nextStore, region);
    session = activeWorkBuddySession(nextStore);
  }
  return session;
}

async function resolveModelCredential(webCtx, accountId, regionValue = WORKBUDDY_CN) {
  const region = workBuddyRegion(regionValue);
  if (authenticationMode(webCtx.settings.get(SETTINGS_NS), region) === "token") {
    const session = await resolveSession(webCtx, accountId, region);
    return { value: session.auth.accessToken, kind: "bearer", sessionId: session.id };
  }
  const configuredRef = configuredApiKeyRef(webCtx.settings, region);
  let ref = configuredRef;
  let resolved = await webCtx.credentials.resolve(credentialRef(ref));
  if (!resolved?.value && ref === region.apiKeyEnv) {
    for (const legacyEnv of region.legacyApiKeyEnvs) {
      const candidate = await webCtx.credentials.resolve(credentialRef(legacyEnv));
      if (candidate?.value) {
        ref = legacyEnv;
        resolved = candidate;
        break;
      }
    }
  }
  if (!resolved?.value) throw new Error("没有找到可用的 WorkBuddy API Key");
  return { value: resolved.value, kind: "api-key", ref };
}

export function installWorkBuddyWeb(ctx, { fetchModelCatalog } = {}) {
  ctx.inject(["webServer", "settings", "credentials"], (webCtx) => {
    const loginPromises = new Map();
    const regionFromBody = (body) => {
      if (body?.provider === undefined) return WORKBUDDY_CN;
      const region = workBuddyRegion(body.provider, null);
      if (!region || ![region.provider, ...region.aliases].includes(String(body.provider).trim().toLowerCase())) {
        throw new Error(`不支持的 WorkBuddy Provider：${body.provider}`);
      }
      return region;
    };
    const currentState = async (regionValue) => {
      const region = workBuddyRegion(regionValue);
      const store = await readSessionStore(webCtx.credentials, region);
      const active = activeWorkBuddySession(store);
      const apiKeys = await currentApiKeyState(webCtx, region);
      return {
        ok: true,
        provider: region.provider,
        displayName: region.displayName,
        siteName: region.siteName,
        mode: authenticationMode(webCtx.settings.get(SETTINGS_NS), region),
        authenticated: active !== undefined,
        activeAccountId: active?.id ?? null,
        accounts: workBuddySessionAccounts(store),
        ...apiKeys,
      };
    };
    const status = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面读取认证状态" });
      try {
        const body = await requestBody(req);
        json(res, 200, await currentState(regionFromBody(body)));
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "读取 WorkBuddy 认证状态失败" });
      }
    };
    const apiKey = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面切换认证方式" });
      try {
        const body = await requestBody(req);
        const region = regionFromBody(body);
        let ref = region.apiKeyEnv;
        if (typeof body.keyId === "string" && body.keyId) {
          const state = await currentApiKeyState(webCtx, region);
          const selected = state.apiKeys.find((entry) => entry.id === body.keyId);
          if (!selected) return json(res, 404, { ok: false, message: "没有找到该 WorkBuddy API Key" });
          if (!selected.configured) return json(res, 409, { ok: false, message: "该 API Key 已不可用，请删除后重新添加" });
          ref = selected.ref;
          const store = await readApiKeyStore(webCtx.credentials, region);
          await writeApiKeyStore(webCtx.credentials, { ...store, activeId: selected.kind === "dsh" ? selected.id : null }, region);
        }
        credentialRef(ref);
        await setMode(webCtx.settings, "api-key", ref, region);
        json(res, 200, await currentState(region));
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "切换 API Key 失败" });
      }
    };
    const addApiKey = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面保存 API Key" });
      try {
        const body = await requestBody(req);
        const region = regionFromBody(body);
        const value = typeof body.key === "string" ? body.key.trim() : "";
        if (!value) return json(res, 400, { ok: false, message: "请输入 API Key" });
        if (value.length > 16 * 1024) return json(res, 413, { ok: false, message: "API Key 长度超出限制" });
        const store = await readApiKeyStore(webCtx.credentials, region);
        const ref = storedApiKeyRef(region);
        const entry = {
          id: `dsh:${ref}`,
          ref,
          label: textLabel(body.label) ?? `DSH API Key ${store.entries.length + 1}`,
        };
        await webCtx.credentials.set(credentialRef(ref), value);
        try {
          const next = upsertWorkBuddyApiKey(store, entry);
          await writeApiKeyStore(webCtx.credentials, next, region);
          await setMode(webCtx.settings, "api-key", ref, region);
        } catch (error) {
          await webCtx.credentials.unset(credentialRef(ref));
          throw error;
        }
        json(res, 200, await currentState(region));
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "保存 API Key 失败" });
      }
    };
    const removeApiKey = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面删除 API Key" });
      try {
        const body = await requestBody(req);
        const region = regionFromBody(body);
        const store = await readApiKeyStore(webCtx.credentials, region);
        const entry = store.entries.find((item) => item.id === body.keyId);
        if (!entry) return json(res, 404, { ok: false, message: "没有找到该 WorkBuddy API Key" });
        const activeRef = configuredApiKeyRef(webCtx.settings, region);
        await webCtx.credentials.unset(credentialRef(entry.ref));
        const remaining = store.entries.filter((item) => item.id !== entry.id);
        await writeApiKeyStore(webCtx.credentials, { version: 1, activeId: remaining[0]?.id, entries: remaining }, region);
        if (authenticationMode(webCtx.settings.get(SETTINGS_NS), region) === "api-key" && activeRef === entry.ref) {
          const environment = await webCtx.credentials.resolve(credentialRef(region.apiKeyEnv));
          let fallback = region.apiKeyEnv;
          if (!environment?.value) {
            for (const candidate of remaining) {
              if ((await webCtx.credentials.resolve(credentialRef(candidate.ref)))?.value) {
                fallback = candidate.ref;
                break;
              }
            }
          }
          await setMode(webCtx.settings, "api-key", fallback, region);
        }
        json(res, 200, await currentState(region));
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "删除 API Key 失败" });
      }
    };
    const token = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面切换认证方式" });
      try {
        const body = await requestBody(req);
        const region = regionFromBody(body);
        const store = await readSessionStore(webCtx.credentials, region);
        const accountId = typeof body.accountId === "string" ? body.accountId : store.activeId;
        const active = store.sessions.find((entry) => entry.id === accountId);
        if (!active) return json(res, 409, { ok: false, message: "没有找到该 WorkBuddy 登录账号" });
        await writeSessionStore(webCtx.credentials, { ...store, activeId: active.id }, region);
        await setMode(webCtx.settings, "token", undefined, region);
        json(res, 200, await currentState(region));
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "切换令牌账号失败" });
      }
    };
    const credits = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面查询 WorkBuddy 积分" });
      try {
        const body = await requestBody(req);
        const region = regionFromBody(body);
        if (authenticationMode(webCtx.settings.get(SETTINGS_NS), region) !== "token") {
          return json(res, 200, {
            ok: true,
            accountId: null,
            credits: null,
            totalDosage: null,
            segments: [],
            unlimited: false,
            cycleResetTime: null,
            creditError: "积分查询仅支持 WorkBuddy 令牌登录",
            todayUsage: null,
            todayUsageError: "今日请求量查询仅支持 WorkBuddy 令牌登录",
          });
        }
        const session = await resolveSession(webCtx, body.accountId, region);
        const result = await fetchWorkBuddyCredits(session, { region });
        json(res, 200, {
          ok: true,
          accountId: session.id,
          credits: result.credits,
          totalDosage: result.totalDosage,
          segments: result.segments,
          unlimited: !!result.unlimited,
          cycleResetTime: result.cycleResetTime ?? null,
          creditError: result.creditError ?? null,
          todayUsage: result.todayUsage ?? null,
          todayUsageError: result.todayUsageError ?? null,
        });
      } catch (error) {
        json(res, 200, {
          ok: true,
          accountId: null,
          credits: null,
          totalDosage: null,
          segments: [],
          unlimited: false,
          cycleResetTime: null,
          creditError: error instanceof Error ? error.message : "查询 WorkBuddy 积分失败",
          todayUsage: null,
          todayUsageError: error instanceof Error ? error.message : "查询 WorkBuddy 今日请求量失败",
        });
      }
    };
    const models = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面查询 WorkBuddy 模型信息" });
      if (typeof fetchModelCatalog !== "function") return json(res, 501, { ok: false, message: "WorkBuddy 模型信息服务不可用" });
      try {
        const body = await requestBody(req);
        const region = regionFromBody(body);
        const credential = await resolveModelCredential(webCtx, body.accountId, region);
        const catalog = await fetchModelCatalog(region, credential);
        json(res, 200, { ok: true, provider: region.provider, models: catalog });
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "查询 WorkBuddy 模型信息失败" });
      }
    };
    const login = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面登录" });
      try {
        const body = await requestBody(req);
        const region = regionFromBody(body);
        if (!loginPromises.has(region.provider)) loginPromises.set(region.provider, (async () => {
          const session = await loginWorkBuddy(undefined, undefined, region);
          const store = await readSessionStore(webCtx.credentials, region);
          await writeSessionStore(webCtx.credentials, upsertWorkBuddySession(store, session), region);
          await setMode(webCtx.settings, "token", undefined, region);
        })().finally(() => {
          loginPromises.delete(region.provider);
        }));
        await loginPromises.get(region.provider);
        json(res, 200, await currentState(region));
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "WorkBuddy 登录失败" });
      }
    };
    const remove = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面管理登录账号" });
      try {
        const body = await requestBody(req);
        const region = regionFromBody(body);
        const store = await readSessionStore(webCtx.credentials, region);
        const accountId = typeof body.accountId === "string" ? body.accountId : store.activeId;
        const sessions = store.sessions.filter((entry) => entry.id !== accountId);
        if (sessions.length === store.sessions.length) return json(res, 404, { ok: false, message: "没有找到该 WorkBuddy 登录账号" });
        const activeId = accountId === store.activeId ? sessions[0]?.id : store.activeId;
        await writeSessionStore(webCtx.credentials, { version: 1, activeId, sessions }, region);
        json(res, 200, await currentState(region));
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "删除令牌账号失败" });
      }
    };
    webCtx.effect(() => {
      const dispose = [
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/status`, handler: status }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/api-key`, handler: apiKey }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/api-key/add`, handler: addApiKey }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/api-key/remove`, handler: removeApiKey }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/token`, handler: token }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/credits`, handler: credits }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/models`, handler: models }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/login`, handler: login }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/remove`, handler: remove }),
      ];
      return () => dispose.forEach((fn) => fn());
    }, "llm-workbuddy: web login routes");
  });
}
