import { randomUUID } from "node:crypto";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { deleteDoubaoConversation, streamDoubaoWebRequest } from "./doubao-browser.js";
import { DOUBAO_PROVIDER, parseDoubaoSession } from "./doubao-session.js";

export const DOUBAO_API = "doubao-web";
export const DOUBAO_BOT_ID = "7338286299411103781";

export const DOUBAO_MODELS = Object.freeze([
  Object.freeze({
    id: "doubao-web",
    name: "豆包 网页版",
    api: DOUBAO_API,
    provider: DOUBAO_PROVIDER,
    baseUrl: "https://www.doubao.com",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_000,
  }),
  Object.freeze({
    id: "doubao-web-thinking",
    name: "豆包 网页版（深度思考）",
    api: DOUBAO_API,
    provider: DOUBAO_PROVIDER,
    baseUrl: "https://www.doubao.com",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_000,
  }),
]);

const EMPTY_USAGE = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((entry) => entry?.type === "text" ? entry.text : "[不支持的图片内容]").join("\n");
}

function assistantTranscript(message) {
  return message.content.map((entry) => {
    if (entry.type === "text") return entry.text;
    if (entry.type === "thinking") return `[思考过程]\n${entry.thinking}`;
    return `<tool_call>${JSON.stringify({ id: entry.id, name: entry.name, arguments: entry.arguments })}</tool_call>`;
  }).join("\n");
}

function transcriptMessage(message) {
  if (message.role === "user") return { role: "user", content: contentText(message.content) };
  if (message.role === "assistant") return { role: "assistant", content: assistantTranscript(message) };
  return {
    role: "tool",
    tool_call_id: message.toolCallId,
    name: message.toolName,
    is_error: message.isError,
    content: contentText(message.content),
  };
}

export function formatDoubaoPrompt(context) {
  const sections = [];
  if (context.systemPrompt) sections.push(`系统指令：\n${context.systemPrompt}`);
  if (context.tools?.length) {
    const tools = context.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
    sections.push([
      "你可以调用下面的工具。需要调用工具时，不要解释，也不要输出 Markdown，只输出这一种格式：",
      '<dsh_tool_calls>{"tool_calls":[{"name":"工具名","arguments":{}}]}</dsh_tool_calls>',
      "工具参数必须满足对应 JSON Schema。可以一次调用多个工具。不需要工具时直接正常回答。",
      `工具定义：\n${JSON.stringify(tools)}`,
    ].join("\n"));
  }
  sections.push(`对话记录（JSON）：\n${JSON.stringify(context.messages.map(transcriptMessage))}`);
  sections.push("请继续生成 assistant 的下一条回复。");
  return sections.join("\n\n");
}

export function buildDoubaoRequest(context, model) {
  const useDeepThink = model.id === "doubao-web-thinking";
  const now = Date.now();
  const localConversationId = `local_${String(BigInt(`0x${randomUUID().replaceAll("-", "")}`) % 10_000_000_000_000_000n)}`;
  const localMessageId = randomUUID();
  return {
    client_meta: {
      local_conversation_id: localConversationId,
      conversation_id: "",
      bot_id: DOUBAO_BOT_ID,
      last_section_id: "",
      last_message_index: null,
      local_permissions: [
        { permission_name: "ACCESS_COARSE_LOCATION", status: 3 },
        { permission_name: "ACCESS_FINE_LOCATION", status: 3 },
        { permission_name: "ACCESS_BACKGROUND_LOCATION", status: 3 },
      ],
    },
    messages: [{
      local_message_id: localMessageId,
      content_block: [{
        block_type: 10000,
        content: {
          text_block: { text: formatDoubaoPrompt(context), icon_url: "", icon_url_dark: "", summary: "" },
          pc_event_block: "",
        },
        block_id: randomUUID(),
        parent_id: "",
        meta_info: [],
        append_fields: [],
      }],
      message_status: 0,
    }],
    option: {
      send_message_scene: "",
      create_time_ms: now,
      collect_id: "",
      is_audio: false,
      answer_with_suggest: false,
      agent_mode: 2,
      tts_switch: false,
      need_deep_think: useDeepThink ? 1 : 0,
      click_clear_context: false,
      from_suggest: false,
      is_regen: false,
      is_replace: false,
      is_from_click_option: false,
      is_from_click_softlink: false,
      disable_sse_cache: false,
      select_text_action: "",
      is_select_text: false,
      resend_for_regen: false,
      scene_type: 0,
      unique_key: randomUUID(),
      start_seq: 0,
      need_create_conversation: true,
      conversation_init_option: { need_ack_conversation: true },
      conversation_init_ext: { model_item_key: "0", reasoning_effort: "3", mode_id: "1" },
      regen_query_id: [],
      edit_query_id: [],
      regen_instruction: "",
      no_replace_for_regen: false,
      message_from: 0,
      shared_app_name: "",
      shared_app_id: "",
      sse_recv_event_options: { support_chunk_delta: true },
      support_lazy_fetch_stream: true,
      is_ai_playground: false,
      is_old_user: true,
      recovery_option: { is_recovery: false, req_create_time_sec: Math.floor(now / 1000), append_sse_event_scene: 0 },
      message_storage_type: 0,
      related_deleted_message_ids: {},
      connector_info_list: [],
      model_config: { model_item_key: "0", model_extra_params: {}, reasoning_effort: 3 },
      aggregate_params: {
        mention_skill_list: "[]",
        mention_plugin_list: "[]",
        mention_ext: "[{}]",
        conversation_mode: "1",
        mode_id: "1",
        model_item_key: "0",
        agent_mode: "2",
        reasoning_effort: "3",
        provider_id: "",
      },
      conversation_mode: 1,
    },
    user_context: [],
    ext: {
      agent_mode: "2",
      use_deep_think: useDeepThink ? "1" : "0",
      sub_conv_firstmet_type: "1",
      collection_id: "",
      is_finish: "1",
      conversation_init_option: JSON.stringify({ need_ack_conversation: true }),
      commerce_credit_config_enable: "0",
    },
  };
}

function parseJson(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || value.length === 0) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function parseDoubaoSseData(raw) {
  const line = raw.trim();
  if (!line.startsWith("data:")) return undefined;
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return { done: true };
  const outer = parseJson(data);
  if (outer.content || outer.patch_op || outer.end_type || outer.ack_client_meta) {
    const initial = parseJson(outer.content?.content);
    let text = typeof initial.text === "string" ? initial.text : "";
    let thinking = typeof initial.thinking === "string" ? initial.thinking : "";
    for (const operation of outer.patch_op ?? []) {
      const patch = parseJson(operation?.patch_value?.content);
      if (typeof patch.text === "string") text += patch.text;
      if (typeof patch.thinking === "string") thinking += patch.thinking;
    }
    const rawConversationId = outer.meta?.conversation_id ?? outer.ack_client_meta?.conversation_id;
    const conversationId = rawConversationId && String(rawConversationId) !== "0" ? String(rawConversationId) : undefined;
    return {
      done: Number(outer.end_type) === 3,
      error: outer.error?.message,
      conversationId,
      text,
      thinking,
    };
  }
  const eventType = Number(outer.event_type);
  const event = parseJson(outer.event_data);
  const message = event.message ?? {};
  const content = parseJson(message.content);
  const contentType = Number(message.content_type);
  const thinking = content.thinking || content.reasoning_content || (contentType === 2008 ? content.text : "") || "";
  const text = contentType === 2008 ? "" : (content.text ?? (typeof message.content === "string" && Object.keys(content).length === 0 ? message.content : ""));
  return {
    done: eventType === 2003,
    error: eventType === 2005 && (event.message || event.code) ? (event.message ?? `豆包返回错误 ${event.code}`) : undefined,
    conversationId: event.conversation_id,
    text: typeof text === "string" ? text : "",
    thinking: typeof thinking === "string" ? thinking : "",
  };
}

function parseToolCalls(text, tools) {
  if (!tools?.length) return undefined;
  const match = text.trim().match(/^<dsh_tool_calls>\s*([\s\S]*?)\s*<\/dsh_tool_calls>$/);
  if (!match) return undefined;
  const payload = parseJson(match[1]);
  if (!Array.isArray(payload.tool_calls) || payload.tool_calls.length === 0) return undefined;
  const available = new Set(tools.map((tool) => tool.name));
  const calls = payload.tool_calls.map((call) => {
    if (!available.has(call?.name) || !call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)) return undefined;
    return { type: "toolCall", id: randomUUID(), name: call.name, arguments: call.arguments };
  });
  return calls.every(Boolean) ? calls : undefined;
}

function messageBase(model) {
  return {
    role: "assistant",
    content: [],
    api: DOUBAO_API,
    provider: model.provider,
    model: model.id,
    usage: { ...EMPTY_USAGE, cost: { ...EMPTY_USAGE.cost } },
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

function estimateTokens(text) {
  return text ? Math.ceil([...text].length / 3) : 0;
}

function finishUsage(message, input, output) {
  message.usage = {
    ...message.usage,
    input: estimateTokens(input),
    output: estimateTokens(output),
    totalTokens: estimateTokens(input) + estimateTokens(output),
  };
}

function emitText(stream, partial, index, text) {
  partial.content.push({ type: "text", text: "" });
  stream.push({ type: "text_start", contentIndex: index, partial });
  if (text) {
    partial.content[index].text = text;
    stream.push({ type: "text_delta", contentIndex: index, delta: text, partial });
  }
  stream.push({ type: "text_end", contentIndex: index, content: text, partial });
}

function emitThinking(stream, partial, index, thinking) {
  partial.content.push({ type: "thinking", thinking: "" });
  stream.push({ type: "thinking_start", contentIndex: index, partial });
  if (thinking) {
    partial.content[index].thinking = thinking;
    stream.push({ type: "thinking_delta", contentIndex: index, delta: thinking, partial });
  }
  stream.push({ type: "thinking_end", contentIndex: index, content: thinking, partial });
}

function emitToolCall(stream, partial, index, call) {
  partial.content.push({ ...call, arguments: {} });
  stream.push({ type: "toolcall_start", contentIndex: index, partial });
  const delta = JSON.stringify(call.arguments);
  stream.push({ type: "toolcall_delta", contentIndex: index, delta, partial });
  partial.content[index].arguments = call.arguments;
  stream.push({ type: "toolcall_end", contentIndex: index, toolCall: call, partial });
}

async function performDoubaoStream(stream, model, context, options = {}) {
  const partial = messageBase(model);
  let conversationId;
  let fullText = "";
  let fullThinking = "";
  const bufferForTools = Boolean(context.tools?.length);
  let activeType;
  let activeIndex;
  let emittedContent = false;
  let pending = "";
  try {
    options.signal?.throwIfAborted?.();
    const session = parseDoubaoSession(options.apiKey);
    let body = buildDoubaoRequest(context, model);
    const transformed = await options.onPayload?.(body, model);
    if (transformed !== undefined) body = transformed;
    stream.push({ type: "start", partial });
    const closeActive = () => {
      if (activeType === "thinking") {
        stream.push({ type: "thinking_end", contentIndex: activeIndex, content: partial.content[activeIndex].thinking, partial });
      }
      if (activeType === "text") {
        stream.push({ type: "text_end", contentIndex: activeIndex, content: partial.content[activeIndex].text, partial });
      }
      activeType = undefined;
      activeIndex = undefined;
    };
    const startContent = (type) => {
      if (activeType === type) return;
      closeActive();
      activeType = type;
      activeIndex = partial.content.length;
      emittedContent = true;
      if (type === "thinking") {
        partial.content.push({ type: "thinking", thinking: "" });
        stream.push({ type: "thinking_start", contentIndex: activeIndex, partial });
      } else {
        partial.content.push({ type: "text", text: "" });
        stream.push({ type: "text_start", contentIndex: activeIndex, partial });
      }
    };
    const accept = (event) => {
      if (event.error) throw new Error(event.error);
      if (event.conversationId) conversationId = event.conversationId;
      if (event.thinking) {
        fullThinking += event.thinking;
        if (!bufferForTools) {
          startContent("thinking");
          partial.content[activeIndex].thinking += event.thinking;
          stream.push({ type: "thinking_delta", contentIndex: activeIndex, delta: event.thinking, partial });
        }
      }
      if (event.text) {
        fullText += event.text;
        if (!bufferForTools) {
          startContent("text");
          partial.content[activeIndex].text += event.text;
          stream.push({ type: "text_delta", contentIndex: activeIndex, delta: event.text, partial });
        }
      }
    };
    await streamDoubaoWebRequest(session, body, {
      onResponse: (response) => options.onResponse?.({ status: response.status, headers: response.headers }, model),
      onChunk(chunk) {
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) {
          const event = parseDoubaoSseData(line);
          if (event) accept(event);
        }
      },
    }, options.signal);
    const tail = parseDoubaoSseData(pending);
    if (tail) accept(tail);

    if (bufferForTools) {
      const toolCalls = parseToolCalls(fullText, context.tools);
      if (toolCalls) {
        if (fullThinking) emitThinking(stream, partial, partial.content.length, fullThinking);
        for (const call of toolCalls) emitToolCall(stream, partial, partial.content.length, call);
        partial.stopReason = "toolUse";
      } else {
        if (fullThinking) emitThinking(stream, partial, partial.content.length, fullThinking);
        emitText(stream, partial, partial.content.length, fullText);
        partial.stopReason = "stop";
      }
    } else {
      closeActive();
      if (!emittedContent) emitText(stream, partial, 0, "");
      partial.stopReason = "stop";
    }
    finishUsage(partial, formatDoubaoPrompt(context), fullThinking + fullText);
    stream.push({ type: "done", reason: partial.stopReason, message: partial });
    stream.end(partial);
  } catch (error) {
    const aborted = options.signal?.aborted;
    partial.stopReason = aborted ? "aborted" : "error";
    partial.errorMessage = aborted ? "请求已取消" : (error instanceof Error ? error.message : String(error));
    stream.push({ type: "error", reason: partial.stopReason, error: partial });
    stream.end(partial);
  } finally {
    if (conversationId) void deleteDoubaoConversation(options.apiKey, conversationId);
  }
}

function stream(model, context, options) {
  if (!options?.apiKey) throw new Error("缺少豆包网页登录凭据");
  const output = createAssistantMessageEventStream();
  queueMicrotask(() => void performDoubaoStream(output, model, context, options));
  return output;
}

export const doubaoApi = Object.freeze({ stream, streamSimple: stream });

export const __testing = Object.freeze({ parseToolCalls, transcriptMessage });
