/// <reference lib="webworker" />
// Worker qui héberge le moteur : il garde l'interface fluide pendant le traitement.
import createCore from "ocgcore-wasm";
import wasmUrl from "ocgcore-wasm/lib/ocgcore.sync.wasm?url";
import { loadCardDb } from "../lib/cards";
import type { CardDb } from "../lib/cards";
import type { OcgCoreSync } from "ocgcore-wasm";
import { DuelEngine } from "./duel";
import { loadWindBot } from "./windbot";
import type { WindBotPlayer } from "./windbot";
import type { FromWorker, ToWorker } from "./protocol";

const scripts = new Map<string, string | null>();
let base = "";
let engine: DuelEngine | null = null;
let current = 0;
const post = (m: FromWorker) => self.postMessage({ ...m, duel: current });

// Le worker reste ouvert d'un duel à l'autre : cartes, moteur et scripts ne sont chargés qu'une fois.
let ready: Promise<[CardDb, string[], OcgCoreSync]> | null = null;
function load(): Promise<[CardDb, string[], OcgCoreSync]> {
  ready ??= Promise.all([
    loadCardDb(base),
    fetch(new URL("data/base-scripts.json", base)).then((r) => r.json() as Promise<string[]>),
    createCore({ sync: true, locateFile: () => wasmUrl }),
  ]);
  ready.catch(() => (ready = null));
  return ready;
}

function scriptUrl(name: string) {
  return new URL(`scripts/${name.split("/").pop()}`, base).href;
}

/** Lecture synchrone (autorisée dans un worker) pour les scripts non préchargés. */
function readScript(name: string): string | null {
  const key = name.split("/").pop()!;
  if (scripts.has(key)) return scripts.get(key)!;
  const xhr = new XMLHttpRequest();
  xhr.open("GET", scriptUrl(key), false);
  try {
    xhr.send();
  } catch {
    scripts.set(key, null);
    return null;
  }
  const text = xhr.status === 200 ? xhr.responseText : null;
  scripts.set(key, text);
  return text;
}

async function preload(names: string[]) {
  const todo = [...new Set(names)].filter((n) => !scripts.has(n));
  await Promise.all(
    todo.map(async (name) => {
      try {
        const r = await fetch(scriptUrl(name));
        scripts.set(name, r.ok ? await r.text() : null);
      } catch {
        // Réessayé en synchrone au besoin.
      }
    }),
  );
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    if (msg.kind === "warmup") {
      base = msg.base;
      const [, baseScripts] = await load();
      await preload(baseScripts);
    } else if (msg.kind === "start") {
      const o = msg.options;
      base = o.base;
      engine?.destroy();
      engine = null;
      current = msg.duel;
      post({ kind: "loading", text: "Chargement des cartes…" });
      const [db, baseScripts, core] = await load();
      if (current !== msg.duel) return;
      // WindBot joue ses propres decks : on récupère la liste de l'executor choisi.
      const bots: [WindBotPlayer | null, WindBotPlayer | null] = [null, null];
      const decks = o.decks.map((d) => ({ ...d }));
      if (decks.some((d) => d.windbot)) {
        post({ kind: "loading", text: "Chargement de WindBot…" });
        const wb = await loadWindBot(new URL("windbot/_framework/dotnet.js", base).href, db);
        if (current !== msg.duel) return;
        decks.forEach((d, p) => {
          if (!d.windbot) return;
          const bot = wb.create(d.windbot, p);
          if (!bot) throw new Error(`Deck WindBot introuvable : ${d.windbot}`);
          bots[p] = bot;
          Object.assign(d, bot.deck());
        });
      }
      o.decks = decks as typeof o.decks;
      post({ kind: "loading", text: "Chargement des scripts…" });
      const codes = [...o.decks[0].main, ...o.decks[0].extra, ...o.decks[1].main, ...o.decks[1].extra];
      await preload([...baseScripts, ...codes.map((c) => `c${c}.lua`)]);
      if (current !== msg.duel) return;
      engine = new DuelEngine(core, db, {
        decks: o.decks,
        ai: o.ai,
        lp: o.lp,
        rules: o.rules,
        seed: o.seed.map(BigInt) as [bigint, bigint, bigint, bigint],
        readScript,
        baseScripts,
        bots,
      }, post);
      engine.run();
    } else if (msg.kind === "respond") {
      if (msg.duel === current) engine?.respond(msg.response);
    } else if (msg.kind === "timeout") {
      if (msg.duel === current) engine?.timeout();
    }
  } catch (err) {
    console.error(err);
    post({ kind: "error", error: String((err as Error)?.stack ?? err) });
  }
};
