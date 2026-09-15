import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { chromium } from "playwright-core";
import {
  DOUBAO_CHAT_URL,
  DOUBAO_ORIGIN,
  cookieValue,
  createDoubaoSession,
  doubaoCookieHeader,
  hasDoubaoLoginCookies,
  parseDoubaoSession,
  serializeDoubaoSession,
} from "./doubao-session.js";

const LOGIN_TIMEOUT_MS = 10 * 60_000;
const PAGE_TIMEOUT_MS = 60_000;
const PARAM_NAMES = ["device_id", "web_id", "tea_uuid", "fp", "pc_version", "version_code", "msToken"];
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

function executableOnPath(name) {
  return (process.env.PATH ?? "").split(delimiter).map((entry) => join(entry, name)).find(existsSync);
}

export function findChromeExecutable() {
  const candidates = [
    process.env.DSH_DOUBAO_CHROME,
    process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined,
    process.platform === "darwin" ? join(process.env.HOME ?? "", "Applications/Google Chrome.app/Contents/MacOS/Google Chrome") : undefined,
    process.platform === "win32" ? join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.platform === "win32" ? join(process.env["PROGRAMFILES(X86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe") : undefined,
    executableOnPath("google-chrome"),
    executableOnPath("google-chrome-stable"),
    executableOnPath("chromium"),
    executableOnPath("chromium-browser"),
  ].filter(Boolean);
  return candidates.find(existsSync);
}

function launchOptions(headless) {
  const executablePath = findChromeExecutable();
  if (!executablePath) {
    throw new Error("未找到 Google Chrome 或 Chromium；可通过 DSH_DOUBAO_CHROME 指定浏览器路径");
  }
  return {
    executablePath,
    headless,
    args: ["--disable-blink-features=AutomationControlled", "--no-default-browser-check"],
  };
}

async function discoverPageDetails(page, cookies) {
  const details = await page.evaluate((names) => {
    const params = {};
    const readUrl = (raw) => {
      try {
        const url = new URL(raw, location.href);
        for (const name of names) {
          const value = url.searchParams.get(name);
          if (value && !params[name]) params[name] = value;
        }
      } catch {
        // Ignore malformed performance entries.
      }
    };
    readUrl(location.href);
    for (const entry of performance.getEntriesByType("resource")) readUrl(entry.name);
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      const value = key ? localStorage.getItem(key) : undefined;
      if (!key || !value) continue;
      for (const name of names) {
        if (!params[name] && key.toLowerCase().replaceAll("-", "_").includes(name.toLowerCase())) params[name] = value;
      }
    }
    return { params, userAgent: navigator.userAgent };
  }, PARAM_NAMES);
  const cookieFallbacks = {
    web_id: cookieValue(cookies, "s_v_web_id") ?? cookieValue(cookies, "web_id"),
    tea_uuid: cookieValue(cookies, "tea_uuid"),
    device_id: cookieValue(cookies, "device_id"),
    msToken: cookieValue(cookies, "msToken"),
  };
  return {
    userAgent: details.userAgent,
    params: { ...cookieFallbacks, ...details.params },
  };
}

export async function loginDoubaoWeb(onStatus = () => {}, options = {}) {
  const browser = await chromium.launch(launchOptions(false));
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    onStatus("opened");
    await page.goto(DOUBAO_CHAT_URL, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });

    const deadline = Date.now() + (options.timeoutMs ?? LOGIN_TIMEOUT_MS);
    let cookies = [];
    while (Date.now() < deadline) {
      if (!browser.isConnected()) throw new Error("豆包登录窗口已关闭");
      cookies = await context.cookies(DOUBAO_ORIGIN);
      if (hasDoubaoLoginCookies(cookies)) break;
      await page.waitForTimeout(1000);
    }
    if (!hasDoubaoLoginCookies(cookies)) throw new Error("等待豆包网页登录超时，请重新运行登录命令");

    onStatus("detected");
    await page.reload({ waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS }).catch(() => undefined);
    await page.waitForTimeout(2500);
    cookies = await context.cookies(DOUBAO_ORIGIN);
    const details = await discoverPageDetails(page, cookies);
    const storageState = await context.storageState({ indexedDB: true });
    return createDoubaoSession(storageState, details);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

class DoubaoSignerRuntime {
  constructor(session, fingerprint) {
    this.session = session;
    this.fingerprint = fingerprint;
    this.browser = undefined;
    this.context = undefined;
    this.page = undefined;
    this.callbacks = new Map();
  }

  async initialize() {
    this.browser = await chromium.launch(launchOptions(true));
    this.browser.on("disconnected", () => {
      this.page = undefined;
      this.context = undefined;
      this.browser = undefined;
    });
    this.context = await this.browser.newContext({
      storageState: this.session.storageState,
      userAgent: this.session.userAgent || DEFAULT_USER_AGENT,
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    await this.page.exposeFunction("__dshDoubaoBridge", async (requestId, event) => {
      const callbacks = this.callbacks.get(requestId);
      if (!callbacks) return;
      if (event.type === "response") await callbacks.onResponse?.(event);
      if (event.type === "chunk") await callbacks.onChunk?.(event.value);
    });
    await this.page.goto(DOUBAO_CHAT_URL, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
    await this.page.locator("#flow-end-msg-send").waitFor({ state: "attached", timeout: PAGE_TIMEOUT_MS });
    const cookies = await this.context.cookies(DOUBAO_ORIGIN);
    if (!hasDoubaoLoginCookies(cookies)) throw new Error("豆包网页登录已失效，请重新登录");
    return this;
  }

  async streamRequest(body, callbacks, signal) {
    signal?.throwIfAborted?.();
    if (!this.page || !this.context || !this.browser?.isConnected()) throw new Error("豆包网页请求环境不可用");
    const requestId = randomUUID();
    this.callbacks.set(requestId, callbacks);
    const abort = () => void this.page?.evaluate((id) => globalThis.__dshDoubaoControllers?.get(id)?.abort(), requestId).catch(() => undefined);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const result = await this.page.evaluate(async ({ requestId: id, body: payload }) => {
        globalThis.__dshDoubaoControllers ??= new Map();
        const controller = new AbortController();
        globalThis.__dshDoubaoControllers.set(id, controller);
        try {
          const response = await fetch("/chat/completion", {
            method: "POST",
            headers: [["content-type", "application/json"], ["Agw-Js-Conv", "str"]],
            body: JSON.stringify(payload),
            credentials: "same-origin",
            signal: controller.signal,
          });
          await globalThis.__dshDoubaoBridge(id, {
            type: "response",
            status: response.status,
            headers: Object.fromEntries(response.headers),
          });
          if (!response.ok) return { status: response.status, detail: (await response.text()).slice(0, 300) };
          if (!response.body) return { status: response.status, detail: "empty response" };
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            if (chunk) await globalThis.__dshDoubaoBridge(id, { type: "chunk", value: chunk });
          }
          const tail = decoder.decode();
          if (tail) await globalThis.__dshDoubaoBridge(id, { type: "chunk", value: tail });
          return { status: response.status };
        } finally {
          globalThis.__dshDoubaoControllers.delete(id);
        }
      }, { requestId, body });
      if (result.status < 200 || result.status >= 300 || result.detail) {
        throw new Error(`豆包网页接口返回 HTTP ${result.status}${result.detail ? `：${result.detail}` : ""}`);
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      this.callbacks.delete(requestId);
    }
  }

  async close() {
    await this.browser?.close().catch(() => undefined);
  }
}

let activeRuntime;
let activeRuntimePromise;

function sessionFingerprint(session) {
  return createHash("sha256").update(serializeDoubaoSession(session)).digest("hex");
}

async function runtimeFor(rawSession) {
  const session = parseDoubaoSession(rawSession);
  const fingerprint = sessionFingerprint(session);
  if (activeRuntime?.fingerprint === fingerprint && activeRuntime.browser?.isConnected()) return activeRuntime;
  if (activeRuntimePromise?.fingerprint === fingerprint) return activeRuntimePromise.promise;
  await activeRuntime?.close();
  activeRuntime = undefined;
  const runtime = new DoubaoSignerRuntime(session, fingerprint);
  const promise = runtime.initialize().then((ready) => {
    activeRuntime = ready;
    return ready;
  }).catch(async (error) => {
    await runtime.close();
    throw error;
  }).finally(() => {
    activeRuntimePromise = undefined;
  });
  activeRuntimePromise = { fingerprint, promise };
  return promise;
}

export async function streamDoubaoWebRequest(rawSession, body, callbacks, signal) {
  let responseStarted = false;
  const guardedCallbacks = {
    ...callbacks,
    async onResponse(response) {
      responseStarted = true;
      await callbacks.onResponse?.(response);
    },
  };
  try {
    return await (await runtimeFor(rawSession)).streamRequest(body, guardedCallbacks, signal);
  } catch (error) {
    await activeRuntime?.close();
    activeRuntime = undefined;
    activeRuntimePromise = undefined;
    if (signal?.aborted || responseStarted) throw error;
    return (await runtimeFor(rawSession)).streamRequest(body, guardedCallbacks, signal);
  }
}

export async function deleteDoubaoConversation(rawSession, conversationId) {
  if (!conversationId || conversationId === "0") return false;
  try {
    const runtime = await runtimeFor(rawSession);
    const cookies = await runtime.context.cookies(DOUBAO_ORIGIN);
    const params = new URLSearchParams(Object.entries({
      version_code: runtime.session.params.version_code || "20800",
      language: "zh",
      device_platform: "web",
      aid: "497858",
      real_aid: "497858",
      pkg_type: "release_version",
      device_id: runtime.session.params.device_id || "",
      pc_version: runtime.session.params.pc_version || "3.22.1",
      web_id: runtime.session.params.web_id || "",
      tea_uuid: runtime.session.params.tea_uuid || "",
      region: "CN",
      sys_region: "CN",
      samantha_web: "1",
      web_platform: "browser",
      "use-olympus-account": "1",
      web_tab_id: randomUUID(),
    }).filter(([, value]) => value.length > 0));
    const response = await fetch(`${DOUBAO_ORIGIN}/im/conversation/batch_del_user_conv?${params}`, {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "agw-js-conv": "str",
        "content-type": "application/json; encoding=utf-8",
        cookie: doubaoCookieHeader(cookies),
        origin: DOUBAO_ORIGIN,
        referer: DOUBAO_CHAT_URL,
        "user-agent": runtime.session.userAgent || DEFAULT_USER_AGENT,
      },
      body: JSON.stringify({
        cmd: 4171,
        uplink_body: {
          batch_delete_user_conversation_uplink_body: {
            conversation_id: [conversationId],
            delete_all: false,
            conversation_type: 3,
          },
        },
        sequence_id: randomUUID(),
        channel: 2,
        version: "1",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.status_code === 0
      && payload?.downlink_body?.batch_delete_user_conversation_downlink_body?.result?.[conversationId] === true;
  } catch {
    return false;
  }
}

export async function closeDoubaoRuntime() {
  const runtime = activeRuntime;
  activeRuntime = undefined;
  activeRuntimePromise = undefined;
  await runtime?.close();
}
