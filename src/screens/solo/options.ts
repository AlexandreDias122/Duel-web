// Données partagées par l'écran SOLO (choix de l'adversaire et réglages) et le Salon (choix du deck).
import type { DeckList, DuelRules } from "../../engine/protocol";
import type { WindBotDeck } from "../../engine/windbot";
import { AI_DECKS } from "../../engine/aiDecks";
import type { CardDb } from "../../lib/cards";
import { TYPE } from "../../lib/constants";
import type { Banlist, Deck } from "../../lib/deck";
import { adaptToBanlist, parseYdk, validateDeck } from "../../lib/deck";
import type { StarterDeck } from "../DecksScreen";

/** Réglages du duel, choisis sur l'écran SOLO et rappelés dans le Salon. */
export interface SoloSettings extends DuelRules {
  /** Vérification du Deck : banlist et règles de construction. */
  deckCheck: boolean;
  banlist: string;
  lp: number;
  /** Temps de réflexion par tour, en secondes (0 = illimité). */
  turnSeconds: number;
}

/** Image de public/img. */
export const asset = (name: string) => `${import.meta.env.BASE_URL}img/${name}`;

const SETTINGS_KEY = "ygo-web.solo-settings";
const PICK_KEY = "ygo-web.solo-pick";

export function loadSettings(defaultBanlist: string): SoloSettings {
  const base: SoloSettings = { deckCheck: true, banlist: defaultBanlist, lp: 8000, startHand: 5, drawCount: 1, masterRule: 5, shuffle: true, turnSeconds: 180 };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return base;
  }
}

export function saveSettings(s: SoloSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Navigation privée : réglages non mémorisés.
  }
}

/** Dernier adversaire / dernier deck choisis. */
export function loadPick(): { opponent?: string; deck?: string } {
  try {
    return JSON.parse(localStorage.getItem(PICK_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function savePick(p: { opponent?: string; deck?: string }) {
  try {
    localStorage.setItem(PICK_KEY, JSON.stringify({ ...loadPick(), ...p }));
  } catch {
    // ignoré
  }
}

export const RULE_LABELS: Record<DuelRules["masterRule"], string> = {
  5: "Nouvelles Master Rules",
  4: "Master Rules 4",
  3: "Master Rules 3",
};

export const TIMERS = [0, 60, 120, 180, 300, 600];
export const timerLabel = (s: number) => (s ? `${s / 60} min` : "Aucune");

/** Un deck jouable, par l'IA ou par le joueur. */
export interface DeckOption {
  key: string;
  name: string;
  group: "windbot" | "meta" | "starter" | "mine";
  list: DeckList;
  /** Carte phare (illustration). */
  cover: number;
  blurb: string;
  /** 1 à 5 pour WindBot. */
  difficulty?: number;
  /** L'IA préfère commencer en second quand elle gagne le pile ou face. */
  goSecond?: boolean;
  errors: string[];
}

/** Cartes génériques qu'on évite comme illustration d'un deck. */
const STAPLES = new Set([14558127, 59438930, 73642296, 97268402, 10045474, 42141493, 84192580, 94145021, 23434538, 27204311, 52038441]);

/** Carte phare : le monstre le plus joué du Main Deck (hors cartes génériques), sinon le premier de l'Extra Deck. */
export function coverOf(db: CardDb, list: { main: number[]; extra: number[] }): number {
  const count = new Map<number, number>();
  for (const c of list.main) {
    const card = db.get(c);
    if (!card || STAPLES.has(c) || !(card.type & TYPE.MONSTER)) continue;
    count.set(c, (count.get(c) ?? 0) + 1);
  }
  const best = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
  return best ?? list.extra[0] ?? list.main[0] ?? 0;
}

/** Decks WindBot (public/windbot/bots.json, absent si WindBot n'a pas été compilé). */
let windbotDecks: Promise<WindBotDeck[]> | null = null;
export function loadWindBotDecks(): Promise<WindBotDeck[]> {
  windbotDecks ??= fetch(`${import.meta.env.BASE_URL}windbot/bots.json`)
    .then((r) => (r.ok ? (r.json() as Promise<WindBotDeck[]>) : []))
    .catch(() => []);
  return windbotDecks;
}

/** Tous les decks proposés, ajustés à la banlist si la vérification est active. */
export function buildOptions(db: CardDb, banlist: Banlist | null, mine: Deck[], starters: StarterDeck[], bots: WindBotDeck[]): DeckOption[] {
  const adapted = (lists: { main: number[]; extra: number[] }) => {
    const l = adaptToBanlist(db, lists, banlist);
    return { main: l.main, extra: l.extra };
  };
  return [
    ...bots.map((w): DeckOption => ({
      key: `w:${w.deck}`, name: w.name, group: "windbot", list: { main: [], extra: [], windbot: w.deck },
      cover: w.cover ?? 0, blurb: w.blurb || "WindBot joue son propre deck, avec un plan de jeu écrit pour lui.",
      difficulty: w.difficulty, goSecond: w.goSecond, errors: [],
    })),
    ...AI_DECKS.map((m): DeckOption => {
      const l = adapted(m);
      return { key: `m:${m.id}`, name: m.name, group: "meta", list: { ...l, profile: m.id }, cover: m.plan[0] ?? coverOf(db, l), blurb: m.blurb, errors: [] };
    }),
    ...starters.map((s): DeckOption => {
      const l = adapted(parseYdk(s.ydk));
      return { key: `s:${s.name}`, name: s.name, group: "starter", list: l, cover: coverOf(db, l), blurb: "Deck de démarrage officiel.", errors: [] };
    }),
    ...mine.map((d): DeckOption => ({
      key: `d:${d.id}`, name: d.name, group: "mine", list: { main: d.main, extra: d.extra }, cover: coverOf(db, d),
      blurb: "L'IA joue votre propre deck.", errors: validateDeck(db, d, banlist),
    })),
  ];
}
