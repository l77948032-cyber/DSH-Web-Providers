import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { LlmError, assertUsableApiKey, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { Config, PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import * as dshSettings from "@deepseek-ai/dsh-settings";
import { createProvider } from "@earendil-works/pi-ai";
import * as openAICompletionsApi from "@earendil-works/pi-ai/api/openai-completions";
import { closeDoubaoRuntime } from "./doubao-browser.js";
import { DOUBAO_API, DOUBAO_MODELS, doubaoApi } from "./doubao-provider.js";
import { DOUBAO_PROVIDER, DOUBAO_SESSION_REF, parseDoubaoSession, serializeDoubaoSession } from "./doubao-session.js";
import {
  activeWorkBuddySession,
  createWorkBuddySessionStore,
  parseWorkBuddySession,
  parseWorkBuddySessions,
  refreshWorkBuddySession,
  serializeWorkBuddySession,
  serializeWorkBuddySessions,
  sessionCacheDeadline,
  sessionNeedsRefresh,
  upsertWorkBuddySession,
} from "./workbuddy-auth.js";
import { installWorkBuddyWeb } from "./workbuddy-web.js";
import { modelMetadataFromConfig, selectWorkBuddyModelRecords } from "./workbuddy-models.js";
import {
  WORKBUDDY_CN,
  WORKBUDDY_REGIONS,
  allWorkBuddyProviderIds,
  workBuddyRegion,
} from "./workbuddy-regions.js";

export { Config };

export const name = "llm-workbuddy";
export const inject = ["llm"];

const NS = typeof dshSettings.settingsNamespace === "function" ? dshSettings.settingsNamespace("llm-workbuddy") : "llm-workbuddy";
const PROVIDER = WORKBUDDY_CN.provider;
const WORKBUDDY_PROVIDERS = new Set(allWorkBuddyProviderIds());
const ALL_PROVIDERS = [...WORKBUDDY_REGIONS.map((region) => region.provider), DOUBAO_PROVIDER];
const USER_AGENT = "CLI/unknown CodeBuddy/2.137.1";
const STREAM_IDLE_TIMEOUT_MS = 300_000;
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"];
const THINKING_LEVELS = ["off", ...EFFORTS];
const COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  maxTokensField: "max_tokens",
  thinkingFormat: "openai",
};

function workBuddyRequestOptions(options) {
  return { ...options, headers: { ...(options?.headers ?? {}), "user-agent": USER_AGENT } };
}

const workBuddyApi = {
  ...openAICompletionsApi,
  stream: (model, context, options) => openAICompletionsApi.stream(model, context, workBuddyRequestOptions(options)),
  streamSimple: (model, context, options) => openAICompletionsApi.streamSimple(model, context, workBuddyRequestOptions(options)),
};

const FALLBACK_MODEL_DEFS = [
  ["hy3", "Hy3", 192000, 64000, true],
  ["glm-5.2", "GLM-5.2", 1000000, 48000, false],
  ["glm-5.1", "GLM-5.1", 200000, 48000, false],
  ["glm-5v-turbo", "GLM-5v-Turbo", 200000, 64000, true],
  ["minimax-m3-pay", "MiniMax-M3", 512000, 128000, true],
  ["minimax-m2.7", "MiniMax-M2.7", 200000, 48000, true],
  ["kimi-k3-2", "Kimi-K3", 1000000, 32000, true],
  ["kimi-k2.7", "Kimi-K2.7-Code", 256000, 32000, true],
  ["kimi-k2.6", "Kimi-K2.6", 256000, 32000, true],
  ["deepseek-v4-pro", "DeepSeek V4 Pro", 1000000, 50000, true],
  ["deepseek-v4-flash", "DeepSeek V4 Flash", 1000000, 50000, true],
];

function fallbackModels(regionValue = WORKBUDDY_CN) {
  const region = workBuddyRegion(regionValue);
  return FALLBACK_MODEL_DEFS.map(([id, modelName, contextWindow, maxTokens, images]) =>
    workBuddyModel(region, { id, name: modelName, contextWindow, maxTokens, images }),
  );
}

function workBuddyModel(regionValue, { provider, id, name: modelName, contextWindow, maxTokens, images, reasoning = true, thinkingLevelMap = { off: null }, defaultReasoningEffort, thinkingFormat }) {
  const region = workBuddyRegion(regionValue);
  return {
    id,
    name: modelName,
    api: "openai-completions",
    provider: provider ?? region.provider,
    baseUrl: region.baseUrl,
    reasoning,
    ...(reasoning ? { thinkingLevelMap: { ...thinkingLevelMap } } : {}),
    ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
    input: images ? ["text", "image"] : ["text"],
    cost: { ...NO_COST },
    contextWindow,
    maxTokens,
    compat: { ...COMPAT, ...(thinkingFormat ? { thinkingFormat } : {}) },
  };
}

function remoteReasoning(raw, fallback) {
  const reasoning = raw.supportsReasoning ?? fallback?.reasoning ?? raw.onlyReasoning === true;
  if (!reasoning) return { reasoning: false };
  const declared = raw.thinkingLevelMap && typeof raw.thinkingLevelMap === "object" ? raw.thinkingLevelMap : undefined;
  const thinkingLevelMap = declared
    ? Object.fromEntries(THINKING_LEVELS.map((level) => [level,
        Object.hasOwn(declared, level) && (typeof declared[level] === "string" || declared[level] === null) ? declared[level] : null]))
    : { ...(fallback?.thinkingLevelMap ?? {}), ...(raw.onlyReasoning === true ? { off: null } : {}) };
  const effort = raw.reasoning?.effort;
  const defaultReasoningEffort = EFFORTS.includes(effort) && thinkingLevelMap[effort] !== null ? effort : undefined;
  return {
    reasoning: true,
    thinkingLevelMap,
    ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
    ...(typeof raw.thinkingFormat === "string" ? { thinkingFormat: raw.thinkingFormat } : {}),
  };
}

function configuredReasoning(entry, base) {
  if (entry.reasoningEfforts === false) return { reasoning: false };
  if (!entry.reasoningEfforts || typeof entry.reasoningEfforts !== "object") {
    return base ? {
      reasoning: base.reasoning,
      thinkingLevelMap: base.thinkingLevelMap,
      defaultReasoningEffort: base.defaultReasoningEffort,
      thinkingFormat: base.compat?.thinkingFormat,
    } : { reasoning: false };
  }
  const map = {};
  for (const level of THINKING_LEVELS) {
    if (!Object.hasOwn(entry.reasoningEfforts, level)) map[level] = null;
    else if (!(level === "off" && entry.reasoningEfforts[level] === null)) map[level] = entry.reasoningEfforts[level];
  }
  return { reasoning: true, thinkingLevelMap: map, thinkingFormat: entry.compat?.thinkingFormat };
}

function positiveInteger(...values) {
  return values.find((value) => Number.isSafeInteger(value) && value > 0);
}

function text(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0);
}

function modelsFromConfig(data, regionValue = WORKBUDDY_CN) {
  const region = workBuddyRegion(regionValue);
  const fallbackCatalog = fallbackModels(region);
  return selectWorkBuddyModelRecords(data).flatMap((raw) => {
    const id = raw.id;
    const fallback = fallbackCatalog.find((model) => model.id === id);
    const contextWindow = positiveInteger(raw.maxInputTokens, raw.maxAllowedSize, fallback?.contextWindow);
    const maxTokens = positiveInteger(raw.maxOutputTokens, fallback?.maxTokens);
    if (!contextWindow || !maxTokens) return [];
    return [workBuddyModel(region, {
      id,
      name: text(raw.name, fallback?.name, id),
      contextWindow,
      maxTokens,
      images: raw.supportsImages === true || fallback?.input.includes("image") === true,
      ...remoteReasoning(raw, fallback),
    })];
  });
}

function authenticationHeaders(credential) {
  const value = assertUsableApiKey(credential.value, name, credential.ref ?? WORKBUDDY_CN.apiKeyEnv);
  return credential.kind === "bearer" ? { authorization: `Bearer ${value}` } : { "x-api-key": value };
}

async function fetchWorkBuddyModels(regionValue, credential, signal) {
  const region = workBuddyRegion(regionValue);
  const data = await fetchWorkBuddyConfiguration(region, credential, signal);
  const models = modelsFromConfig(data, region);
  if (models.length === 0) throw new LlmError(`${region.displayName}没有返回 CLI 可用模型`, "DISCOVERY_FAILED");
  return models;
}

async function fetchWorkBuddyConfiguration(regionValue, credential, signal) {
  const region = workBuddyRegion(regionValue);
  let response;
  try {
    response = await fetch(region.configUrl, {
      headers: {
        accept: "application/json",
        ...authenticationHeaders(credential),
        "user-agent": USER_AGENT,
        "x-product": "SaaS",
      },
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw new LlmError(`${region.displayName}模型列表获取已取消`, "ABORTED", { cause: error });
    throw new LlmError(`无法连接${region.displayName}模型配置接口`, "DISCOVERY_FAILED", { cause: error });
  }
  if (!response.ok) throw new LlmError(`${region.displayName}模型配置接口返回 ${response.status}`, "DISCOVERY_FAILED");
  const body = await response.json();
  if (body?.code !== 0) throw new LlmError(`${region.displayName}模型配置接口错误：${body?.msg ?? body?.code}`, "DISCOVERY_FAILED");
  return body.data;
}

async function fetchWorkBuddyModelCatalog(regionValue, credential, signal) {
  const region = workBuddyRegion(regionValue);
  return modelMetadataFromConfig(await fetchWorkBuddyConfiguration(region, credential, signal));
}

/**
 * WorkBuddy's credential is already resolved by the DSH adapter.  Do not
 * reuse pi-ai's DeepSeek envApiKeyAuth here: newer pi-ai releases require a
 * signal argument while older DSH adapters call auth resolvers without one.
 * This small adapter accepts both contracts and keeps bearer/API-key values
 * opaque to the provider implementation.
 */
function workBuddyApiKeyAuth(regionValue = WORKBUDDY_CN) {
  const region = workBuddyRegion(regionValue);
  return {
    name: `${region.displayName} API Key`,
    login: async (interaction) => {
      const signal = interaction?.signal;
      signal?.throwIfAborted?.();
      const key = await interaction.prompt({ type: "secret", message: `Enter ${region.displayName} API Key` });
      signal?.throwIfAborted?.();
      return { type: "api_key", key };
    },
    resolve: async ({ credential, signal } = {}) => {
      signal?.throwIfAborted?.();
      if (!credential?.key) return undefined;
      return {
        auth: { apiKey: credential.key },
        ...(credential.env ? { env: credential.env } : {}),
        source: "DSH credential",
      };
    },
  };
}

function workBuddyProvider(regionValue, models) {
  const region = workBuddyRegion(regionValue);
  return createProvider({
    id: region.provider,
    name: region.displayName,
    baseUrl: region.baseUrl,
    auth: { apiKey: workBuddyApiKeyAuth(region) },
    models: models.map((model) => ({ ...model, provider: region.provider, baseUrl: region.baseUrl })),
    api: workBuddyApi,
  });
}

function doubaoWebAuth() {
  return {
    name: "豆包网页登录状态",
    login: async () => {
      throw new Error("请运行 dsh-web-providers login doubao 完成豆包网页登录");
    },
    resolve: async ({ credential, signal } = {}) => {
      signal?.throwIfAborted?.();
      if (!credential?.key) return undefined;
      return { auth: { apiKey: credential.key }, source: "DSH credential" };
    },
  };
}

function doubaoProvider(models = DOUBAO_MODELS) {
  return createProvider({
    id: DOUBAO_PROVIDER,
    name: "豆包（网页登录）",
    baseUrl: "https://www.doubao.com",
    auth: { apiKey: doubaoWebAuth() },
    models,
    api: doubaoApi,
  });
}

function resolvedProfile(provider, source, piProvider, configuredMaxTokens = new Map()) {
  const apiKeyEnv = source.apiKeyEnv === undefined ? undefined : credentialRef(source.apiKeyEnv);
  return {
    ...source,
    // WorkBuddy chooses each model's reasoning policy. Do not let a DSH route
    // setting turn that fixed provider behavior into a user-selectable override.
    reasoning: undefined,
    headers: runtimeHeaders(source.headers),
    provider,
    displayName: source.displayName ?? piProvider.name ?? provider,
    // dsh-llm-pi-ai reads this map for every exact model during catalog
    // resolution. WorkBuddy profiles have no per-model validation failures
    // here, but must still provide the empty map for the shared adapter API.
    modelErrors: new Map(),
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    streamIdleTimeoutMs: source.streamIdleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS,
    retryPolicy: resolveRetryPolicy(source.retryPolicy, `${name}: provider "${provider}" retryPolicy`),
    configuredMaxTokens,
    piProvider,
  };
}

function withoutReasoningControl(modelInfo) {
  if (!modelInfo?.reasoning) return modelInfo;
  const { reasoning: _reasoning, ...fixed } = modelInfo;
  return fixed;
}

function selectWorkBuddyModels(base, entries, regionValue = WORKBUDDY_CN) {
  const region = workBuddyRegion(regionValue);
  if (!Array.isArray(entries) || entries.length === 0) return base;
  const byId = new Map(base.map((model) => [model.id, model]));
  return entries.map((entry) => {
    const model = byId.get(entry.id);
    const reasoning = configuredReasoning(entry, model);
    return workBuddyModel(region, {
      id: entry.id,
      name: entry.name ?? model?.name ?? entry.id,
      contextWindow: entry.contextWindow ?? model?.contextWindow ?? 262144,
      maxTokens: entry.maxTokens ?? model?.maxTokens ?? 32768,
      images: entry.input?.includes("image") ?? model?.input.includes("image") ?? false,
      ...reasoning,
    });
  });
}

function runtimeHeaders(headers) {
  return { ...(headers ?? {}) };
}

function workBuddySource(config, source, regionValue = WORKBUDDY_CN) {
  const region = workBuddyRegion(regionValue);
  const providers = config?.providers ?? {};
  return [region.provider, ...region.aliases].some((provider) => Object.hasOwn(providers, provider))
    ? source
    : { ...source, apiKeyEnv: source.apiKeyEnv ?? region.apiKeyEnv };
}

function installSettingsCompat(ctx, ns, schema, entry, hooks) {
  if (typeof dshSettings.installSettingsSection === "function") {
    return dshSettings.installSettingsSection(ctx, ns, schema, entry, hooks);
  }
  return ctx.inject(["settings"], (settingsCtx) => {
    if (!settingsCtx.settings || typeof settingsCtx.settings.installSection !== "function") {
      throw new Error(`${name}: DSH settings service does not provide installSection`);
    }
    return settingsCtx.settings.installSection(ctx, ns, schema, entry, hooks);
  });
}

export const __testing = Object.freeze({
  authenticationHeaders,
  fetchWorkBuddyConfiguration,
  fetchWorkBuddyModelCatalog,
  fetchWorkBuddyModels,
  workBuddyApiKeyAuth,
  workBuddyRequestOptions,
  workBuddySource,
  modelsFromConfig,
  modelMetadataFromConfig,
  withoutReasoningControl,
  runtimeHeaders,
  selectWorkBuddyModels,
  provider: PROVIDER,
  providers: WORKBUDDY_REGIONS.map((region) => region.provider),
  allProviders: ALL_PROVIDERS,
  doubaoProvider,
  doubaoWebAuth,
  regions: WORKBUDDY_REGIONS,
  settingsNamespace: NS,
});

export function apply(ctx, config) {
  installWorkBuddyWeb(ctx, { fetchModelCatalog: fetchWorkBuddyModelCatalog });
  ctx.effect?.(() => () => void closeDoubaoRuntime());
  let current = () => config;
  const remoteModels = new Map();
  const remoteModelsKey = new Map();
  let generation = 0;
  let memoRaw;
  let memoGeneration = -1;
  let memoized;
  const loginSessionPromises = new Map();

  const effectiveConfig = () => {
    const raw = current() ?? {};
    const providers = raw.providers ?? {};
    const additions = {};
    for (const region of WORKBUDDY_REGIONS) {
      const configured = providers[region.provider]
        ?? region.aliases.map((provider) => providers[provider]).find((profile) => profile !== undefined);
      additions[region.provider] = configured ?? { apiKeyEnv: region.apiKeyEnv };
    }
    additions[DOUBAO_PROVIDER] = providers[DOUBAO_PROVIDER] ?? {};
    return {
      ...raw,
      providers: {
        ...providers,
        ...additions,
      },
    };
  };

  const profiles = () => {
    const raw = effectiveConfig();
    if (memoRaw === current() && memoGeneration === generation && memoized) return memoized;
    const result = new Map();
    for (const region of WORKBUDDY_REGIONS) {
      const source = raw.providers[region.provider];
      const sourceWithAuth = workBuddySource(current(), source, region);
      const models = selectWorkBuddyModels(remoteModels.get(region.provider) ?? fallbackModels(region), source.models, region);
      const configured = new Map((source.models ?? []).flatMap((model) =>
        Number.isSafeInteger(model.maxTokens) && model.maxTokens > 0 ? [[model.id, model.maxTokens]] : [],
      ));
      result.set(region.provider, resolvedProfile(region.provider, {
        ...sourceWithAuth,
        displayName: region.displayName,
      }, workBuddyProvider(region, models), configured));
    }
    const doubaoSource = raw.providers[DOUBAO_PROVIDER] ?? {};
    const doubaoModels = Array.isArray(doubaoSource.models) && doubaoSource.models.length
      ? doubaoSource.models.map((entry) => {
        const base = DOUBAO_MODELS.find((model) => model.id === entry.id);
        return {
          ...(base ?? DOUBAO_MODELS[0]),
          id: entry.id,
          name: entry.name ?? base?.name ?? entry.id,
          contextWindow: entry.contextWindow ?? base?.contextWindow ?? 128_000,
          maxTokens: entry.maxTokens ?? base?.maxTokens ?? 16_000,
          provider: DOUBAO_PROVIDER,
          api: DOUBAO_API,
        };
      })
      : DOUBAO_MODELS;
    const configured = new Map((doubaoSource.models ?? []).flatMap((model) =>
      Number.isSafeInteger(model.maxTokens) && model.maxTokens > 0 ? [[model.id, model.maxTokens]] : [],
    ));
    result.set(DOUBAO_PROVIDER, resolvedProfile(DOUBAO_PROVIDER, {
      ...doubaoSource,
      displayName: "豆包（网页登录）",
    }, doubaoProvider(doubaoModels), configured));
    memoRaw = current();
    memoGeneration = generation;
    memoized = result;
    return result;
  };

  const resolveLoginSession = async (regionValue) => {
    const region = workBuddyRegion(regionValue);
    if (!loginSessionPromises.has(region.provider)) loginSessionPromises.set(region.provider, (async () => {
      const credentials = ctx.get("credentials");
      const env = launchEnvironmentOf(ctx);
      const sessionsRef = credentialRef(region.sessionsRef);
      const sessionRefs = [region.sessionsRef, ...region.legacySessionsRefs].map(credentialRef);
      let sessionsValue;
      for (const ref of sessionRefs) {
        const storedSessions = await credentials?.resolve(ref);
        sessionsValue = storedSessions?.value ?? env.get(ref)?.value;
        if (sessionsValue) break;
      }
      let store;
      if (sessionsValue) {
        store = parseWorkBuddySessions(sessionsValue);
      } else {
        const legacyRefs = [region.sessionRef, ...region.legacySessionRefs].map(credentialRef);
        let legacyValue;
        for (const ref of legacyRefs) {
          const storedLegacy = await credentials?.resolve(ref);
          legacyValue = storedLegacy?.value ?? env.get(ref)?.value;
          if (legacyValue) break;
        }
        if (!legacyValue) throw new Error(`未找到${region.displayName}登录凭据`);
        const legacy = parseWorkBuddySession(legacyValue);
        store = createWorkBuddySessionStore([legacy]);
      }
      const active = activeWorkBuddySession(store);
      if (!active) throw new Error(`未找到${region.displayName}登录账号`);
      let session = active;
      if (sessionNeedsRefresh(session)) {
        session = { ...session, ...(await refreshWorkBuddySession(session, undefined, region)), updatedAt: Date.now() };
        const nextStore = upsertWorkBuddySession({ ...store, activeId: active.id }, session);
        await credentials?.set(sessionsRef, serializeWorkBuddySessions(nextStore));
        await credentials?.set(credentialRef(region.sessionRef), serializeWorkBuddySession(session));
      }
      return { ...session, sessionId: active.id, expiresAt: sessionCacheDeadline(session) };
    })().finally(() => {
      loginSessionPromises.delete(region.provider);
    }));
    return loginSessionPromises.get(region.provider);
  };

  const resolveCredential = async (provider, profile) => {
    if (provider === DOUBAO_PROVIDER) {
      const ref = credentialRef(DOUBAO_SESSION_REF);
      const stored = await ctx.get("credentials")?.resolve(ref);
      const value = stored?.value ?? launchEnvironmentOf(ctx).get(ref)?.value;
      if (!value) {
        throw new LlmError(`${name}: 未找到豆包网页登录状态，请运行 dsh-web-providers login doubao`, "MISSING_CREDENTIAL");
      }
      try {
        return { value: serializeDoubaoSession(parseDoubaoSession(value)), kind: "web-session", ref };
      } catch (error) {
        throw new LlmError(`${name}: 豆包网页登录状态无效，请重新登录`, "MISSING_CREDENTIAL", { cause: error });
      }
    }
    const region = workBuddyRegion(provider);
    const ref = profile.apiKeyEnv;
    if (!ref && WORKBUDDY_PROVIDERS.has(provider)) {
      let session;
      try {
        session = await resolveLoginSession(region);
      } catch (error) {
        throw new LlmError(`${name}: 未找到可用的${region.displayName}登录令牌，请在模型设置中登录`, "MISSING_CREDENTIAL", { cause: error });
      }
      profile.headers ??= {};
      if (session.account.userId) profile.headers["X-User-Id"] = session.account.userId;
      if (session.account.enterpriseId) {
        profile.headers["X-Enterprise-Id"] = session.account.enterpriseId;
        profile.headers["X-Tenant-Id"] = session.account.enterpriseId;
      }
      if (session.auth.domain) profile.headers["X-Domain"] = session.auth.domain;
      return { value: assertUsableApiKey(session.auth.accessToken, name, `${region.displayName} login session`), kind: "bearer", sessionId: session.sessionId };
    }
    if (!ref) return { value: undefined, kind: "none" };
    const stored = await ctx.get("credentials")?.resolve(ref);
    let value = stored?.value ?? launchEnvironmentOf(ctx).get(ref)?.value;
    if (!value && ref === region.apiKeyEnv) {
      for (const legacyEnv of region.legacyApiKeyEnvs) {
        const legacyRef = credentialRef(legacyEnv);
        const legacyStored = await ctx.get("credentials")?.resolve(legacyRef);
        value = legacyStored?.value ?? launchEnvironmentOf(ctx).get(legacyRef)?.value;
        if (value) break;
      }
    }
    if (value) return { value: assertUsableApiKey(value, name, ref), kind: "api-key", ref };
    throw new LlmError(`${name}: Provider "${provider}" 缺少 API Key，请在 WebUI 的模型设置中填写`, "MISSING_CREDENTIAL");
  };

  const resolveApiKey = async (provider, profile) => (await resolveCredential(provider, profile)).value;

  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey,
    resolveAttachments: () => ctx.get("attachments"),
  });
  const resolveModel = adapter.resolveModel.bind(adapter);
  adapter.resolveModel = async (provider, model, signal) => {
    const resolved = await resolveModel(provider, model, signal);
    return WORKBUDDY_PROVIDERS.has(provider) ? withoutReasoningControl(resolved) : resolved;
  };
  const prepareCall = adapter.prepareCall.bind(adapter);
  adapter.prepareCall = async (provider, model, signal) => {
    const prepared = await prepareCall(provider, model, signal);
    return WORKBUDDY_PROVIDERS.has(provider)
      ? { ...prepared, model: withoutReasoningControl(prepared.model) }
      : prepared;
  };
  const listModels = adapter.listModels.bind(adapter);
  const refreshPromises = new Map();
  adapter.listModels = async (provider) => {
    if (WORKBUDDY_PROVIDERS.has(provider)) {
      const region = workBuddyRegion(provider);
      if (!refreshPromises.has(region.provider)) refreshPromises.set(region.provider, (async () => {
        try {
          const profile = profiles().get(provider);
          const credential = await resolveCredential(provider, profile);
          const cacheKey = credential.kind === "bearer" ? `token:${credential.sessionId ?? "active"}` : `api:${credential.ref ?? region.apiKeyEnv}`;
          if (remoteModels.has(region.provider) && remoteModelsKey.get(region.provider) === cacheKey) return;
          remoteModels.set(region.provider, await fetchWorkBuddyModels(region, credential));
          remoteModelsKey.set(region.provider, cacheKey);
          generation += 1;
        } catch {
          // Keep the built-in catalog available while the key or network is absent.
        }
      })().finally(() => {
        refreshPromises.delete(region.provider);
      }));
      await refreshPromises.get(region.provider);
    }
    return listModels(provider);
  };

  const directoryEntries = () => [
    ...WORKBUDDY_REGIONS.map((region) => ({
      provider: region.provider,
      displayName: region.displayName,
      settingsNs: NS,
      settingsPath: ["providers", region.provider],
      declared: false,
    })),
    {
      provider: DOUBAO_PROVIDER,
      displayName: "豆包（网页登录）",
      settingsNs: NS,
      settingsPath: ["providers", DOUBAO_PROVIDER],
      declared: false,
    },
  ];

  let directory = ctx.llm.registerConfigurableProviders(directoryEntries());
  let registration = ctx.llm.registerAdapter(ALL_PROVIDERS, adapter);

  ctx.llm.registerModelDiscovery(NS, async (request, signal) => {
    if (request.provider === DOUBAO_PROVIDER) {
      return DOUBAO_MODELS.map((model) => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      }));
    }
    const region = WORKBUDDY_REGIONS.find((entry) => entry.provider === request.provider);
    if (!region) {
      throw new LlmError(`没有 Provider "${request.provider ?? ""}" 的模型目录`, "DISCOVERY_FAILED");
    }
    const profile = profiles().get(region.provider);
    const credential = request.apiKey
      ? { value: request.apiKey, kind: "api-key", ref: region.apiKeyEnv }
      : await resolveCredential(region.provider, profile);
    remoteModels.set(region.provider, await fetchWorkBuddyModels(region, credential, signal));
    remoteModelsKey.set(region.provider, credential.kind === "bearer" ? `token:${credential.sessionId ?? "active"}` : `api:${credential.ref ?? region.apiKeyEnv}`);
    generation += 1;
    return remoteModels.get(region.provider).map((model) => ({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    }));
  });

  // Keep WorkBuddy out of the settings base layer so it appears in WebUI's
  // "Add provider" dropdown. The runtime profile above still exists as the
  // built-in implementation; selecting it only persists the credential ref.
  installSettingsCompat(ctx, NS, Config, config ?? { providers: {} }, {
    setSource(source) {
      current = source;
    },
    onChange() {
      memoRaw = undefined;
      profiles();
      registration.replace(ALL_PROVIDERS);
      directory.replace(directoryEntries());
    },
  });
}
