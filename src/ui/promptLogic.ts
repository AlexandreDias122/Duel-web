// Traduit une question du moteur en actions cliquables sur le terrain.
import { OcgMessageType as T, OcgResponseType as R } from "ocgcore-wasm";
import type { OcgMessage, OcgResponse, OcgCardLoc } from "ocgcore-wasm";
import type { CardDb } from "../lib/cards";
import { LOC } from "../lib/constants";
import { cardKey } from "./keys";

export interface CardAction {
  label: string;
  response: OcgResponse;
}

export function locKey(c: OcgCardLoc) {
  return cardKey(c.controller, c.location & ~LOC.OVERLAY, c.sequence);
}

/** Actions par carte pour les phases principales et de combat. */
export function cardActions(msg: OcgMessage | undefined, db: CardDb): Map<string, CardAction[]> {
  const map = new Map<string, CardAction[]>();
  const push = (c: OcgCardLoc, a: CardAction) => {
    const k = locKey(c);
    map.set(k, [...(map.get(k) ?? []), a]);
  };
  if (!msg) return map;
  if (msg.type === T.SELECT_IDLECMD) {
    const idle = (action: number, index: number): OcgResponse => ({ type: R.SELECT_IDLECMD, action, index });
    msg.summons.forEach((c, i) => push(c, { label: "Invocation Normale", response: idle(0, i) }));
    msg.special_summons.forEach((c, i) => push(c, { label: "Invocation Spéciale", response: idle(1, i) }));
    msg.pos_changes.forEach((c, i) => push(c, { label: "Changer de position", response: idle(2, i) }));
    msg.monster_sets.forEach((c, i) => push(c, { label: "Poser", response: idle(3, i) }));
    msg.spell_sets.forEach((c, i) => push(c, { label: "Poser", response: idle(4, i) }));
    msg.activates.forEach((c, i) => push(c, { label: activateLabel(db, c.description), response: idle(5, i) }));
  } else if (msg.type === T.SELECT_BATTLECMD) {
    msg.chains.forEach((c, i) => push(c, { label: activateLabel(db, c.description), response: { type: R.SELECT_BATTLECMD, action: 0, index: i } }));
    msg.attacks.forEach((c, i) =>
      push(c, { label: c.can_direct ? "Attaquer (direct possible)" : "Attaquer", response: { type: R.SELECT_BATTLECMD, action: 1, index: i } }));
  }
  return map;
}

function activateLabel(db: CardDb, description: bigint) {
  const text = db.desc(description);
  return text ? `Activer : ${text}` : "Activer";
}

/** Zones proposées par SELECT_PLACE / SELECT_DISFIELD (bit à 0 = disponible). */
export function placeZones(msg: OcgMessage | undefined): Set<string> {
  const out = new Set<string>();
  if (!msg || (msg.type !== T.SELECT_PLACE && msg.type !== T.SELECT_DISFIELD)) return out;
  for (let bit = 0; bit < 32; bit++) {
    const b = bit % 16;
    if (b === 7 || msg.field_mask & (1 << bit)) continue;
    const player = bit >= 16 ? 1 - msg.player : msg.player;
    const location = b < 8 ? LOC.MZONE : LOC.SZONE;
    out.add(cardKey(player, location, b % 8));
  }
  return out;
}

export function locationName(location: number): string {
  if (location & LOC.OVERLAY) return "Matériel";
  return ({
    [LOC.DECK]: "Deck", [LOC.HAND]: "Main", [LOC.MZONE]: "Terrain", [LOC.SZONE]: "Terrain", [LOC.GRAVE]: "Cimetière",
    [LOC.REMOVED]: "Banni", [LOC.EXTRA]: "Extra Deck", [LOC.FZONE]: "Terrain", [LOC.PZONE]: "Zone Pendule",
  } as Record<number, string>)[location] ?? "";
}

/** Vérifie une sélection de SELECT_SUM comme le moteur. */
export function sumValid(msg: Extract<OcgMessage, { type: T.SELECT_SUM }>, chosen: number[]): boolean {
  const params = [...msg.selects_must.map((c) => c.amount), ...chosen.map((i) => msg.selects[i].amount)];
  // select_max à 0 : somme exacte avec un nombre de cartes borné.
  if (!msg.select_max) {
    if (chosen.length < msg.min || chosen.length > msg.max) return false;
    const check = (i: number, acc: number): boolean => {
      if (acc === 0 || i === params.length) return false;
      const o1 = params[i] & 0xffff, o2 = params[i] >> 16;
      if (i === params.length - 1) return acc === o1 || acc === o2;
      return (acc > o1 && check(i + 1, acc - o1)) || (o2 > 0 && acc > o2 && check(i + 1, acc - o2));
    };
    return check(0, msg.amount);
  }
  let sum = 0, mx = 0, mn = Infinity;
  for (const op of params) {
    const o1 = op & 0xffff, o2 = op >> 16;
    const ms = o2 && o2 < o1 ? o2 : o1;
    sum += ms;
    mx += o2 > o1 ? o2 : o1;
    mn = Math.min(mn, ms);
  }
  return params.length > 0 && !(mx < msg.amount || sum - mn >= msg.amount);
}
