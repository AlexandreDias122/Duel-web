// Duels IA contre IA en Node, pour vérifier le moteur et l'IA avec les vraies données.
// Usage : npx tsx tests/ai-duel.ts [nombre de duels] [starter|meta|profil]
//   starter : decks de démarrage entre eux
//   meta    : decks méta (avec leur profil) entre eux
//   profil  : chaque deck méta, avec profil contre le même deck sans profil
import createCore from "ocgcore-wasm";
import { OcgMessageType as T } from "ocgcore-wasm";
import { readFileSync, existsSync } from "node:fs";
import { CardDb } from "../src/lib/cards";
import { DuelEngine } from "../src/engine/duel";
import { parseYdk, validateDeck } from "../src/lib/deck";
import { AI_DECKS } from "../src/engine/aiDecks";
import { handTrapKind } from "../src/engine/cardKnowledge";
import type { DeckList, FromWorker } from "../src/engine/protocol";

const db = new CardDb(JSON.parse(readFileSync("public/data/cards.json", "utf8")), JSON.parse(readFileSync("public/data/strings.json", "utf8")));
const starters: { name: string; ydk: string }[] = JSON.parse(readFileSync("public/data/decks/starter.json", "utf8"));
const banlists = JSON.parse(readFileSync("public/data/banlists.json", "utf8"));
const baseScripts: string[] = JSON.parse(readFileSync("public/data/base-scripts.json", "utf8"));
const core = await createCore({ sync: true });
const readScript = (name: string) => {
  const p = `public/scripts/${name.split("/").pop()}`;
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

const n = Number(process.argv[2] ?? 4);
const mode = process.argv[3] ?? "starter";

// Les decks méta doivent être jouables tels quels avec la banlist TCG.
for (const d of AI_DECKS) {
  const errors = validateDeck(db, { main: d.main, extra: d.extra, side: [] }, banlists[0]);
  if (errors.length) console.log(`⚠ ${d.name} (${banlists[0].name}) :`, errors.join(" ; "));
  const missing = [...d.main, ...d.extra, ...d.plan, ...d.search, ...d.extraPlan].filter((c) => !db.get(c));
  if (missing.length) console.log(`⚠ ${d.name} : cartes inconnues`, [...new Set(missing)]);
}

type Entry = { name: string; list: DeckList };
const pairs: [Entry, Entry][] = [];
// DECKS=toon,branded : limiter aux decks méta voulus.
const only = process.env.DECKS?.split(",");
const meta = AI_DECKS.filter((d) => !only || only.includes(d.id)).map((d): Entry => ({ name: d.name, list: { main: d.main, extra: d.extra, profile: d.id } }));
for (let i = 0; i < n; i++) {
  if (mode === "meta") {
    const k = meta.length;
    const a = i % k, b = (a + 1 + Math.floor(i / k) % (k - 1)) % k;
    pairs.push([meta[a], meta[b]]);
  } else if (mode === "profil") {
    const m = meta[Math.floor(i / 2) % meta.length];
    const plain: Entry = { name: `${m.name} (sans profil)`, list: { main: m.list.main, extra: m.list.extra } };
    pairs.push(i % 2 ? [plain, m] : [m, plain]);
  } else {
    const a = starters[i % starters.length], b = starters[(i + 1) % starters.length];
    pairs.push([{ name: a.name, list: parseYdk(a.ydk) }, { name: b.name, list: parseYdk(b.ydk) }]);
  }
}

/** victoires, duels, duels en premier, Invocations Spéciales au tour 1, cartes sur le terrain à la fin du tour 1 */
const name = (c: number) => db.get(c)?.name ?? String(c);
function trace(turn: number, msg: import("ocgcore-wasm").OcgMessage) {
  const say = (p: number, t: string) => console.log(`    T${turn} J${p + 1} ${t}`);
  if (msg.type === T.CHAINING) say(msg.controller, `active ${name(msg.code)} (maillon ${msg.chain_size})`);
  if (msg.type === T.SUMMONING) say(msg.controller, `Invocation Normale ${name(msg.code)}`);
  if (msg.type === T.SPSUMMONING) say(msg.controller, `Invocation Spéciale ${name(msg.code)}`);
  if (msg.type === T.CHAIN_NEGATED || msg.type === T.CHAIN_DISABLED) console.log(`    T${turn} maillon ${msg.chain_size} annulé`);
  if (msg.type === T.MOVE && msg.card && msg.to.location === 0x2 && msg.from.location !== 0x2) say(msg.to.controller, `→ main : ${name(msg.card)}`);
  if (msg.type === T.MOVE && msg.card && msg.to.location === 0x10 && msg.from.location === 0x2) say(msg.to.controller, `défausse ${name(msg.card)}`);
  if (msg.type === T.SET) say(msg.controller, `pose une carte`);
  if (msg.type === T.ATTACK) say(msg.card.controller, `attaque`);
}

const wins = new Map<string, number[]>();
let badSummons = 0, errors = 0;
pairs.forEach(([a, b], i) => {
  let end: (FromWorker & { kind: "end" }) | null = null;
  let turn = 0, chains = 0, handTraps = 0, t1Summons = 0, t1Board = 0;
  const engine = new DuelEngine(core, db, {
    decks: [a.list, b.list], ai: [true, true], lp: 8000, baseScripts, readScript,
    // En mode profil, les deux sens d'un même duel partagent la graine : le joueur 1 a la même main.
    seed: [BigInt((mode === "profil" ? Math.floor(i / 2) : i) + 1 + Number(process.env.SEED ?? 0)), 2n, 3n, 4n],
  }, (m) => {
    if (m.kind === "update") {
      turn = m.state.turn;
      if (turn === 1) t1Board = m.state.players[0].mzone.filter(Boolean).length + m.state.players[0].szone.filter(Boolean).length;
      for (const msg of m.messages) {
        if (msg.type === T.SUMMONING && handTrapKind(db.get(msg.code))) {
          badSummons++;
          console.log(`  ✗ Invocation Normale d'une hand trap : ${db.get(msg.code)?.name}`);
        }
        if (msg.type === T.SPSUMMONING && turn === 1) t1Summons++;
        if (process.env.TRACE && turn <= Number(process.env.TRACE)) trace(turn, msg);
        if (msg.type === T.CHAINING) {
          chains++;
          if (handTrapKind(db.get(msg.code)) && msg.location === 0x2) handTraps++;
        }
      }
    }
    if (m.kind === "end") end = m;
    if (m.kind === "error") { errors++; console.log("  erreur :", m.error); }
  });
  const t = Date.now();
  try {
    engine.run();
  } catch (e) {
    errors++;
    console.log("  exception :", e);
  }
  const winner = end ? (end as { winner: number }).winner : -1;
  for (const [k, e] of [[0, a], [1, b]] as const) {
    const w = wins.get(e.name) ?? [0, 0, 0, 0, 0];
    w[1]++;
    if (winner === k) w[0]++;
    if (k === 0) { w[2]++; w[3] += t1Summons; w[4] += t1Board; }
    wins.set(e.name, w);
  }
  console.log(`${a.name} vs ${b.name}: gagnant=${winner === -1 ? "?" : winner === 0 ? a.name : b.name} (${end ? (end as { reason: string }).reason : "pas de fin"}) tours=${turn} activations=${chains} hand-traps=${handTraps} ${Date.now() - t}ms`);
  engine.destroy();
});
console.log("\nBilan :");
for (const [name, [w, p, f, ss, board]] of [...wins].sort((x, y) => y[1][0] / y[1][1] - x[1][0] / x[1][1]))
  console.log(`  ${name} : ${w}/${p}` + (f ? ` · tour 1 : ${(ss / f).toFixed(1)} Invoc. Spéciales, ${(board / f).toFixed(1)} cartes posées` : ""));
console.log(`Hand traps invoquées normalement : ${badSummons} ; erreurs : ${errors}`);
if (badSummons || errors) process.exitCode = 1;
