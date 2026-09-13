#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseDocument } from "yaml";
import {
  createWorkBuddySessionStore,
  loginWorkBuddy,
  parseWorkBuddySession,
  parseWorkBuddySessions,
  serializeWorkBuddySession,
  serializeWorkBuddySessions,
  upsertWorkBuddySession,
} from "./workbuddy-auth.js";
import { WORKBUDDY_CN, WORKBUDDY_REGIONS, workBuddyRegion } from "./workbuddy-regions.js";

const PACKAGE = "@l77948032-cyber/dsh-workbuddy";
const LEGACY_PACKAGES = ["@axiaohungry/dsh-llm-workbuddy", "dsh-llm-workbuddy", "dsh-llm-codebuddy"];
const PACKAGE_VERSION = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
const PACKAGE_SPEC = process.env.DSH_WORKBUDDY_PACKAGE_SPEC || `github:l77948032-cyber/DSH-Workbuddy#v${PACKAGE_VERSION}`;
const SETTINGS_NS = "llm-workbuddy";
const PROVIDER_PATH = [SETTINGS_NS, "providers", WORKBUDDY_CN.provider];
const LEGACY_PROVIDER_PATH = [SETTINGS_NS, "providers", WORKBUDDY_CN.aliases[0]];
const IGNORED_BUILDS = ["@google/genai", "protobufjs"];
const PROFILES = new Set(["desktop", "web", "headless"]);
const require = createRequire(import.meta.url);

function dshHome() {
  return resolve(process.env.DSH_HOME || join(homedir(), ".dsh"));
}

function profileHasPackage(home, profile, packageName) {
  const file = join(home, "profiles", profile, "package.json");
  if (!existsSync(file)) return false;
  const json = JSON.parse(readFileSync(file, "utf8"));
  return Boolean(json.dependencies?.[packageName] || json.devDependencies?.[packageName]);
}

function profileHasPlugin(home, profile) {
  return profileHasPackage(home, profile, PACKAGE);
}

function dshEnv() {
  const pnpmPackageDir = dirname(require.resolve("pnpm"));
  const pnpmBinDir = join(dirname(pnpmPackageDir), ".bin");
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") || "PATH";
  return {
    ...process.env,
    [pathKey]: `${pnpmBinDir}${delimiter}${process.env[pathKey] || ""}`,
    npm_config_ignore_workspace_root_check: "true",
  };
}

function desktopDsh() {
  if (process.platform !== "darwin") return undefined;
  const candidates = [
    process.env.DSH_DESKTOP_APP,
    "/Applications/DSH Desktop.app",
    join(homedir(), "Applications", "DSH Desktop.app"),
  ].filter(Boolean);
  for (const app of candidates) {
    const command = join(app, "Contents", "MacOS", "DSH Desktop");
    const archive = join(app, "Contents", "Resources", "app.asar");
    if (existsSync(command) && existsSync(archive)) {
      return { command, prefix: [join(archive, "lib", "desktop-cli.js")] };
    }
  }
  return undefined;
}

function commandOnPath(command) {
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") || "PATH";
  return (process.env[pathKey] || "").split(delimiter).map((entry) => join(entry, command)).find(existsSync);
}

function dshInvocation(args) {
  const desktop = desktopDsh();
  const wantsDesktop = args.some((value, index) => value === "--profile" && args[index + 1] === "desktop");
  if (wantsDesktop && desktop) return { ...desktop, desktop: true };
  const command = commandOnPath(process.platform === "win32" ? "dsh.cmd" : "dsh");
  if (command) return { command, prefix: [] };
  if (desktop) return { ...desktop, desktop: true };
  return { command: process.platform === "win32" ? "dsh.cmd" : "dsh", prefix: [] };
}

function runDsh(args) {
  const invocation = dshInvocation(args);
  const env = dshEnv();
  if (invocation.desktop) env.ELECTRON_RUN_AS_NODE = "1";
  const result = spawnSync(invocation.command, [...invocation.prefix, ...args], {
    stdio: "inherit",
    shell: process.platform === "win32" && invocation.prefix.length === 0,
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`dsh ${args.join(" ")} 执行失败（退出码 ${result.status}）`);
}

function selectedProfiles(args = []) {
  const profiles = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--profile" || !args[index + 1]) throw new Error(`未知参数：${args[index]}`);
    const profile = args[index + 1];
    if (!PROFILES.has(profile)) throw new Error(`不支持的 Profile：${profile}`);
    profiles.push(profile);
    index += 1;
  }
  if (profiles.length) return [...new Set(profiles)];
  return desktopDsh() ? ["desktop"] : ["web", "headless"];
}

function selectedRegion(args = []) {
  if (args.length === 0) return WORKBUDDY_CN;
  if (args.length !== 2 || args[0] !== "--region") throw new Error(`未知参数：${args.join(" ")}`);
  const region = workBuddyRegion(args[1], null);
  if (!region) throw new Error(`不支持的区域：${args[1]}`);
  return region;
}

function writeYamlDocument(file, document, mode) {
  const existingMode = existsSync(file) ? statSync(file).mode & 0o777 : undefined;
  const targetMode = mode ?? existingMode ?? 0o600;
  const temporary = join(dirname(file), `.workbuddy-${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(temporary, String(document), { encoding: "utf8", flag: "wx", mode: targetMode });
  chmodSync(temporary, targetMode);
  renameSync(temporary, file);
}

function withPnpmBuildPolicy(file, action) {
  const document = parseDocument(readFileSync(file, "utf8"));
  if (document.errors.length) throw new Error(`无法解析 ${file}：${document.errors[0].message}`);
  const changes = [];
  for (const packageName of IGNORED_BUILDS) {
    const path = ["allowBuilds", packageName];
    if (typeof document.getIn(path) !== "boolean") {
      changes.push({ packageName, existed: document.hasIn(path), value: document.getIn(path) });
      document.setIn(path, false);
    }
  }
  if (changes.length) writeYamlDocument(file, document);
  try {
    return action();
  } finally {
    if (changes.length) {
      const current = parseDocument(readFileSync(file, "utf8"));
      for (const change of changes) {
        const path = ["allowBuilds", change.packageName];
        if (change.existed) current.setIn(path, change.value);
        else current.deleteIn(path);
      }
      if (current.getIn(["allowBuilds"])?.items?.length === 0) current.deleteIn(["allowBuilds"]);
      writeYamlDocument(file, current);
    }
  }
}

function cleanPnpmWorkspace(file) {
  if (!existsSync(file)) return;
  const document = parseDocument(readFileSync(file, "utf8"));
  if (document.errors.length) throw new Error(`无法解析 ${file}：${document.errors[0].message}`);
  const entries = document.getIn(["minimumReleaseAgeExclude"])?.items;
  if (!entries) return;
  const packageNames = [PACKAGE, ...LEGACY_PACKAGES];
  const remaining = entries.map((entry) => entry.value).filter((entry) => !packageNames.some((packageName) => String(entry).startsWith(`${packageName}@`)));
  if (remaining.length === entries.length) return;
  if (remaining.length) document.setIn(["minimumReleaseAgeExclude"], remaining);
  else document.deleteIn(["minimumReleaseAgeExclude"]);
  writeYamlDocument(file, document);
}

function cleanSettings(file) {
  if (!existsSync(file)) return undefined;
  const source = readFileSync(file, "utf8");
  const document = parseDocument(source);
  if (document.errors.length) throw new Error(`无法解析 ${file}：${document.errors[0].message}`);
  const paths = WORKBUDDY_REGIONS.flatMap((region) => [region.provider, ...region.aliases])
    .map((provider) => [SETTINGS_NS, "providers", provider])
    .filter((path) => document.hasIn(path));
  if (paths.length === 0) return undefined;

  for (const path of paths) document.deleteIn(path);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${file}.workbuddy-backup-${stamp}`;
  copyFileSync(file, backup);
  writeYamlDocument(file, document);
  return backup;
}

function enableTokenLogin(home = dshHome(), regionValue = WORKBUDDY_CN) {
  const region = workBuddyRegion(regionValue);
  const file = join(home, "settings.yaml");
  const source = existsSync(file) ? readFileSync(file, "utf8") : "{}\n";
  const document = parseDocument(source);
  if (document.errors.length) throw new Error(`无法解析 ${file}：${document.errors[0].message}`);
  const providerPath = [SETTINGS_NS, "providers", region.provider];
  const legacyPath = region.aliases.map((provider) => [SETTINGS_NS, "providers", provider]).find((path) => document.hasIn(path));
  if (document.hasIn(providerPath)) document.deleteIn([...providerPath, "apiKeyEnv"]);
  else if (legacyPath) {
    const legacy = document.getIn(legacyPath);
    const value = legacy && typeof legacy.toJSON === "function" ? legacy.toJSON() : legacy;
    document.setIn(providerPath, document.createNode(value && typeof value === "object" ? value : {}));
    document.deleteIn([...providerPath, "apiKeyEnv"]);
    document.deleteIn(legacyPath);
  }
  else document.setIn(providerPath, {});
  if (existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(file, `${file}.workbuddy-backup-${stamp}`);
  }
  writeYamlDocument(file, document);
}

function storeLoginSession(session, home = dshHome(), regionValue = WORKBUDDY_CN) {
  const region = workBuddyRegion(regionValue);
  const file = join(home, ".credentials.yaml");
  const document = parseDocument(existsSync(file) ? readFileSync(file, "utf8") : "{}\n");
  if (document.errors.length) throw new Error(`无法解析 ${file}：${document.errors[0].message}`);
  const stored = [region.sessionsRef, ...region.legacySessionsRefs, region.sessionRef, ...region.legacySessionRefs]
    .map((ref) => document.get(ref))
    .find((value) => value !== undefined);
  const current = stored ? parseWorkBuddySessions(stored) : createWorkBuddySessionStore();
  const next = upsertWorkBuddySession(current, session);
  document.set(region.sessionsRef, serializeWorkBuddySessions(next));
  document.set(region.sessionRef, serializeWorkBuddySession(next.sessions.find((entry) => entry.id === next.activeId)));
  for (const ref of [...region.legacySessionsRefs, ...region.legacySessionRefs]) document.delete(ref);
  if (existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = `${file}.workbuddy-backup-${stamp}`;
    copyFileSync(file, backup);
    chmodSync(backup, 0o600);
  }
  writeYamlDocument(file, document, 0o600);
}

async function login(args = []) {
  const region = selectedRegion(args);
  console.log(`正在打开${region.siteName}网页登录（无需安装 WorkBuddy CLI）……`);
  const session = await loginWorkBuddy((url, opened) => {
    if (opened) console.log("浏览器登录页已打开，请在浏览器中完成登录。");
    else console.log(`无法自动打开浏览器，请手动访问：${url}`);
  }, undefined, region);
  storeLoginSession(session, dshHome(), region);
  enableTokenLogin(dshHome(), region);
  console.log(`${region.displayName}令牌登录成功，Provider 已切换为令牌模式。请重启 DSH。`);
}

function install(args) {
  for (const profile of selectedProfiles(args)) {
    runDsh(["plugin", "--profile", profile, "list", "--depth", "0"]);
    const workspace = join(dshHome(), "profiles", profile, "pnpm-workspace.yaml");
    withPnpmBuildPolicy(workspace, () => {
      for (const legacyPackage of LEGACY_PACKAGES) {
        if (profileHasPackage(dshHome(), profile, legacyPackage)) {
          runDsh(["plugin", "--profile", profile, "remove", legacyPackage]);
        }
      }
      runDsh(["plugin", "--profile", profile, "add", PACKAGE_SPEC]);
    });
  }
  console.log("WorkBuddy Provider 已安装。请重启 DSH 后进行配置。");
}

function uninstall(home = dshHome(), args = []) {
  const backup = cleanSettings(join(home, "settings.yaml"));
  for (const profile of selectedProfiles(args)) {
    const workspace = join(home, "profiles", profile, "pnpm-workspace.yaml");
    const installedPackages = [PACKAGE, ...LEGACY_PACKAGES].filter((packageName) => profileHasPackage(home, profile, packageName));
    if (installedPackages.length) {
      withPnpmBuildPolicy(workspace, () => {
        for (const packageName of installedPackages) {
          runDsh(["plugin", "--profile", profile, "remove", packageName]);
        }
      });
    }
    cleanPnpmWorkspace(workspace);
  }
  console.log(backup ? `WorkBuddy 配置已清理，备份：${backup}` : "未发现 WorkBuddy Provider 配置。");
  console.log("插件已卸载，API Key 和登录令牌凭据保持不变。请重启 DSH。");
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), "dsh-workbuddy-cli-"));
  try {
    const file = join(root, "settings.yaml");
    writeFileSync(file, "llm-pi-ai:\n  providers:\n    opencode-go:\n      apiKeyEnv: OPENCODE_GO_API_KEY\nllm-workbuddy:\n  providers:\n    codebuddy-cn:\n      apiKeyEnv: WORKBUDDY_CN_API_KEY\n      models:\n        - id: legacy-model\n", "utf8");
    enableTokenLogin(root);
    const tokenMode = parseDocument(readFileSync(file, "utf8"));
    if (tokenMode.hasIn([...PROVIDER_PATH, "apiKeyEnv"]) || !tokenMode.hasIn(PROVIDER_PATH) || tokenMode.hasIn(LEGACY_PROVIDER_PATH) || !tokenMode.hasIn([...PROVIDER_PATH, "models", 0, "id"])) {
      throw new Error("token login settings self-test failed");
    }
    const backup = cleanSettings(file);
    const result = parseDocument(readFileSync(file, "utf8"));
    if (!backup || !existsSync(backup) || result.hasIn(PROVIDER_PATH) || !result.hasIn(["llm-pi-ai", "providers", "opencode-go"])) {
      throw new Error("uninstall settings cleanup self-test failed");
    }
    enableTokenLogin(root);
    if (!parseDocument(readFileSync(file, "utf8")).hasIn(PROVIDER_PATH)) {
      throw new Error("token login provider creation self-test failed");
    }
    const sampleSession = {
      auth: { accessToken: "test-access-token", refreshToken: "test-refresh-token", expiresAt: Date.now() + 60_000 },
      account: { userId: "test-user" },
    };
    storeLoginSession(sampleSession, root);
    const storedSession = parseDocument(readFileSync(join(root, ".credentials.yaml"), "utf8")).get(WORKBUDDY_CN.sessionRef);
    if (parseWorkBuddySession(storedSession).account.userId !== "test-user") {
      throw new Error("token credential storage self-test failed");
    }
    const storedSessions = parseDocument(readFileSync(join(root, ".credentials.yaml"), "utf8")).get(WORKBUDDY_CN.sessionsRef);
    const sessionStore = parseWorkBuddySessions(storedSessions);
    if (sessionStore.sessions.length !== 1 || sessionStore.activeId !== sessionStore.sessions[0].id) {
      throw new Error("token account list self-test failed");
    }
    if ((statSync(join(root, ".credentials.yaml")).mode & 0o777) !== 0o600) {
      throw new Error("token credential file permissions self-test failed");
    }
    const workspace = join(root, "pnpm-workspace.yaml");
    writeFileSync(workspace, "packages:\n  - .\nallowBuilds:\n  '@google/genai': true\n  protobufjs: pending\n", "utf8");
    withPnpmBuildPolicy(workspace, () => {
      const active = parseDocument(readFileSync(workspace, "utf8"));
      if (active.getIn(["allowBuilds", "@google/genai"]) !== true || active.getIn(["allowBuilds", "protobufjs"]) !== false) {
        throw new Error("pnpm build policy activation self-test failed");
      }
    });
    const restored = parseDocument(readFileSync(workspace, "utf8"));
    if (restored.getIn(["allowBuilds", "@google/genai"]) !== true || restored.getIn(["allowBuilds", "protobufjs"]) !== "pending") {
      throw new Error("pnpm build policy self-test failed");
    }
    restored.setIn(["minimumReleaseAgeExclude"], ["other@1.0.0", `${PACKAGE}@1.3.1`]);
    writeYamlDocument(workspace, restored);
    cleanPnpmWorkspace(workspace);
    const cleaned = parseDocument(readFileSync(workspace, "utf8")).getIn(["minimumReleaseAgeExclude"])?.items?.map((entry) => entry.value);
    if (cleaned?.join(",") !== "other@1.0.0") throw new Error("pnpm workspace cleanup self-test failed");
    const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") || "PATH";
    if (!dshEnv()[pathKey].split(delimiter)[0].endsWith(join("node_modules", ".bin"))) {
      throw new Error("bundled pnpm PATH self-test failed");
    }
    if (selectedProfiles(["--profile", "web", "--profile", "web"]).join(",") !== "web") {
      throw new Error("profile selection self-test failed");
    }
    console.log("CLI-SELF-TEST-OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const command = process.argv[2];
const args = process.argv.slice(3);
if (command === "install") install(args);
else if (command === "uninstall") uninstall(dshHome(), args);
else if (command === "login") await login(args);
else if (command === "--self-test") selfTest();
else {
  console.log("用法：dsh-workbuddy install|uninstall [--profile desktop|web|headless]");
  console.log("      dsh-workbuddy login [--region cn|global]");
  process.exitCode = 1;
}
