// All Claude API access goes through here: streaming, cost tracking, budget cap.
import Anthropic from "@anthropic-ai/sdk";
import { getMeta, setMeta } from "./store.js";
import { mockRun } from "./mock.js";

// USD per million tokens (in / out / cache read / cache write). Estimates for the spend meter.
export const MODELS = {
  "claude-opus-5-5": { label: "Opus 5.5", note: "sharp and fast — the default", in: 4, out: 20, cr: 0.2, cw: 5, fallback: true },
  "claude-sonnet-5-5": { label: "Sonnet 5.5", note: "about half the cost", in: 2, out: 10, cr: 0.1, cw: 2.5, fallback: true },
  "claude-haiku-5-5": { label: "Haiku 5.5", note: "nearly free, lighter sparring", in: 0.1, out: 0.5, cr: 0.01, cw: 0.125, fallback: false },
  "claude-fable-5-2": { label: "Fable 5.2", note: "most capable, 2× Opus cost", in: 8, out: 40, cr: 0.2, cw: 10, fallback: true },
};
const DEFAULT_MODEL = "claude-opus-5-5";
const SEARCH_USD = 0.01; // web search: $10 per 1,000

export const isMock = () => process.env.MOCK === "1";
export const hasKey = () => isMock() || !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
export const budget = () => Number(process.env.BUDGET_USD) || 100;
export const currentModel = () => {
  const m = getMeta().model || process.env.MODEL;
  return MODELS[m] ? m : DEFAULT_MODEL;
};

let client;
const getClient = () => (client ??= new Anthropic());

export class FriendlyError extends Error {}

function charge(model, usage) {
  const p = MODELS[model] || MODELS[DEFAULT_MODEL];
  const usd =
    ((usage.input_tokens || 0) * p.in +
      (usage.cache_read_input_tokens || 0) * p.cr +
      (usage.cache_creation_input_tokens || 0) * p.cw +
      (usage.output_tokens || 0) * p.out) /
      1e6 +
    (usage.server_tool_use?.web_search_requests || 0) * SEARCH_USD;
  const meta = getMeta();
  setMeta({ spend: meta.spend + usd, calls: meta.calls + 1 });
  return usd;
}

function explain(err) {
  if (err instanceof FriendlyError) return err;
  if (err instanceof Anthropic.AuthenticationError)
    return new FriendlyError("Your API key was rejected. Check ANTHROPIC_API_KEY in .env and restart.");
  if (err instanceof Anthropic.PermissionDeniedError)
    return new FriendlyError("This API key isn't allowed to use that model or feature. Try another model in the header menu.");
  if (err instanceof Anthropic.RateLimitError)
    return new FriendlyError("Rate limited by the API. Give it a few seconds and try again.");
  if (err instanceof Anthropic.APIConnectionError)
    return new FriendlyError("Couldn't reach the Anthropic API. Check your connection and try again.");
  if (err instanceof Anthropic.APIError)
    return new FriendlyError(`The API returned an error (${err.status ?? "?"}): ${err.message}`);
  return err;
}

/**
 * One streamed Claude call.
 *  system: array of text blocks · messages: MessageParam[] · format: JSON schema (optional)
 *  onText(delta) and onEvent(rawStreamEvent) are optional live hooks.
 */
export async function run({ system, messages, maxTokens = 4000, effort = "low", tools, format, onText, onEvent, mock }) {
  if (getMeta().spend >= budget())
    throw new FriendlyError(
      `Budget cap reached ($${budget()}). Raise BUDGET_USD in .env if you want to keep going.`,
    );
  if (isMock()) return mockRun({ mock, onText });

  const model = currentModel();
  const base = {
    model,
    max_tokens: maxTokens,
    system,
    messages,
    cache_control: { type: "ephemeral" },
    output_config: { effort, ...(format ? { format: { type: "json_schema", schema: format } } : {}) },
    ...(tools ? { tools } : {}),
  };
  const call = (withFallback) => {
    // Server-side refusal fallback: if a safety classifier declines, the API retries on
    // another model inside the same request instead of dead-ending the conversation.
    const stream = withFallback
      ? getClient().beta.messages.stream({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
      : getClient().messages.stream(base);
    if (onText) stream.on("text", onText);
    if (onEvent) stream.on("streamEvent", onEvent);
    return stream.finalMessage();
  };

  let msg;
  try {
    try {
      msg = await call(MODELS[model].fallback);
    } catch (err) {
      // If the account doesn't have the fallback beta, retry as a plain request.
      if (MODELS[model].fallback && err instanceof Anthropic.BadRequestError) msg = await call(false);
      else throw err;
    }
  } catch (err) {
    throw explain(err);
  }

  const usd = charge(model, msg.usage);
  if (msg.stop_reason === "refusal")
    throw new FriendlyError("The model declined that one. Try rephrasing, or switch model in the header menu.");
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text, msg, usd };
}

/** A call that must come back as JSON matching `schema`. Falls back to prompt-only JSON if needed. */
export async function runJSON({ system, user, schema, maxTokens = 16000, effort = "medium", mock }) {
  const messages = [{ role: "user", content: user }];
  const parse = (t) => JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
  try {
    const { text } = await run({ system, messages, maxTokens, effort, format: schema, mock });
    return parse(text);
  } catch (err) {
    if (err instanceof FriendlyError && !/error \(400\)/.test(err.message)) throw err;
    const nudge = `\n\nReturn ONLY a JSON object matching this JSON Schema, no prose, no code fence:\n${JSON.stringify(schema)}`;
    const { text } = await run({ system, messages: [{ role: "user", content: user + nudge }], maxTokens, effort, mock });
    return parse(text);
  }
}

/** Web research pass with live progress. Returns notes, or "" if search isn't available. */
export async function research({ prompt, onSearch }) {
  if (isMock()) {
    for (const q of ["mock: current state of the debate", "mock: strongest counterarguments"]) {
      onSearch?.(q);
      await new Promise((r) => setTimeout(r, 400));
    }
    return "";
  }
  const variants = [
    { type: "web_search_20260209", name: "web_search", max_uses: 5 },
    { type: "web_search_20250305", name: "web_search", max_uses: 5 },
  ];
  for (const tool of variants) {
    try {
      const partial = {};
      const onEvent = (e) => {
        if (e.type === "content_block_start" && e.content_block.type === "server_tool_use") partial[e.index] = "";
        else if (e.type === "content_block_delta" && e.delta.type === "input_json_delta" && e.index in partial)
          partial[e.index] += e.delta.partial_json;
        else if (e.type === "content_block_stop" && e.index in partial) {
          try {
            const q = JSON.parse(partial[e.index]).query;
            if (q) onSearch?.(q);
          } catch {}
          delete partial[e.index];
        }
      };
      const messages = [{ role: "user", content: prompt }];
      let notes = "";
      for (let i = 0; i < 4; i++) {
        const { text, msg } = await run({ messages, maxTokens: 6000, effort: "low", tools: [tool], onEvent });
        notes += text;
        if (msg.stop_reason !== "pause_turn") break;
        // Long server-tool turn paused: send it back so the server resumes where it left off.
        messages.push({ role: "assistant", content: msg.content });
      }
      return notes;
    } catch (err) {
      if (err instanceof FriendlyError && /Budget cap|API key|reach the Anthropic/.test(err.message)) throw err;
      // otherwise: this search variant isn't available on the account — try the next, then go without.
    }
  }
  return "";
}

export const spendInfo = () => {
  const m = getMeta();
  return { spend: m.spend, calls: m.calls, budget: budget() };
};
