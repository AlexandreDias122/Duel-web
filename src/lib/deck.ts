// Decks : format .ydk, URL YDKE, validation et sauvegarde locale.
import type { CardDb } from "./cards";
import { isExtra } from "./cards";

export interface Deck {
  id: string;
  name: string;
  main: number[];
  extra: number[];
  side: number[];
  updated: number;
}

export function parseYdk(text: string): { main: number[]; extra: number[]; side: number[] } {
  const out = { main: [] as number[], extra: [] as number[], side: [] as number[] };
  let section: keyof typeof out = "main";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "#main") section = "main";
    else if (line === "#extra") section = "extra";
    else if (line === "!side") section = "side";
    else if (/^\d+$/.test(line)) out[section].push(Number(line));
  }
  return out;
}

export function toYdk(deck: Pick<Deck, "main" | "extra" | "side">): string {
  return ["#created by ygo-web", "#main", ...deck.main, "#extra", ...deck.extra, "!side", ...deck.side, ""].join("\n");
}

function encodeList(list: number[]): string {
  const bytes = new Uint8Array(list.length * 4);
  const view = new DataView(bytes.buffer);
  list.forEach((c, i) => view.setUint32(i * 4, c, true));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function decodeList(b64: string): number[] {
  const bin = atob(b64);
  const out: number[] = [];
  for (let i = 0; i + 3 < bin.length; i += 4)
    out.push((bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8) | (bin.charCodeAt(i + 2) << 16) | (bin.charCodeAt(i + 3) << 24)) >>> 0);
  return out;
}

export function toYdke(deck: Pick<Deck, "main" | "extra" | "side">): string {
  return `ydke://${encodeList(deck.main)}!${encodeList(deck.extra)}!${encodeList(deck.side)}!`;
}

export function parseYdke(url: string): { main: number[]; extra: number[]; side: number[] } | null {
  const m = url.trim().match(/^ydke:\/\/([^!]*)!([^!]*)!([^!]*)!?$/);
  if (!m) return null;
  try {
    return { main: decodeList(m[1]), extra: decodeList(m[2]), side: decodeList(m[3]) };
  } catch {
    return null;
  }
}

export type Banlist = { name: string; cards: Record<string, number> };

export function limitOf(db: CardDb, id: number, banlist: Banlist | null): number {
  if (!banlist) return 3;
  const base = db.baseId(id);
  return banlist.cards[base] ?? banlist.cards[id] ?? 3;
}

export function validateDeck(db: CardDb, deck: Pick<Deck, "main" | "extra" | "side">, banlist: Banlist | null): string[] {
  const errors: string[] = [];
  if (deck.main.length < 40) errors.push(`Main Deck : ${deck.main.length}/40 cartes minimum`);
  if (deck.main.length > 60) errors.push(`Main Deck : ${deck.main.length}/60 cartes maximum`);
  if (deck.extra.length > 15) errors.push(`Extra Deck : ${deck.extra.length}/15 maximum`);
  if (deck.side.length > 15) errors.push(`Side Deck : ${deck.side.length}/15 maximum`);
  const counts = new Map<number, number>();
  for (const id of [...deck.main, ...deck.extra, ...deck.side]) {
    const base = db.baseId(id);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  for (const [id, n] of counts) {
    const lim = limitOf(db, id, banlist);
    if (n > lim) errors.push(`${db.get(id)?.name ?? id} : ${n} exemplaires (limite ${lim})`);
  }
  for (const id of deck.main) {
    const c = db.get(id);
    if (c && isExtra(c)) errors.push(`${c.name} doit aller dans l'Extra Deck`);
  }
  return errors;
}

const KEY = "ygo-web.decks";

export function loadDecks(): Deck[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveDecks(decks: Deck[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(decks));
  } catch {
    // Stockage indisponible (navigation privée) : les decks restent en mémoire.
  }
}

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}
