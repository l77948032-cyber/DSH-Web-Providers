window.__ModuleLoader__.load({
  id: "@l77948032-cyber/dsh-workbuddy",
  factory: (require) => {
    const ROUTE = "/dsh-llm-workbuddy/auth";
    const MARKER = "data-workbuddy-auth-switch";
    const AUTH_STATE_EVENT = "dsh-llm-workbuddy:auth-state";
    const WORKBUDDY_PROVIDER_PATTERN = /(?:^|-)(?:work-?buddy|code-?buddy)(?:-|$)/;
    const React = require("react");
    const { createElement, useEffect, useRef, useState } = React;

    function isWorkBuddyProvider(value) {
      const normalized = String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      return normalized.length > 0 && WORKBUDDY_PROVIDER_PATTERN.test(normalized);
    }

    function button(text) {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = text;
      element.className = "dsh-wb-button";
      Object.assign(element.style, {
        minHeight: "36px",
        padding: "0 12px",
        border: "1px solid var(--dsw-border-subtle, #d0d5dd)",
        borderRadius: "6px",
        background: "var(--dsw-surface-subtle, transparent)",
        color: "inherit",
        cursor: "pointer",
        whiteSpace: "nowrap",
        boxSizing: "border-box",
        font: "inherit",
        fontSize: "13px",
        fontWeight: "500",
        transition: "background-color 120ms ease, border-color 120ms ease, opacity 120ms ease",
      });
      return element;
    }

    function accountPicker() {
      const element = document.createElement("select");
      element.className = "dsh-wb-select";
      element.setAttribute("aria-label", "WorkBuddy 令牌账号");
      Object.assign(element.style, {
        minHeight: "36px",
        minWidth: "180px",
        maxWidth: "260px",
        flex: "1 1 220px",
        boxSizing: "border-box",
        padding: "0 10px",
        border: "1px solid var(--dsw-border-subtle, #d0d5dd)",
        borderRadius: "6px",
        background: "var(--dsw-surface-subtle, transparent)",
        color: "inherit",
        font: "inherit",
        fontSize: "13px",
      });
      return element;
    }

    function textInput(type, placeholder, ariaLabel) {
      const element = document.createElement("input");
      element.className = "dsh-wb-input";
      element.type = type;
      element.placeholder = placeholder;
      element.setAttribute("aria-label", ariaLabel);
      element.autocomplete = type === "password" ? "new-password" : "off";
      Object.assign(element.style, {
        minHeight: "36px",
        minWidth: "0",
        flex: "1 1 200px",
        boxSizing: "border-box",
        padding: "0 12px",
        border: "1px solid var(--dsw-border-subtle, #d0d5dd)",
        borderRadius: "6px",
        background: "var(--dsw-surface-subtle, transparent)",
        color: "inherit",
        font: "inherit",
        fontSize: "13px",
      });
      return element;
    }

    function fieldLabel(text) {
      const element = document.createElement("span");
      element.className = "dsh-wb-label";
      element.textContent = text;
      Object.assign(element.style, {
        flex: "0 0 auto",
        minWidth: "92px",
        fontSize: "13px",
        lineHeight: "20px",
        color: "var(--dsw-text-secondary, #667085)",
      });
      return element;
    }

    function row() {
      const element = document.createElement("div");
      element.className = "dsh-wb-row";
      Object.assign(element.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
        width: "100%",
      });
      return element;
    }

    function section() {
      const element = document.createElement("div");
      element.className = "dsh-wb-section";
      Object.assign(element.style, {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        width: "100%",
        boxSizing: "border-box",
        padding: "12px 0 0",
        borderTop: "1px solid var(--dsw-border-subtle, #d0d5dd)",
        background: "transparent",
      });
      return element;
    }

    function setVisible(element, visible, display = "flex") {
      element.hidden = !visible;
      element.style.setProperty("display", visible ? display : "none", "important");
    }

    function isWorkBuddy(input) {
      const editor = input.parentElement?.parentElement;
      if (!editor) return false;
      if (isWorkBuddyProvider(editor.textContent)) return true;
      const provider = editor.parentElement?.querySelector('select[aria-label="提供方"]')?.value;
      return isWorkBuddyProvider(provider);
    }

    function accountText(account) {
      const label = account?.accountName || account?.label || account?.account?.displayName || account?.account?.email || account?.account?.userId || "未命名账号";
      const userId = account?.userId || account?.account?.userId;
      return userId && userId !== label ? `${label} · ${String(userId).slice(0, 8)}` : label;
    }

    function accountLabel(account) {
      return account?.accountName || account?.label || account?.account?.displayName || account?.account?.email || account?.account?.userId || "未命名账号";
    }

    function apiKeyText(key) {
      const label = key?.label || (key?.kind === "environment" ? `环境变量 ${key.ref}` : "DSH 保存的 API Key");
      const suffix = key?.masked ? ` · ${key.masked}` : "";
      return key?.configured === false ? `${label}（不可用）` : `${label}${suffix}`;
    }

    function apiKeyLabel(key) {
      return key?.label || (key?.kind === "environment" ? `环境变量 ${key.ref}` : "DSH 保存的 API Key");
    }

    function formatCredits(value) {
      const number = Number(value);
      return Number.isFinite(number) ? number.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "—";
    }

    async function authRequest(path, body) {
      const options = {
        method: body === undefined ? "GET" : "POST",
        cache: "no-store",
      };
      if (body !== undefined) {
        options.headers = { "content-type": "application/json" };
        options.body = JSON.stringify(body);
      }
      const response = await fetch(`${ROUTE}/${path}`, options);
      const text = await response.text();
      let result = {};
      try {
        result = text ? JSON.parse(text) : {};
      } catch {
        result = {};
      }
      if (!response.ok || result.ok === false) {
        const error = new Error(result.message || `请求失败（${response.status}）`);
        error.status = response.status;
        throw error;
      }
      return result;
    }

    function notifyAuthState() {
      if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_STATE_EVENT));
    }

    function selectedProvider(selection) {
      return selection?.next?.provider ?? selection?.lastUsed?.provider ?? selection?.provider;
    }

    function WorkBuddyCreditsDock({ useProjection }) {
      let selection;
      try {
        selection = typeof useProjection === "function" ? useProjection("modelSelection") : undefined;
      } catch {
        selection = undefined;
      }
      const provider = selectedProvider(selection);
      const selected = isWorkBuddyProvider(provider);
      const [state, setState] = useState(null);

      useEffect(() => {
        let disposed = false;
        let requestId = 0;
        const load = async () => {
          const currentRequestId = ++requestId;
          if (!selected) {
            setState(null);
            return;
          }
          setState({ mode: "token", creditLoading: true, credits: undefined, todayUsage: null, creditError: null, todayUsageError: null });
          let status;
          try {
            status = await authRequest("status");
          } catch {
            if (!disposed && currentRequestId === requestId) setState(null);
            return;
          }
          if (disposed || currentRequestId !== requestId) return;
          if (status.mode !== "token" || !status.activeAccountId) {
            setState({ ...status, creditLoading: false });
            return;
          }
          try {
            const result = await authRequest("credits", { accountId: status.activeAccountId });
            if (!disposed && currentRequestId === requestId) setState({ ...status, ...result, creditLoading: false });
          } catch (error) {
            if (!disposed && currentRequestId === requestId) {
              const message = error instanceof Error ? error.message : "查询 WorkBuddy 积分失败";
              setState({
                ...status,
                credits: null,
                creditLoading: false,
                creditError: message,
                todayUsage: null,
                todayUsageError: "查询 WorkBuddy 今日请求量失败",
              });
            }
          }
        };
        load();
        const onAuthState = () => load();
        window.addEventListener(AUTH_STATE_EVENT, onAuthState);
        const timer = window.setInterval(load, 60_000);
        return () => {
          disposed = true;
          window.removeEventListener(AUTH_STATE_EVENT, onAuthState);
          window.clearInterval(timer);
        };
      }, [provider, selected]);

      if (!selected || state?.mode !== "token" || !state?.activeAccountId) return null;
      const creditsText = state.creditLoading
        ? "剩余积分：读取中…"
        : state.unlimited
          ? "剩余积分：不限量"
          : typeof state.credits === "number" && Number.isFinite(state.credits)
            ? `剩余积分：${formatCredits(state.credits)}`
            : state.creditError
              ? "剩余积分：暂不可用"
              : "剩余积分：—";
      const activeAccount = Array.isArray(state.accounts) ? state.accounts.find((account) => account.id === state.activeAccountId) : undefined;
      return createElement(
        "div",
        {
          className: "dsh-workbuddy-credits",
          "data-workbuddy-credits": true,
          role: "status",
          "aria-live": "polite",
          title: [activeAccount ? `当前账号：${accountText(activeAccount)}` : "", state.creditError].filter(Boolean).join("；") || undefined,
          style: {
            boxSizing: "border-box",
            minWidth: 0,
            width: "100%",
            maxWidth: "100%",
            minHeight: "24px",
            padding: "4px 8px 0",
            display: "block",
            flex: "0 1 auto",
            color: "var(--dsw-alias-label-tertiary, #98a2b3)",
            fontSize: "var(--dsh-content-font-size-secondary, 13px)",
            lineHeight: "calc(20px + var(--dsh-content-font-delta-secondary, 0px))",
            fontVariantNumeric: "tabular-nums",
            textAlign: "right",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          },
        },
        creditsText,
      );
    }

    function installComposerDockLayout() {
      if (typeof document === "undefined" || document.querySelector('style[data-plugin-css="dsh-llm-workbuddy-composer-dock"]')) return;
      const style = document.createElement("style");
      style.dataset.plugin = "@l77948032-cyber/dsh-workbuddy";
      style.dataset.pluginCss = "dsh-llm-workbuddy-composer-dock";
      style.textContent = `
[data-slot="conversation.composer.dock"]:has(> [data-composer-stats]),
[data-slot="conversation.composer.dock"]:has(> [data-workbuddy-credits]) {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  min-height: 20px;
  padding: 0 4px 4px;
  overflow: hidden;
}
[data-slot="conversation.composer.dock"] > [data-composer-stats] {
  grid-column: 2;
  width: auto !important;
  max-width: 100%;
  min-width: 0;
  margin: 0 !important;
}
[data-slot="conversation.composer.dock"] > [data-workbuddy-credits] {
  grid-column: 3;
  justify-self: end;
  width: auto !important;
  max-width: 100%;
  min-width: 0;
  margin: 0 !important;
}
@media (max-width: 760px) {
  [data-slot="conversation.composer.dock"]:has(> [data-composer-stats]),
  [data-slot="conversation.composer.dock"]:has(> [data-workbuddy-credits]) {
    display: flex !important;
    flex-wrap: wrap;
    justify-content: center;
  }
  [data-slot="conversation.composer.dock"] > [data-composer-stats],
  [data-slot="conversation.composer.dock"] > [data-workbuddy-credits] {
    flex: 0 1 auto;
  }
}
`;
      document.head.appendChild(style);
    }

    function installInterfaceStyles() {
      if (typeof document === "undefined" || document.querySelector('style[data-plugin-css="dsh-llm-workbuddy-interface"]')) return;
      const style = document.createElement("style");
      style.dataset.plugin = "@l77948032-cyber/dsh-workbuddy";
      style.dataset.pluginCss = "dsh-llm-workbuddy-interface";
      style.textContent = `
.dsh-wb-auth {
  box-sizing: border-box;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0 2px;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-wb-mode-tabs {
  width: fit-content !important;
  gap: 2px !important;
  padding: 3px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28));
  border-radius: 8px;
  background: var(--dsw-alias-bg-module-platform, rgba(127,127,127,.08));
}
.dsh-wb-mode-tabs > .dsh-wb-button {
  min-width: 104px;
  min-height: 34px !important;
  border: 0 !important;
  border-radius: 5px !important;
  color: var(--dsw-alias-label-secondary, inherit);
  background: transparent !important;
}
.dsh-wb-mode-tabs > .dsh-wb-button[aria-pressed="true"] {
  color: var(--dsw-alias-label-primary, inherit);
  background: var(--dsw-alias-interactive-bg-selected, rgba(255,255,255,.12)) !important;
  box-shadow: 0 1px 3px rgba(0,0,0,.18);
}
.dsh-wb-button:hover:not(:disabled), .dsh-wb-select:hover, .dsh-wb-input:hover {
  border-color: var(--dsw-alias-border-l3, rgba(127,127,127,.5)) !important;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.09)) !important;
}
.dsh-wb-button:focus-visible, .dsh-wb-select:focus-visible, .dsh-wb-input:focus-visible {
  outline: 2px solid var(--dsw-alias-border-l3, #6ea8fe);
  outline-offset: 1px;
}
.dsh-wb-button:disabled { opacity: .55; }
.dsh-wb-section {
  border: 0 !important;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18)) !important;
  border-radius: 0 !important;
  padding: 14px 0 0 !important;
  background: transparent !important;
}
.dsh-wb-auth-hint {
  color: var(--dsw-alias-label-tertiary, #98a2b3) !important;
  font-size: 12px !important;
  line-height: 18px !important;
}
.dsh-wb-account-state {
  flex: 0 0 auto !important;
  color: var(--dsw-alias-state-success-primary, #42b883) !important;
  font-size: 12px !important;
}
.dsh-wb-stats {
  display: grid !important;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 !important;
  padding: 10px 0;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18));
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18));
}
.dsh-wb-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 0 14px;
}
.dsh-wb-stat:first-child { padding-left: 0; border-right: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18)); }
.dsh-wb-stat-label { color: var(--dsw-alias-label-tertiary, #98a2b3); font-size: 11px; line-height: 16px; }
.dsh-wb-stat-value { color: var(--dsw-alias-label-primary, inherit); font-size: 15px; line-height: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
.dsh-wb-message { min-height: 18px; color: var(--dsw-alias-label-tertiary, #98a2b3); }
.dsh-wb-danger { color: var(--dsw-alias-state-error-primary, #ef5b5b) !important; border-color: transparent !important; background: transparent !important; }
.dsh-wb-model-menu { width: min(380px, calc(100vw - 32px)) !important; min-width: min(380px, calc(100vw - 32px)) !important; max-width: min(380px, calc(100vw - 32px)) !important; }
section[data-workbuddy-model-group] > button[role="menuitemradio"] { min-height: 42px; }
section[data-workbuddy-model-group] > button[role="menuitemradio"] > span:first-child {
  flex-direction: row !important;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.dsh-wb-model-badge {
  flex: none;
  max-width: 112px;
  padding: 1px 6px;
  border-radius: 5px;
  overflow: hidden;
  color: #ff5555;
  background: rgba(255,75,75,.13);
  font-size: 11px;
  font-weight: 500;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-wb-model-rate {
  flex: none;
  min-width: 54px;
  color: var(--dsw-alias-label-tertiary, #98a2b3);
  font-size: 13px;
  line-height: 20px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.dsh-wb-model-detail {
  box-sizing: border-box;
  position: fixed;
  z-index: 1101;
  width: min(286px, calc(100vw - 24px));
  padding: 14px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2));
  border-radius: 12px;
  background: var(--dsw-specific-menu, #25272a);
  box-shadow: var(--dsw-elevation-prominent, 0 14px 36px rgba(0,0,0,.34));
  color: var(--dsw-alias-label-primary, #f2f4f7);
}
.dsh-wb-model-detail[hidden] { display: none !important; }
.dsh-wb-detail-name { margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; }
.dsh-wb-detail-description { margin: 5px 0 0; color: var(--dsw-alias-label-secondary, #c3c7cf); font-size: 13px; line-height: 20px; }
.dsh-wb-detail-list { margin-top: 14px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); }
.dsh-wb-detail-row { display: flex; justify-content: space-between; gap: 20px; padding: 10px 0; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16)); font-size: 13px; line-height: 20px; }
.dsh-wb-detail-key { color: var(--dsw-alias-label-secondary, #c3c7cf); }
.dsh-wb-detail-value { text-align: right; font-variant-numeric: tabular-nums; }
.dsh-wb-detail-rate { color: var(--dsw-alias-state-info-primary, #48a8ff); }
.dsh-wb-detail-original { margin-right: 6px; color: var(--dsw-alias-label-tertiary, #98a2b3); text-decoration: line-through; }
.dsh-wb-promotion { margin-top: 13px; color: var(--dsw-alias-label-secondary, #c3c7cf); font-size: 12px; line-height: 19px; }
.dsh-wb-promotion-action { margin-top: 3px; padding: 0; border: 0; color: var(--dsw-alias-state-info-primary, #48a8ff); background: transparent; font: inherit; cursor: pointer; }
@media (max-width: 680px) {
  .dsh-wb-row { align-items: stretch !important; }
  .dsh-wb-label { width: 100%; min-width: 0 !important; }
  .dsh-wb-select, .dsh-wb-input { max-width: none !important; flex-basis: 100% !important; }
  .dsh-wb-model-menu { width: min(360px, calc(100vw - 24px)) !important; min-width: min(360px, calc(100vw - 24px)) !important; max-width: min(360px, calc(100vw - 24px)) !important; }
}
`;
      document.head.appendChild(style);
    }

    const MODEL_CATALOG_TTL_MS = 30_000;
    let modelCatalog = [];
    let modelCatalogByName = new Map();
    let modelCatalogFetchedAt = 0;
    let modelCatalogPromise;
    let detailPanel;
    let detailTimer;
    let activeModelButton;

    function normalizedModelName(value) {
      return String(value ?? "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    }

    async function loadModelCatalog(force = false) {
      if (!force && modelCatalogFetchedAt && Date.now() - modelCatalogFetchedAt < MODEL_CATALOG_TTL_MS) return modelCatalog;
      if (modelCatalogPromise) return modelCatalogPromise;
      modelCatalogFetchedAt = Date.now();
      modelCatalogPromise = authRequest("models", {}).then((result) => {
        modelCatalog = Array.isArray(result.models) ? result.models : [];
        modelCatalogByName = new Map();
        for (const model of modelCatalog) {
          for (const value of [model.id, model.name]) {
            const key = normalizedModelName(value);
            if (key && !modelCatalogByName.has(key)) modelCatalogByName.set(key, model);
          }
        }
        return modelCatalog;
      }).catch(() => modelCatalog).finally(() => {
        modelCatalogPromise = undefined;
      });
      return modelCatalogPromise;
    }

    function formatContextWindow(tokens) {
      const value = Number(tokens);
      if (!Number.isSafeInteger(value) || value <= 0) return undefined;
      if (value >= 1_000_000 && value % 1_000_000 === 0) return `${value / 1_000_000}M`;
      if (value >= 1_000 && value % 1_000 === 0) return `${value / 1_000}K`;
      return value.toLocaleString("zh-CN");
    }

    function detailRow(label, value, valueClass) {
      const row = document.createElement("div");
      row.className = "dsh-wb-detail-row";
      const key = document.createElement("span");
      key.className = "dsh-wb-detail-key";
      key.textContent = label;
      const content = document.createElement("span");
      content.className = `dsh-wb-detail-value${valueClass ? ` ${valueClass}` : ""}`;
      if (value instanceof Node) content.append(value);
      else content.textContent = value;
      row.append(key, content);
      return row;
    }

    function ensureDetailPanel() {
      if (detailPanel?.isConnected) return detailPanel;
      detailPanel = document.createElement("aside");
      detailPanel.id = "dsh-workbuddy-model-detail";
      detailPanel.className = "dsh-wb-model-detail";
      detailPanel.hidden = true;
      detailPanel.addEventListener("pointerenter", () => clearTimeout(detailTimer));
      detailPanel.addEventListener("pointerleave", () => hideModelDetailSoon());
      document.body.append(detailPanel);
      return detailPanel;
    }

    function placeDetailPanel(panel, button) {
      const rect = button.getBoundingClientRect();
      const width = panel.offsetWidth || 286;
      const height = panel.offsetHeight || 260;
      const gap = 8;
      let left = rect.left - width - gap;
      if (left < 12) left = Math.min(window.innerWidth - width - 12, rect.right + gap);
      const top = Math.min(Math.max(12, rect.top - 8), Math.max(12, window.innerHeight - height - 12));
      panel.style.left = `${Math.max(12, left)}px`;
      panel.style.top = `${top}px`;
    }

    function showModelDetail(button, model) {
      clearTimeout(detailTimer);
      activeModelButton = button;
      const panel = ensureDetailPanel();
      const name = document.createElement("h3");
      name.className = "dsh-wb-detail-name";
      name.textContent = model.name || model.id;
      const description = document.createElement("p");
      description.className = "dsh-wb-detail-description";
      description.textContent = model.description || "WorkBuddy 模型";
      const list = document.createElement("div");
      list.className = "dsh-wb-detail-list";
      if (model.rate) {
        const rate = document.createElement("span");
        if (model.originalRate) {
          const original = document.createElement("span");
          original.className = "dsh-wb-detail-original";
          original.textContent = model.originalRate;
          rate.append(original);
        }
        rate.append(`${model.rate} 倍率`);
        list.append(detailRow("消耗速度", rate, "dsh-wb-detail-rate"));
      }
      if (model.supportsReasoning) list.append(detailRow("思考强度", model.reasoningEffort || "支持"));
      const context = formatContextWindow(model.contextWindow);
      if (context) list.append(detailRow("上下文窗口", context));
      panel.replaceChildren(name, description, list);
      if (model.promotionText) {
        const promotion = document.createElement("div");
        promotion.className = "dsh-wb-promotion";
        const text = document.createElement("div");
        text.textContent = model.promotionText;
        promotion.append(text);
        if (model.promotionAction) {
          const action = document.createElement("button");
          action.type = "button";
          action.className = "dsh-wb-promotion-action";
          action.textContent = model.promotionAction;
          action.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            activeModelButton?.click();
          });
          promotion.append(action);
        }
        panel.append(promotion);
      }
      panel.hidden = false;
      button.setAttribute("aria-describedby", panel.id);
      requestAnimationFrame(() => placeDetailPanel(panel, button));
    }

    function hideModelDetailSoon(delay = 180) {
      clearTimeout(detailTimer);
      detailTimer = setTimeout(() => {
        if (activeModelButton) activeModelButton.removeAttribute("aria-describedby");
        activeModelButton = undefined;
        if (detailPanel) detailPanel.hidden = true;
      }, delay);
    }

    function modelForButton(button) {
      const pinned = modelCatalogByName.get(normalizedModelName(button.dataset.workbuddyModel));
      return pinned ?? modelCatalogByName.get(normalizedModelName(button.title || button.textContent));
    }

    function enhanceModelButton(button) {
      const model = modelForButton(button);
      if (!model) return;
      button.dataset.workbuddyModel = model.id;
      const copy = button.firstElementChild;
      const check = button.lastElementChild;
      if (copy && model.badge) {
        let badge = copy.querySelector(":scope > [data-workbuddy-model-badge]");
        if (!badge) {
          badge = document.createElement("span");
          badge.dataset.workbuddyModelBadge = "";
          badge.className = "dsh-wb-model-badge";
          copy.append(badge);
        }
        if (badge.textContent !== model.badge) badge.textContent = model.badge;
      }
      let rate = button.querySelector(":scope > [data-workbuddy-model-rate]");
      if (model.rate) {
        if (!rate) {
          rate = document.createElement("span");
          rate.dataset.workbuddyModelRate = "";
          rate.className = "dsh-wb-model-rate";
          button.insertBefore(rate, check);
        }
        if (rate.textContent !== model.rate) rate.textContent = model.rate;
      } else if (rate) rate.remove();
      if (button.dataset.workbuddyModelBound !== "true") {
        button.dataset.workbuddyModelBound = "true";
        button.addEventListener("pointerenter", () => {
          const current = modelForButton(button);
          if (current) showModelDetail(button, current);
        });
        button.addEventListener("pointerleave", () => hideModelDetailSoon());
        button.addEventListener("focus", () => {
          const current = modelForButton(button);
          if (current) showModelDetail(button, current);
        });
        button.addEventListener("blur", (event) => {
          if (!detailPanel?.contains(event.relatedTarget)) hideModelDetailSoon(0);
        });
      }
    }

    function enhanceModelMetadata() {
      let found = false;
      for (const section of document.querySelectorAll('section[role="group"][aria-labelledby]')) {
        const heading = document.getElementById(section.getAttribute("aria-labelledby"));
        if (heading?.textContent?.trim() !== "WorkBuddy 中国区") continue;
        found = true;
        section.dataset.workbuddyModelGroup = "";
        section.closest('[role="menu"]')?.classList.add("dsh-wb-model-menu");
        for (const button of section.querySelectorAll('button, [role="menuitemradio"], [role="menuitem"]')) {
          if (modelForButton(button)) enhanceModelButton(button);
        }
      }
      if (found && !modelCatalogPromise && (!modelCatalogFetchedAt || Date.now() - modelCatalogFetchedAt >= MODEL_CATALOG_TTL_MS)) {
        loadModelCatalog().then(enhanceModelMetadata);
      }
      if (!found && detailPanel && !detailPanel.hidden) hideModelDetailSoon(0);
    }

    function applyCreditStatus(stats, status, activeAccount) {
      const visible = status.mode === "token" && Boolean(activeAccount);
      setVisible(stats, visible);
      if (!visible) return;
      const credit = stats.querySelector('[data-workbuddy-stat="credits"]');
      const usage = stats.querySelector('[data-workbuddy-stat="usage"]');
      credit.title = status.creditError || "";
      usage.title = status.todayUsageError || "";
      const setStat = (element, label, value) => {
        const caption = document.createElement("span");
        caption.className = "dsh-wb-stat-label";
        caption.textContent = label;
        const content = document.createElement("strong");
        content.className = "dsh-wb-stat-value";
        content.textContent = value;
        element.replaceChildren(caption, content);
      };
      if (status.creditLoading) setStat(credit, "剩余积分", "读取中…");
      else if (status.unlimited) setStat(credit, "剩余积分", "不限量");
      else if (typeof status.credits === "number" && Number.isFinite(status.credits)) setStat(credit, "剩余积分", formatCredits(status.credits));
      else setStat(credit, "剩余积分", status.creditError ? "暂不可用" : "—");
      const today = status.todayUsage;
      if (today && today.synced === true) {
        setStat(usage, "今日用量", `${Number.isFinite(Number(today.count)) ? Number(today.count) : 0} 次 · ${formatCredits(today.used)} 积分`);
      } else {
        setStat(usage, "今日用量", status.creditLoading ? "读取中…" : status.todayUsageError ? "暂不可用" : "—");
      }
    }

    function applyMode(input, keyButton, tokenButton, keySection, keySourceRow, keySelect, keyHint, newKeyInput, newKeyLabelInput, saveKeyButton, removeKeyButton, tokenSection, tokenHint, accountRow, accountSelect, accountName, addButton, removeButton, accountStats, message, status) {
      const token = status.mode === "token";
      const apiKeys = Array.isArray(status.apiKeys) ? status.apiKeys : [];
      const activeApiKeyId = status.activeApiKeyId ?? apiKeys[0]?.id;
      const activeApiKey = apiKeys.find((key) => key.id === activeApiKeyId);
      const accounts = Array.isArray(status.accounts) ? status.accounts : [];
      const activeAccountId = status.activeAccountId ?? accounts[0]?.id;
      input.disabled = token;
      input.placeholder = token ? "当前使用 WorkBuddy 账号令牌" : "输入新的 API Key（保存到 DSH）";
      newKeyInput.disabled = token;
      newKeyLabelInput.disabled = token;
      keyButton.setAttribute("aria-pressed", String(!token));
      tokenButton.setAttribute("aria-pressed", String(token));
      setVisible(keySection, !token);
      setVisible(keySourceRow, apiKeys.length > 0);
      keySelect.replaceChildren(...apiKeys.map((key) => {
        const option = document.createElement("option");
        option.value = key.id;
        option.textContent = apiKeyText(key);
        option.title = apiKeyLabel(key);
        return option;
      }));
      if (activeApiKeyId) keySelect.value = activeApiKeyId;
      keyHint.textContent = token
        ? ""
        : activeApiKey ? `${status.apiKeyConfigured ? "当前来源" : "可选来源"}：${apiKeyText(activeApiKey)}` : "未检测到可用 API Key，可输入新 Key 保存";
      keyHint.title = activeApiKey ? apiKeyLabel(activeApiKey) : "";
      saveKeyButton.textContent = "添加并使用";
      removeKeyButton.hidden = !activeApiKey || activeApiKey.kind !== "dsh";
      setVisible(tokenSection, token);
      tokenButton.textContent = "网页登录";
      tokenHint.textContent = accounts.length
        ? "登录凭据由 DSH 安全保存，可在下方切换账号。"
        : "在浏览器中完成 WorkBuddy 登录，返回后即可直接使用。";
      addButton.textContent = accounts.length ? "添加账号" : "浏览器登录";
      setVisible(accountRow, token && accounts.length > 0);
      accountSelect.replaceChildren(...accounts.map((account) => {
        const option = document.createElement("option");
        option.value = account.id;
        option.textContent = accountText(account);
        option.title = accountLabel(account);
        return option;
      }));
      if (activeAccountId) accountSelect.value = activeAccountId;
      const activeAccount = accounts.find((account) => account.id === activeAccountId);
      accountName.textContent = activeAccount ? "已连接" : "";
      accountName.title = activeAccount ? accountLabel(activeAccount) : "";
      removeButton.hidden = !token || !activeAccount;
      setVisible(accountStats, token && Boolean(activeAccount));
      applyCreditStatus(accountStats, status, activeAccount);
      message.textContent = token
        ? status.authenticated ? "账号令牌已安全保存" : "尚未登录 WorkBuddy"
        : status.apiKeyConfigured ? "API Key 已配置" : "尚未配置 API Key";
      message.style.color = token
        ? status.authenticated ? "var(--dsw-text-success, #2e7d32)" : "var(--dsw-text-danger, #c62828)"
        : status.apiKeyConfigured ? "var(--dsw-text-success, #2e7d32)" : "var(--dsw-text-danger, #c62828)";
    }

    async function request(path, body) {
      const options = { method: "POST" };
      if (body !== undefined) {
        options.headers = { "content-type": "application/json" };
        options.body = JSON.stringify(body);
      }
      const response = await fetch(`${ROUTE}/${path}`, options);
      const result = await response.json();
      if (!response.ok || !result.ok) {
        const error = new Error(result.message || `请求失败（${response.status}）`);
        error.status = response.status;
        throw error;
      }
      return result;
    }

    function mount(input) {
      const field = input.parentElement;
      if (!field || field.querySelector(`[${MARKER}]`)) return;
      field.setAttribute("data-workbuddy-auth-field", "");
      input.dataset.workbuddyPlaceholder = input.placeholder;
      for (const nativeNode of field.children) nativeNode.hidden = true;
      Object.assign(field.style, { display: "block", width: "100%", boxSizing: "border-box" });
      const controls = document.createElement("div");
      controls.className = "dsh-wb-auth";
      controls.setAttribute(MARKER, "");
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", "WorkBuddy 认证方式");
      Object.assign(controls.style, {
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: "14px",
        width: "100%",
        maxWidth: "100%",
        paddingTop: "4px",
        boxSizing: "border-box",
        color: "var(--dsw-text-primary, inherit)",
      });
      const modeRow = row();
      modeRow.classList.add("dsh-wb-mode-tabs");
      const keySection = section();
      const keySourceRow = row();
      const keyAddRow = row();
      const tokenSection = section();
      const accountRow = row();
      const tokenActionRow = row();
      const keyButton = button("API Key");
      const tokenButton = button("令牌登录");
      const keySelect = accountPicker();
      keySelect.setAttribute("aria-label", "WorkBuddy API Key 来源");
      const keySourceLabel = fieldLabel("当前 API Key");
      const newKeyLabel = fieldLabel("新增 API Key");
      const newKeyInput = textInput("password", "粘贴新的 API Key", "新增 WorkBuddy API Key");
      const newKeyLabelInput = textInput("text", "名称（可选）", "API Key 名称");
      const keyHint = document.createElement("span");
      Object.assign(keyHint.style, {
        display: "block",
        width: "100%",
        minWidth: "0",
        overflowWrap: "anywhere",
        whiteSpace: "normal",
        fontSize: "12px",
        lineHeight: "18px",
        color: "var(--dsw-text-secondary, #667085)",
      });
      const saveKeyButton = button("添加并使用");
      const removeKeyButton = button("删除");
      removeKeyButton.classList.add("dsh-wb-danger");
      const accountSelect = accountPicker();
      const accountName = document.createElement("span");
      accountName.className = "dsh-wb-account-state";
      Object.assign(accountName.style, {
        flex: "1 1 220px",
        minWidth: "0",
        overflowWrap: "anywhere",
        whiteSpace: "normal",
        fontSize: "13px",
        color: "var(--dsw-text-secondary, #667085)",
      });
      const addButton = button("令牌登录");
      const removeButton = button("删除账号");
      removeButton.classList.add("dsh-wb-danger");
      const accountLabel = fieldLabel("令牌账号");
      const accountStats = document.createElement("div");
      accountStats.className = "dsh-wb-stats";
      accountStats.setAttribute("role", "status");
      accountStats.setAttribute("aria-live", "polite");
      Object.assign(accountStats.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
        width: "100%",
        minHeight: "24px",
        fontSize: "13px",
        color: "var(--dsw-text-secondary, #667085)",
      });
      const tokenHint = document.createElement("span");
      tokenHint.className = "dsh-wb-auth-hint";
      tokenHint.textContent = "令牌登录后可切换账号，并查看积分与今日请求量。";
      Object.assign(tokenHint.style, {
        display: "block",
        width: "100%",
        fontSize: "12px",
        lineHeight: "18px",
        color: "var(--dsw-text-secondary, #667085)",
      });
      const creditStat = document.createElement("span");
      creditStat.className = "dsh-wb-stat";
      creditStat.dataset.workbuddyStat = "credits";
      const usageStat = document.createElement("span");
      usageStat.className = "dsh-wb-stat";
      usageStat.dataset.workbuddyStat = "usage";
      accountStats.append(creditStat, usageStat);
      const message = document.createElement("span");
      message.className = "dsh-wb-message";
      message.setAttribute("role", "status");
      message.setAttribute("aria-live", "polite");
      Object.assign(message.style, { fontSize: "12px", minHeight: "18px", lineHeight: "18px" });
      modeRow.append(keyButton, tokenButton);
      keySourceRow.append(keySourceLabel, keySelect, removeKeyButton);
      keyAddRow.append(newKeyLabel, newKeyInput, newKeyLabelInput, saveKeyButton);
      keySection.append(keySourceRow, keyAddRow, keyHint);
      accountRow.append(accountLabel, accountSelect, accountName, removeButton);
      tokenActionRow.append(addButton);
      tokenSection.append(tokenHint, accountRow, accountStats, tokenActionRow);
      controls.append(modeRow, keySection, tokenSection, message);
      field.append(controls);
      let current = { mode: "api-key", authenticated: false, accounts: [], apiKeys: [], credits: undefined, creditLoading: false, creditError: null, todayUsage: null, todayUsageError: null };
      const render = (status) => {
        const previousMode = current.mode;
        const previousAccountId = current.activeAccountId;
        current = { ...current, ...status };
        applyMode(input, keyButton, tokenButton, keySection, keySourceRow, keySelect, keyHint, newKeyInput, newKeyLabelInput, saveKeyButton, removeKeyButton, tokenSection, tokenHint, accountRow, accountSelect, accountName, addButton, removeButton, accountStats, message, current);
        if (previousMode !== current.mode || previousAccountId !== current.activeAccountId) notifyAuthState();
      };
      render(current);
      let creditRequestId = 0;
      const loadCredits = async (accountId) => {
        const requestId = ++creditRequestId;
        if (current.mode !== "token" || !accountId) {
          render({ credits: undefined, creditLoading: false, creditError: null, todayUsage: null, todayUsageError: null });
          return;
        }
        render({ credits: undefined, creditLoading: true, creditError: null, todayUsage: null, todayUsageError: null });
        try {
          const result = await request("credits", { accountId });
          if (requestId !== creditRequestId || current.activeAccountId !== accountId) return;
          render({ ...result, creditLoading: false });
        } catch (error) {
          if (requestId !== creditRequestId || current.activeAccountId !== accountId) return;
          render({ credits: null, creditLoading: false, creditError: error instanceof Error ? error.message : "查询 WorkBuddy 积分失败", todayUsage: null, todayUsageError: "查询 WorkBuddy 今日请求量失败" });
        }
      };

      const setBusy = (busy) => {
        keyButton.disabled = busy;
        tokenButton.disabled = busy;
        keySelect.disabled = busy;
        newKeyInput.disabled = busy || current.mode === "token";
        newKeyLabelInput.disabled = busy || current.mode === "token";
        saveKeyButton.disabled = busy;
        removeKeyButton.disabled = busy;
        accountSelect.disabled = busy;
        addButton.disabled = busy;
        removeButton.disabled = busy;
        keyButton.style.cursor = busy ? "progress" : "pointer";
        tokenButton.style.cursor = busy ? "progress" : "pointer";
        saveKeyButton.style.cursor = busy ? "progress" : "pointer";
        removeKeyButton.style.cursor = busy ? "progress" : "pointer";
        addButton.style.cursor = busy ? "progress" : "pointer";
        removeButton.style.cursor = busy ? "progress" : "pointer";
      };
      keyButton.addEventListener("click", async () => {
        setBusy(true);
        message.textContent = "正在切换…";
        try {
          render(await request("api-key", current.activeApiKeyId ? { keyId: current.activeApiKeyId } : undefined));
          newKeyInput.focus();
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : "切换失败";
          message.style.color = "var(--dsw-text-danger, #c62828)";
        } finally {
          setBusy(false);
        }
      });
      keySelect.addEventListener("change", async () => {
        setBusy(true);
        message.textContent = "正在切换 API Key…";
        try {
          render(await request("api-key", { keyId: keySelect.value }));
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : "切换失败";
          message.style.color = "var(--dsw-text-danger, #c62828)";
        } finally {
          setBusy(false);
        }
      });
      saveKeyButton.addEventListener("click", async () => {
        const value = newKeyInput.value.trim();
        if (!value) {
          message.textContent = "请输入新的 API Key";
          message.style.color = "var(--dsw-text-danger, #c62828)";
          newKeyInput.focus();
          return;
        }
        setBusy(true);
        saveKeyButton.textContent = "添加中…";
        message.textContent = "正在保存 API Key…";
        try {
          const label = newKeyLabelInput.value.trim();
          const next = await request("api-key/add", { key: value, ...(label ? { label } : {}) });
          newKeyInput.value = "";
          newKeyLabelInput.value = "";
          render(next);
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : "保存失败";
          message.style.color = "var(--dsw-text-danger, #c62828)";
        } finally {
          setBusy(false);
        }
      });
      newKeyInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !saveKeyButton.disabled) {
          event.preventDefault();
          saveKeyButton.click();
        }
      });
      removeKeyButton.addEventListener("click", async () => {
        if (!current.activeApiKeyId || !window.confirm("确定删除当前 DSH 保存的 API Key 吗？")) return;
        setBusy(true);
        message.textContent = "正在删除 API Key…";
        try {
          render(await request("api-key/remove", { keyId: current.activeApiKeyId }));
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : "删除失败";
          message.style.color = "var(--dsw-text-danger, #c62828)";
        } finally {
          setBusy(false);
        }
      });
      tokenButton.addEventListener("click", async () => {
        setBusy(true);
        tokenButton.textContent = "切换中…";
        message.textContent = current.accounts?.length ? "正在切换令牌账号…" : "请在浏览器中完成 WorkBuddy 中国站登录";
        try {
          const next = await request(current.accounts?.length ? "token" : "login");
          render(next);
          await loadCredits(next.activeAccountId);
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : "登录失败";
          message.style.color = "var(--dsw-text-danger, #c62828)";
        } finally {
          setBusy(false);
        }
      });
      addButton.addEventListener("click", async () => {
        setBusy(true);
        addButton.textContent = "等待浏览器登录…";
        message.textContent = "请在浏览器中完成 WorkBuddy 中国站登录";
        try {
          const next = await request("login");
          render(next);
          await loadCredits(next.activeAccountId);
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : "登录失败";
          message.style.color = "var(--dsw-text-danger, #c62828)";
        } finally {
          setBusy(false);
        }
      });
      accountSelect.addEventListener("change", async () => {
        setBusy(true);
        message.textContent = "正在切换令牌账号…";
        try {
          const next = await request("token", { accountId: accountSelect.value });
          render(next);
          await loadCredits(next.activeAccountId);
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : "切换失败";
          message.style.color = "var(--dsw-text-danger, #c62828)";
        } finally {
          setBusy(false);
        }
      });
      removeButton.addEventListener("click", async () => {
        if (!current.activeAccountId || !window.confirm("确定删除这个 WorkBuddy 登录账号吗？令牌将从 DSH 凭据中移除。")) return;
        setBusy(true);
        message.textContent = "正在删除账号…";
        try {
          const next = await request("remove", { accountId: current.activeAccountId });
          render(next);
          await loadCredits(next.activeAccountId);
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : "删除失败";
          message.style.color = "var(--dsw-text-danger, #c62828)";
        } finally {
          setBusy(false);
        }
      });
      fetch(`${ROUTE}/status`, { cache: "no-store" })
        .then((response) => response.json())
        .then((status) => {
          render(status);
          return loadCredits(status.activeAccountId);
        })
        .catch(() => {
          message.textContent = "认证状态读取失败";
          message.style.color = "var(--dsw-text-danger, #c62828)";
        });
    }

    function WorkBuddyProviderCard({ provider }) {
      const hostRef = useRef(null);
      const supported = isWorkBuddyProvider(provider?.provider);
      useEffect(() => {
        const host = hostRef.current;
        if (!supported || !host) return undefined;
        const input = document.createElement("input");
        input.type = "password";
        input.hidden = true;
        input.setAttribute("aria-label", "WorkBuddy 认证占位");
        host.append(input);
        mount(input);
        return () => host.replaceChildren();
      }, [supported, provider?.provider]);
      return supported ? createElement("div", { ref: hostRef, "data-workbuddy-provider-card": "" }) : null;
    }

    function enhance() {
      for (const input of document.querySelectorAll('input[aria-label="API 密钥"]')) {
        if (isWorkBuddy(input)) mount(input);
      }
      enhanceModelMetadata();
    }

    function apply(ctx) {
      installComposerDockLayout();
      installInterfaceStyles();
      ctx.slots.inject("settings.models.provider-card", () => ctx.slots.register({
        name: "settings.models.provider-card",
        key: "llm-workbuddy",
      }, WorkBuddyProviderCard));
      ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
        name: "conversation.composer.dock",
        id: "workbuddy-credits",
        order: 100,
        label: "WorkBuddy 用量",
      }, WorkBuddyCreditsDock));
      ctx.effect(() => {
        const observer = new MutationObserver(enhance);
        const resetCatalog = () => {
          modelCatalog = [];
          modelCatalogByName = new Map();
          modelCatalogFetchedAt = 0;
          enhance();
        };
        observer.observe(document.body, { childList: true, subtree: true });
        document.addEventListener("change", enhance, true);
        window.addEventListener(AUTH_STATE_EVENT, resetCatalog);
        enhance();
        return () => {
          observer.disconnect();
          document.removeEventListener("change", enhance, true);
          window.removeEventListener(AUTH_STATE_EVENT, resetCatalog);
          if (detailPanel) detailPanel.remove();
          detailPanel = undefined;
        };
      }, "llm-workbuddy: interface enhancements");
    }

    return { name: "dsh-llm-workbuddy-client", inject: ["slots"], apply };
  },
});
