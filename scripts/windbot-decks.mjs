// Liste des decks WindBot jouables en Master Rule 5 (d'après bots.json de Project Ignis),
// limitée aux executors dont le fichier .ydk existe.
// Pour l'écran SOLO, chaque deck reçoit une carte phare (illustration), une description,
// et l'indication « préfère commencer en second » lue dans son executor (OnSelectHand).
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Carte phare et description de chaque deck (clé : nom de l'executor). */
/** Carte phare et description de chaque deck (clé : nom de l'executor), partagées avec l'appli. */
const INFO = JSON.parse(readFileSync(new URL("../src/engine/windbotInfo.json", import.meta.url), "utf8"));

const [src, out] = process.argv.slice(2);
const files = new Map();
const goSecond = new Set();
for (const f of readdirSync(join(src, "Game/AI/Decks"))) {
  const code = readFileSync(join(src, "Game/AI/Decks", f), "utf8");
  const decks = [...code.matchAll(/\[Deck\("([^"]+)",\s*"([^"]+)"/g)];
  for (const m of decks) files.set(m[1], m[2]);
  // Executor qui choisit de commencer en second au pile ou face.
  if (/override bool OnSelectHand\(\)\s*\{(?:\s*\/\/[^\n]*)*\s*return false;/.test(code))
    for (const m of decks) goSecond.add(m[1]);
}

/** Carte phare de repli : premier monstre de l'Extra Deck, sinon la carte la plus jouée du Main Deck. */
function fallbackCover(ydk) {
  const lines = readFileSync(ydk, "utf8").split(/\r?\n/);
  const main = [], extra = [];
  let part = null;
  for (const l of lines) {
    if (l.startsWith("#main")) part = main;
    else if (l.startsWith("#extra")) part = extra;
    else if (l.startsWith("!")) part = null;
    else if (part && /^\d+$/.test(l.trim())) part.push(Number(l));
  }
  if (extra.length) return extra[0];
  const count = new Map();
  for (const c of main) count.set(c, (count.get(c) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

const bots = JSON.parse(readFileSync(join(src, "bots.json"), "utf8"))
  .filter((b) => !b.masterRules || b.masterRules.includes(5))
  .filter((b) => files.has(b.deck) && existsSync(join(src, "Decks", `${files.get(b.deck)}.ydk`)))
  .map((b) => {
    const { cover, blurb } = INFO[b.deck] ?? { cover: fallbackCover(join(src, "Decks", `${files.get(b.deck)}.ydk`)), blurb: "" };
    return { name: b.name, deck: b.deck, difficulty: b.difficulty ?? 1, cover, blurb, ...(goSecond.has(b.deck) ? { goSecond: true } : {}) };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(out, JSON.stringify(bots));
console.log(`decks WindBot : ${bots.length} (${bots.filter((b) => b.goSecond).length} préfèrent commencer en second)`);
