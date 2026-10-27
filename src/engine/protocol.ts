// Messages échangés entre l'interface et le worker qui fait tourner le moteur.
import type { OcgMessage, OcgResponse } from "ocgcore-wasm";

export interface DeckList {
  main: number[];
  extra: number[];
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
}

export interface StartOptions {
  base: string;
  decks: [DeckList, DeckList];
  /** Joueurs contrôlés par l'IA. */
  ai: [boolean, boolean];
  seed: [string, string, string, string];
  lp: number;
}

export type ToWorker =
  | { kind: "start"; options: StartOptions }
  | { kind: "respond"; response: OcgResponse };

export type FromWorker =
  | { kind: "loading"; text: string }
  | { kind: "update"; state: DuelState; messages: OcgMessage[] }
  | { kind: "prompt"; message: OcgMessage; hint: string; retry: boolean }
  | { kind: "end"; winner: number; reason: string }
  | { kind: "error"; error: string };
