// Optional ElevenLabs voices: text-to-speech for replies, speech-to-text for browsers without
// built-in recognition. Enabled by setting ELEVENLABS_API_KEY in .env; the key never leaves the server.
import { getMeta, setMeta } from "./store.js";

const API = process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io/v1";
const key = () => process.env.ELEVENLABS_API_KEY;
export const hasVoice = () => !!key() && process.env.MOCK !== "1";

export class VoiceError extends Error {
  constructor(status, detail) {
    super(detail || `ElevenLabs returned ${status}`);
    this.status = status;
  }
}

async function fail(res) {
  let detail = "";
  try {
    const body = await res.json();
    detail = body?.detail?.message || body?.detail?.status || (typeof body?.detail === "string" ? body.detail : "");
  } catch {}
  throw new VoiceError(res.status, detail);
}

let voices; // cached list of voice ids this account may use
async function voiceIds() {
  if (voices) return voices;
  const fixed = (process.env.ELEVENLABS_VOICES || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (fixed.length) return (voices = fixed);
  const res = await fetch(`${API}/voices`, { headers: { "xi-api-key": key() } });
  if (!res.ok) await fail(res);
  const all = (await res.json()).voices || [];
  // Ready-made voices work on every plan; library voices may not be usable through the API on the free one.
  const premade = all.filter((v) => v.category === "premade");
  const pick = (premade.length ? premade : all).map((v) => v.voice_id);
  if (!pick.length) throw new VoiceError(404, "No voices are available on this ElevenLabs account.");
  return (voices = pick);
}

/** Speak `text` in the voice assigned to speaker slot `slot`. Returns MP3 bytes. */
export async function tts(text, slot) {
  const ids = await voiceIds();
  const id = ids[Math.abs(slot | 0) % ids.length];
  const res = await fetch(`${API}/text-to-speech/${id}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key(), "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5" }),
  });
  if (!res.ok) await fail(res);
  setMeta({ voiceChars: (getMeta().voiceChars || 0) + text.length });
  return Buffer.from(await res.arrayBuffer());
}

/** Transcribe recorded audio. Returns the text. */
export async function stt(buffer, mime) {
  const form = new FormData();
  form.append("model_id", process.env.ELEVENLABS_STT_MODEL || "scribe_v1");
  form.append("file", new Blob([buffer], { type: mime || "audio/webm" }), "speech.webm");
  const res = await fetch(`${API}/speech-to-text`, { method: "POST", headers: { "xi-api-key": key() }, body: form });
  if (!res.ok) await fail(res);
  return ((await res.json()).text || "").trim();
}
