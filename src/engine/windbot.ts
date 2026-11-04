// WindBot Ignite (C#, compilé en WebAssembly .NET) comme adversaire.
// Le bot reçoit exactement ce qu'un serveur EDOPro lui enverrait : les messages du moteur
// (avec les informations cachées masquées), plus les rafraîchissements du terrain avant chaque question.
import { OcgDuelMode } from "ocgcore-wasm";
import type { CardDb } from "../lib/cards";
import { LOC, POS, TYPE } from "../lib/constants";
import type { DeckList } from "./protocol";

/** Deck WindBot proposé dans l'appli (liste générée par scripts/build-windbot.sh). */
export interface WindBotDeck {
  /** Nom affiché. */
  name: string;
  /** Nom de l'executor WindBot. */
  deck: string;
  /** 1 (facile) à 5 (difficile), d'après Project Ignis. */
  difficulty: number;
}

interface Exports {
  Init(cards: Uint8Array): string;
  Create(deck: string, dialog: string): number;
  DeckOf(id: number): string;
  Feed(id: number, packet: Uint8Array): Uint8Array;
  TakeChat(id: number): string;
  Destroy(id: number): void;
}

interface DotnetModule {
  dotnet: {
    withConfig(c: object): DotnetModule["dotnet"];
    create(): Promise<{ getAssemblyExports(name: string): Promise<{ WindBot: { WasmBot: Exports } }> }>;
  };
}

const MSG = {
  RETRY: 1, HINT: 2, START: 4, UPDATE_DATA: 6, SHUFFLE_HAND: 33, SHUFFLE_EXTRA: 39, MOVE: 50, SET: 54, DRAW: 90, MISSED_EFFECT: 120,
} as const;
/** Questions du moteur (MSG_SELECT_*, MSG_ANNOUNCE_*…) : le joueur concerné est toujours le premier octet. */
export const PROMPT_IDS = new Set([10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 132, 140, 141, 142, 143]);
const STOC_GAME_MSG = 0x01;
const STOC_JOIN_GAME = 0x12;
/** Champs de requête que WindBot sait lire (Query.cs), plus IS_PUBLIC pour le masquage. */
export const WINDBOT_QUERY = 0x1 | 0x2 | 0x4 | 0x8 | 0x10 | 0x20 | 0x40 | 0x80 | 0x100 | 0x200 | 0x400 | 0x800 | 0x10000 | 0x40000 | 0x80000 | 0x100000 | 0x200000 | 0x400000 | 0x800000;
const QUERY_POSITION = 0x2;
const QUERY_IS_PUBLIC = 0x100000;
const QUERY_END = 0x80000000;
/** Zones rafraîchies avant chaque décision, comme le fait le serveur EDOPro. */
export const REFRESH_LOCATIONS = [LOC.MZONE, LOC.SZONE, LOC.HAND, LOC.GRAVE, LOC.REMOVED, LOC.EXTRA];

let runtime: Promise<WindBotRuntime> | null = null;

/** Charge WindBot une seule fois (≈ 3 Mo compressés) ; `dotnetUrl` pointe vers windbot/_framework/dotnet.js. */
export function loadWindBot(dotnetUrl: string, db: CardDb): Promise<WindBotRuntime> {
  runtime ??= (async () => {
    const mod = (await import(/* @vite-ignore */ dotnetUrl)) as DotnetModule;
    const rt = await mod.dotnet.withConfig({ disableIntegrityCheck: true }).create();
    const api = (await rt.getAssemblyExports("WindBotWasm.dll")).WindBot.WasmBot;
    const error = api.Init(encodeCards(db));
    if (error) throw new Error(`WindBot : ${error}`);
    return new WindBotRuntime(api);
  })();
  runtime.catch(() => (runtime = null));
  return runtime;
}

/** Cartes au format attendu par Bridge/CardsManager.cs. */
function encodeCards(db: CardDb): Uint8Array {
  const enc = new TextEncoder();
  const cards = [...db.cards.values()];
  const names = cards.map((c) => enc.encode(c.name).slice(0, 0xffff));
  const size = 4 + cards.reduce((n, _c, i) => n + 70 + names[i].length, 0);
  const buf = new Uint8Array(size);
  const v = new DataView(buf.buffer);
  let o = 0;
  v.setUint32(o, cards.length, true); o += 4;
  cards.forEach((c, i) => {
    const isLink = (c.type & TYPE.LINK) !== 0;
    v.setInt32(o, c.id, true); o += 4;
    v.setInt32(o, c.ot, true); o += 4;
    v.setInt32(o, c.alias, true); o += 4;
    v.setBigInt64(o, BigInt.asIntN(64, c.setcode), true); o += 8;
    v.setBigInt64(o, BigInt(c.type >>> 0), true); o += 8;
    v.setBigInt64(o, BigInt(((c.level & 0xff) | (c.rscale << 16) | (c.lscale << 24)) >>> 0), true); o += 8;
    v.setBigInt64(o, BigInt(c.race), true); o += 8;
    v.setBigInt64(o, BigInt(c.attribute >>> 0), true); o += 8;
    v.setInt32(o, c.atk, true); o += 4;
    v.setInt32(o, isLink ? c.linkMarker : c.def, true); o += 4;
    v.setUint16(o, names[i].length, true); o += 2;
    buf.set(names[i], o); o += names[i].length;
  });
  return buf;
}

export class WindBotRuntime {
  constructor(private api: Exports) {}

  /** Crée un bot pour l'executor donné (null si WindBot ne le connaît pas). */
  create(deck: string, player: number): WindBotPlayer | null {
    const id = this.api.Create(deck, "fr");
    return id ? new WindBotPlayer(this.api, id, player) : null;
  }
}

export class WindBotPlayer {
  /** Le bot a abandonné le duel. */
  surrendered = false;
  /** Messages sur lesquels WindBot a planté (l'IA maison répond alors à sa place). */
  errors = 0;
  /** Questions auxquelles WindBot a répondu / laissées à l'IA maison. */
  answered = 0;
  missed = 0;

  constructor(private api: Exports, private id: number, readonly player: number) {}

  /** Deck que joue l'executor (fichier .ydk de WindBot). */
  deck(): DeckList {
    const [main, extra] = this.api.DeckOf(this.id).split("|").map((s) => (s ? s.split(",").map(Number) : []));
    return { main, extra };
  }

  /** Paquets d'ouverture : salle (règles MR5) puis MSG_START. */
  start(lp: number, decks: [DeckList, DeckList]) {
    const join = new DataView(new ArrayBuffer(1 + 56));
    let o = 0;
    join.setUint8(o++, STOC_JOIN_GAME);
    o += 4 + 1 + 1; // lflist, rule, mode
    join.setUint8(o++, 5); // duel_rule
    o += 2 + 3; // nocheck, noshuffle, alignement
    join.setUint32(o, lp, true); o += 4;
    join.setUint8(o++, 5);
    join.setUint8(o++, 1);
    join.setUint16(o, 0, true); o += 2;
    o += 4;
    join.setUint32(o, 4043399681, true); o += 4; // SERVER_HANDSHAKE
    o += 4; // version
    join.setInt32(o, 1, true); o += 4;
    join.setInt32(o, 1, true); o += 4;
    join.setInt32(o, 1, true); o += 4; // best_of
    join.setInt32(o, Number(OcgDuelMode.MODE_MR5 & 0xffffffffn), true); o += 4;
    this.send(new Uint8Array(join.buffer));

    const start = new DataView(new ArrayBuffer(2 + 1 + 8 + 8));
    start.setUint8(0, STOC_GAME_MSG);
    start.setUint8(1, MSG.START);
    start.setUint8(2, this.player);
    start.setInt32(3, lp, true);
    start.setInt32(7, lp, true);
    start.setInt16(11, decks[0].main.length, true);
    start.setInt16(13, decks[0].extra.length, true);
    start.setInt16(15, decks[1].main.length, true);
    start.setInt16(17, decks[1].extra.length, true);
    this.send(new Uint8Array(start.buffer));
  }

  /** Message du moteur qui n'attend pas de réponse du bot. */
  observe(raw: Uint8Array) {
    const msg = this.filter(raw);
    if (msg) this.send(gameMsg(msg));
  }

  /**
   * Question du moteur adressée au bot. `refresh` fournit les zones du terrain (tampons de requête bruts),
   * envoyées juste avant comme MSG_UPDATE_DATA. Renvoie la réponse brute, ou null si WindBot n'en a pas.
   */
  respond(raw: Uint8Array, refresh: (player: number, location: number) => Uint8Array): Uint8Array | null {
    if (this.surrendered) return null;
    for (const p of [0, 1])
      for (const loc of REFRESH_LOCATIONS) {
        const data = maskQuery(refresh(p, loc), p !== this.player, loc);
        const packet = new Uint8Array(4 + data.length);
        packet.set([STOC_GAME_MSG, MSG.UPDATE_DATA, p, loc]);
        packet.set(data, 4);
        this.send(packet);
      }
    const answer = this.send(gameMsg(raw));
    if (answer) this.answered++;
    else this.missed++;
    return answer;
  }

  /** Répliques du bot depuis le dernier appel. */
  chat(): string[] {
    const text = this.api.TakeChat(this.id);
    return text ? text.split("\n") : [];
  }

  destroy() {
    this.api.Destroy(this.id);
  }

  private send(packet: Uint8Array): Uint8Array | null {
    const out = this.api.Feed(this.id, packet);
    switch (out[0]) {
      case 1: return out.slice(1);
      case 2: this.errors++; return null;
      case 3: this.surrendered = true; return null;
      default: return null;
    }
  }

  /** Ce que le serveur EDOPro transmettrait à ce joueur (null : rien), avec les cartes cachées masquées. */
  private filter(raw: Uint8Array): Uint8Array | null {
    const type = raw[0];
    const me = this.player;
    if (type === MSG.RETRY || type === MSG.MISSED_EFFECT) return null;
    if (PROMPT_IDS.has(type)) return null; // question d'un autre joueur (les siennes passent par respond)
    if (type === MSG.HINT) {
      const kind = raw[1], player = raw[2];
      if ([1, 2, 3, 5].includes(kind)) return player === me ? raw : null;
      if ([4, 6, 7, 8, 9, 11].includes(kind)) return player !== me ? raw : null;
      return raw;
    }
    const out = raw.slice();
    const v = new DataView(out.buffer);
    switch (type) {
      case MSG.DRAW: {
        if (out[1] === me) break;
        const count = v.getUint32(2, true);
        for (let i = 0; i < count; i++) {
          const at = 6 + i * 8;
          if (!(v.getUint32(at + 4, true) & POS.FACEUP)) v.setUint32(at, 0, true);
        }
        break;
      }
      case MSG.MOVE: {
        const toController = out[15], toLocation = out[16], toPosition = v.getUint32(21, true);
        const hidden = !(toLocation & (LOC.GRAVE | LOC.OVERLAY)) && (toLocation & (LOC.DECK | LOC.HAND) || toPosition & POS.FACEDOWN);
        if (toController !== me && hidden) v.setUint32(1, 0, true);
        break;
      }
      case MSG.SET:
        if (out[5] !== me) v.setUint32(1, 0, true);
        break;
      case MSG.SHUFFLE_HAND: case MSG.SHUFFLE_EXTRA:
        if (out[1] !== me) out.fill(0, 6);
        break;
    }
    return out;
  }
}

function gameMsg(msg: Uint8Array): Uint8Array {
  const packet = new Uint8Array(1 + msg.length);
  packet[0] = STOC_GAME_MSG;
  packet.set(msg, 1);
  return packet;
}

/**
 * Réécrit un tampon de OCG_DuelQueryLocation pour le bot : sans IS_PUBLIC (que WindBot ne lit pas),
 * et réduit à la position pour les cartes adverses cachées (main, face verso).
 */
export function maskQuery(buf: Uint8Array, opponent: boolean, location: number): Uint8Array {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const parts: Uint8Array[] = [];
  let o = 4;
  while (o + 2 <= buf.length) {
    const first = v.getUint16(o, true);
    if (first === 0) {
      parts.push(new Uint8Array(2));
      o += 2;
      continue;
    }
    const fields: { flag: number; bytes: Uint8Array }[] = [];
    let isPublic = false, position = 0;
    for (;;) {
      const size = v.getUint16(o, true);
      const flag = v.getUint32(o + 2, true);
      const bytes = buf.subarray(o, o + 2 + size);
      o += 2 + size;
      if (flag === QUERY_END) break;
      if (flag === QUERY_IS_PUBLIC) {
        isPublic = v.getUint8(o - 1) !== 0;
        continue;
      }
      if (flag === QUERY_POSITION) position = v.getUint32(o - 4, true);
      fields.push({ flag, bytes });
    }
    const hidden = opponent && !isPublic && (location === LOC.HAND || (position & POS.FACEDOWN) !== 0);
    for (const f of fields) if (!hidden || f.flag === QUERY_POSITION) parts.push(f.bytes);
    parts.push(new Uint8Array([4, 0, 0, 0, 0, 0x80]));
  }
  const total = 4 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  new DataView(out.buffer).setUint32(0, total, true);
  let w = 4;
  for (const p of parts) {
    out.set(p, w);
    w += p.length;
  }
  return out;
}
