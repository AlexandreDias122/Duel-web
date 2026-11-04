// Messages échangés entre l'interface et le worker qui fait tourner le moteur.
import { OcgDuelMode } from "ocgcore-wasm";
import type { OcgMessage, OcgResponse } from "ocgcore-wasm";

export interface DeckList {
  main: number[];
  extra: number[];
  /** Profil de jeu de l'IA pour ce deck (decks méta), voir aiDecks.ts. */
  profile?: string;
  /** Executor WindBot qui joue ce deck : le worker remplace alors main/extra par la liste du bot. */
  windbot?: string;
}

export interface FieldCard {
  code: number;
  position: number;
  type: number;
  level: number;
  rank: number;
  link: number;
  attack: number;
  defense: number;
  baseAttack: number;
  baseDefense: number;
  overlays: number[];
  counters: Record<number, number>;
  isPublic: boolean;
  lscale: number;
  rscale: number;
}

export interface PlayerState {
  lp: number;
  hand: FieldCard[];
  /** 0-4 zones principales, 5-6 zones Monstre Extra. */
  mzone: (FieldCard | null)[];
  /** 0-4 Magie/Piège (0 et 4 servent aussi de zones Pendule), 5 Terrain. */
  szone: (FieldCard | null)[];
  grave: FieldCard[];
  removed: FieldCard[];
  extra: FieldCard[];
  deck: number;
}

export interface ChainLink {
  code: number;
  controller: number;
  location: number;
  sequence: number;
  description: string;
}

export interface DuelState {
  players: [PlayerState, PlayerState];
  turn: number;
  turnPlayer: number;
  phase: number;
  chain: ChainLink[];
  /** Numéro du maillon en cours de résolution (0 si aucun). */
  solving: number;
}

/** Réglages du duel (écran SOLO). */
export interface DuelRules {
  /** Main de départ. */
  startHand: number;
  /** Cartes piochées à chaque tour. */
  drawCount: number;
  /** Master Rule (5 = Nouvelles Master Rules). */
  masterRule: 1 | 2 | 3 | 4 | 5;
  /** Mélanger les decks au début du duel. */
  shuffle: boolean;
}

/** Drapeaux du moteur pour chaque Master Rule. */
export const MASTER_RULE_FLAGS = {
  1: OcgDuelMode.MODE_MR1, 2: OcgDuelMode.MODE_MR2, 3: OcgDuelMode.MODE_MR3, 4: OcgDuelMode.MODE_MR4, 5: OcgDuelMode.MODE_MR5,
} as const;

export const DEFAULT_RULES: DuelRules = { startHand: 5, drawCount: 1, masterRule: 5, shuffle: true };

export interface StartOptions {
  base: string;
  decks: [DeckList, DeckList];
  /** Joueurs contrôlés par l'IA. */
  ai: [boolean, boolean];
  seed: [string, string, string, string];
  lp: number;
  rules?: DuelRules;
}

export type ToWorker =
  | { kind: "warmup"; base: string }
  | { kind: "start"; duel: number; options: StartOptions }
  | { kind: "respond"; duel: number; response: OcgResponse }
  /** Temps écoulé : le moteur répond à la place du joueur. */
  | { kind: "timeout"; duel: number };

/** Message du worker, rattaché au duel qui l'a produit. */
export type FromWorkerTagged = FromWorker & { duel: number };

export type FromWorker =
  | { kind: "loading"; text: string }
  | { kind: "update"; state: DuelState; messages: OcgMessage[] }
  | { kind: "prompt"; message: OcgMessage; hint: string; retry: boolean }
  | { kind: "end"; winner: number; reason: string }
  /** L'IA réfléchit avant d'agir : l'interface marque une pause. */
  | { kind: "think"; ms: number }
  /** Réplique de WindBot. */
  | { kind: "chat"; player: number; text: string }
  | { kind: "error"; error: string };
