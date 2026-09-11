import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { __testing, apply } from "./index.js";
import {
  workBuddyApiKeyEntries,
  activeWorkBuddySession,
  workBuddySessionAccounts,
  createWorkBuddyApiKeyStore,
  createWorkBuddySessionStore,
  parseWorkBuddyApiKeys,
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
import { authenticationMode } from "./workbuddy-web.js";
import { __testing as creditsTesting, fetchWorkBuddyCredits } from "./workbuddy-credits.js";
import { AUTO_TIER_MODELS, formatCreditsCoefficient, isPromotionActive, modelMetadataFromConfig } from "./workbuddy-models.js";

test("客户端兼容包装 Provider 并将 WorkBuddy 用量并入统计行", () => {
  const client = readFileSync(new URL("./client.js", import.meta.url), "utf8");
  assert.match(client, /WORKBUDDY_PROVIDER_PATTERN/);
  assert.match(client, /isWorkBuddyProvider\(provider\)/);
  assert.match(client, /data-composer-stats/);
  assert.match(client, /display: grid !important/);
  assert.match(client, /settings\.models\.provider-card/);
  assert.match(client, /key: "llm-workbuddy"/);
  assert.match(client, /authRequest\("models", \{\}\)/);
  assert.match(client, /data-workbuddy-model-rate/);
  assert.match(client, /\\p\{L\}\\p\{N\}/);
  assert.match(client, /section\.querySelectorAll\('button, \[role="menuitemradio"\], \[role="menuitem"\]'\)/);
  assert.match(client, /消耗速度/);
  assert.doesNotMatch(client, /EFFORT_TRANSLATIONS/);
  assert.match(client, /dsh-wb-stats/);
});

test("模型元数据按 WorkBuddy 规则展示倍率、活动和详情", () => {
  const now = new Date("2026-09-11T09:00:00+08:00");
  const model = modelMetadataFromConfig({
    agents: [{ name: "cli", models: ["hy4", "hy4"] }],
    models: [{
      id: "hy4",
      name: "Hy4 preview",
      descriptionZh: "混元思考模型，具有增强的推理能力",
      credits: "x0.50 credits",
      maxInputTokens: 300_000,
      supportsReasoning: true,
      reasoning: { effort: "high" },
    }],
    modelPromotions: [{
      id: "hy4-free",
      modelIds: ["hy4"],
      kind: "discount",
      badge: { label: "限时免费", display: "activeOnly" },
      discount: { factor: 0, discountedCredits: "0x", displayMode: "replace" },
      hover: { textZh: "限时启用可享免费额度。", action: { labelZh: "去使用" } },
      schedule: { validFrom: "2026-09-01T00:00:00+08:00", validUntil: "2026-10-01T00:00:00+08:00" },
    }],
  }, now).find((entry) => entry.id === "hy4");

  assert.equal(model.rate, "0.00x");
  assert.equal(model.badge, "限时免费");
  assert.equal(model.description, "混元思考模型，具有增强的推理能力");
  assert.equal(model.contextWindow, 300_000);
  assert.equal(model.reasoningEffort, "高");
  assert.equal(model.promotionAction, "去使用");
  assert.equal(formatCreditsCoefficient("x0.79 credits"), "0.79x");
  assert.equal(isPromotionActive({ schedule: { daily: [{ start: "22:00", end: "06:00" }] } }, new Date("2026-09-11T23:00:00")), true);
});

test("Auto 模型按 WorkBuddy 展开为快速、均衡、极致并去重", () => {
  const models = modelMetadataFromConfig({
    agents: [{ name: "cli", models: ["auto", "hy3", "hy3"] }],
    models: [
      { id: "auto", name: "Auto", maxInputTokens: 168_000, maxOutputTokens: 32_000 },
      { id: "hy3", name: "Hy3", maxInputTokens: 192_000, maxOutputTokens: 64_000 },
    ],
  });

  assert.deepEqual(models.slice(0, 3).map((model) => model.id), AUTO_TIER_MODELS.map((model) => model.id));
  assert.deepEqual(models.slice(0, 3).map((model) => model.rate), ["0.21x", "0.65x", "1.20x"]);
  assert.equal(models.filter((model) => model.id === "hy3").length, 1);
  assert.equal(models.some((model) => model.id === "auto"), false);
});

test("远端只下发折后倍率时保留 WorkBuddy 当前活动标识", () => {
  const models = modelMetadataFromConfig({
    agents: [{ name: "cli", models: ["hy4-preview-f", "hy3", "deepseek-v4.1-flash", "glm-5.2"] }],
    models: [
      { id: "hy4-preview-f", name: "Hy4 preview", credits: "x0.00 credits", maxInputTokens: 300_000 },
      { id: "hy3", name: "Hy3", credits: "x0.00 credits", maxInputTokens: 192_000 },
      { id: "deepseek-v4.1-flash", name: "Deepseek-V4.1-Flash", credits: "x0.03 credits", maxInputTokens: 1_000_000 },
      { id: "glm-5.2", name: "GLM-5.2", credits: "x0.79 credits", maxInputTokens: 1_000_000 },
    ],
  }, new Date("2026-09-11T18:00:00+08:00"));
  assert.deepEqual(models.slice(3).map((model) => model.badge), ["限时免费", "限时免费", "独家优惠", "夜间折扣"]);
});

test("插件使用独立命名空间且不禁用原生 pi-ai Adapter", () => {
  const patch = readFileSync(new URL("./cordis.patch.yml", import.meta.url), "utf8");
  assert.equal(__testing.provider, "workbuddy-cn");
  assert.equal(__testing.settingsNamespace, "llm-workbuddy");
  assert.doesNotMatch(patch, /id:\s*llm-pi-ai/);
  assert.doesNotMatch(patch, /disabled:\s*true/);
  assert.match(patch, /@l77948032-cyber\/dsh-workbuddy/);
});

test("运行时只注册 WorkBuddy，不接管已有自定义 Provider", () => {
  const seen = { adapters: [], directories: [], discoveries: [] };
  const replaceable = () => Object.assign(() => {}, { replace() {} });
  const ctx = {
    get: () => undefined,
    inject: () => undefined,
    llm: {
      registerAdapter(providers) {
        seen.adapters.push([...providers]);
        return replaceable();
      },
      registerConfigurableProviders(entries) {
        seen.directories.push(entries.map((entry) => ({ ...entry })));
        return replaceable();
      },
      registerModelDiscovery(namespace) {
        seen.discoveries.push(namespace);
        return () => {};
      },
    },
  };

  apply(ctx, {
    providers: {
      b: {
        api: "openai-completions",
        baseURL: "https://api.b.ai/v1",
        models: [{ id: "glm-5.3-flash" }],
      },
    },
  });

  assert.deepEqual(seen.adapters, [["workbuddy-cn"]]);
  assert.deepEqual(seen.directories.map((entries) => entries.map((entry) => entry.provider)), [["workbuddy-cn"]]);
  assert.deepEqual(seen.discoveries, ["llm-workbuddy"]);
});

test("API Key 和登录令牌使用各自的认证头", () => {
  assert.deepEqual(__testing.authenticationHeaders({ value: "api-key", kind: "api-key" }), { "x-api-key": "api-key" });
  assert.deepEqual(__testing.authenticationHeaders({ value: "login-token", kind: "bearer" }), { authorization: "Bearer login-token" });
});

test("WorkBuddy 自有认证助手兼容新旧 DSH 的 signal 调用约定", async () => {
  const auth = __testing.workBuddyApiKeyAuth();
  const credential = { type: "api_key", key: "login-token" };

  // Older DSH calls resolve without a signal. This must not dereference it.
  assert.deepEqual(await auth.resolve({ credential }), {
    auth: { apiKey: "login-token" },
    source: "DSH credential",
  });

  // Newer DSH supplies an AbortSignal. The same resolver must remain valid.
  const controller = new AbortController();
  assert.deepEqual(await auth.resolve({ credential, signal: controller.signal }), {
    auth: { apiKey: "login-token" },
    source: "DSH credential",
  });
});

test("登录请求头不修改 DSH 冻结的配置对象", () => {
  const headers = __testing.runtimeHeaders(Object.freeze({ existing: "value" }));
  headers["X-User-Id"] = "user";
  assert.deepEqual(headers, { existing: "value", "X-User-Id": "user" });
});

test("模型请求恢复 WorkBuddy 官方 User-Agent", () => {
  const options = Object.freeze({ headers: Object.freeze({ "user-agent": "deepseek-harness", existing: "value" }) });
  const resolved = __testing.workBuddyRequestOptions(options);

  assert.equal(resolved.headers["user-agent"], "CLI/unknown CodeBuddy/2.137.1");
  assert.equal(resolved.headers.existing, "value");
  assert.equal(options.headers["user-agent"], "deepseek-harness");
});

test("显式空配置启用令牌模式，未配置时仍使用 API Key", () => {
  assert.equal(__testing.workBuddySource({}, {}).apiKeyEnv, "WORKBUDDY_API_KEY");
  assert.equal(__testing.workBuddySource({ providers: { "workbuddy-cn": {} } }, {}).apiKeyEnv, undefined);
  assert.equal(__testing.workBuddySource({ providers: { "codebuddy-cn": {} } }, {}).apiKeyEnv, undefined);
});

test("WebUI 可以区分 API Key 与令牌认证模式", () => {
  assert.equal(authenticationMode({ providers: {} }), "api-key");
  assert.equal(authenticationMode({ providers: { "workbuddy-cn": { apiKeyEnv: "WORKBUDDY_API_KEY" } } }), "api-key");
  assert.equal(authenticationMode({ providers: { "workbuddy-cn": {} } }), "token");
  assert.equal(authenticationMode({ providers: { "codebuddy-cn": {} } }), "token");
});

test("登录会话可以安全序列化并按过期时间刷新", () => {
  const session = {
    auth: { accessToken: "access", refreshToken: "refresh", expiresAt: 2_000_000 },
    account: { userId: "user", enterpriseId: "enterprise", ignored: "not-stored" },
  };
  const restored = parseWorkBuddySession(serializeWorkBuddySession(session));
  assert.deepEqual(restored.account, { userId: "user", enterpriseId: "enterprise" });
  assert.equal(sessionNeedsRefresh(restored, 1_000_000), false);
  assert.equal(sessionNeedsRefresh(restored, 1_900_000), true);
});

test("多个登录账号可以持久化、去重并切换", () => {
  const first = { auth: { accessToken: "access-1", refreshToken: "refresh-1" }, account: { userId: "user-1" } };
  const second = { auth: { accessToken: "access-2", refreshToken: "refresh-2" }, account: { userId: "user-2" } };
  const store = upsertWorkBuddySession(upsertWorkBuddySession(createWorkBuddySessionStore(), first), second);
  const restored = parseWorkBuddySessions(serializeWorkBuddySessions({ ...store, activeId: store.sessions[0].id }));
  assert.equal(restored.sessions.length, 2);
  assert.equal(activeWorkBuddySession(restored).account.userId, "user-1");
  assert.deepEqual(workBuddySessionAccounts(restored).map((entry) => entry.label), ["user-1", "user-2"]);
  assert.equal(JSON.stringify(workBuddySessionAccounts(restored)).includes("refresh-1"), false);
  const replaced = upsertWorkBuddySession(restored, { ...first, auth: { accessToken: "access-1-new", refreshToken: "refresh-1-new" } });
  assert.equal(replaced.sessions.length, 2);
  assert.equal(replaced.sessions.find((entry) => entry.id === "user:user-1").auth.accessToken, "access-1-new");
});

test("新增登录账号统一生成账号名称和 UID 展示字段", () => {
  const session = {
    auth: { accessToken: "access-new", refreshToken: "refresh-new" },
    account: { account: { uid: "new-user-id", nickname: "新账号" } },
  };
  const store = upsertWorkBuddySession(createWorkBuddySessionStore(), session);
  const [account] = workBuddySessionAccounts(store);

  assert.equal(account.label, "新账号");
  assert.equal(account.accountName, "新账号");
  assert.equal(account.userId, "new-user-id");
  assert.equal(account.account.displayName, "新账号");
  assert.equal(account.account.userId, "new-user-id");
});

test("账号接口缺少名称时从 UIN 或登录令牌补齐展示信息", () => {
  const payload = Buffer.from(JSON.stringify({ sub: "jwt-user-id", preferred_username: "jwt-account" })).toString("base64url");
  const session = {
    auth: { accessToken: `header.${payload}.signature`, refreshToken: "refresh-jwt" },
    account: { uin: "uin-account" },
  };
  const store = upsertWorkBuddySession(createWorkBuddySessionStore(), session);
  const [account] = workBuddySessionAccounts(store);

  assert.equal(account.label, "uin-account");
  assert.equal(account.userId, "jwt-user-id");
  assert.equal(account.account.displayName, "uin-account");
  assert.equal(account.account.uin, "uin-account");
});

test("API Key 目录只保存引用和展示元数据，不保存密钥值", () => {
  const store = upsertWorkBuddyApiKey(createWorkBuddyApiKeyStore(), {
    id: "dsh:WORKBUDDY_API_KEY_DSH_TEST",
    ref: "WORKBUDDY_API_KEY_DSH_TEST",
    label: "DSH API Key 1",
  });
  const restored = parseWorkBuddyApiKeys(serializeWorkBuddyApiKeys(store));
  assert.deepEqual(workBuddyApiKeyEntries(restored).map((entry) => entry.ref), ["WORKBUDDY_API_KEY_DSH_TEST"]);
  assert.equal(JSON.stringify(workBuddyApiKeyEntries(restored)).includes("secret"), false);
  const noActive = createWorkBuddyApiKeyStore(restored.entries, null);
  assert.equal(noActive.activeId, null);
});

test("插件直接调用官方刷新接口且不复用旧过期时间", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ code: 0, data: { accessToken: "new-access", expiresIn: 3600 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const refreshed = await refreshWorkBuddySession({
      auth: { accessToken: "old-access", refreshToken: "refresh", expiresAt: 1 },
      account: { uid: "user", enterpriseId: "enterprise" },
    });
    assert.equal(request.url, "https://copilot.tencent.com/v2/plugin/auth/token/refresh");
    assert.equal(request.options.headers["X-Refresh-Token"], "refresh");
    assert.equal(request.options.headers["X-Enterprise-Id"], "enterprise");
    assert.equal(refreshed.auth.accessToken, "new-access");
    assert.ok(refreshed.auth.expiresAt > Date.now() + 3_500_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("模型目录保留逐模型思考能力和默认档位", () => {
  const models = __testing.modelsFromConfig({
    agents: [{ name: "cli", models: ["reasoning", "plain"] }],
    models: [
      { id: "reasoning", name: "Reasoning", maxInputTokens: 1000, maxOutputTokens: 100, supportsReasoning: true, onlyReasoning: true, reasoning: { effort: "high" } },
      { id: "plain", name: "Plain", maxInputTokens: 1000, maxOutputTokens: 100, supportsReasoning: false },
    ],
  });

  const configured = models.filter((model) => model.id === "reasoning" || model.id === "plain");
  assert.deepEqual(configured.map((model) => model.id), ["reasoning", "plain"]);
  assert.equal(configured[0].reasoning, true);
  assert.equal(configured[0].thinkingLevelMap.off, null);
  assert.equal(configured[0].thinkingLevelMap.xhigh, undefined);
  assert.equal(configured[0].defaultReasoningEffort, "high");
  assert.equal(configured[1].reasoning, false);
});

test("WorkBuddy 固定模型推理策略，不向 DSH 暴露可选档位", () => {
  const info = __testing.withoutReasoningControl({
    provider: "workbuddy-cn",
    id: "hy4",
    reasoning: { efforts: [{ id: "high", name: "High" }], defaultEffort: "high" },
  });
  assert.deepEqual(info, { provider: "workbuddy-cn", id: "hy4" });
});

test("自定义模型可覆盖自己的思考档位", () => {
  const [model] = __testing.selectWorkBuddyModels([], [{
    id: "custom",
    contextWindow: 1000,
    maxTokens: 100,
    reasoningEfforts: { off: null, medium: "balanced" },
  }]);

  assert.equal(model.reasoning, true);
  assert.equal(Object.hasOwn(model.thinkingLevelMap, "off"), false);
  assert.equal(model.thinkingLevelMap.medium, "balanced");
  assert.equal(model.thinkingLevelMap.high, null);
});

test("积分查询复用 WorkBuddy billing 接口并汇总有效资源", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (String(url).includes("get-user-resource")) {
      return new Response(JSON.stringify({ code: 0, data: { Response: { Data: { Accounts: [
        { CycleCapacityRemainPrecise: 12.5, CapacityRemainPrecise: 100, PackageName: "月度包" },
        { CapacityRemain: 7 },
      ] } } } }), { status: 200 });
    }
    return new Response(JSON.stringify({ code: 0, data: { total: 2, data: [
      { requestId: "r1", requestTime: Date.now(), credit: 1.25 },
      { requestId: "r2", requestTime: Date.now() - 1000, credit: 2.75 },
    ] } }), { status: 200 });
  };
  try {
    const result = await fetchWorkBuddyCredits({ auth: { accessToken: "token" }, account: { userId: "user" } });
    assert.equal(result.credits, 19.5);
    assert.equal(result.todayUsage.count, 2);
    assert.equal(result.todayUsage.used, 4);
    assert.equal(result.creditError, null);
    assert.equal(requests[0].url, "https://www.codebuddy.cn/v2/billing/meter/get-user-resource");
    assert.equal(requests[0].options.headers.authorization, "Bearer token");
    assert.equal(requests[1].url, "https://www.codebuddy.cn/billing/meter/get-user-request-usage");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("企业积分响应支持不限量和周期重置时间", () => {
  const result = creditsTesting.enterpriseUsage({ data: { limitNum: -1, cycleResetTime: "2026-09-01 00:00:00" } });
  assert.equal(result.unlimited, true);
  assert.equal(result.credits, null);
  assert.ok(Number.isFinite(result.cycleResetTime));
});

test("积分查询只接受受信任的 WorkBuddy billing 域名", () => {
  assert.equal(creditsTesting.normalizeHost("https://www.codebuddy.cn"), "https://www.codebuddy.cn");
  assert.equal(creditsTesting.normalizeHost("https://evil.example"), "https://www.codebuddy.cn");
  assert.deepEqual(creditsTesting.buildCreditResourceBody(new Date(2026, 7, 31, 9, 8, 7)), {
    PageNumber: 1,
    PageSize: 100,
    ProductCode: "p_tcaca",
    Status: [0, 3],
    PackageEndTimeRangeBegin: "2026-08-31 09:08:07",
    PackageEndTimeRangeEnd: "2127-08-31 09:08:07",
  });
});
