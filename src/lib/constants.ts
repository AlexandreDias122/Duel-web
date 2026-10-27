// Constantes du moteur (miroir de ygopro-core) et libellés français.

export const TYPE = {
  MONSTER: 0x1, SPELL: 0x2, TRAP: 0x4, NORMAL: 0x10, EFFECT: 0x20, FUSION: 0x40, RITUAL: 0x80,
  TRAPMONSTER: 0x100, SPIRIT: 0x200, UNION: 0x400, GEMINI: 0x800, TUNER: 0x1000, SYNCHRO: 0x2000,
  TOKEN: 0x4000, QUICKPLAY: 0x10000, CONTINUOUS: 0x20000, EQUIP: 0x40000, FIELD: 0x80000,
  COUNTER: 0x100000, FLIP: 0x200000, TOON: 0x400000, XYZ: 0x800000, PENDULUM: 0x1000000,
  SPSUMMON: 0x2000000, LINK: 0x4000000, SKILL: 0x8000000,
} as const;

export const EXTRA_TYPES = TYPE.FUSION | TYPE.SYNCHRO | TYPE.XYZ | TYPE.LINK;

export const LOC = {
  DECK: 0x1, HAND: 0x2, MZONE: 0x4, SZONE: 0x8, GRAVE: 0x10, REMOVED: 0x20, EXTRA: 0x40,
  OVERLAY: 0x80, FZONE: 0x100, PZONE: 0x200,
} as const;

export const POS = {
  FACEUP_ATTACK: 0x1, FACEDOWN_ATTACK: 0x2, FACEUP_DEFENSE: 0x4, FACEDOWN_DEFENSE: 0x8,
  FACEUP: 0x5, FACEDOWN: 0xa, ATTACK: 0x3, DEFENSE: 0xc,
} as const;

export const PHASE = {
  DRAW: 0x1, STANDBY: 0x2, MAIN1: 0x4, BATTLE_START: 0x8, BATTLE_STEP: 0x10, DAMAGE: 0x20,
  DAMAGE_CAL: 0x40, BATTLE: 0x80, MAIN2: 0x100, END: 0x200,
} as const;

export const PHASE_NAMES: Record<number, string> = {
  0x1: "Draw Phase", 0x2: "Standby Phase", 0x4: "Main Phase 1", 0x8: "Battle Phase", 0x10: "Battle Phase",
  0x20: "Damage Step", 0x40: "Damage Step", 0x80: "Battle Phase", 0x100: "Main Phase 2", 0x200: "End Phase",
};

export const PHASE_SHORT: [number, string][] = [
  [PHASE.DRAW, "DP"], [PHASE.STANDBY, "SP"], [PHASE.MAIN1, "M1"],
  [PHASE.BATTLE_START | PHASE.BATTLE_STEP | PHASE.DAMAGE | PHASE.DAMAGE_CAL | PHASE.BATTLE, "BP"],
  [PHASE.MAIN2, "M2"], [PHASE.END, "EP"],
];

export const ATTRIBUTES: [number, string][] = [
  [0x01, "TERRE"], [0x02, "EAU"], [0x04, "FEU"], [0x08, "VENT"], [0x10, "LUMIÈRE"], [0x20, "TÉNÈBRES"], [0x40, "DIVIN"],
];

export const RACES: [number, string][] = [
  [0x1, "Guerrier"],
  [0x2, "Magicien"],
  [0x4, "Elfe"],
  [0x8, "Démon"],
  [0x10, "Zombie"],
  [0x20, "Machine"],
  [0x40, "Aqua"],
  [0x80, "Pyro"],
  [0x100, "Rocher"],
  [0x200, "Bête Ailée"],
  [0x400, "Plante"],
  [0x800, "Insecte"],
  [0x1000, "Tonnerre"],
  [0x2000, "Dragon"],
  [0x4000, "Bête"],
  [0x8000, "Bête-Guerrier"],
  [0x10000, "Dinosaure"],
  [0x20000, "Poisson"],
  [0x40000, "Serpent de Mer"],
  [0x80000, "Reptile"],
  [0x100000, "Psychique"],
  [0x200000, "Bête Divine"],
  [0x400000, "Dieu Créateur"],
  [0x800000, "Wyrm"],
  [0x1000000, "Cyberse"],
  [0x2000000, "Illusion"],
];

export const LINK_MARKERS: [number, string][] = [
  [0x040, "↖"], [0x080, "↑"], [0x100, "↗"], [0x008, "←"], [0x020, "→"], [0x001, "↙"], [0x002, "↓"], [0x004, "↘"],
];

export function flagNames(value: number, table: [number, string][]): string {
  return table.filter(([f]) => value & f).map(([, n]) => n).join(" / ");
}
