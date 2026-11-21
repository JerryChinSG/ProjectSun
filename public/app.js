import { parseTurn } from "/parse.js";
import { memoryHTML } from "/memory.js";

const $ = (sel, el = document) => el.querySelector(sel);
const app = $("#app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>");

let G = null; // global state: cases, spend, model…
let C = null; // current case
let R = {}; // current room state

const MODES = {
  learn: { ico: "☀️", name: "The Guide", min: 20, blurb: "Sol teaches the concept map by asking, not telling. Explain an idea in your own words and it lights up." },
  table: { ico: "🍷", name: "The Table", min: 15, blurb: "Four people who disagree are mid-argument. Pull up a chair, take sides, get pushed." },
  hotseat: { ico: "🔥", name: "The Hot Seat", min: 15, blurb: "Vex cross-examines you. Every answer is scored and rewritten stronger. Try defending the side you reject." },
  chair: { ico: "🪑", name: "The Chair", min: 10, blurb: "You're the one deciding. Make six calls and live with what follows." },
};
const FIXED = {
  sol: { name: "Sol", role: "your guide", emoji: "☀️", color: "#ffb84d" },
  vex: { name: "Vex", role: "cross-examiner", emoji: "⚔️", color: "#ff5c7a" },
  narrator: { name: "Narrator", role: "", emoji: "📖", color: "#9aa7c7" },
};
const CAST_COLORS = ["#ff8a5c", "#5cc8ff", "#b08cff", "#6fdc8c"];

function speaker(who) {
  if (FIXED[who]) return FIXED[who];
  const i = C.dossier.cast.findIndex((p) => p.id === who || p.name.toLowerCase().split(" ")[0] === who);
  if (i < 0) return { name: who, role: "", emoji: "💬", color: "#9aa7c7" };
  const p = C.dossier.cast[i];
  return { name: p.name, role: p.role, emoji: p.emoji, color: CAST_COLORS[i % 4], id: p.id };
}

// ---- plumbing -------------------------------------------------------------------------------

function toast(text, err) {
  const el = document.createElement("div");
  el.className = "toast" + (err ? " err" : "");
  el.textContent = text;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), err ? 7000 : 4000);
}

async function api(path, body, method) {
  const res = await fetch("/api/" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function stream(path, body, onEvent) {
  const res = await fetch("/api/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.headers.get("content-type")?.includes("event-stream")) throw new Error((await res.json()).error || "Request failed");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (line.startsWith("data: ")) onEvent(JSON.parse(line.slice(6)));
    }
  }
}

function renderTop() {
  if (!G) return;
  const sel = $("#model");
  sel.innerHTML = G.models.map((m) => `<option value="${m.id}" ${m.id === G.model ? "selected" : ""}>${esc(m.label)} — ${esc(m.note)}</option>`).join("");
  sel.onchange = async () => {
    Object.assign(G, await api("settings", { model: sel.value }));
    toast("Model switched. It applies from your next message.");
  };
  const pct = Math.min(100, (G.spend / G.budget) * 100);
  $("#spend").innerHTML = `${G.mock ? "MOCK · " : ""}$${G.spend.toFixed(2)} of $${G.budget} used<div class="bar"><i style="width:${pct}%"></i></div>`;
}
const setSpend = (e) => {
  if (e.spend != null) Object.assign(G, { spend: e.spend, budget: e.budget });
  renderTop();
};

// ---- home -----------------------------------------------------------------------------------

const EXAMPLES = [
  "Raising interest rates won't solve the inflation caused by an Iran war",
  "Remote work is making companies less innovative",
  "Nuclear power is essential to hitting net zero",
  "AI will take more jobs than it creates this decade",
  "CRISPR gene editing",
];

async function home() {
  G = await api("state");
  renderTop();
  C = null;
  app.innerHTML = `
    ${G.hasKey ? "" : `<div class="banner"><b>No API key yet.</b> Copy <code>.env.example</code> to <code>.env</code>, paste your Anthropic key, and restart with <code>npm start</code>.</div>`}
    <section class="hero">
      <div class="eyebrow">Learn it by arguing it</div>
      <h1>What do you want to be able to hold your own on?</h1>
      <p>Type a claim, a question, or just a subject. Crux researches it, maps what you need to know, and seats you at a table of people who disagree.</p>
      <form class="ask" id="ask">
        <textarea id="topic" placeholder="e.g. Raising interest rates won't solve the inflation caused by an Iran war" maxlength="400"></textarea>
        <button class="btn" ${G.hasKey ? "" : "disabled"}>Open it →</button>
      </form>
      <div class="examples">${EXAMPLES.map((e) => `<button class="chip" data-ex="${esc(e)}">${esc(e)}</button>`).join("")}</div>
    </section>
    ${
      G.cases.length
        ? `<div class="eyebrow">Your topics</div>
      <div class="cases">${G.cases
        .map(
          (c) => `<a class="card case" href="#/c/${c.id}">
            <button class="del" data-del="${c.id}" title="Delete topic">✕</button>
            <h3>${esc(c.title)}</h3>
            <div class="dim small">${esc(c.claim)}</div>
            <div class="meter"><i style="width:${(c.lit / c.total) * 100}%"></i></div>
            <div class="dim small">${c.lit}/${c.total} concepts lit · ${c.minutes} min practised${c.streak > 1 ? ` · ${c.streak}-day streak` : ""}</div>
          </a>`,
        )
        .join("")}</div>`
        : ""
    }
    <section class="steps">
      ${Object.values(MODES)
        .map((m) => `<div class="card"><span style="font-size:1.5rem">${m.ico}</span><b>${m.name}</b><span class="dim small">${m.blurb}</span></div>`)
        .join("")}
      <div class="card"><span style="font-size:1.5rem">📓</span><b>The Playbook</b><span class="dim small">Your position, best arguments and comebacks, written from what you actually said.</span></div>
    </section>`;
  const ta = $("#topic");
  app.querySelectorAll("[data-ex]").forEach((b) => (b.onclick = () => ((ta.value = b.dataset.ex), ta.focus())));
  app.querySelectorAll("[data-del]").forEach(
    (b) =>
      (b.onclick = async (e) => {
        e.preventDefault();
        if (!confirm("Delete this topic and all its sessions?")) return;
        await api("cases/" + b.dataset.del, null, "DELETE");
        home();
      }),
  );
  ta.onkeydown = (e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), $("#ask").requestSubmit());
  $("#ask").onsubmit = (e) => {
    e.preventDefault();
    if (ta.value.trim()) genesis(ta.value.trim());
  };
}

async function genesis(topic) {
  app.innerHTML = `<section class="genesis">
    <div class="rise"><i></i></div>
    <div class="eyebrow">Opening a new topic</div>
    <h1 style="font-size:1.6rem;max-width:22em;margin:8px auto">${esc(topic)}</h1>
    <p class="dim">This takes about a minute. Crux is researching it now.</p>
    <div class="feed" id="feed"></div></section>`;
  const feed = $("#feed");
  const add = (cls, text) => feed.insertAdjacentHTML("beforeend", `<div class="${cls}">${text}</div>`);
  try {
    let failed = null;
    await stream("cases", { topic }, (e) => {
      if (e.type === "stage") add("stage", esc(e.text) + "…");
      else if (e.type === "search") add("", "🔎 " + esc(e.text));
      else if (e.type === "error") failed = e.error;
      else if (e.type === "done") {
        C = e.case;
        setSpend(e);
      }
    });
    if (failed || !C) throw new Error(failed || "The connection dropped. Try again.");
    location.hash = `#/c/${C.id}`;
  } catch (err) {
    toast(err.message, true);
    home();
  }
}

// ---- stance ---------------------------------------------------------------------------------

function stanceModal(first) {
  const last = C.stances.at(-1);
  const el = document.createElement("div");
  el.className = "modal";
  el.innerHTML = `<div class="card">
    <div class="eyebrow">${first ? "Gut check — before you learn anything" : "Where do you stand now?"}</div>
    <h2>${esc(C.dossier.claim)}</h2>
    <input type="range" id="sv" min="-100" max="100" step="5" value="${last?.value ?? 0}" />
    <div class="range-labels"><span>Strongly disagree</span><span>Unsure</span><span>Strongly agree</span></div>
    <label class="small dim">How confident are you? <b id="cl">${last?.confidence ?? 30}%</b></label>
    <input type="range" id="cv" min="0" max="100" step="5" value="${last?.confidence ?? 30}" />
    <div style="height:10px"></div>
    <label class="small dim">In a sentence — why? (optional)</label>
    <textarea id="why" maxlength="400" placeholder="${first ? "No wrong answers. This is your 'before' picture." : "What moved you, or what kept you where you were?"}"></textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      ${first ? "" : `<button class="btn ghost" id="cancel">Cancel</button>`}
      <button class="btn" id="save">Record it</button>
    </div></div>`;
  document.body.append(el);
  $("#cv", el).oninput = (e) => ($("#cl", el).textContent = e.target.value + "%");
  if (!first) $("#cancel", el).onclick = () => el.remove();
  $("#save", el).onclick = async () => {
    C = await api(`cases/${C.id}/stance`, { value: +$("#sv", el).value, confidence: +$("#cv", el).value, why: $("#why", el).value });
    el.remove();
    route();
  };
}

// ---- hub ------------------------------------------------------------------------------------

function mapHTML(sel) {
  const ks = C.dossier.concepts;
  const byId = Object.fromEntries(ks.map((k) => [k.id, k]));
  const depth = {};
  const d = (k, seen = new Set()) => {
    if (depth[k.id] != null) return depth[k.id];
    if (seen.has(k.id)) return 0;
    seen.add(k.id);
    return (depth[k.id] = k.requires.length ? 1 + Math.max(...k.requires.map((r) => (byId[r] ? d(byId[r], seen) : -1))) : 0);
  };
  ks.forEach((k) => d(k));
  const maxD = Math.max(...Object.values(depth));
  const rows = Array.from({ length: maxD + 1 }, (_, i) => ks.filter((k) => depth[k.id] === i));
  const pos = {};
  rows.forEach((row, i) => {
    // keep children near their prerequisites so fewer lines cross
    const mean = (k) => (k.requires.filter((r) => pos[r]).reduce((a, r) => a + pos[r].x, 0) / (k.requires.filter((r) => pos[r]).length || 1)) || 50;
    if (i) row.sort((a, b) => mean(a) - mean(b));
    row.forEach((k, j) => {
      pos[k.id] = { x: ((j + 1) / (row.length + 1)) * 100, y: maxD === 0 ? 50 : 86 - (i / maxD) * 74 };
    });
  });
  const lit = C.lit;
  const ready = (k) => !lit[k.id] && k.requires.every((r) => lit[r]);
  return `<div class="map">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">${ks
      .flatMap((k) => k.requires.filter((r) => pos[r]).map((r) => `<line x1="${pos[r].x}" y1="${pos[r].y}" x2="${pos[k.id].x}" y2="${pos[k.id].y}" class="${lit[r] && lit[k.id] ? "on" : ""}"/>`))
      .join("")}</svg>
    ${ks
      .map(
        (k) => `<button class="node ${lit[k.id] ? "lit" : ready(k) ? "next" : ""} ${sel === k.id ? "sel" : ""}" style="left:${pos[k.id].x}%;top:${pos[k.id].y}%" data-k="${k.id}"><i></i><span>${esc(k.name)}</span></button>`,
      )
      .join("")}
  </div>`;
}

function driftHTML() {
  const s = C.stances;
  if (!s.length) return `<p class="dim small">No stance recorded yet.</p>`;
  const x = (i) => (s.length === 1 ? 150 : 10 + (i / (s.length - 1)) * 280);
  const y = (v) => 50 - v * 0.42;
  return `<div class="drift">
    <svg viewBox="0 0 300 100" preserveAspectRatio="none">
      <line x1="0" y1="50" x2="300" y2="50" stroke="#2a3660" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>
      <polyline fill="none" stroke="#ffb84d" stroke-width="2" vector-effect="non-scaling-stroke" points="${s.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")}"/>
    </svg>
    <div class="axis"><span>↑ agree · ↓ disagree</span><span>${s.length} check-in${s.length > 1 ? "s" : ""}</span></div>
    <p class="small" style="margin:8px 0 0">Now: <b>${s.at(-1).value > 0 ? "+" : ""}${s.at(-1).value}</b> at ${s.at(-1).confidence}% confidence${
      s.length > 1 ? ` <span class="dim">(started at ${s[0].value > 0 ? "+" : ""}${s[0].value})</span>` : ""
    }${s.at(-1).why ? `<br><span class="dim">“${esc(s.at(-1).why)}”</span>` : ""}</p></div>`;
}

function hub(selConcept) {
  const d = C.dossier;
  const litN = Object.keys(C.lit).length;
  const mins = Math.round((C.days[C.today]?.ms || 0) / 60000);
  const recent = C.scores.slice(-5);
  const strength = recent.length ? (recent.reduce((a, s) => a + s.avg, 0) / recent.length).toFixed(1) : "–";
  const k = d.concepts.find((x) => x.id === selConcept);
  const rounds = (m) => C.threads.filter((t) => t.mode === m).length;
  app.innerHTML = `
    <a class="dim small" href="#/">← all topics</a>
    <div class="eyebrow" style="margin-top:14px">${esc(d.title)}${C.researched ? " · researched live " + esc(C.createdDay) : ""}</div>
    <h1 class="claim">“${esc(d.claim)}”</h1>
    <div class="dim">${esc(d.hook)}</div>
    <div class="stats">
      <div class="stat"><b>${litN}/${d.concepts.length}</b>concepts lit</div>
      <div class="stat"><b>${mins}/60</b>min today</div>
      <div class="stat"><b>${C.streak}</b>day streak</div>
      <div class="stat"><b>${(C.memory || []).filter((m) => m.status === "solid").length}</b>ideas shown</div>
      <div class="stat"><b>${strength}</b>/5 argument strength</div>
    </div>
    <div class="grid">
      <div class="stack">
        <div class="card">
          <h3>Your map <span class="dim small" style="font-family:var(--sans);font-weight:400">— foundations at the bottom; tap a concept</span></h3>
          ${mapHTML(selConcept)}
          ${
            k
              ? `<div class="concept"><b>${esc(k.name)}</b> ${C.lit[k.id] ? "☀️" : ""}<br>${esc(k.blurb)}<br><span class="dim">${esc(k.why)}</span>
                 <div style="margin-top:8px"><button class="btn sm" id="teach">${C.lit[k.id] ? "Quiz me on this" : "Teach me this"}</button></div></div>`
              : ""
          }
        </div>
        ${memoryHTML(C)}
        <div class="card"><h3>What it turns on</h3>
          ${d.cruxes
            .map(
              (x) => `<div class="crux"><b>${esc(x.question)}</b><span class="tag">${x.kind}</span>
              <div class="yn"><div>If yes → ${esc(x.if_yes)}</div><div>If no → ${esc(x.if_no)}</div></div></div>`,
            )
            .join("")}
        </div>
        <div class="card">
          <details><summary>Facts to have at your fingertips</summary><ul>${d.facts.map((f) => `<li>${esc(f.text)} <span class="dim">(${esc(f.source)})</span></li>`).join("")}</ul></details>
          <details style="margin-top:10px"><summary>What newcomers get wrong</summary><ul>${d.misconceptions.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></details>
        </div>
      </div>
      <div class="stack">
        <div class="card"><h3>Today's hour</h3>
          <div class="stations">
            ${Object.entries(MODES)
              .map(
                ([id, m]) => `<a class="station" href="#/c/${C.id}/${id}"><div class="ico">${m.ico}</div>
                <div><b>${m.name}</b><p>${m.blurb}</p></div><div class="min">${m.min} min${rounds(id) ? `<br>${rounds(id)} round${rounds(id) > 1 ? "s" : ""}` : ""}</div></a>`,
              )
              .join("")}
            <a class="station" href="#/c/${C.id}/playbook"><div class="ico">📓</div>
              <div><b>The Playbook</b><p>Your 30-second pitch, best arguments, comebacks and weak spots — rebuilt from your sessions.</p></div><div class="min">end of day</div></a>
          </div>
        </div>
        <div class="card"><h3>Your stance over time</h3>${driftHTML()}
          <div style="margin-top:10px"><button class="btn ghost sm" id="restance">Update my stance</button></div></div>
        <div class="card"><h3>Who's at the table</h3>
          ${d.cast
            .map(
              (p, i) => `<div class="cast-row" style="--c:${CAST_COLORS[i % 4]}"><div class="av">${esc(p.emoji)}</div>
              <div><b>${esc(p.name)}</b> <span class="dim">· ${esc(p.role)}</span><br><span class="dim small">${esc(p.core)}</span>
              <div class="lean"><i style="left:${(p.stance + 100) / 2}%"></i></div></div></div>`,
            )
            .join("")}
        </div>
      </div>
    </div>`;
  app.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => hub(b.dataset.k)));
  $("#restance").onclick = () => stanceModal(false);
  app.querySelectorAll("[data-forget]").forEach(
    (b) =>
      (b.onclick = async () => {
        C = await api(`cases/${C.id}/forget`, { id: b.dataset.forget });
        hub(selConcept);
      }),
  );
  if ($("#quizdue"))
    $("#quizdue").onclick = () => {
      R = { pending: "Quiz me on what's due for review, what I'm shaky on, and what I had wrong." };
      location.hash = `#/c/${C.id}/learn`;
    };
  if (k)
    $("#teach").onclick = () => {
      R = { pending: C.lit[k.id] ? `Quiz me on "${k.name}".` : `Teach me "${k.name}".` };
      location.hash = `#/c/${C.id}/learn`;
    };
  if (!C.stances.length) stanceModal(true);
}

// ---- rooms ----------------------------------------------------------------------------------

const pips = (n) => `<span class="pips">${"●".repeat(n)}<u>${"●".repeat(Math.max(0, 5 - n))}</u></span>`;

function scoreHTML(meta) {
  if (!meta?.score) return "";
  return `<div class="score"><div class="dims">${Object.entries(meta.score)
    .map(([k, v]) => `<span>${esc(k)} ${pips(Math.max(0, Math.min(5, Math.round(+v) || 0)))}</span>`)
    .join("")}</div>
    ${meta.fallacy ? `<div class="fallacy">⚠ ${esc(meta.fallacy)}</div>` : ""}
    <div>${esc(meta.note || "")}</div>
    ${meta.upgrade ? `<details><summary>Say it stronger</summary><blockquote>${esc(meta.upgrade)}</blockquote></details>` : ""}</div>`;
}

const sayHTML = (s) => {
  const p = speaker(s.who);
  return `<div class="msg them" style="--c:${p.color}"><div class="av">${esc(p.emoji)}</div><div class="bub">
    <div class="who">${esc(p.name)}${p.role ? ` <span>· ${esc(p.role)}</span>` : ""}</div><div class="txt">${md(s.text)}</div></div></div>`;
};
const meHTML = (text) => `<div class="msg me"><div class="bub"><div class="txt">${esc(text)}</div></div></div>`;

function threadFor(mode) {
  if (R.fresh) return null;
  return C.threads.filter((t) => t.mode === mode).at(-1) || null;
}

function room(mode) {
  const M = MODES[mode];
  const pending = R.pending;
  R = { mode, fresh: R.mode === mode ? R.fresh : false, opts: R.mode === mode ? R.opts : null, busy: false };
  const t = threadFor(mode);
  const lastMeta = t?.messages.at(-1)?.meta || {};
  const d = C.dossier;
  const tts = localStorage.getItem("crux-tts") === "1";

  let chrome = "";
  if (mode === "table")
    chrome = `<div class="seats">${d.cast
      .map(
        (p, i) => `<button class="seat" data-seat="${p.id}" style="--c:${CAST_COLORS[i % 4]}" title="Address ${esc(p.name)}">
        <div class="av">${esc(p.emoji)}</div><b>${esc(p.name.split(" ")[0])}</b><span>${esc(p.role)}</span><div class="lean"><i style="left:${(p.stance + 100) / 2}%"></i></div></button>`,
      )
      .join("")}</div>`;
  if (mode === "chair" && t)
    chrome = `<div class="gauges">${d.scenario.gauges
      .map((g) => {
        const v = t.gauges?.[g.id] ?? g.start;
        const ok = g.good === "high" ? v >= 50 : v <= 50;
        return `<div class="gauge">${esc(g.name)} <b>${v}</b><div class="meter"><i style="width:${v}%;background:${ok ? "var(--good)" : "var(--bad)"}"></i></div></div>`;
      })
      .join("")}</div>`;

  const needsStart = !t && (mode === "hotseat" || mode === "chair") && !R.opts;
  const stance = C.stances.at(-1)?.value ?? 0;
  const startHTML =
    mode === "hotseat"
      ? `<div class="start"><div style="font-size:2.4rem">🔥</div><h2>Pick a side to defend</h2>
          <p>“${esc(d.claim)}”<br><br>Arguing the side you <i>reject</i> is the fastest way to understand it. You'll be graded on whether a true believer would nod along.</p>
          <div class="row"><button class="btn${stance < 0 ? " ghost" : ""}" data-side="for">Argue FOR it${stance < 0 ? " (flip)" : ""}</button>
          <button class="btn${stance >= 0 ? " ghost" : ""}" data-side="against">Argue AGAINST it${stance > 0 ? " (flip)" : ""}</button></div></div>`
      : `<div class="start"><div style="font-size:2.4rem">🪑</div><h2>${esc(d.scenario.role)}</h2>
          <p>${esc(d.scenario.setup)}</p><div class="row"><button class="btn" data-side="go">Take the chair</button></div></div>`;

  app.innerHTML = `<section class="room">
    <div class="room-head">
      <a class="back" href="#/c/${C.id}">← ${esc(d.title)}</a>
      <h2>${M.ico} ${M.name}${t?.opts?.side ? ` <span class="dim small" style="font-family:var(--sans)">· arguing ${t.opts.side}${t.opts.flip ? " (flip)" : ""}</span>` : ""}</h2>
      <button class="btn ghost sm" id="tts" title="Read replies aloud">${tts ? "🔊 Voice on" : "🔈 Voice off"}</button>
      ${t ? `<button class="btn ghost sm" id="fresh">New round</button>` : ""}
    </div>
    <div>${chrome}</div>
    <div class="log" id="log">${
      needsStart
        ? startHTML
        : (t?.messages || [])
            .map((m) => (m.role === "user" ? (m.text ? meHTML(m.text) : "") : scoreHTML(m.meta) + (m.says || []).map(sayHTML).join("")))
            .join("")
    }</div>
    <div class="composer" ${needsStart ? "hidden" : ""}>
      <div id="quick"></div>
      <div class="inrow">
        <textarea id="say" rows="1" placeholder="${mode === "table" ? "Jump in… (tap a seat to address someone)" : "Say it in your own words…"}"></textarea>
        <button class="icon" id="mic" title="Speak your answer">🎙️</button>
        ${mode === "table" ? `<button class="btn ghost" id="pass" title="Stay quiet and let them argue">Let them argue</button>` : ""}
        <button class="btn" id="send">Send</button>
      </div>
    </div></section>`;

  const log = $("#log");
  const say = $("#say");
  const scroll = () => (log.scrollTop = log.scrollHeight);
  scroll();

  const quick = () => {
    const meta = threadFor(mode)?.messages.at(-1)?.meta || {};
    const done = mode === "chair" && threadFor(mode)?.done;
    const opts = mode === "chair" ? meta.options || [] : [];
    const chips = meta.chips || [];
    $("#quick").innerHTML =
      (opts.length ? `<div class="options">${opts.map((o) => `<button class="chip" data-send="${esc(o)}">${esc(o)}</button>`).join("")}</div>` : "") +
      (chips.length ? `<div class="chips">${chips.map((c) => `<button class="chip" data-chip="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : "") +
      (done ? `<div class="chips"><a class="btn sm" href="#/c/${C.id}/playbook">Debrief in the Playbook →</a></div>` : "");
    $("#quick").querySelectorAll("[data-send]").forEach((b) => (b.onclick = () => send(b.dataset.send)));
    $("#quick").querySelectorAll("[data-chip]").forEach(
      (b) =>
        (b.onclick = () => {
          const c = b.dataset.chip;
          if (/…|\.\.\.$/.test(c)) {
            say.value = c.replace(/…|\.\.\.$/, " ");
            say.focus();
          } else send(c);
        }),
    );
  };

  async function send(text, kickoff) {
    if (R.busy) return;
    R.busy = true;
    speechSynthesis?.cancel();
    $("#quick").innerHTML = "";
    if (!kickoff && text) log.insertAdjacentHTML("beforeend", meHTML(text));
    const live = document.createElement("div");
    live.style.display = "grid";
    live.style.gap = "12px";
    live.innerHTML = `<div class="typing">${mode === "table" ? "The table reacts" : mode === "chair" ? "Events unfold" : speaker(mode === "learn" ? "sol" : "vex").name + " is thinking"}</div>`;
    log.append(live);
    scroll();
    say.value = "";
    say.style.height = "";
    let buf = "";
    let result = null;
    let failed = null;
    try {
      await stream(`cases/${C.id}/turn`, { mode, threadId: threadFor(mode)?.id, text, opts: R.opts || {} }, (e) => {
        if (e.type === "delta") {
          buf += e.text;
          const { says } = parseTurn(buf, mode === "learn" ? "sol" : mode === "hotseat" ? "vex" : mode === "chair" ? "narrator" : C.dossier.cast[0].id);
          if (says.length) live.innerHTML = says.map(sayHTML).join("");
          app.querySelectorAll(".seat").forEach((s) => s.classList.toggle("speaking", says.at(-1)?.who === s.dataset.seat));
          scroll();
        } else if (e.type === "error") failed = e.error;
        else if (e.type === "done") result = e;
      });
      if (failed || !result) throw new Error(failed || "The connection dropped. Try again.");
      C = result.case;
      setSpend(result);
      R.fresh = false;
      for (const ch of result.memoryChanges || [])
        toast(ch.status === "solid" ? `Added to what you know: ${ch.point}` : ch.status === "shaky" ? `Marked shaky: ${ch.point}` : `Flagged to fix: ${ch.point}`);
      for (const id of result.newlyLit || []) toast(`☀️ Lit: ${C.dossier.concepts.find((k) => k.id === id)?.name}`);
      const said = C.threads.find((x) => x.id === result.threadId).messages.at(-1);
      R.busy = false;
      if (!location.hash.endsWith(`/${C.id}/${mode}`)) return; // navigated away mid-reply
      const draft = say.value;
      room(mode);
      $("#say").value = draft;
      if (localStorage.getItem("crux-tts") === "1") speak(said.says || []);
      return;
    } catch (err) {
      live.remove();
      toast(err.message, true);
      if (!kickoff && text) {
        log.lastElementChild?.remove();
        say.value = text;
      }
      quick();
    }
    R.busy = false;
  }

  quick();
  say.oninput = () => {
    say.style.height = "";
    say.style.height = Math.min(160, say.scrollHeight) + "px";
  };
  say.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (say.value.trim()) send(say.value.trim());
    }
  };
  $("#send").onclick = () => say.value.trim() && send(say.value.trim());
  if ($("#pass")) $("#pass").onclick = () => send("");
  if ($("#fresh"))
    $("#fresh").onclick = () => {
      R.fresh = true;
      R.opts = null;
      room(mode);
    };
  $("#tts").onclick = () => {
    localStorage.setItem("crux-tts", tts ? "0" : "1");
    speechSynthesis?.cancel();
    const draft = say.value;
    room(mode);
    $("#say").value = draft;
  };
  app.querySelectorAll("[data-seat]").forEach(
    (b) =>
      (b.onclick = () => {
        say.value = `@${speaker(b.dataset.seat).name.split(" ")[0]} ${say.value.replace(/^@\S+\s*/, "")}`;
        say.focus();
      }),
  );
  app.querySelectorAll("[data-side]").forEach(
    (b) =>
      (b.onclick = () => {
        const side = b.dataset.side;
        R.opts = mode === "hotseat" ? { side, flip: (side === "for" && stance < 0) || (side === "against" && stance > 0) } : {};
        R.fresh = true;
        room(mode);
      }),
  );
  setupMic($("#mic"), say);

  if (!needsStart && !t) send(null, true).then(() => pending && send(pending));
  else if (pending && !needsStart) send(pending);
}

// ---- voice ----------------------------------------------------------------------------------

function speak(says) {
  if (!window.speechSynthesis) return;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  const names = [...new Set(says.map((s) => s.who))];
  for (const s of says) {
    const u = new SpeechSynthesisUtterance(s.text.replace(/\*/g, ""));
    if (voices.length) u.voice = voices[(names.indexOf(s.who) * 3 + s.who.length) % voices.length];
    u.rate = 1.05;
    speechSynthesis.speak(u);
  }
}

function setupMic(btn, target) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    btn.hidden = true;
    return;
  }
  let rec = null;
  btn.onclick = () => {
    if (rec) return rec.stop();
    const base = target.value ? target.value.trimEnd() + " " : "";
    rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      target.value = base + [...e.results].map((r) => r[0].transcript).join("");
      target.oninput?.();
    };
    rec.onend = () => {
      rec = null;
      btn.classList.remove("on");
    };
    rec.onerror = (e) => e.error !== "aborted" && e.error !== "no-speech" && toast("Microphone: " + e.error, true);
    rec.start();
    btn.classList.add("on");
  };
}

// ---- playbook -------------------------------------------------------------------------------

function playbook() {
  const p = C.playbook;
  const turns = C.threads.reduce((a, t) => a + t.messages.filter((m) => m.role === "user" && m.text).length, 0);
  const list = (items) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
  app.innerHTML = `<section class="pb">
    <a class="dim small" href="#/c/${C.id}">← ${esc(C.dossier.title)}</a>
    <div><div class="eyebrow">The Playbook</div><h1 class="claim">How you'd argue this tomorrow</h1>
      <div class="dim">Written from what you actually said across ${turns} turn${turns === 1 ? "" : "s"}. Rebuild it after each day's session.</div></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn" id="build">${p ? "Rebuild from my latest sessions" : "Write my playbook"}</button>
      <button class="btn ghost" id="restance">Update my stance first</button>
    </div>
    ${
      !p
        ? `<div class="card dim">${turns < 3 ? "Tip: it gets much better once you've done a round or two at the Table or in the Hot Seat." : "Ready when you are."}</div>`
        : `
    <div class="card" style="display:flex;gap:16px;align-items:center"><div class="ring" style="--p:${p.readiness}"><b>${p.readiness}</b></div>
      <div><h3>Discussion readiness</h3><div class="dim">${esc(p.readiness_note)}</div><div class="small" style="margin-top:6px">Next: ${esc(p.next_session)}</div></div></div>
    <div class="card"><div class="eyebrow">Your 30-second pitch</div><p class="pitch">${esc(p.pitch)}</p></div>
    <div class="card"><h3>Your best arguments</h3><ol>${p.arguments.map((a) => `<li><b>${esc(a.point)}</b><br><span class="dim">${esc(a.support)}</span></li>`).join("")}</ol></div>
    <div class="card"><h3>When they say… you say…</h3>${p.counters.map((c) => `<div class="qa"><div class="q">“${esc(c.they_say)}”</div><div class="a">→ ${esc(c.you_say)}</div></div>`).join("")}</div>
    <div class="grid">
      <div class="card"><h3>Concede these gracefully</h3>${list(p.concessions)}</div>
      <div class="card"><h3>Questions that open people up</h3>${list(p.questions)}</div>
      <div class="card"><h3>Phrases that show you know the terrain</h3>${list(p.phrases)}</div>
      <div class="card"><h3>Your weak spots</h3>${list(p.gaps)}</div>
    </div>
    <div class="dim small">Last built ${new Date(p.at).toLocaleString()}</div>`
    }</section>`;
  $("#restance").onclick = () => stanceModal(false);
  $("#build").onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Reading your sessions…";
    try {
      const r = await api(`cases/${C.id}/playbook`, {});
      C = r.case;
      setSpend(r);
    } catch (err) {
      toast(err.message, true);
    }
    playbook();
  };
}

// ---- router ---------------------------------------------------------------------------------

async function route() {
  speechSynthesis?.cancel();
  document.querySelectorAll(".modal").forEach((m) => m.remove());
  const [, kind, id, sub] = location.hash.split("/");
  try {
    if (kind !== "c" || !id) return await home();
    if (!G) {
      G = await api("state");
      renderTop();
    }
    if (C?.id !== id) C = await api("cases/" + id);
    if (!sub) return hub();
    if (sub === "playbook") return playbook();
    if (MODES[sub]) return room(sub);
    hub();
  } catch (err) {
    toast(err.message, true);
    if (kind === "c") location.hash = "#/";
  }
}
window.addEventListener("hashchange", route);
route();
