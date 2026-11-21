// MOCK=1 canned responses so the UI can be exercised without an API key or spending credit.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dossier = {
  title: "Rate hikes vs. war inflation",
  claim: "Raising interest rates won't solve inflation caused by an Iran war.",
  hook: "Rate hikes cool demand, but a war mainly cuts supply. Whether central banks should 'look through' a supply shock or fight it anyway splits economists.",
  concepts: [
    { id: "supply-demand", name: "Supply vs demand inflation", blurb: "Prices can rise because people want to buy more, or because there is less to buy.", why: "Rate hikes only directly act on the demand side.", requires: [] },
    { id: "transmission", name: "How rate hikes work", blurb: "Higher rates make borrowing costlier, slowing spending, hiring and investment.", why: "Shows what the tool can and cannot reach.", requires: [] },
    { id: "oil-shock", name: "Oil price shock", blurb: "A sudden jump in energy costs that ripples through transport and production.", why: "The main channel from an Iran war to prices.", requires: ["supply-demand"] },
    { id: "expectations", name: "Inflation expectations", blurb: "What people believe inflation will be shapes the wages and prices they set.", why: "The best argument for hiking into a supply shock.", requires: ["transmission"] },
    { id: "second-round", name: "Second-round effects", blurb: "When a one-off price jump feeds into wages and other prices and becomes persistent.", why: "Determines whether 'looking through' is safe.", requires: ["oil-shock", "expectations"] },
    { id: "stagflation", name: "Stagflation", blurb: "High inflation together with weak growth and rising unemployment.", why: "The trap policymakers fear in a supply shock.", requires: ["oil-shock"] },
    { id: "volcker", name: "The Volcker precedent", blurb: "The Fed crushed 1970s inflation with very high rates at the cost of a deep recession.", why: "Both sides cite it.", requires: ["stagflation", "expectations"] },
    { id: "credibility", name: "Central bank credibility", blurb: "Whether the public trusts the bank to bring inflation back to target.", why: "Hawks say it must be defended at any cost.", requires: ["second-round"] },
  ],
  cast: [
    { id: "ingrid", name: "Ingrid Vasquez", emoji: "🦅", role: "former central bank governor", worldview: "Credibility is everything.", stance: -70, voice: "Clipped, precise, dry.", core: "You hike not to produce oil but to stop the shock becoming a spiral." },
    { id: "tomas", name: "Tomas Adeyemi", emoji: "🛢️", role: "energy market analyst", worldview: "Fix the supply, not the demand.", stance: 80, voice: "Blunt, numbers-first.", core: "No interest rate reopens the Strait of Hormuz." },
    { id: "mei", name: "Mei Lindqvist", emoji: "🧮", role: "labor economist", worldview: "Workers pay for policy mistakes.", stance: 50, voice: "Warm but pointed.", core: "Hiking into a supply shock adds unemployment to a cost-of-living crisis." },
    { id: "rafi", name: "Rafi Okonkwo", emoji: "📜", role: "economic historian", worldview: "It depends on expectations.", stance: 0, voice: "Storyteller, loves 1973.", core: "The same shock ended differently in Germany and Britain; the response is what mattered." },
  ],
  cruxes: [
    { id: "anchored", question: "Are inflation expectations firmly anchored today?", kind: "empirical", if_yes: "Banks can look through the shock; the claim gains.", if_no: "Hikes are needed to prevent a spiral; the claim weakens." },
    { id: "duration", question: "Will the supply disruption be short-lived?", kind: "empirical", if_yes: "Hiking is pointless pain.", if_no: "Persistent shocks bleed into everything." },
    { id: "pain", question: "Is a recession an acceptable price for price stability?", kind: "values", if_yes: "Hawks win.", if_no: "The claim is more attractive." },
  ],
  facts: [
    { text: "Roughly a fifth of global oil consumption passes through the Strait of Hormuz.", source: "EIA" },
    { text: "The US federal funds rate peaked near 20% in 1981 under Volcker.", source: "Federal Reserve" },
    { text: "US unemployment reached 10.8% in late 1982.", source: "BLS" },
  ],
  misconceptions: ["Rate hikes lower oil prices directly.", "All inflation is the same.", "Volcker proved hikes always work."],
  scenario: {
    role: "Governor of the central bank",
    setup: "It is the morning after the Strait of Hormuz was closed. Oil is up 40% overnight and your phone will not stop ringing.",
    gauges: [
      { id: "inflation", name: "Inflation", start: 55, good: "low" },
      { id: "jobs", name: "Employment", start: 70, good: "high" },
      { id: "trust", name: "Public trust", start: 60, good: "high" },
    ],
  },
};

const playbook = {
  readiness: 28,
  readiness_note: "You can state the supply/demand distinction but have not yet defended it under pressure.",
  pitch: "Rate hikes fight inflation by cooling demand, but a war cuts supply. Hiking can't produce oil — it can only make people poorer until they buy less. The real job is keeping expectations anchored, and that may need only modest tightening.",
  arguments: [{ point: "Wrong tool for the cause", support: "Hikes act on borrowing and demand; the shock is a physical supply cut." }],
  counters: [{ they_say: "Volcker proved hikes work.", you_say: "He was fighting a decade of unanchored expectations, not a fresh shock — and it cost 10.8% unemployment." }],
  concessions: ["If expectations de-anchor, some tightening is unavoidable."],
  questions: ["Do you think expectations are anchored right now?"],
  phrases: ["'Look through the shock' — when arguing for patience."],
  gaps: ["Second-round effects"],
  next_session: "Take the Hot Seat on the flip side to learn the hawk case.",
};

const chat = {
  learn: `<say who="sol">Welcome! Before I teach you anything — in one sentence, what's your **gut take**: can a central bank fix prices that are rising because of a war?</say><meta>{"lit":["supply-demand"],"memory":[{"id":"","point":"A war cuts supply, and rate hikes only act on demand.","status":"solid","evidence":"the war cuts supply"},{"id":"","point":"Believes rate hikes directly lower oil prices.","status":"wrong","evidence":"hikes make oil cheaper"}],"focus":"supply-demand","chips":["Give me a hint","What counts as fixing?","Why would it not work?"]}</meta>`,
  table: `<say who="tomas">Ingrid, you can hike to twenty percent and not one extra barrel comes through Hormuz.</say><say who="ingrid">I'm not trying to produce oil, Tomas. I'm trying to stop a one-off jump becoming a **wage-price spiral**.</say><say who="rafi">Germany and Britain got the same shock in 1973 and ended up in very different places. You, new arrival — which of these two is closer to right?</say><meta>{"crux":"anchored","lit":[],"chips":["I side with Tomas because…","What happened in 1973?","Ingrid, what's your evidence?"]}</meta>`,
  hotseat: `<say who="vex">Decent start — but you said hikes "do nothing". Then why did inflation fall after 1981? Be specific.</say><meta>{"score":{"clarity":4,"evidence":2,"logic":3,"rebuttal":2},"note":"Clear claim, but you offered no evidence and overstated it.","upgrade":"Rate hikes can't restore lost supply; they lower inflation only by shrinking demand to match. That works, but the cost is jobs — so the question is whether expectations are at risk enough to justify it.","fallacy":"Overgeneralisation","chips":["That was a different situation","Fair, let me narrow my claim","What would you accept as evidence?"]}</meta>`,
  chair: `<say who="narrator">Dawn. Oil is at $140. Your deputy slides the overnight numbers across the desk: petrol queues, airlines grounding flights, and a union leader on every channel demanding raises.</say><say who="ingrid">Governor, if you blink now they'll never believe you again.</say><meta>{"gauges":{"inflation":68,"jobs":66,"trust":55},"options":["Emergency rate hike of 1 point","Hold rates and give a calming speech","Cut rates to cushion the economy"],"turn":1,"done":false,"lit":[]}</meta>`,
};

export async function mockRun({ mock, onText }) {
  let text;
  if (mock === "dossier") text = JSON.stringify(dossier);
  else if (mock === "playbook") text = JSON.stringify(playbook);
  else text = chat[mock] || chat.learn;
  if (onText) {
    for (let i = 0; i < text.length; i += 12) {
      onText(text.slice(i, i + 12));
      await sleep(15);
    }
  } else await sleep(300);
  return { text, msg: { stop_reason: "end_turn", content: [{ type: "text", text }] }, usd: 0 };
}
