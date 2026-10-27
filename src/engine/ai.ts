// IA basique : des heuristiques simples, suffisantes pour un adversaire d'entraînement.
import { OcgMessageType as T, OcgResponseType as R, cardMatchesOpcode } from "ocgcore-wasm";
import type { OcgMessage, OcgResponse, OcgCardLoc, OcgLocation, OcgPosition, SelectFieldPlace } from "ocgcore-wasm";
import type { CardDb } from "../lib/cards";
import { LOC, POS, TYPE } from "../lib/constants";
import type { DuelState, FieldCard } from "./protocol";

export class BasicAi {
  private idleActions = 0;
  private lastTurn = -1;

  constructor(private db: CardDb) {}

  respond(msg: OcgMessage, state: DuelState, retry: boolean): OcgResponse {
    if (state.turn !== this.lastTurn) {
      this.lastTurn = state.turn;
      this.idleActions = 0;
    }
    // Après un refus du moteur, on se rabat sur la réponse la plus sûre.
    if (retry) return safeResponse(msg);
    switch (msg.type) {
      case T.SELECT_IDLECMD: return this.idle(msg, state);
      case T.SELECT_BATTLECMD: return this.battle(msg, state);
      case T.SELECT_CHAIN: {
        if (msg.forced) return { type: R.SELECT_CHAIN, index: 0 };
        // On garde les pièges pour le tour adverse, et on n'enchaîne pas sur soi-même à chaque fois.
        if (!msg.selects.length) return { type: R.SELECT_CHAIN, index: null };
        const mine = state.turnPlayer === msg.player;
        const chance = mine ? 0.35 : 0.75;
        return { type: R.SELECT_CHAIN, index: Math.random() < chance ? 0 : null };
      }
      case T.SELECT_EFFECTYN: return { type: R.SELECT_EFFECTYN, yes: true };
      case T.SELECT_YESNO: return { type: R.SELECT_YESNO, yes: true };
      case T.SELECT_OPTION: return { type: R.SELECT_OPTION, index: 0 };
      case T.SELECT_CARD: {
        const order = this.rank(msg.selects, msg.player, state);
        return { type: R.SELECT_CARD, indicies: order.slice(0, Math.max(msg.min, 1)) };
      }
      case T.SELECT_TRIBUTE: {
        const order = this.rank(msg.selects, msg.player, state).reverse();
        return { type: R.SELECT_TRIBUTE, indicies: order.slice(0, msg.min) };
      }
      case T.SELECT_UNSELECT_CARD: {
        if (msg.can_finish || !msg.select_cards.length) return { type: R.SELECT_UNSELECT_CARD, index: null };
        const order = this.rank(msg.select_cards, msg.player, state);
        return { type: R.SELECT_UNSELECT_CARD, index: order[0] };
      }
      case T.SELECT_POSITION: {
        const card = this.db.get(msg.code);
        const prefer = card && card.atk < card.def && card.atk < 1500
          ? [POS.FACEUP_DEFENSE, POS.FACEUP_ATTACK, POS.FACEDOWN_DEFENSE, POS.FACEDOWN_ATTACK]
          : [POS.FACEUP_ATTACK, POS.FACEUP_DEFENSE, POS.FACEDOWN_DEFENSE, POS.FACEDOWN_ATTACK];
        return { type: R.SELECT_POSITION, position: (prefer.find((p) => msg.positions & p) ?? POS.FACEUP_ATTACK) as OcgPosition };
      }
      case T.SELECT_PLACE:
      case T.SELECT_DISFIELD:
        return { type: msg.type === T.SELECT_PLACE ? R.SELECT_PLACE : R.SELECT_DISFIELD, places: pickPlaces(msg.player, msg.field_mask, msg.count, msg.type === T.SELECT_DISFIELD) };
      case T.SELECT_SUM: return { type: R.SELECT_SUM, indicies: selectSum(msg) };
      case T.SELECT_COUNTER: {
        let left = msg.count;
        return { type: R.SELECT_COUNTER, counters: msg.cards.map((c) => { const n = Math.min(c.count, left); left -= n; return n; }) };
      }
      case T.SORT_CARD:
      case T.SORT_CHAIN:
        return { type: R.SORT_CARD, order: null };
      case T.ANNOUNCE_RACE: return { type: R.ANNOUNCE_RACE, races: bits(BigInt(msg.available)).slice(0, msg.count) as never };
      case T.ANNOUNCE_ATTRIB: return { type: R.ANNOUNCE_ATTRIB, attributes: bits(BigInt(msg.available)).slice(0, msg.count).map(Number) as never };
      case T.ANNOUNCE_NUMBER: return { type: R.ANNOUNCE_NUMBER, value: 0 };
      case T.ANNOUNCE_CARD: return { type: R.ANNOUNCE_CARD, card: this.announce(msg.opcodes) };
      case T.ROCK_PAPER_SCISSORS: return { type: R.ROCK_PAPER_SCISSORS, value: (1 + Math.floor(Math.random() * 3)) as 1 | 2 | 3 };
      default: return safeResponse(msg);
    }
  }

  private idle(msg: Extract<OcgMessage, { type: T.SELECT_IDLECMD }>, state: DuelState): OcgResponse {
    const me = state.players[msg.player];
    const done = (): OcgResponse => {
      const canAttack = state.turn > 1 && me.mzone.some((c) => c && c.position & POS.ATTACK);
      return { type: R.SELECT_IDLECMD, action: msg.to_bp && canAttack ? 6 : 7, index: null };
    };
    if (++this.idleActions > 20) return done();

    // 1. Invocations Spéciales disponibles.
    if (msg.special_summons.length) return { type: R.SELECT_IDLECMD, action: 1, index: 0 };
    // 2. Effets et Magies (pas les Pièges, gardés pour le tour adverse).
    const activates = msg.activates
      .map((c, i) => ({ c, i, card: this.db.get(c.code) }))
      .filter(({ c, card }) => !(c.location === LOC.HAND && card && card.type & TYPE.TRAP));
    if (activates.length && Math.random() < 0.9) return { type: R.SELECT_IDLECMD, action: 5, index: activates[0].i };
    // 3. Invocation Normale du monstre le plus fort.
    if (msg.summons.length) {
      const best = maxBy(msg.summons.map((c, i) => ({ i, atk: this.db.get(c.code)?.atk ?? 0 })), (x) => x.atk);
      return { type: R.SELECT_IDLECMD, action: 0, index: best.i };
    }
    // 4. Poser un monstre si on n'a rien à invoquer.
    if (msg.monster_sets.length && !me.mzone.some(Boolean)) return { type: R.SELECT_IDLECMD, action: 3, index: 0 };
    // 5. Poser Pièges et Magies Jeu-Rapide.
    const sets = msg.spell_sets.findIndex((c) => {
      const card = this.db.get(c.code);
      return card && (card.type & TYPE.TRAP || card.type & TYPE.QUICKPLAY);
    });
    if (sets >= 0) return { type: R.SELECT_IDLECMD, action: 4, index: sets };
    return done();
  }

  private battle(msg: Extract<OcgMessage, { type: T.SELECT_BATTLECMD }>, state: DuelState): OcgResponse {
    const opp = state.players[1 - msg.player];
    const defenders = opp.mzone.filter((c): c is FieldCard => !!c);
    const weakest = defenders.length ? Math.min(...defenders.map(battleValue)) : -1;
    for (let i = 0; i < msg.attacks.length; i++) {
      const a = msg.attacks[i];
      const atk = state.players[msg.player].mzone[a.sequence]?.attack ?? 0;
      if (!defenders.length || a.can_direct || atk > weakest) return { type: R.SELECT_BATTLECMD, action: 1, index: i };
    }
    return { type: R.SELECT_BATTLECMD, action: msg.to_m2 ? 2 : 3, index: null };
  }

  /** Classe les cartes proposées : on vise les meilleures cartes adverses, et on sacrifie ses plus faibles. */
  private rank(cards: OcgCardLoc[], player: number, state: DuelState): number[] {
    const score = (c: OcgCardLoc) => {
      const onField = c.location & (LOC.MZONE | LOC.SZONE);
      const fc = onField ? (c.location & LOC.MZONE ? state.players[c.controller].mzone : state.players[c.controller].szone)[c.sequence] : null;
      const atk = fc?.attack ?? this.db.get(c.code)?.atk ?? 0;
      if (c.controller !== player) return 10000 + atk;
      return onField ? -atk : atk;
    };
    return cards.map((c, i) => ({ i, s: score(c) })).sort((a, b) => b.s - a.s).map((x) => x.i);
  }

  private announce(opcodes: Parameters<typeof cardMatchesOpcode>[1]): number {
    for (const card of this.db.searchable) {
      const data = {
        code: card.id, alias: card.alias, setcodes: [], type: card.type, level: card.level, attribute: card.attribute,
        race: BigInt(card.race), attack: card.atk, defense: card.def, lscale: card.lscale, rscale: card.rscale, link_marker: card.linkMarker,
      };
      if (cardMatchesOpcode(data, opcodes)) return card.id;
    }
    return 0;
  }
}

function battleValue(c: FieldCard) {
  if (c.position & POS.FACEDOWN) return 1500;
  return c.position & POS.DEFENSE ? c.defense : c.attack;
}

function maxBy<T>(list: T[], f: (x: T) => number): T {
  return list.reduce((a, b) => (f(b) > f(a) ? b : a));
}

function bits(v: bigint): bigint[] {
  const out: bigint[] = [];
  for (let b = 1n; b <= v; b <<= 1n) if (v & b) out.push(b);
  return out;
}

/** Bits de field_mask : 0-6 mes monstres, 8-15 mes Magies/Pièges, +16 pour l'adversaire. Bit à 1 = indisponible. */
export function pickPlaces(player: number, mask: number, count: number, opponentFirst: boolean): SelectFieldPlace[] {
  const order = opponentFirst ? [16, 0] : [0, 16];
  const places: SelectFieldPlace[] = [];
  for (const offset of order) {
    for (let b = 0; b < 16 && places.length < count; b++) {
      const bit = offset + b;
      if (b === 7 || mask & (1 << bit)) continue;
      places.push({ player: offset ? 1 - player : player, location: (b < 8 ? LOC.MZONE : LOC.SZONE) as OcgLocation, sequence: b % 8 });
    }
  }
  return places;
}

function selectSum(msg: Extract<OcgMessage, { type: T.SELECT_SUM }>): number[] {
  const values = (amount: number) => [amount & 0xffff, amount >> 16].filter((v) => v > 0);
  let target = msg.amount;
  for (const c of msg.selects_must) target -= values(c.amount)[0] ?? 0;
  // Recherche exhaustive bornée (les listes sont courtes).
  const n = msg.selects.length;
  const exact = !msg.select_max;
  let best: number[] | null = null;
  const walk = (i: number, sum: number, chosen: number[]) => {
    if (best) return;
    if (exact ? sum === target : sum >= target) {
      if (chosen.length >= msg.min && chosen.length <= Math.max(msg.max, msg.min)) best = [...chosen];
      return;
    }
    if (i >= n || chosen.length > 8) return;
    for (const v of values(msg.selects[i].amount)) walk(i + 1, sum + v, [...chosen, i]);
    walk(i + 1, sum, chosen);
  };
  walk(0, 0, []);
  return best ?? msg.selects.map((_, i) => i).slice(0, Math.max(msg.min, 1));
}

/** Réponse par défaut : annuler ou faire le choix minimal. */
export function safeResponse(msg: OcgMessage): OcgResponse {
  switch (msg.type) {
    case T.SELECT_IDLECMD: return { type: R.SELECT_IDLECMD, action: msg.to_ep ? 7 : 6, index: null };
    case T.SELECT_BATTLECMD: return { type: R.SELECT_BATTLECMD, action: msg.to_ep ? 3 : 2, index: null };
    case T.SELECT_CHAIN: return { type: R.SELECT_CHAIN, index: msg.forced ? 0 : null };
    case T.SELECT_EFFECTYN: return { type: R.SELECT_EFFECTYN, yes: false };
    case T.SELECT_YESNO: return { type: R.SELECT_YESNO, yes: false };
    case T.SELECT_OPTION: return { type: R.SELECT_OPTION, index: 0 };
    case T.SELECT_CARD: return { type: R.SELECT_CARD, indicies: msg.can_cancel ? null : Array.from({ length: msg.min }, (_, i) => i) };
    case T.SELECT_TRIBUTE: return { type: R.SELECT_TRIBUTE, indicies: msg.can_cancel ? null : Array.from({ length: msg.min }, (_, i) => i) };
    case T.SELECT_UNSELECT_CARD:
      return { type: R.SELECT_UNSELECT_CARD, index: msg.can_finish || msg.can_cancel || !msg.select_cards.length ? null : 0 };
    case T.SELECT_POSITION: return { type: R.SELECT_POSITION, position: ([1, 4, 8, 2].find((p) => msg.positions & p) ?? 1) as OcgPosition };
    case T.SELECT_PLACE: return { type: R.SELECT_PLACE, places: pickPlaces(msg.player, msg.field_mask, msg.count, false) };
    case T.SELECT_DISFIELD: return { type: R.SELECT_DISFIELD, places: pickPlaces(msg.player, msg.field_mask, msg.count, true) };
    case T.SELECT_SUM: return { type: R.SELECT_SUM, indicies: selectSum(msg) };
    case T.SELECT_COUNTER: {
      let left = msg.count;
      return { type: R.SELECT_COUNTER, counters: msg.cards.map((c) => { const n = Math.min(c.count, left); left -= n; return n; }) };
    }
    case T.SORT_CARD: case T.SORT_CHAIN: return { type: R.SORT_CARD, order: null };
    case T.ANNOUNCE_RACE: return { type: R.ANNOUNCE_RACE, races: bits(BigInt(msg.available)).slice(0, msg.count) as never };
    case T.ANNOUNCE_ATTRIB: return { type: R.ANNOUNCE_ATTRIB, attributes: bits(BigInt(msg.available)).slice(0, msg.count).map(Number) as never };
    case T.ANNOUNCE_NUMBER: return { type: R.ANNOUNCE_NUMBER, value: 0 };
    case T.ANNOUNCE_CARD: return { type: R.ANNOUNCE_CARD, card: 0 };
    case T.ROCK_PAPER_SCISSORS: return { type: R.ROCK_PAPER_SCISSORS, value: 1 };
    default: throw new Error(`Message sans réponse possible: ${msg.type}`);
  }
}

export const PROMPT_TYPES = new Set<number>([
  T.SELECT_BATTLECMD, T.SELECT_IDLECMD, T.SELECT_EFFECTYN, T.SELECT_YESNO, T.SELECT_OPTION, T.SELECT_CARD,
  T.SELECT_CHAIN, T.SELECT_PLACE, T.SELECT_POSITION, T.SELECT_TRIBUTE, T.SORT_CHAIN, T.SELECT_COUNTER,
  T.SELECT_SUM, T.SELECT_DISFIELD, T.SORT_CARD, T.SELECT_UNSELECT_CARD, T.ANNOUNCE_RACE, T.ANNOUNCE_ATTRIB,
  T.ANNOUNCE_CARD, T.ANNOUNCE_NUMBER, T.ROCK_PAPER_SCISSORS,
]);
