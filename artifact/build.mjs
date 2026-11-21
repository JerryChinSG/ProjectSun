// Builds the Claude-hosted single-page version of Crux: artifact/crux.html
// It reuses the same prompts and parser as the local server version.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(here, "..", p), "utf8");
const strip = (js) => js.replace(/^export /gm, "").replace(/^import .*$/gm, "");

const html = `<title>Crux</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap">
<style>
${read("public/style.css")}
${read("artifact/extra.css")}
</style>
<header class="top">
  <button class="logo" id="home"><span class="sun"></span>CRUX</button>
  <div class="top-right">
    <label class="small dim" for="speed">Replies</label>
    <select id="speed" title="Sharper replies take longer to start">
      <option value="default">Sharper</option>
      <option value="quick">Quicker</option>
    </select>
  </div>
</header>
<main id="app"><p class="dim" style="text-align:center;padding:60px 0">Opening your topics…</p></main>
<div id="toasts"></div>
<script type="module">
${strip(read("public/parse.js"))}
${strip(read("public/memory.js"))}
${strip(read("lib/prompts.js"))}
${read("artifact/app.js")}
</script>
`;
fs.writeFileSync(path.join(here, "crux.html"), html);
console.log("wrote artifact/crux.html", (html.length / 1024).toFixed(0) + " KB");
