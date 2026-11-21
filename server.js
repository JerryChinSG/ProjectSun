// Crux — learn any topic by arguing about it.  `npm start` → http://localhost:3000
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {}

const { getCase, saveCase, deleteCase, listCases, setMeta } = await import("./lib/store.js");
const ai = await import("./lib/ai.js");
const P = await import("./lib/prompts.js");
const { parseTurn } = await import("./public/parse.js");
const { applyMemory } = await import("./public/memory.js");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";

// ---- helpers ------------------------------------------------------------------------------

function streak(days) {
  let n = 0;
  const d = new Date();
  if (!days[d.toLocaleDateString("en-CA")]) d.setDate(d.getDate() - 1); // today not started yet
  while (days[d.toLocaleDateString("en-CA")]) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

const view = (c) => ({ ...c, notes: undefined, streak: streak(c.days || {}), today: today() });
const summary = (c) => ({
  id: c.id,
  title: c.dossier.title,
  claim: c.dossier.claim,
  lit: Object.keys(c.lit || {}).length,
  total: c.dossier.concepts.length,
  streak: streak(c.days || {}),
  minutes: Math.round(Object.values(c.days || {}).reduce((a, d) => a + d.ms, 0) / 60000),
  touchedAt: c.touchedAt,
});

function touch(c) {
  const now = Date.now();
  const day = (c.days ||= {})[today()] || { ms: 0, turns: 0 };
  // Count time between consecutive actions as practice time, capped so idle tabs don't count.
  if (c.touchedAt) day.ms += Math.min(now - c.touchedAt, 3 * 60000);
  day.turns++;
  c.days[today()] = day;
  c.touchedAt = now;
}

function cleanDossier(d) {
  const ids = new Set();
  const uniq = (raw) => {
    let id = slug(raw);
    while (ids.has(id)) id += "-2";
    ids.add(id);
    return id;
  };
  const rename = {};
  for (const k of d.concepts) rename[k.id] = k.id = uniq(k.id);
  for (const k of d.concepts) k.requires = (k.requires || []).map((r) => rename[r]).filter((r) => r && r !== k.id);
  for (const p of d.cast) p.id = uniq(p.id || p.name.split(" ")[0]);
  for (const x of d.cruxes) x.id = uniq(x.id);
  for (const g of d.scenario.gauges) {
    g.id = slug(g.id);
    g.start = Math.max(0, Math.min(100, g.start));
  }
  return d;
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

function sse(res) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  return (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
}

const stateInfo = () => ({
  cases: listCases().map(summary),
  ...ai.spendInfo(),
  model: ai.currentModel(),
  models: Object.entries(ai.MODELS).map(([id, m]) => ({ id, label: m.label, note: m.note })),
  hasKey: ai.hasKey(),
  mock: ai.isMock(),
});

// ---- API ----------------------------------------------------------------------------------

async function createCase(req, res) {
  const { topic } = await readBody(req);
  if (!topic?.trim()) return json(res, 400, { error: "Give me a topic." });
  const send = sse(res);
  try {
    send({ type: "stage", text: "Reading up on it — searching the live web" });
    const notes = await ai.research({
      prompt: P.researchPrompt(topic.trim(), today()),
      onSearch: (q) => send({ type: "search", text: q }),
    });
    send({
      type: "stage",
      text: notes ? "Drawing your concept map and casting the table" : "No web search on this key — building from model knowledge",
    });
    const dossier = cleanDossier(
      await ai.runJSON({ system: P.DOSSIER_SYSTEM, user: P.dossierUser(topic.trim(), notes), schema: P.DOSSIER_SCHEMA, mock: "dossier" }),
    );
    const c = {
      id: `${slug(dossier.title).slice(0, 40)}-${crypto.randomBytes(3).toString("hex")}`,
      topic: topic.trim(),
      createdAt: Date.now(),
      createdDay: today(),
      touchedAt: Date.now(),
      researched: !!notes,
      notes,
      dossier,
      lit: {},
      stances: [],
      threads: [],
      scores: [],
      days: {},
      playbook: null,
    };
    saveCase(c);
    send({ type: "done", case: view(c), ...ai.spendInfo() });
  } catch (err) {
    if (!(err instanceof ai.FriendlyError)) console.error(err);
    send({ type: "error", error: err instanceof ai.FriendlyError ? err.message : "Something broke while building this topic. Try again." });
  }
  res.end();
}

async function turn(req, res, c) {
  const { mode, threadId, text, opts = {} } = await readBody(req);
  const M = P.MODE[mode];
  if (!M) return json(res, 400, { error: "Unknown mode." });
  const send = sse(res);

  let thread = c.threads.find((t) => t.id === threadId && t.mode === mode);
  const isNew = !thread;
  if (isNew) {
    thread = { id: crypto.randomBytes(4).toString("hex"), mode, opts, startedAt: Date.now(), messages: [] };
    if (mode === "chair") thread.gauges = Object.fromEntries(c.dossier.scenario.gauges.map((g) => [g.id, g.start]));
  }
  const kickoff = thread.messages.length === 0;
  const said = kickoff ? null : String(text || "").trim() || "[The learner stays silent and gestures for the others to continue.]";
  // The exact bytes sent are stored and replayed on later turns so the prompt cache keeps hitting.
  const api = `${P.stateNote(c, thread)}\n\n${kickoff ? M.kickoff(thread.opts) : said}`;

  try {
    const { text: raw } = await ai.run({
      system: [
        { type: "text", text: P.dossierBlock(c), cache_control: { type: "ephemeral" } },
        { type: "text", text: M.rules(thread.opts, c) },
      ],
      messages: [...thread.messages.map((m) => ({ role: m.role, content: m.api })), { role: "user", content: api }],
      effort: M.effort,
      onText: (delta) => send({ type: "delta", text: delta }),
      mock: mode,
    });
    const { says, meta } = parseTurn(raw, M.speaker || c.dossier.cast[0].id);
    thread.messages.push({ role: "user", api, text: kickoff ? null : text?.trim() || null, at: Date.now() });
    thread.messages.push({ role: "assistant", api: raw, says, meta, at: Date.now() });
    if (isNew) c.threads.push(thread);

    const known = new Set(c.dossier.concepts.map((k) => k.id));
    const newlyLit = [];
    for (const id of Array.isArray(meta?.lit) ? meta.lit : []) {
      if (!known.has(id)) continue;
      if (!c.lit[id]) newlyLit.push(id);
      c.lit[id] = { at: Date.now(), n: (c.lit[id]?.n || 0) + 1 };
    }
    if (mode === "chair" && meta?.gauges) {
      for (const g of c.dossier.scenario.gauges) {
        const v = Number(meta.gauges[g.id]);
        if (Number.isFinite(v)) thread.gauges[g.id] = Math.max(0, Math.min(100, Math.round(v)));
      }
      thread.done = !!meta.done;
    }
    if (mode === "hotseat" && meta?.score) {
      const vals = Object.values(meta.score).map(Number).filter(Number.isFinite);
      if (vals.length) c.scores.push({ at: Date.now(), avg: vals.reduce((a, b) => a + b, 0) / vals.length });
    }
    const memoryChanges = applyMemory(c, meta?.memory);
    touch(c);
    saveCase(c);
    send({ type: "done", case: view(c), threadId: thread.id, newlyLit, memoryChanges, ...ai.spendInfo() });
  } catch (err) {
    if (!(err instanceof ai.FriendlyError)) console.error(err);
    send({ type: "error", error: err instanceof ai.FriendlyError ? err.message : "That turn failed. Try sending it again." });
  }
  res.end();
}

async function api(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // after "api"
  const [a, id, b] = parts;

  if (a === "state" && req.method === "GET") return json(res, 200, stateInfo());
  if (a === "settings" && req.method === "POST") {
    const { model } = await readBody(req);
    if (!ai.MODELS[model]) return json(res, 400, { error: "Unknown model." });
    setMeta({ model });
    return json(res, 200, stateInfo());
  }
  if (a === "cases" && !id && req.method === "POST") {
    if (!ai.hasKey()) return json(res, 400, { error: "No API key found. Put ANTHROPIC_API_KEY in .env and restart." });
    return createCase(req, res);
  }
  if (a === "cases" && id) {
    const c = getCase(id);
    if (!c) return json(res, 404, { error: "That topic no longer exists." });
    if (!b && req.method === "GET") return json(res, 200, view(c));
    if (!b && req.method === "DELETE") {
      deleteCase(id);
      return json(res, 200, { ok: true });
    }
    if (b === "stance" && req.method === "POST") {
      const { value, confidence, why } = await readBody(req);
      c.stances.push({
        at: Date.now(),
        value: Math.max(-100, Math.min(100, Math.round(Number(value) || 0))),
        confidence: Math.max(0, Math.min(100, Math.round(Number(confidence) || 0))),
        why: String(why || "").slice(0, 400),
      });
      c.touchedAt ||= Date.now();
      saveCase(c);
      return json(res, 200, view(c));
    }
    if (b === "forget" && req.method === "POST") {
      const { id: entry } = await readBody(req);
      c.memory = (c.memory || []).filter((m) => m.id !== entry);
      saveCase(c);
      return json(res, 200, view(c));
    }
    if (b === "turn" && req.method === "POST") return turn(req, res, c);
    if (b === "playbook" && req.method === "POST") {
      try {
        const playbook = await ai.runJSON({
          system: [
            { type: "text", text: P.dossierBlock(c).split("Ground rules for every mode:")[0] },
            { type: "text", text: P.PLAYBOOK_SYSTEM },
          ],
          user: P.playbookUser(c),
          schema: P.PLAYBOOK_SCHEMA,
          maxTokens: 8000,
          mock: "playbook",
        });
        c.playbook = { at: Date.now(), ...playbook };
        touch(c);
        saveCase(c);
        return json(res, 200, { case: view(c), ...ai.spendInfo() });
      } catch (err) {
        if (!(err instanceof ai.FriendlyError)) console.error(err);
        return json(res, 500, { error: err instanceof ai.FriendlyError ? err.message : "Couldn't write the playbook. Try again." });
      }
    }
  }
  json(res, 404, { error: "Not found." });
}

// ---- static files + server ------------------------------------------------------------------

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

function serveStatic(res, url) {
  const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const file = path.join(root, "public", path.normalize(rel));
  if (!file.startsWith(path.join(root, "public") + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end("Not found");
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
  fs.createReadStream(file).pipe(res);
}

function authorized(req) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return true;
  const given = Buffer.from((req.headers.authorization || "").replace(/^Basic /, ""), "base64").toString().split(":").slice(1).join(":");
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(pw).digest();
  return crypto.timingSafeEqual(a, b);
}

http
  .createServer(async (req, res) => {
    try {
      if (!authorized(req)) {
        res.writeHead(401, { "www-authenticate": 'Basic realm="Crux"' });
        return res.end("Password required");
      }
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      serveStatic(res, url);
    } catch (err) {
      if (!(err instanceof ai.FriendlyError)) console.error(err);
      if (!res.headersSent) json(res, 500, { error: "Server error." });
      else res.end();
    }
  })
  .listen(PORT, HOST, () => {
    console.log(`\n  Crux is running →  http://localhost:${PORT}\n`);
    if (ai.isMock()) console.log("  MOCK mode: canned replies, no API calls.\n");
    else if (!ai.hasKey()) console.log("  ⚠  No ANTHROPIC_API_KEY found. Copy .env.example to .env and add your key.\n");
  });
