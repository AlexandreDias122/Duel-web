// Pilotage d'un duel ygopro-core : boucle de traitement, état du terrain, IA.
import { OcgCoreInternal, OcgDuelMode, OcgMessageType as T, OcgProcessResult, OcgResponseType } from "ocgcore-wasm";
import type { OcgCoreSync, OcgDuelHandle, OcgLocation, OcgMessage, OcgResponse } from "ocgcore-wasm";
import type { CardDb } from "../lib/cards";
import { LOC, POS } from "../lib/constants";
import { BasicAi, PROMPT_TYPES } from "./ai";
import type { DeckList, DuelState, FieldCard, FromWorker, PlayerState } from "./protocol";

export interface DuelSetup {
  decks: [DeckList, DeckList];
  ai: [boolean, boolean];
  seed: [bigint, bigint, bigint, bigint];
  lp: number;
  /** Lecture synchrone d'un script Lua (null s'il n'existe pas). */
  readScript: (name: string) => string | null;
  baseScripts: string[];
}

const QUERY_FLAGS =
  0x1 | 0x2 | 0x8 | 0x10 | 0x20 | 0x100 | 0x200 | 0x400 | 0x800 | 0x10000 | 0x20000 | 0x100000 | 0x200000 | 0x400000 | 0x800000;

function seededRandom(seed: readonly bigint[]): () => number {
  let a = Number(seed[0] & 0xffffffffn) | 1, b = Number(seed[1] & 0xffffffffn), c = Number(seed[2] & 0xffffffffn), d = Number(seed[3] & 0xffffffffn);
  // sfc32, avec quelques tours à vide pour bien mélanger les petites graines
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
  for (let i = 0; i < 20; i++) next();
  return next;
}

function shuffle<T>(list: readonly T[], rng: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Questions qui n'appellent pas de vraie décision du joueur, comme dans Master Duel :
 * fenêtre de chaîne sans carte activable, et placement quand une seule zone est libre.
 */
function autoResponse(prompt: OcgMessage): OcgResponse | null {
  if (prompt.type === T.SELECT_CHAIN && prompt.selects.length === 0) return { type: OcgResponseType.SELECT_CHAIN, index: null };
  if (prompt.type === T.SELECT_PLACE && prompt.count === 1) {
    const free: number[] = [];
    for (let bit = 0; bit < 32; bit++) if (bit % 16 !== 7 && !(prompt.field_mask & (1 << bit))) free.push(bit);
    if (free.length !== 1) return null;
    const bit = free[0] % 16;
    return {
      type: OcgResponseType.SELECT_PLACE,
      places: [{ player: free[0] >= 16 ? 1 - prompt.player : prompt.player, location: (bit < 8 ? LOC.MZONE : LOC.SZONE) as OcgLocation, sequence: bit % 8 }],
    };
  }
  return null;
}

/** Temps de réaction simulé de l'IA, seulement quand elle prend une vraie décision. */
function thinkTime(prompt: OcgMessage, response: OcgResponse): number {
  const jitter = (min: number, max: number) => Math.round(min + Math.random() * (max - min));
  switch (prompt.type) {
    case T.SELECT_IDLECMD: return jitter(900, 1700);
    case T.SELECT_BATTLECMD: return jitter(700, 1300);
    case T.SELECT_CHAIN:
      if (!prompt.selects.length) return 0;
      return (response as { index: number | null }).index === null ? jitter(300, 600) : jitter(800, 1400);
    case T.SELECT_EFFECTYN: case T.SELECT_YESNO: case T.SELECT_OPTION: return jitter(500, 900);
    case T.SELECT_CARD: case T.SELECT_UNSELECT_CARD: case T.SELECT_TRIBUTE: case T.SELECT_SUM: return jitter(600, 1100);
    case T.SELECT_PLACE: case T.SELECT_POSITION: return jitter(250, 500);
    default: return 0;
  }
}

export class DuelEngine {
  private duel: OcgDuelHandle;
  private ai: BasicAi;
  private lp: [number, number];
  private turn = 0;
  private turnPlayer = 0;
  private phase = 0;
  private hint: [bigint, bigint] = [0n, 0n];
  private pending: OcgMessage | null = null;
  private finished = false;
  /** Maillon en cours de résolution (0 si aucun). */
  private solving = 0;

  constructor(private core: OcgCoreSync, private db: CardDb, private setup: DuelSetup, private emit: (m: FromWorker) => void) {
    this.ai = new BasicAi(db);
    this.lp = [setup.lp, setup.lp];
    const team = { startingLP: setup.lp, startingDrawCount: 5, drawCountPerTurn: 1 };
    const duel = core.createDuel({
      flags: OcgDuelMode.MODE_MR5,
      seed: setup.seed,
      team1: team,
      team2: team,
      cardReader: (code) => {
        const c = db.get(code);
        if (!c) return null;
        const setcodes: number[] = [];
        for (let s = c.setcode; s; s >>= 16n) if (s & 0xffffn) setcodes.push(Number(s & 0xffffn));
        return {
          code: c.id, alias: c.alias, setcodes, type: c.type, level: c.level, attribute: c.attribute, race: BigInt(c.race),
          attack: c.atk, defense: c.def, lscale: c.lscale, rscale: c.rscale, link_marker: c.linkMarker,
        };
      },
      scriptReader: (name) => setup.readScript(name),
      errorHandler: (type, text) => console.warn("[ocgcore]", type, text),
    });
    if (!duel) throw new Error("Impossible de créer le duel");
    this.duel = duel;
    for (const name of ["constant.lua", "utility.lua"]) {
      const content = setup.readScript(name);
      if (content) core.loadScript(duel, name, content);
    }
    // Le moteur ne mélange pas lui-même le deck : on le mélange avant de poser les cartes.
    const rng = seededRandom(setup.seed);
    setup.decks.forEach((deck, team) => {
      for (const code of shuffle(deck.main, rng))
        core.duelNewCard(duel, { team: team as 0 | 1, duelist: 0, code, controller: team as 0 | 1, location: LOC.DECK, sequence: 0, position: POS.FACEDOWN_DEFENSE });
      for (const code of deck.extra)
        core.duelNewCard(duel, { team: team as 0 | 1, duelist: 0, code, controller: team as 0 | 1, location: LOC.EXTRA, sequence: 0, position: POS.FACEDOWN_DEFENSE });
    });
    core.startDuel(duel);
  }

  /** Fait avancer le duel jusqu'à la prochaine décision humaine. */
  run(retry = false) {
    let isRetry = retry;
    for (let guard = 0; guard < 50000 && !this.finished; guard++) {
      const status = this.core.duelProcess(this.duel);
      const messages = this.core.duelGetMessage(this.duel);
      let prompt: OcgMessage | null = null;
      for (const m of messages) {
        this.track(m);
        if (m.type === T.RETRY) {
          isRetry = true;
          prompt = this.pending;
        }
        if (PROMPT_TYPES.has(m.type)) prompt = m;
        if (m.type === T.WIN) {
          this.finished = true;
          this.emit({ kind: "update", state: this.state(), messages });
          this.emit({ kind: "end", winner: m.player, reason: this.db.strings.victory[m.reason] ?? "" });
          return;
        }
      }
      const visible = messages.filter((m) => m.type !== T.RETRY && !PROMPT_TYPES.has(m.type));
      if (status === OcgProcessResult.END) {
        this.finished = true;
        this.emit({ kind: "update", state: this.state(), messages: visible });
        this.emit({ kind: "end", winner: -1, reason: "" });
        return;
      }
      if (status === OcgProcessResult.CONTINUE) {
        if (visible.length) this.emit({ kind: "update", state: this.state(), messages: visible });
        continue;
      }
      if (!prompt) throw new Error("Le moteur attend une réponse sans question");
      this.pending = prompt;
      const state = this.state();
      this.emit({ kind: "update", state, messages: visible });
      const player = (prompt as { player?: number }).player ?? 0;
      if (this.setup.ai[player]) {
        const response = this.ai.respond(prompt, state, isRetry);
        const ms = thinkTime(prompt, response);
        if (ms) this.emit({ kind: "think", ms });
        this.core.duelSetResponse(this.duel, response);
        isRetry = false;
        continue;
      }
      const auto = isRetry ? null : autoResponse(prompt);
      if (auto) {
        this.core.duelSetResponse(this.duel, auto);
        continue;
      }
      this.emit({ kind: "prompt", message: prompt, hint: this.hintText(prompt, this.hint[player]), retry: isRetry });
      return;
    }
    if (!this.finished) this.emit({ kind: "error", error: "Le duel ne progresse plus (boucle du moteur)." });
  }

  respond(response: OcgResponse) {
    if (this.finished) return;
    this.hint = [0n, 0n];
    this.core.duelSetResponse(this.duel, response);
    this.run();
  }

  /** Temps de réflexion écoulé : on passe la main ou on laisse l'IA trancher les choix obligatoires. */
  timeout() {
    const p = this.pending;
    if (this.finished || !p) return;
    let r: OcgResponse;
    if (p.type === T.SELECT_IDLECMD) r = { type: OcgResponseType.SELECT_IDLECMD, action: p.to_ep ? 7 : 6, index: null };
    else if (p.type === T.SELECT_BATTLECMD) r = { type: OcgResponseType.SELECT_BATTLECMD, action: p.to_ep ? 3 : 2, index: null };
    else if (p.type === T.SELECT_CHAIN && !p.forced) r = { type: OcgResponseType.SELECT_CHAIN, index: null };
    else r = this.ai.respond(p, this.state(), false);
    this.respond(r);
  }

  /** Indique si le prochain pas sera joué par l'IA (pour temporiser l'affichage). */
  get aiTurn() {
    const p = (this.pending as { player?: number } | null)?.player;
    return p !== undefined && this.setup.ai[p];
  }

  /** Texte d'aide de la sélection ; pour une zone, l'indice est le code de la carte à placer. */
  private hintText(prompt: OcgMessage, hint: bigint): string {
    if (!hint) return "";
    if (prompt.type === T.SELECT_PLACE || prompt.type === T.SELECT_DISFIELD) {
      const card = this.db.get(Number(hint));
      if (card) return this.db.sys(569).replace("%ls", card.name);
    }
    return this.db.desc(hint);
  }

  private track(m: OcgMessage) {
    switch (m.type) {
      case T.NEW_TURN: this.turn++; this.turnPlayer = m.player; break;
      case T.NEW_PHASE: this.phase = m.phase; break;
      case T.CHAIN_SOLVING: this.solving = m.chain_size; break;
      case T.CHAIN_END: this.solving = 0; break;
      case T.DAMAGE: case T.PAY_LPCOST: this.lp[m.player] = Math.max(0, this.lp[m.player] - m.amount); break;
      case T.RECOVER: this.lp[m.player] += m.amount; break;
      case T.LPUPDATE: this.lp[m.player] = m.lp; break;
      case T.HINT:
        if (m.hint_type === 3) this.hint[m.player] = BigInt(m.hint);
        break;
    }
  }

  state(): DuelState {
    const field = this.core.duelQueryField(this.duel);
    // Les LP viennent du moteur lui-même : le suivi par messages pouvait dériver (SetLP, coûts…).
    const lpOf = (p: number) => {
      const raw = (field.players[p] as unknown as { lp?: number }).lp;
      return raw === undefined ? this.lp[p] : Math.max(0, raw | 0);
    };
    const players = [0, 1].map((p): PlayerState => {
      const loc = (l: number) => this.queryLocation(p, l);
      const szone = loc(LOC.SZONE);
      return {
        lp: lpOf(p),
        hand: loc(LOC.HAND).filter((c): c is FieldCard => !!c),
        mzone: pad(loc(LOC.MZONE), 7),
        szone: pad(szone, 6),
        grave: loc(LOC.GRAVE).filter((c): c is FieldCard => !!c),
        removed: loc(LOC.REMOVED).filter((c): c is FieldCard => !!c),
        extra: loc(LOC.EXTRA).filter((c): c is FieldCard => !!c),
        deck: this.core.duelQueryCount(this.duel, p, LOC.DECK),
      };
    }) as [PlayerState, PlayerState];
    return {
      players,
      turn: this.turn,
      turnPlayer: this.turnPlayer,
      phase: this.phase,
      solving: this.solving,
      chain: field.chain.map((c) => ({
        code: c.code, controller: c.controller, location: c.location, sequence: c.sequence, description: this.db.desc(c.description),
      })),
    };
  }

  /**
   * Requête d'une zone. On décode nous-mêmes le tampon du moteur
   * (le décodeur fourni par ocgcore-wasm 0.1.6 renvoie des champs décalés).
   */
  private queryLocation(player: number, location: number): (FieldCard | null)[] {
    const m = (this.core as unknown as Record<symbol, { module: RawModule }>)[OcgCoreInternal].module;
    const handle = (Object.getOwnPropertySymbols(this.duel).map((s) => (this.duel as unknown as Record<symbol, { handle: number }>)[s])[0]).handle;
    const stack = m.stackSave();
    try {
      const q = m.stackAlloc(20);
      const view = new DataView(m.HEAPU8.buffer);
      view.setUint32(q, QUERY_FLAGS, true);
      view.setUint8(q + 4, player);
      view.setUint32(q + 8, location, true);
      view.setUint32(q + 12, 0, true);
      view.setUint32(q + 16, 0, true);
      const lenPtr = m.stackAlloc(4);
      const ptr = m._ocgapiDuelQueryLocation(handle, lenPtr, q);
      const len = view.getUint32(lenPtr, true);
      return parseLocation(new DataView(m.HEAPU8.buffer, ptr, len));
    } finally {
      m.stackRestore(stack);
    }
  }

  destroy() {
    this.core.destroyDuel(this.duel);
  }
}

interface RawModule {
  HEAPU8: Uint8Array;
  stackSave(): number;
  stackRestore(p: number): void;
  stackAlloc(n: number): number;
  _ocgapiDuelQueryLocation(duel: number, lenPtr: number, info: number): number;
}

function pad<T>(list: (T | null)[], n: number): (T | null)[] {
  const out = list.slice(0, n);
  while (out.length < n) out.push(null);
  return out;
}

function parseLocation(v: DataView): (FieldCard | null)[] {
  const cards: (FieldCard | null)[] = [];
  let o = 4; // taille totale
  while (o < v.byteLength) {
    let size = v.getUint16(o, true);
    o += 2;
    if (size === 0) {
      cards.push(null);
      continue;
    }
    const card: FieldCard = {
      code: 0, position: 0, type: 0, level: 0, rank: 0, link: 0, attack: 0, defense: 0, baseAttack: 0, baseDefense: 0,
      overlays: [], counters: {}, isPublic: false, lscale: 0, rscale: 0,
    };
    for (;;) {
      const flag = v.getUint32(o, true);
      const start = o + 4;
      const end = o - 2 + size + 2;
      if (flag === 0x80000000) {
        o = end;
        break;
      }
      const u32 = () => v.getUint32(start, true);
      const i32 = () => v.getInt32(start, true);
      switch (flag) {
        case 0x1: card.code = u32(); break;
        case 0x2: card.position = u32(); break;
        case 0x8: card.type = u32(); break;
        case 0x10: card.level = u32(); break;
        case 0x20: card.rank = u32(); break;
        case 0x100: card.attack = i32(); break;
        case 0x200: card.defense = i32(); break;
        case 0x400: card.baseAttack = i32(); break;
        case 0x800: card.baseDefense = i32(); break;
        case 0x10000: {
          const n = v.getUint32(start, true);
          for (let i = 0; i < n; i++) card.overlays.push(v.getUint32(start + 4 + i * 4, true));
          break;
        }
        case 0x20000: {
          const n = v.getUint32(start, true);
          for (let i = 0; i < n; i++) {
            const count = v.getUint16(start + 4 + i * 4, true);
            const kind = v.getUint16(start + 6 + i * 4, true);
            card.counters[kind] = count;
          }
          break;
        }
        case 0x100000: card.isPublic = v.getUint8(start) !== 0; break;
        case 0x200000: card.lscale = u32(); break;
        case 0x400000: card.rscale = u32(); break;
        case 0x800000: card.link = u32(); break;
      }
      o = end;
      size = v.getUint16(o, true);
      o += 2;
    }
    cards.push(card);
  }
  return cards;
}
