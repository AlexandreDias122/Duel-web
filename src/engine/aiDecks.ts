// Decks méta joués par l'IA, avec la « connaissance » de chaque deck (façon exécuteurs WindBot) :
// quoi jouer en premier, quoi chercher, quels monstres de l'Extra Deck viser.
// Listes tirées de tops récents (YGOPRODeck), retouchées pour respecter la banlist TCG 2026.10.

export interface DeckProfile {
  id: string;
  name: string;
  /** Une ligne pour l'écran de préparation. */
  blurb: string;
  main: number[];
  extra: number[];
  /** Ordre de jeu en Main Phase : cartes à activer / invoquer en priorité. */
  plan: number[];
  /** Invocation Normale préférée. */
  normal: number[];
  /** Cartes à prendre en priorité (recherche, Invocation depuis le Deck ou le Cimetière…). */
  search: number[];
  /** Monstres de l'Extra Deck à invoquer, du plus voulu au moins voulu. */
  extraPlan: number[];
  /** Cartes qu'on accepte de défausser / envoyer / sacrifier en premier. */
  fodder?: number[];
}

/** "id*3 id id*2" → liste de codes. */
function list(s: string): number[] {
  return s.trim().split(/\s+/).flatMap((t) => {
    const [id, n = "1"] = t.split("*");
    return Array(Number(n)).fill(Number(id));
  });
}

// Cartes génériques, pour la lisibilité des listes.
const ASH = 14558127, OGRE = 59438930, BELLE = 73642296, VEILER = 97268402, IMPERM = 10045474;
const FUWALOS = 42141493, PURULIA = 84192580, DROLL = 94145021;

export const AI_DECKS: DeckProfile[] = [
  {
    id: "elfnote",
    name: "Elfnote",
    blurb: "Vainqueur du YCS Montréal (août 2026). Synchro autour de la zone centrale.",
    main: list(`13597785*3 56651978*3 85976588*2 12375297*2 70488851*2 10266279*2 97556336*3 60303688 70088809*3
      ${FUWALOS}*3 ${PURULIA}*3 ${ASH}*3 ${BELLE}*2 33854624 64491754*2 25661743 30271097*2 24092792*2`),
    extra: list("5559570 42302563 40139997 94641726 93125329 5914858 31924889 22850702 74405783 53971455 78397661 29301450"),
    // Lucina et Fortuna s'invoquent seules au centre ; Medius va chercher Power Patron ; Terminus envoie un Power Patron.
    plan: [13597785, 85976588, 56651978, 25661743, 97556336, 12375297, 64491754, 10266279, 24092792, 70488851],
    normal: [97556336, 56651978, 60303688],
    search: [56651978, 12375297, 13597785, 85976588, 97556336, 64491754, 24092792, 10266279],
    extraPlan: [5914858, 5559570, 42302563, 40139997, 94641726, 31924889, 22850702, 93125329, 74405783, 53971455, 78397661, 29301450],
    fodder: [70488851, 10266279, 30271097],
  },
  {
    id: "kewl-tune",
    name: "Kewl Tune",
    blurb: "Finaliste du YCS Montréal (août 2026). Syntoniseurs qui s'enchaînent en Synchro.",
    main: list(`16387555*3 89392810*3 43904702*3 16509007*3 70088809*3 ${ASH}*3 ${BELLE}*3 ${OGRE}*2 ${VEILER}*3
      74203495 38814750 49036338 14442329 78058681*3 99243014 97474300*2 84211599 ${IMPERM}*3`),
    extra: list("65961304 39576656 15665977*2 88170262 42781164*2 41069676*2 4891376 98506199 93125329 821049 72444406 93039339"),
    // Cue en Invocation Normale appelle un autre syntoniseur, Reco / Mix cherchent le reste.
    plan: [84211599, 78058681, 97474300, 99243014, 14442329, 16387555, 89392810, 16509007],
    normal: [16387555, 89392810, 16509007, 43904702],
    search: [78058681, 16387555, 89392810, 16509007, 14442329, 43904702, 41069676, 42781164, 15665977],
    extraPlan: [41069676, 65961304, 4891376, 15665977, 88170262, 42781164, 39576656, 72444406, 98506199, 821049, 93125329],
  },
  {
    id: "mitsurugi",
    name: "Mitsurugi Azamina",
    blurb: "Top 8 du YCS Montréal (août 2026). Rituels Mitsurugi, Diabellstar et Black Chaos.",
    main: list(`44001993 98684220*2 97462632 24088928*2 72270339*3 44694191 30680659*2 2563463 40543231*3 82782870*2
      18176525*2 55397172 19899073 ${FUWALOS}*3 ${PURULIA}*3 ${DROLL} ${ASH} 33599853 94845588 66328392 80845034*3
      39568067 3285551 38745520 25224340*2 45171524*3 81560239 49721684 24461358*3 13048472*2 98476659*3 24299458*3
      81439174 17954937 24749710`),
    extra: list("73391962 59400890 94259633 5043010 86066372 45819647 98127546 8264361 29301450"),
    plan: [13048472, 24461358, 45171524, 80845034, 72270339, 81560239, 49721684, 33599853, 98684220, 3285551, 39568067,
      30680659, 66328392, 94845588, 25224340, 24749710, 97462632, 98476659],
    normal: [40543231, 18176525, 82782870, 72270339, 30680659],
    search: [19899073, 55397172, 40543231, 18176525, 81560239, 45171524, 72270339, 82782870, 33599853, 44001993, 98684220,
      80845034, 94845588],
    extraPlan: [73391962, 98127546, 86066372, 5043010, 59400890, 29301450, 94259633, 45819647, 8264361],
    fodder: [98476659, 24088928, 44694191],
  },
  {
    id: "branded",
    name: "Branded Black Chaos",
    blurb: "Top 16 du YCS Montréal (août 2026). Fusions Branded et rituel Light and Darkness.",
    main: list(`70405001*2 44001993 98684220*3 97462632 24088928*2 50073633 73819701*2 68468459 95515789*2 55273560
      82344137 62991792 70088809*3 33854624 ${ASH}*3 33599853*2 29948294 44362883 30271097*3 24461358*3 13048472
      48130397*3 24299458 24749710*2`),
    extra: list("67809530 93125329 22850702 74405783 53971455 78397661 44146295 24915933 51409648 76666602 80843006 11765832 29301450"),
    plan: [29948294, 44362883, 13048472, 24461358, 33599853, 98684220, 68468459, 73819701, 55273560, 95515789, 50073633,
      62991792, 24749710],
    normal: [68468459, 73819701, 55273560, 50073633, 62991792, 95515789],
    search: [68468459, 33599853, 44001993, 70405001, 98684220, 44362883, 29948294, 55273560, 95515789, 24088928],
    extraPlan: [44146295, 24915933, 51409648, 53971455, 76666602, 80843006, 78397661, 74405783, 67809530, 11765832, 22850702, 29301450, 93125329],
    fodder: [24088928, 95515789],
  },
  {
    id: "sky-striker",
    name: "Sky Striker",
    blurb: "Top 32 du YCS Montréal (août 2026). Magies à la chaîne et Links Sky Striker Ace.",
    main: list(`26077387*3 37351133*2 ${ASH}*3 ${OGRE}*3 ${BELLE}*2 ${DROLL} 63166095*2 9726840*3 34433770*2 98338152*3
      51227866 30271097*3 5318639 20508881*3 98829635*2 35261759*3 99550630*2 32807846`),
    extra: list("76072561*3 63288573*3 90673288 8491308 25072579 75147529 63013339 98462037 29301450 78397661"),
    plan: [35261759, 32807846, 63166095, 9726840, 20508881, 26077387, 37351133, 51227866, 99550630],
    normal: [26077387, 37351133],
    search: [63166095, 26077387, 98338152, 51227866, 9726840, 37351133, 34433770, 99550630],
    extraPlan: [63288573, 90673288, 8491308, 98462037, 63013339, 75147529, 25072579, 76072561, 29301450, 78397661],
  },
  {
    id: "maliss",
    name: "Maliss",
    blurb: "Top 4 du Championnat du Japon (juillet 2026). Cyberse qui se bannit et revient.",
    main: list(`69272449 96676583*3 20938824*2 32061192 30118811*3 3723262 18789533 74652966 64865 ${PURULIA}*3 ${FUWALOS}
      ${OGRE}*3 ${ASH}*2 ${BELLE} ${VEILER} ${DROLL} 33854624 72656408 68337209*2 75500286 73628505 1475311 94722358
      20726052 57111661 ${IMPERM}*2 40366667*2 78114463`),
    extra: list("24842059 60303245 52698008 37458564 29301450 65741786 4993187 21848500 46947713 5043010 86066372 39138610 13203964"),
    // Les Pièges <C> se jouent pendant notre propre tour, dès qu'ils sont posés.
    plan: [73628505, 68337209, 75500286, 1475311, 96676583, 32061192, 20938824, 30118811, 3723262, 74652966,
      94722358, 57111661, 20726052],
    normal: [30118811, 69272449, 96676583, 32061192, 3723262],
    search: [69272449, 96676583, 30118811, 68337209, 32061192, 20938824, 94722358, 57111661, 20726052, 18789533],
    extraPlan: [39138610, 86066372, 21848500, 5043010, 46947713, 4993187, 65741786, 52698008, 37458564, 60303245, 29301450, 13203964, 24842059],
  },
  {
    id: "toon",
    name: "Toon",
    blurb: "Vainqueur du Championnat du Japon (juillet 2026). Toon World et ses invocations en cascade.",
    main: list(`8915275 45536531*3 72921536*3 34314989 ${PURULIA}*3 ${FUWALOS} ${OGRE}*3 ${ASH}*2 ${DROLL} ${VEILER}*3
      ${BELLE}*2 7293697*3 89997728 91500017 32236916*3 73628505 84211599 53094821 34298391 40366667*2 ${IMPERM}*3`),
    extra: list("87460579 15982593 22850702 13203964 45112597 5043010 98462037 94259633"),
    // Toon World d'abord (il cherche jusqu'à trois fois), puis les cartes qui vont le chercher.
    plan: [7293697, 84211599, 45536531, 89997728, 91500017, 73628505, 32236916, 72921536, 8915275, 34314989],
    normal: [45536531, 72921536],
    search: [7293697, 45536531, 72921536, 8915275, 53094821, 34314989, 34298391, 91500017],
    extraPlan: [15982593, 87460579, 45112597, 5043010, 94259633, 22850702, 98462037, 13203964],
  },
];

export function getProfile(id: string | undefined | null): DeckProfile | null {
  return AI_DECKS.find((d) => d.id === id) ?? null;
}
