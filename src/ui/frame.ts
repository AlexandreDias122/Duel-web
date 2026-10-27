import type { Card } from "../lib/cards";
import { TYPE } from "../lib/constants";

/** Couleur du cadre selon le type, comme sur les vraies cartes. */
export function frameOf(card: Card | undefined): string {
  if (!card) return "effect";
  const t = card.type;
  if (t & TYPE.SPELL) return "spell";
  if (t & TYPE.TRAP) return "trap";
  if (t & TYPE.TOKEN) return "token";
  if (t & TYPE.LINK) return "link";
  if (t & TYPE.XYZ) return "xyz";
  if (t & TYPE.SYNCHRO) return "synchro";
  if (t & TYPE.FUSION) return "fusion";
  if (t & TYPE.RITUAL) return "ritual";
  if (t & TYPE.NORMAL) return "normal";
  return "effect";
}

const ATTR_GLYPH: Record<number, [string, string]> = {
  0x01: ["地", "earth"], 0x02: ["水", "water"], 0x04: ["炎", "fire"], 0x08: ["風", "wind"],
  0x10: ["光", "light"], 0x20: ["闇", "dark"], 0x40: ["神", "divine"],
};

/** Symbole et classe de couleur de l'attribut (Magie et Piège ont le leur). */
export function attributeGlyph(card: Card): [string, string] {
  if (card.type & TYPE.SPELL) return ["魔", "spell"];
  if (card.type & TYPE.TRAP) return ["罠", "trap"];
  return ATTR_GLYPH[card.attribute] ?? ["?", "dark"];
}
