// Liste des decks WindBot jouables en Master Rule 5 (d'après bots.json de Project Ignis),
// limitée aux executors dont le fichier .ydk existe.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [src, out] = process.argv.slice(2);
const files = new Map();
for (const f of readdirSync(join(src, "Game/AI/Decks"))) {
  const code = readFileSync(join(src, "Game/AI/Decks", f), "utf8");
  for (const m of code.matchAll(/\[Deck\("([^"]+)",\s*"([^"]+)"/g)) files.set(m[1], m[2]);
}
const bots = JSON.parse(readFileSync(join(src, "bots.json"), "utf8"))
  .filter((b) => !b.masterRules || b.masterRules.includes(5))
  .filter((b) => files.has(b.deck) && existsSync(join(src, "Decks", `${files.get(b.deck)}.ydk`)))
  .map((b) => ({ name: b.name, deck: b.deck, difficulty: b.difficulty ?? 1 }))
  .sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(out, JSON.stringify(bots));
console.log(`decks WindBot : ${bots.length}`);
