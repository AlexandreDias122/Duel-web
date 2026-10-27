// Duel IA contre IA en Node, pour vérifier le moteur et l'IA avec les vraies données.
// Usage : npx tsx tests/ai-duel.ts [nombre de duels]
import createCore from "ocgcore-wasm";
import { readFileSync, existsSync } from "node:fs";
import { CardDb } from "../src/lib/cards";
import { DuelEngine } from "../src/engine/duel";
import { parseYdk } from "../src/lib/deck";
import type { FromWorker } from "../src/engine/protocol";

const db = new CardDb(JSON.parse(readFileSync("public/data/cards.json", "utf8")), JSON.parse(readFileSync("public/data/strings.json", "utf8")));
const starters: { name: string; ydk: string }[] = JSON.parse(readFileSync("public/data/decks/starter.json", "utf8"));
const baseScripts: string[] = JSON.parse(readFileSync("public/data/base-scripts.json", "utf8"));
const core = await createCore({ sync: true });
const readScript = (name: string) => {
  const p = `public/scripts/${name.split("/").pop()}`;
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

const n = Number(process.argv[2] ?? 4);
for (let i = 0; i < n; i++) {
  const a = starters[i % starters.length], b = starters[(i + 1) % starters.length];
  const decks = [parseYdk(a.ydk), parseYdk(b.ydk)] as const;
  let end: FromWorker | null = null;
  let updates = 0, prompts = 0, turn = 0;
  const engine = new DuelEngine(core, db, {
    decks: [decks[0], decks[1]], ai: [true, true], lp: 8000, baseScripts, readScript,
    seed: [BigInt(i + 1), 2n, 3n, 4n],
  }, (m) => {
    if (m.kind === "update") { updates++; turn = m.state.turn; }
    if (m.kind === "prompt") prompts++;
    if (m.kind === "end") end = m;
  });
  const t = Date.now();
  engine.run();
  console.log(`${a.name} vs ${b.name}:`, end, `tours=${turn} updates=${updates} prompts=${prompts} ${Date.now() - t}ms`);
  engine.destroy();
}
