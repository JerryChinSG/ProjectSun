// Tiny JSON-on-disk persistence. Everything lives in ./data (git-ignored).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = process.env.DATA_DIR || path.join(root, "data");
const CASES = path.join(DATA, "cases");
fs.mkdirSync(CASES, { recursive: true });

const read = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const write = (file, value) => {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  fs.renameSync(tmp, file);
};

const metaFile = path.join(DATA, "meta.json");
export const getMeta = () => ({ spend: 0, calls: 0, model: null, ...read(metaFile, {}) });
export const setMeta = (patch) => {
  const next = { ...getMeta(), ...patch };
  write(metaFile, next);
  return next;
};

const caseFile = (id) => path.join(CASES, `${id.replace(/[^a-z0-9-]/gi, "")}.json`);
export const getCase = (id) => read(caseFile(id), null);
export const saveCase = (c) => write(caseFile(c.id), c);
export const deleteCase = (id) => fs.rmSync(caseFile(id), { force: true });
export const listCases = () =>
  fs
    .readdirSync(CASES)
    .filter((f) => f.endsWith(".json"))
    .map((f) => read(path.join(CASES, f), null))
    .filter(Boolean)
    .sort((a, b) => (b.touchedAt || 0) - (a.touchedAt || 0));
