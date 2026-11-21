// Shared by server and browser: turn the model's tagged output into speech bubbles + metadata.
// Format the model writes:
//   <say who="id">spoken text</say> ... <meta>{"json": true}</meta>
// Works on partial text too, so the browser can render while the reply is still streaming.
export function parseTurn(raw, fallbackWho = "sol") {
  const says = [];
  const body = raw.split("<meta")[0];
  const re = /<say who="([^"]+)">([\s\S]*?)(?:<\/say>|$)/g;
  let m;
  while ((m = re.exec(body))) {
    const text = m[2].replace(/<[^>]*$/, "").trim(); // drop a half-streamed tag
    if (text) says.push({ who: m[1].trim().toLowerCase(), text });
  }
  if (!says.length) {
    const text = body.replace(/<[^>]*>?/g, "").trim();
    if (text) says.push({ who: fallbackWho, text });
  }
  let meta = null;
  const mm = /<meta>([\s\S]*?)<\/meta>/.exec(raw);
  if (mm) {
    try {
      meta = JSON.parse(mm[1]);
    } catch {
      meta = null;
    }
  }
  return { says, meta };
}
