// Connaissances générales de l'IA sur les cartes : hand traps, cartes réactives à garder, etc.
import type { Card } from "../lib/cards";
import { TYPE } from "../lib/constants";

/**
 * Hand traps qui répondent à une activation adverse (Ash, Veiler…) :
 * jamais invoquées, seulement activées en réponse à l'adversaire.
 */
const REACTIVE_HAND_TRAPS = new Set([
  14558127, 14558128, // Ash Blossom
  59438930, // Ghost Ogre
  73642296, // Ghost Belle
  97268402, // Effect Veiler
  52038441, // Ghost Mourner
  38814750, 74203495, // PSY-Framegear Gamma, Delta
  33854624, 72656408, 6637331, // Bystial Magnamhut, Baldrake, Druiswurm
  24508238, // D.D. Crow
  97462632, // Griffoh
]);

/** Hand traps « à tout moment » du tour adverse (pioche, verrou) : activées dès que possible. */
const FREE_HAND_TRAPS = new Set([
  23434538, // Maxx "C"
  42141493, 84192580, 87126721, // Mulcharmy Fuwalos, Purulia, Meowls
  94145021, // Droll & Lock Bird
  27204311, // Nibiru
  91800273, // Dimension Shifter
]);

/** Cartes qui se gardent pour répondre à l'adversaire, pas pour notre propre Main Phase. */
const HOLD = new Set([
  10045474, // Infinite Impermanence
  24224830, // Called by the Grave
  65681983, // Crossout Designator
  24299458, // Forbidden Droplet
  25311006, // Triple Tactics Talent
  40366667, // Dominus Impulse
  14087893, // Book of Moon
  78114463, 41420027, 40605147, // Solemn Accusation, Judgment, Strike
  15693423, // Evenly Matched
  98338152, // Sky Striker Mecha - Widow Anchor
  98829635, // Forbidden Crown
  48130397, // Super Polymerization
  53094821, // Toon Terror
  17954937, // Mitsurugi Great Purification
]);

export type HandTrapKind = "reactive" | "free" | null;

const cache = new Map<number, HandTrapKind>();

/** La carte est-elle une hand trap ? Liste connue, sinon déduit du texte (« défaussez cette carte » + effet rapide). */
export function handTrapKind(card: Card | undefined): HandTrapKind {
  if (!card) return null;
  const id = card.alias || card.id;
  if (REACTIVE_HAND_TRAPS.has(id) || REACTIVE_HAND_TRAPS.has(card.id)) return "reactive";
  if (FREE_HAND_TRAPS.has(id) || FREE_HAND_TRAPS.has(card.id)) return "free";
  if (!(card.type & TYPE.MONSTER)) return null;
  const hit = cache.get(card.id);
  if (hit !== undefined) return hit;
  const text = card.desc;
  const kind: HandTrapKind =
    /discard this card/i.test(text) && /\(Quick Effect\)|your opponent's turn|your opponent activates/i.test(text) ? "reactive" : null;
  cache.set(card.id, kind);
  return kind;
}

export function isHeld(card: Card | undefined): boolean {
  return !!card && (HOLD.has(card.id) || HOLD.has(card.alias));
}

/** Effet déclenché par son Invocation : un « starter » à invoquer en priorité. */
export function hasSummonTrigger(card: Card | undefined): boolean {
  return !!card && /If this card is (Normal|Normal or Special) Summoned/i.test(card.desc);
}

/** La carte a un effet depuis le Cimetière : bonne à défausser ou envoyer, mauvaise à bannir. */
export function likesGrave(card: Card | undefined): boolean {
  return !!card && /(is sent to the GY|is in your GY|from your GY;|banish this card from your GY)/i.test(card.desc);
}

/** Cherche une carte (ajout depuis le Deck) : bonne carte à activer tôt. */
export function isSearcher(card: Card | undefined): boolean {
  return !!card && /add .{0,80}from your Deck to your hand/i.test(card.desc);
}
