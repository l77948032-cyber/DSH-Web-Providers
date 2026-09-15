const DOUBAO_DOMAIN_PATTERN = /(^|\.)doubao\.com$/i;
const AUTH_COOKIE_NAMES = new Set(["sessionid", "sessionid_ss", "sid_guard"]);

export const DOUBAO_PROVIDER = "doubao-web";
export const DOUBAO_SESSION_REF = "DOUBAO_WEB_LOGIN_SESSION";
export const DOUBAO_ORIGIN = "https://www.doubao.com";
export const DOUBAO_CHAT_URL = `${DOUBAO_ORIGIN}/chat/`;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validCookie(cookie) {
  return isRecord(cookie)
    && typeof cookie.name === "string"
    && typeof cookie.value === "string"
    && typeof cookie.domain === "string"
    && DOUBAO_DOMAIN_PATTERN.test(cookie.domain.replace(/^\./, ""));
}

export function hasDoubaoLoginCookies(cookies, nowSeconds = Date.now() / 1000) {
  return Array.isArray(cookies) && cookies.some((cookie) =>
    validCookie(cookie)
      && AUTH_COOKIE_NAMES.has(cookie.name)
      && cookie.value.length > 0
      && (!Number.isFinite(cookie.expires) || cookie.expires <= 0 || cookie.expires > nowSeconds),
  );
}

export function createDoubaoSession(storageState, details = {}) {
  const cookies = Array.isArray(storageState?.cookies) ? storageState.cookies.filter(validCookie) : [];
  if (!hasDoubaoLoginCookies(cookies)) throw new Error("没有检测到有效的豆包网页登录状态");
  const origins = Array.isArray(storageState?.origins)
    ? storageState.origins.filter((entry) => entry?.origin === DOUBAO_ORIGIN)
    : [];
  const params = Object.fromEntries(Object.entries(details.params ?? {})
    .filter(([, value]) => typeof value === "string" && value.length > 0));
  return {
    version: 1,
    kind: "doubao-web",
    createdAt: Number.isFinite(details.createdAt) ? details.createdAt : Date.now(),
    updatedAt: Number.isFinite(details.updatedAt) ? details.updatedAt : Date.now(),
    userAgent: typeof details.userAgent === "string" ? details.userAgent : undefined,
    params,
    storageState: { cookies, origins },
  };
}

export function parseDoubaoSession(value) {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      throw new Error("豆包网页登录凭据不是有效 JSON", { cause: error });
    }
  }
  if (!isRecord(parsed) || parsed.version !== 1 || parsed.kind !== "doubao-web") {
    throw new Error("不支持的豆包网页登录凭据格式");
  }
  return createDoubaoSession(parsed.storageState, parsed);
}

export function serializeDoubaoSession(session) {
  return JSON.stringify(parseDoubaoSession(session));
}

export function doubaoCookieHeader(cookies, nowSeconds = Date.now() / 1000) {
  if (!Array.isArray(cookies)) return "";
  return cookies
    .filter((cookie) => validCookie(cookie)
      && (!Number.isFinite(cookie.expires) || cookie.expires <= 0 || cookie.expires > nowSeconds))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export function cookieValue(cookies, name) {
  return Array.isArray(cookies) ? cookies.find((cookie) => cookie?.name === name)?.value : undefined;
}
