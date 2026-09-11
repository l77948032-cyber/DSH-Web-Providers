const EFFORT_LABELS = Object.freeze({
  minimal: "低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "极致",
});

// WorkBuddy 5.5.6 expands its Auto model into these three requestable tiers.
export const AUTO_TIER_MODELS = Object.freeze([
  {
    id: "fast-model",
    name: "快速",
    credits: "x0.21",
    maxOutputTokens: 48_000,
    maxInputTokens: 200_000,
    maxAllowedSize: 200_000,
    supportsImages: true,
    supportsReasoning: true,
    onlyReasoning: true,
    reasoning: { effort: "medium", summary: "auto" },
    descriptionZh: "优先响应速度，适合简单任务与快速问答",
    descriptionEn: "Prioritizes speed for simple tasks and quick answers",
  },
  {
    id: "balanced-model",
    name: "均衡",
    credits: "x0.65",
    maxOutputTokens: 48_000,
    maxInputTokens: 200_000,
    maxAllowedSize: 200_000,
    supportsImages: true,
    supportsReasoning: true,
    onlyReasoning: true,
    reasoning: { effort: "medium", summary: "auto" },
    descriptionZh: "兼顾速度与质量，适合大多数日常工作",
    descriptionEn: "Balances speed and quality for most everyday tasks",
  },
  {
    id: "deep-model",
    name: "极致",
    credits: "x1.20",
    maxOutputTokens: 48_000,
    maxInputTokens: 200_000,
    maxAllowedSize: 200_000,
    supportsImages: true,
    supportsReasoning: true,
    onlyReasoning: true,
    reasoning: { effort: "medium", summary: "auto" },
    descriptionZh: "优先深度与准确性，适合复杂分析和高要求任务",
    descriptionEn: "Prioritizes depth and accuracy for complex analysis and high-stakes tasks",
  },
]);

const AUTO_MODEL_IDS = new Set(["auto", ...AUTO_TIER_MODELS.map((model) => model.id)]);

function nonEmptyText(...values) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

function positiveInteger(...values) {
  return values.find((value) => Number.isSafeInteger(value) && value > 0);
}

/** Keep the server's CLI order while removing repeated model ids. */
export function selectWorkBuddyModelRecords(data) {
  const agents = Array.isArray(data?.agents) ? data.agents : data?.agent?.agents;
  const cli = Array.isArray(agents) ? agents.find((agent) => agent?.name === "cli") : undefined;
  const allowed = Array.isArray(cli?.models) ? cli.models : [];
  const source = Array.isArray(data?.models) ? data.models : [];
  if (allowed.length === 0 || source.length === 0) return [];
  const byId = new Map(source.flatMap((model) =>
    model && typeof model.id === "string" && model.id ? [[model.id, model]] : [],
  ));
  const seen = new Set(AUTO_MODEL_IDS);
  const records = allowed.flatMap((id) => {
    if (typeof id !== "string" || seen.has(id)) return [];
    seen.add(id);
    const model = byId.get(id);
    return model ? [model] : [];
  });
  const names = new Set();
  return [...AUTO_TIER_MODELS, ...records].filter((model) => {
    const key = nonEmptyText(model.name, model.id)?.toLowerCase();
    if (!key || names.has(key)) return false;
    names.add(key);
    return true;
  });
}

export function formatCreditsCoefficient(credits) {
  if (typeof credits !== "string" || !credits.trim()) return undefined;
  const match = credits.match(/(\d+(?:\.\d+)?)/);
  return match ? `${match[1]}x` : credits.trim();
}

function creditsParts(credits) {
  const display = formatCreditsCoefficient(credits);
  if (!display) return undefined;
  const match = display.match(/^(\d+(?:\.\d+)?)(.*)$/);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  return { value, numberText: match[1], suffix: match[2] || "x", display };
}

function formatDiscountCredits(credits, discount) {
  const original = creditsParts(credits);
  const explicit = nonEmptyText(discount?.discountedCredits);
  if (explicit) {
    const discounted = creditsParts(explicit);
    if (!discounted) return original ? { original: original.display, discounted: explicit } : undefined;
    const decimals = Math.max(
      2,
      original?.numberText.split(".")[1]?.length ?? 0,
      discounted.numberText.split(".")[1]?.length ?? 0,
    );
    return {
      original: original?.display,
      discounted: `${discounted.value.toFixed(decimals)}${discounted.suffix}`,
    };
  }
  const factor = discount?.factor;
  if (!original || typeof factor !== "number" || !Number.isFinite(factor) || factor < 0 || factor >= 1) return undefined;
  const decimals = Math.max(2, original.numberText.split(".")[1]?.length ?? 0);
  return {
    original: original.display,
    discounted: `${(original.value * factor).toFixed(decimals)}${original.suffix}`,
  };
}

function parseTime(value) {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : undefined;
}

function zonedMinute(date, timeZone) {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      }).formatToParts(date);
      const part = (type) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
      return (part("hour") % 24) * 60 + part("minute");
    } catch {
      // Invalid remote time zones fall back to the local clock.
    }
  }
  return date.getHours() * 60 + date.getMinutes();
}

export function isPromotionActive(promotion, now = new Date()) {
  if (!promotion || promotion.enabled === false) return false;
  const schedule = promotion.schedule;
  const nowMs = now.getTime();
  if (schedule?.validFrom) {
    const from = Date.parse(schedule.validFrom);
    if (!Number.isNaN(from) && nowMs < from) return false;
  }
  if (schedule?.validUntil) {
    const until = Date.parse(schedule.validUntil);
    if (!Number.isNaN(until) && nowMs >= until) return false;
  }
  if (!Array.isArray(schedule?.daily) || schedule.daily.length === 0) return true;
  const current = zonedMinute(now, schedule.timezone);
  return schedule.daily.some((window) => {
    const start = parseTime(window?.start);
    const end = parseTime(window?.end);
    if (start === undefined || end === undefined) return false;
    if (start === end) return true;
    return start < end ? current >= start && current < end : current >= start || current < end;
  });
}

function primaryPromotion(promotions, now) {
  if (!Array.isArray(promotions)) return undefined;
  const enabled = promotions.filter((promotion) => promotion && promotion.enabled !== false);
  const ranked = (items) => items.reduce((best, item) =>
    !best || (item.priority ?? 0) > (best.priority ?? 0) ? item : best, undefined);
  return ranked(enabled.filter((promotion) => isPromotionActive(promotion, now))) ?? ranked(enabled);
}

function tagBadge(tags) {
  if (!Array.isArray(tags)) return undefined;
  for (const tag of tags) {
    if (typeof tag !== "string" || !tag.startsWith("badge:")) continue;
    const [, label] = tag.split(":");
    if (label?.trim()) return label.trim();
  }
  return undefined;
}

function promotionDisplay(model, now) {
  const promotion = primaryPromotion(model.promotions, now);
  if (!promotion) return {};
  const active = isPromotionActive(promotion, now);
  const badge = promotion.badge;
  const badgeLabel = badge?.label && (badge.display === "always" || active) ? badge.label.trim() : undefined;
  const formatted = active && promotion.kind === "discount"
    ? formatDiscountCredits(model.credits, promotion.discount)
    : undefined;
  const hover = active ? promotion.hover : undefined;
  return {
    ...(badgeLabel ? { badge: badgeLabel } : {}),
    ...(formatted?.discounted ? { rate: formatted.discounted } : {}),
    ...(formatted?.original && promotion.discount?.displayMode !== "replace" ? { originalRate: formatted.original } : {}),
    ...(nonEmptyText(hover?.textZh, hover?.textEn) ? { promotionText: nonEmptyText(hover?.textZh, hover?.textEn) } : {}),
    ...(nonEmptyText(hover?.action?.labelZh, hover?.action?.labelEn)
      ? { promotionAction: nonEmptyText(hover?.action?.labelZh, hover?.action?.labelEn) }
      : {}),
  };
}

function modelPromotions(model, data) {
  if (Array.isArray(model.promotions) && model.promotions.length > 0) return model.promotions;
  if (!Array.isArray(data?.modelPromotions)) return undefined;
  const matched = data.modelPromotions.filter((promotion) =>
    promotion && Array.isArray(promotion.modelIds) && promotion.modelIds.includes(model.id),
  );
  return matched.length > 0 ? matched : undefined;
}

function knownPromotionDisplay(model, now) {
  const id = String(model?.id ?? "").toLowerCase();
  const rate = formatCreditsCoefficient(model?.credits);
  if ((id === "hy3" || id === "hy4-preview-f") && rate === "0.00x") {
    const hy4Trial = id === "hy4-preview-f" && now.getTime() < Date.parse("2026-10-11T00:00:00+08:00");
    return {
      badge: "限时免费",
      ...(hy4Trial ? {
        promotionText: "10月10日 24时前启用，立享14天免费额度。",
        promotionAction: "去使用",
      } : {}),
    };
  }
  if (id === "deepseek-v4.1-flash" && rate === "0.03x") return { badge: "独家优惠" };
  if (id === "glm-5.2") return { badge: "夜间折扣" };
  return {};
}

/** Return only display-safe fields; credentials and unrelated product config never reach the browser. */
export function modelMetadataFromConfig(data, now = new Date()) {
  return selectWorkBuddyModelRecords(data).map((model) => {
    const promotion = promotionDisplay({ ...model, promotions: modelPromotions(model, data) }, now);
    const knownPromotion = knownPromotionDisplay(model, now);
    const effort = nonEmptyText(model.reasoning?.defaultEffort, model.reasoning?.effort);
    return {
      id: model.id,
      name: nonEmptyText(model.name, model.id),
      description: nonEmptyText(model.descriptionZh, model.description, model.descriptionEn),
      rate: promotion.rate ?? formatCreditsCoefficient(model.credits),
      originalRate: promotion.originalRate,
      badge: promotion.badge ?? tagBadge(model.tags) ?? knownPromotion.badge,
      promotionText: promotion.promotionText ?? knownPromotion.promotionText,
      promotionAction: promotion.promotionAction ?? knownPromotion.promotionAction,
      contextWindow: positiveInteger(model.contextWindow?.defaultLength, model.maxInputTokens, model.maxAllowedSize),
      supportsReasoning: model.supportsReasoning === true || model.onlyReasoning === true,
      reasoningEffort: effort ? EFFORT_LABELS[effort] ?? effort : undefined,
    };
  });
}
