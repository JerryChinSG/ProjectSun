// The knowledge ledger: what the learner has DEMONSTRATED, never what they were merely told.
// Shared by the server, the browser and the Claude-hosted page.
const DAY = 86400000;
const STEPS = [1, 3, 7, 14, 30]; // days until a solid idea is due for a re-check; grows each time it's shown again
const STATUSES = ["solid", "shaky", "wrong"];

/** Merge the model's per-turn evidence into the ledger. Returns what changed, for toasts. */
export function applyMemory(c, updates, now = Date.now()) {
  c.memory ||= [];
  c.memorySeq ||= 0;
  const changes = [];
  for (const u of Array.isArray(updates) ? updates.slice(0, 4) : []) {
    if (!u || !STATUSES.includes(u.status)) continue;
    const point = String(u.point || "").trim().slice(0, 260);
    let e = u.id ? c.memory.find((m) => m.id === u.id) : null;
    if (!e) {
      if (!point) continue;
      e = { id: "m" + ++c.memorySeq, point, n: 0, firstAt: now };
      c.memory.push(e);
    } else if (point) e.point = point;
    const before = e.status;
    e.status = u.status;
    e.evidence = String(u.evidence || "").trim().slice(0, 260);
    e.lastAt = now;
    if (u.status === "solid") {
      e.n = (e.n || 0) + 1;
      e.due = now + STEPS[Math.min(e.n - 1, STEPS.length - 1)] * DAY;
    } else {
      e.n = u.status === "wrong" ? 0 : Math.max(0, (e.n || 0) - 1);
      e.due = now; // comes back at the next opportunity
    }
    changes.push({ id: e.id, point: e.point, status: e.status, before });
  }
  if (c.memory.length > 80) c.memory = c.memory.slice(-80);
  return changes;
}

export const isDue = (e, now = Date.now()) => e.status === "solid" && e.due <= now;

/** The ledger as the model sees it at the top of each user message. */
export function memoryNote(c, now = Date.now()) {
  const m = c.memory || [];
  if (!m.length) return "<memory>empty: the learner has not demonstrated anything yet</memory>";
  const line = (label, items) => (items.length ? `${label}: ${items.map((e) => `[${e.id}] ${e.point}`).join(" | ")}\n` : "");
  return `<memory>
${line("solid (shown correctly, recently)", m.filter((e) => e.status === "solid" && !isDue(e, now)))}${line("solid but due for a re-check", m.filter((e) => isDue(e, now)))}${line("shaky", m.filter((e) => e.status === "shaky"))}${line("misconceptions the learner holds", m.filter((e) => e.status === "wrong"))}</memory>`;
}

const memEsc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const ago = (t, now) => {
  const d = Math.floor((now - t) / DAY);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};

/** The "what you've shown you know" card for the topic page. */
export function memoryHTML(c, now = Date.now()) {
  const m = c.memory || [];
  const group = (title, cls, items) =>
    items.length
      ? `<div class="mem-group ${cls}"><div class="mem-title">${title} <span>${items.length}</span></div>${items
          .map(
            (e) => `<div class="mem"><div><b>${memEsc(e.point)}</b>${isDue(e, now) ? ` <span class="tag">due</span>` : ""}
            ${e.evidence ? `<div class="dim small">You said: “${memEsc(e.evidence)}”</div>` : ""}
            <div class="dim small">${e.status === "solid" ? `shown ${e.n}× · ` : ""}last ${ago(e.lastAt, now)}</div></div>
            <button class="del" data-forget="${e.id}" title="Remove: I don't actually know this" aria-label="Remove from memory">✕</button></div>`,
          )
          .join("")}</div>`
      : "";
  const due = m.filter((e) => isDue(e, now) || e.status !== "solid").length;
  return `<div class="card"><h3>What you've shown you know</h3>
    ${
      m.length
        ? group("Solid", "ok", m.filter((e) => e.status === "solid")) +
          group("Shaky", "mid", m.filter((e) => e.status === "shaky")) +
          group("To fix", "bad", m.filter((e) => e.status === "wrong")) +
          (due ? `<div style="margin-top:12px"><button class="btn sm" id="quizdue">Quiz me on the ${due} that need work</button></div>` : "")
        : `<p class="dim small" style="margin:0">Nothing yet. An idea lands here only when you explain or apply it correctly in your own words. Being told something doesn't count.</p>`
    }</div>`;
}
