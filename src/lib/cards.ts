// Base de cartes chargée depuis public/data/cards.json (générée par scripts/build-data.mjs).
import { TYPE, EXTRA_TYPES, ATTRIBUTES, RACES, LINK_MARKERS, flagNames } from "./constants";

export interface Card {
  id: number;
  ot: number;
  alias: number;
  setcode: bigint;
  type: number;
  atk: number;
  def: number;
  /** Niveau / rang / classement Lien (sans les échelles Pendule). */
  level: number;
  lscale: number;
  rscale: number;
  race: number;
  attribute: number;
  linkMarker: number;
  name: string;
  desc: string;
  strs: string[];
  category: bigint;
}

type RawCard = [number, number, number, string, number, number, number, number, number, number, string, string, string[], string];

export interface Strings {
  system: Record<number, string>;
  victory: Record<number, string>;
  counter: Record<number, string>;
  setname: Record<number, string>;
}

export class CardDb {
  readonly cards = new Map<number, Card>();
  /** Cartes visibles dans la recherche (sans les illustrations alternatives). */
  readonly searchable: Card[] = [];

  constructor(raw: RawCard[], readonly strings: Strings) {
    for (const [id, ot, alias, setcode, type, atk, def, level, race, attribute, name, desc, strs, category] of raw) {
      const isLink = (type & TYPE.LINK) !== 0;
      this.cards.set(id, {
        id, ot, alias, setcode: BigInt(setcode), type, atk,
        def: isLink ? 0 : def,
        level: level & 0xff,
        lscale: (level >> 24) & 0xff,
        rscale: (level >> 16) & 0xff,
        race, attribute,
        linkMarker: isLink ? def : 0,
        name, desc, strs, category: BigInt(category),
      });
    }
    for (const card of this.cards.values()) {
      if (card.type & TYPE.TOKEN) continue;
      if (card.type & TYPE.SKILL) continue;
      if (card.alias && this.cards.get(card.alias)?.name === card.name) continue;
      this.searchable.push(card);
    }
    this.searchable.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: number): Card | undefined {
    return this.cards.get(id);
  }

  /** Identifiant de la carte « de base » (les illustrations alternatives partagent la limite de 3). */
  baseId(id: number): number {
    const card = this.cards.get(id);
    if (card?.alias && this.cards.get(card.alias)?.name === card.name) return card.alias;
    return id;
  }

  /** Texte d'une description d'effet (format EDOPro : code << 20 | index). Chaîne vide si inconnue. */
  desc(description: bigint | number): string {
    const d = BigInt(description);
    const code = Number(d >> 20n);
    const index = Number(d & 0xfffffn);
    if (code === 0) return this.strings.system[index] ?? "";
    return this.cards.get(code)?.strs[index] ?? "";
  }

  sys(id: number): string {
    return this.strings.system[id] ?? `#${id}`;
  }

  setNames(card: Card): string[] {
    const out: string[] = [];
    let s = card.setcode;
    while (s) {
      const v = Number(s & 0xffffn);
      if (v && this.strings.setname[v]) out.push(this.strings.setname[v]);
      s >>= 16n;
    }
    return out;
  }
}

export function isMonster(c: Card) { return (c.type & TYPE.MONSTER) !== 0; }
export function isExtra(c: Card) { return (c.type & TYPE.MONSTER) !== 0 && (c.type & EXTRA_TYPES) !== 0; }

export function typeLine(c: Card): string {
  if (c.type & TYPE.SPELL || c.type & TYPE.TRAP) {
    const kind = c.type & TYPE.SPELL ? "Magie" : "Piège";
    const sub =
      c.type & TYPE.QUICKPLAY ? "Jeu-Rapide" : c.type & TYPE.CONTINUOUS ? "Continue" : c.type & TYPE.EQUIP ? "Équipement"
      : c.type & TYPE.FIELD ? "Terrain" : c.type & TYPE.RITUAL ? "Rituelle" : c.type & TYPE.COUNTER ? "Contre" : "Normale";
    return `${kind} ${sub}`;
  }
  const parts = [flagNames(c.race, RACES)];
  const subtypes: [number, string][] = [
    [TYPE.FUSION, "Fusion"], [TYPE.RITUAL, "Rituel"], [TYPE.SYNCHRO, "Synchro"], [TYPE.XYZ, "Xyz"],
    [TYPE.PENDULUM, "Pendule"], [TYPE.LINK, "Lien"], [TYPE.TUNER, "Syntoniseur"], [TYPE.FLIP, "Flip"],
    [TYPE.TOON, "Toon"], [TYPE.SPIRIT, "Spirit"], [TYPE.UNION, "Union"], [TYPE.GEMINI, "Gémeau"],
    [TYPE.NORMAL, "Normal"], [TYPE.EFFECT, "Effet"],
  ];
  for (const [f, n] of subtypes) if (c.type & f) parts.push(n);
  return parts.join(" / ");
}

export function statLine(c: Card): string {
  if (!isMonster(c)) return "";
  const attr = flagNames(c.attribute, ATTRIBUTES);
  if (c.type & TYPE.LINK) return `${attr} · LIEN-${c.level} ${flagNames(c.linkMarker, LINK_MARKERS)} · ATK ${fmt(c.atk)}`;
  const lvl = c.type & TYPE.XYZ ? `Rang ${c.level}` : `Niv. ${c.level}`;
  const scale = c.type & TYPE.PENDULUM ? ` · Échelle ${c.lscale}` : "";
  return `${attr} · ${lvl}${scale} · ATK ${fmt(c.atk)} / DEF ${fmt(c.def)}`;
}

export function fmt(v: number) {
  return v < 0 ? "?" : String(v);
}

let loading: Promise<CardDb> | null = null;

export function loadCardDb(base: string): Promise<CardDb> {
  loading ??= Promise.all([
    fetch(new URL("data/cards.json", base)).then((r) => r.json()),
    fetch(new URL("data/strings.json", base)).then((r) => r.json()),
  ]).then(([raw, strings]) => new CardDb(raw, strings));
  return loading;
}

/** Sources d'images, de la meilleure à la plus sûre. "art" = illustration seule (terrain, façon Master Duel). */
export function cardImageSources(id: number, variant: "full" | "big" | "art"): string[] {
  const ygopd = "https://images.ygoprodeck.com/images/";
  const ignis = `https://pics.projectignis.org:2096/pics/${id}.jpg`;
  if (variant === "art") return [`${ygopd}cards_cropped/${id}.jpg`];
  if (variant === "big") return [`${ygopd}cards/${id}.jpg`, ignis];
  return [`${ygopd}cards_small/${id}.jpg`, ignis];
}
