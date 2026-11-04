// Liste des decks WindBot jouables en Master Rule 5 (d'après bots.json de Project Ignis),
// limitée aux executors dont le fichier .ydk existe.
// Pour l'écran SOLO, chaque deck reçoit une carte phare (illustration), une description,
// et l'indication « préfère commencer en second » lue dans son executor (OnSelectHand).
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Carte phare et description de chaque deck (clé : nom de l'executor). */
const INFO = {
  ABC: [1561110, "Union de machines qui s'assemblent en dragon géant pour tout bannir."],
  Altergeist: [42790071, "Des esprits numériques qui contrent vos effets à chaque tour."],
  Apophis: [85888377, "Pièges qui deviennent des monstres, autour du Temple des Rois."],
  "Blue-Eyes": [89631139, "Le légendaire Dragon Blanc aux Yeux Bleus et sa puissance brute."],
  BE2025: [38517737, "Les Yeux Bleus version moderne : des dragons de 3000 ATK en série."],
  BlueEyesMaxDragon: [55410871, "Rituel du Dragon Chaos MAX : des attaques qui transpercent tout."],
  Brave: [2563463, "Un Jeton Aventurier et des héros qui partent en quête."],
  Albaz: [68468459, "Albaz le Déchu et ses Fusions qui brûlent votre terrain."],
  Burn: [102380, "Pas besoin d'attaquer : vos Points de Vie fondent tour après tour."],
  ChainBurn: [27053506, "Une chaîne de pièges qui vous inflige des dégâts à chaque action."],
  ST1732: [1861629, "Des Cyberse qui se relient en Liens toujours plus grands."],
  DarkMagician: [46986414, "Le Magicien Sombre et ses sorts maîtres."],
  Dogmatika: [60303688, "L'Église Dogmatika punit les decks qui comptent sur l'Extra Deck."],
  Dragun: [37818794, "Le Dragon Noir aux Yeux Rouges devient le Dragon Sombre Chevalier."],
  Dragunity: [25682811, "Des dragons-oiseaux qui s'équipent les uns des autres pour Synchroniser."],
  Exosister: [42741437, "Des sœurs en armure Xyz qui punissent les effets du Cimetière."],
  FamiliarPossessed: [4376658, "Les Possédées et leurs familiers, un pour chaque Attribut."],
  Lucky: [2196767, "Pile, face, dés : tout se joue sur la chance !"],
  Frog: [9126351, "Sautez au combat avec des grenouilles venimeuses !"],
  GrenMajuThunderBoarder: [36584821, "Bannit son propre deck pour un Gren Maju surpuissant."],
  Horus: [48229808, "Horus le Dragon de la Flamme Noire monte de niveau en niveau."],
  Dragma: [75286621, "Dogmatika et Invoqué : Fusions qui renvoient vos monstres dans le deck."],
  Kashtira: [48626373, "Kashtira bannit vos cartes face verso et verrouille vos zones."],
  Labrynth: [81497285, "Le château de Labrynth et ses pièges qui ne s'arrêtent jamais."],
  LightswornShaddoldinosour: [57774843, "Lumière, ombres et dinosaures : le Cimetière se remplit vite."],
  Maliss: [68059897, "Les Maliss de l'autre côté du miroir, en Liens et bannissements."],
  MalissOCG: [95454996, "Les Maliss, version OCG."],
  MathMech: [36521307, "Des Cyberse calculateurs qui résolvent votre défaite."],
  MokeyMokey: [27288416, "Une armée de monstres Normaux… qui ne paient pas de mine."],
  MokeyMokeyKing: [13803864, "Les Mokey Mokey se rassemblent autour de leur roi."],
  Orcust: [30741503, "Des automates qui jouent leur mélodie depuis le Cimetière."],
  Phantasm: [56649609, "Le Dragon Spirale Fantasme et ses Ondes fantomatiques."],
  Qliphort: [27279764, "Des machines Pendule qui verrouillent les Invocations Spéciales."],
  "Rank V": [6983839, "Tout pour le Rang 5 : des Xyz à la chaîne."],
  Rainbow: [79856792, "Le Dragon Arc-en-ciel et les sept Bêtes Cristallines."],
  "Level VIII": [73580471, "Rose et ferraille : des Synchro de Niveau 8 en fin de combo."],
  Ryzeal: [34909328, "Les Ryzeal et leurs Xyz de Rang 4 qui détonent."],
  SacredBeast: [69890967, "Les trois Bêtes Sacrées et leur seigneur Raviel."],
  Salamangreat: [87871125, "Les Salamangrandes se réincarnent pour revenir plus fortes."],
  SkyStriker: [26077387, "Raye et ses armures aériennes : une magie à chaque tour."],
  SuperheavySamurai: [3117804, "Des samouraïs géants qui se battent en défense."],
  Swordsoul: [69248256, "Les Âmes d'Épée de Longyuan et leurs Synchro."],
  ThunderDragon: [15291624, "Des Dragons Tonnerre qui fusionnent depuis le Cimetière."],
  Tearlaments: [92731385, "Les Larmalments fusionnent dès qu'ils touchent le Cimetière."],
  TimeThief: [55285840, "Les Voleurs de Temps volent vos cartes pour leurs Xyz."],
  "Toadally Awesome": [90809975, "La Grenouille Trop Géniale et ses amphibiens."],
  Trickstar: [32448765, "Les idoles Trickstar vous brûlent à chaque carte ajoutée."],
  PureWinds: [25793414, "Les Sorcières du Vent et leurs Synchro de glace."],
  Witchcraft: [21522601, "Les Artisanes Sorcières défaussent pour créer des sorts."],
  Yosenju: [65247798, "Des belettes du vent qui frappent puis retournent en main."],
  Yubel: [78371393, "Yubel ne vous laisse pas attaquer sans en payer le prix."],
  Neko: [30581601, "Des Yummy tout mignons… et très affamés."],
  Zefra: [29432356, "Les Zefra et l'Échelle Pendule entre deux mondes."],
  "Zexal Weapons": [84013237, "Numéro 39 Utopie et ses armes ZEXAL."],
  Zoodiac: [48905153, "Les Zodiaques s'empilent en Xyz pour renverser le combat."],
};

const [src, out] = process.argv.slice(2);
const files = new Map();
const goSecond = new Set();
for (const f of readdirSync(join(src, "Game/AI/Decks"))) {
  const code = readFileSync(join(src, "Game/AI/Decks", f), "utf8");
  const decks = [...code.matchAll(/\[Deck\("([^"]+)",\s*"([^"]+)"/g)];
  for (const m of decks) files.set(m[1], m[2]);
  // Executor qui choisit de commencer en second au pile ou face.
  if (/override bool OnSelectHand\(\)\s*\{(?:\s*\/\/[^\n]*)*\s*return false;/.test(code))
    for (const m of decks) goSecond.add(m[1]);
}

/** Carte phare de repli : premier monstre de l'Extra Deck, sinon la carte la plus jouée du Main Deck. */
function fallbackCover(ydk) {
  const lines = readFileSync(ydk, "utf8").split(/\r?\n/);
  const main = [], extra = [];
  let part = null;
  for (const l of lines) {
    if (l.startsWith("#main")) part = main;
    else if (l.startsWith("#extra")) part = extra;
    else if (l.startsWith("!")) part = null;
    else if (part && /^\d+$/.test(l.trim())) part.push(Number(l));
  }
  if (extra.length) return extra[0];
  const count = new Map();
  for (const c of main) count.set(c, (count.get(c) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

const bots = JSON.parse(readFileSync(join(src, "bots.json"), "utf8"))
  .filter((b) => !b.masterRules || b.masterRules.includes(5))
  .filter((b) => files.has(b.deck) && existsSync(join(src, "Decks", `${files.get(b.deck)}.ydk`)))
  .map((b) => {
    const [cover, blurb] = INFO[b.deck] ?? [fallbackCover(join(src, "Decks", `${files.get(b.deck)}.ydk`)), ""];
    return { name: b.name, deck: b.deck, difficulty: b.difficulty ?? 1, cover, blurb, ...(goSecond.has(b.deck) ? { goSecond: true } : {}) };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(out, JSON.stringify(bots));
console.log(`decks WindBot : ${bots.length} (${bots.filter((b) => b.goSecond).length} préfèrent commencer en second)`);
