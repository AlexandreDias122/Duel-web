/// <reference lib="webworker" />
// Worker qui héberge le moteur : il garde l'interface fluide pendant le traitement.
import createCore from "ocgcore-wasm";
import wasmUrl from "ocgcore-wasm/lib/ocgcore.sync.wasm?url";
import { loadCardDb } from "../lib/cards";
import { DuelEngine } from "./duel";
import type { FromWorker, ToWorker } from "./protocol";

const post = (m: FromWorker) => self.postMessage(m);
const scripts = new Map<string, string | null>();
let base = "";
let engine: DuelEngine | null = null;

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
    if (msg.kind === "start") {
      const o = msg.options;
      base = o.base;
      post({ kind: "loading", text: "Chargement des cartes…" });
      const [db, baseScripts, core] = await Promise.all([
        loadCardDb(base),
        fetch(new URL("data/base-scripts.json", base)).then((r) => r.json() as Promise<string[]>),
        createCore({ sync: true, locateFile: () => wasmUrl }),
      ]);
      post({ kind: "loading", text: "Chargement des scripts…" });
      const codes = [...o.decks[0].main, ...o.decks[0].extra, ...o.decks[1].main, ...o.decks[1].extra];
      await preload([...baseScripts, ...codes.map((c) => `c${c}.lua`)]);
      engine?.destroy();
      engine = new DuelEngine(core, db, {
        decks: o.decks,
        ai: o.ai,
        lp: o.lp,
        seed: o.seed.map(BigInt) as [bigint, bigint, bigint, bigint],
        readScript,
        baseScripts,
      }, post);
      engine.run();
    } else if (msg.kind === "respond") {
      engine?.respond(msg.response);
    }
  } catch (err) {
    console.error(err);
    post({ kind: "error", error: String((err as Error)?.stack ?? err) });
  }
};
