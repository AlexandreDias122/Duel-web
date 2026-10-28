// IA : heuristiques générales (hand traps, timing des effets rapides, attaques rentables)
// complétées, pour les decks méta, par un profil qui dit quoi jouer et quoi chercher.
import { OcgMessageType as T, OcgResponseType as R, cardMatchesOpcode } from "ocgcore-wasm";
import type { OcgMessage, OcgResponse, OcgCardLoc, OcgLocation, OcgPosition, SelectFieldPlace } from "ocgcore-wasm";
import type { Card, CardDb } from "../lib/cards";
import { isExtra } from "../lib/cards";
import { LOC, PHASE, POS, TYPE } from "../lib/constants";
import type { DeckProfile } from "./aiDecks";
import { handTrapKind, hasSummonTrigger, isHeld, isSearcher, likesGrave } from "./cardKnowledge";
import type { DuelState, FieldCard } from "./protocol";

type Msg<K extends T> = Extract<OcgMessage, { type: K }>;

/** Sens d'une sélection de cartes, d'après l'indice du moteur (HINTMSG_*). */
type Intent = "good" | "bad" | "material" | "attack" | "target";

const BAD_HINTS = new Set([500, 501, 502, 503, 504, 505, 507, 515, 519, 520, 521, 528, 531, 532, 575, 579]);
const MATERIAL_HINTS = new Set([511, 512, 513, 533]);

function intentOf(hint: bigint): Intent {
  const h = Number(hint);
  if (h === 549) return "attack";
  if (h === 551) return "target";
  if (MATERIAL_HINTS.has(h)) return "material";
  if (BAD_HINTS.has(h)) return "bad";
  return "good";
}

/** Dernier événement marquant, pour savoir à quoi on répond. */
type Event = { kind: "summon" | "attack" | "chain" | "phase"; player: number } | null;

export class DuelAi {
  private idleActions = 0;
  private lastTurn = -1;
  /** Effets déjà lancés ce tour (code:description) : évite de tourner en rond. */
  private used = new Map<string, number>();
  private extraSummons = 0;
  private attackerAtk = 0;
  private attackerSeq = -1;
  /** Monstres qui renoncent à attaquer ce tour (aucune cible rentable). */
  private holdAttack = new Set<number>();
  private event: Event = null;
  /** Cartes ajoutées à notre main ce tour (hors pioche) : on évite de chercher deux fois la même. */
  private fetched = new Map<number, number>();
  /** Cartes adverses vues, pour les déclarations de nom. */
  private seen: number[] = [];
  private rankOf: (list: number[] | undefined, code: number) => number;

  constructor(private db: CardDb, readonly player: number, private profile: DeckProfile | null = null) {
    this.rankOf = (list, code) => {
      if (!list) return -1;
      const base = db.baseId(code);
      const i = list.findIndex((c) => c === code || db.baseId(c) === base);
      return i;
    };
  }

  /** Suit le déroulé du duel (appelé pour chaque message du moteur). */
  observe(m: OcgMessage) {
    switch (m.type) {
      case T.SUMMONING: case T.SPSUMMONING: case T.FLIPSUMMONING: this.event = { kind: "summon", player: m.controller }; break;
      case T.ATTACK: this.event = { kind: "attack", player: m.card.controller }; break;
      case T.CHAINING:
        this.event = { kind: "chain", player: m.controller };
        if (m.controller !== this.player) this.see(m.code);
        break;
      case T.NEW_PHASE: case T.NEW_TURN: this.event = { kind: "phase", player: -1 }; break;
      case T.MOVE:
        if (m.card && m.to.controller === this.player && m.to.location === LOC.HAND && m.from.location & (LOC.DECK | LOC.GRAVE)) {
          const base = this.db.baseId(m.card);
          this.fetched.set(base, (this.fetched.get(base) ?? 0) + 1);
        }
        if (m.card && m.to.controller !== this.player && m.to.location & (LOC.MZONE | LOC.SZONE | LOC.GRAVE | LOC.REMOVED)) this.see(m.card);
        break;
    }
  }

  private see(code: number) {
    if (!code) return;
    this.seen = [code, ...this.seen.filter((c) => c !== code)].slice(0, 40);
  }

  respond(msg: OcgMessage, state: DuelState, retry: boolean, hint: bigint = 0n): OcgResponse {
    if (state.turn !== this.lastTurn) {
      this.lastTurn = state.turn;
      this.idleActions = 0;
      this.extraSummons = 0;
      this.used.clear();
      this.holdAttack.clear();
      this.fetched.clear();
    }
    // Après un refus du moteur, on se rabat sur la réponse la plus sûre.
    if (retry) return safeResponse(msg);
    switch (msg.type) {
      case T.SELECT_IDLECMD: return this.idle(msg, state);
      case T.SELECT_BATTLECMD: return this.battle(msg, state);
      case T.SELECT_CHAIN: return this.chain(msg, state);
      case T.SELECT_EFFECTYN: return { type: R.SELECT_EFFECTYN, yes: true };
      case T.SELECT_YESNO: return { type: R.SELECT_YESNO, yes: true };
      case T.SELECT_OPTION: return { type: R.SELECT_OPTION, index: 0 };
      case T.SELECT_CARD: return this.selectCard(msg, state, intentOf(hint));
      case T.SELECT_TRIBUTE: {
        const order = this.rank(msg.selects, state, "material");
        return { type: R.SELECT_TRIBUTE, indicies: order.slice(0, msg.min) };
      }
      case T.SELECT_UNSELECT_CARD: {
        if (!msg.select_cards.length) return { type: R.SELECT_UNSELECT_CARD, index: null };
        const intent = intentOf(hint);
        const order = this.rank(msg.select_cards, state, intent);
        // On continue tant qu'il reste une carte adverse à frapper ; sinon on s'arrête au minimum.
        const more = (intent === "bad" || intent === "target") && msg.select_cards[order[0]].controller !== this.player
          && msg.unselect_cards.length < msg.max;
        if (msg.can_finish && !more) return { type: R.SELECT_UNSELECT_CARD, index: null };
        return { type: R.SELECT_UNSELECT_CARD, index: order[0] };
      }
      case T.SELECT_POSITION: return { type: R.SELECT_POSITION, position: this.position(msg, state) };
      case T.SELECT_PLACE:
      case T.SELECT_DISFIELD:
        return { type: msg.type === T.SELECT_PLACE ? R.SELECT_PLACE : R.SELECT_DISFIELD, places: pickPlaces(msg.player, msg.field_mask, msg.count, msg.type === T.SELECT_DISFIELD) };
      case T.SELECT_SUM: return { type: R.SELECT_SUM, indicies: selectSum(msg, this.rank(msg.selects, state, "material")) };
      case T.SELECT_COUNTER: {
        let left = msg.count;
        return { type: R.SELECT_COUNTER, counters: msg.cards.map((c) => { const n = Math.min(c.count, left); left -= n; return n; }) };
      }
      case T.SORT_CARD:
      case T.SORT_CHAIN:
        return { type: R.SORT_CARD, order: null };
      case T.ANNOUNCE_RACE: return { type: R.ANNOUNCE_RACE, races: bits(BigInt(msg.available)).slice(0, msg.count) as never };
      case T.ANNOUNCE_ATTRIB: return { type: R.ANNOUNCE_ATTRIB, attributes: bits(BigInt(msg.available)).slice(0, msg.count).map(Number) as never };
      case T.ANNOUNCE_NUMBER: return { type: R.ANNOUNCE_NUMBER, value: 0 };
      case T.ANNOUNCE_CARD: return { type: R.ANNOUNCE_CARD, card: this.announce(msg.opcodes) };
      case T.ROCK_PAPER_SCISSORS: return { type: R.ROCK_PAPER_SCISSORS, value: (1 + Math.floor(Math.random() * 3)) as 1 | 2 | 3 };
      default: return safeResponse(msg);
    }
  }

  // --- Main Phase ---------------------------------------------------------------

  private idle(msg: Msg<T.SELECT_IDLECMD>, state: DuelState): OcgResponse {
    const me = state.players[msg.player];
    const done = (): OcgResponse => {
      const canAttack = state.turn > 1 && me.mzone.some((c) => c && c.position & POS.ATTACK && c.attack > 0);
      return { type: R.SELECT_IDLECMD, action: msg.to_bp && canAttack ? 6 : 7, index: null };
    };
    if (++this.idleActions > 45) return done();
    const p = this.profile;
    const planScore = (code: number, base: number) => {
      const i = this.rankOf(p?.plan, code);
      return i >= 0 ? base - i * 5 : -1;
    };

    const options: { action: number; index: number; score: number; key?: string; extra?: boolean }[] = [];

    msg.activates.forEach((c, index) => {
      const card = this.db.get(c.code);
      const key = `${c.code}:${c.description}`;
      if ((this.used.get(key) ?? 0) >= 3) return;
      const planned = planScore(c.code, 900);
      // Les hand traps, les cartes de réponse et les Pièges posés attendent le tour adverse.
      if (planned < 0) {
        if (c.location === LOC.HAND && handTrapKind(card)) return;
        if (isHeld(card)) return;
        if (card && card.type & TYPE.TRAP) return;
      }
      // Une deuxième copie d'un Terrain / d'une Continue déjà en place ne sert à rien.
      if (c.location === LOC.HAND && card && card.type & (TYPE.FIELD | TYPE.CONTINUOUS) && this.onField(state, c.code)) return;
      if (c.location === LOC.HAND && card && card.type & TYPE.FIELD && me.szone[5] && !(me.szone[5].position & POS.FACEDOWN)) return;
      // Effets rapides des monstres (sans effet de Main Phase) : gardés pour le tour adverse.
      if (planned < 0 && c.location & LOC.MZONE && quickOnly(card)) return;
      let score = planned;
      if (score < 0) {
        if (c.location & LOC.MZONE) score = 760; // effets des monstres avant de s'en servir comme Matériel
        else if (c.location & LOC.GRAVE) score = 720;
        else if (card && card.type & TYPE.FIELD) score = 560;
        else if (isSearcher(card)) score = 540;
        else if (card && card.type & TYPE.PENDULUM && c.location === LOC.HAND) score = 300;
        else score = 500;
      }
      options.push({ action: 5, index, score, key });
    });

    msg.summons.forEach((c, index) => {
      const card = this.db.get(c.code);
      if (handTrapKind(card)) return;
      const i = this.rankOf(p?.normal, c.code);
      let score: number;
      if (i >= 0) score = 880 - i * 5;
      else if (card && card.level >= 5) score = card.atk >= 2400 ? 260 : -1; // Invocation Sacrifice : seulement pour un gros monstre
      else score = (hasSummonTrigger(card) ? 480 : 400) + (card?.atk ?? 0) / 100;
      if (score > 0) options.push({ action: 0, index, score });
    });

    msg.special_summons.forEach((c, index) => {
      const card = this.db.get(c.code);
      if (c.location === LOC.HAND && handTrapKind(card) && planScore(c.code, 1) < 0) return;
      const planned = planScore(c.code, 870);
      let score: number;
      if (c.location & LOC.EXTRA) {
        if (this.extraSummons >= 10) return;
        const i = this.rankOf(p?.extraPlan, c.code);
        if (i >= 0) score = 700 - i * 8;
        else if (p) return; // avec un profil, on s'en tient aux monstres prévus
        // Sans profil : on évite de transformer de bons monstres en petits Liens.
        else score = (card?.atk ?? 0) >= 1800 ? 300 + (card?.atk ?? 0) / 20 : -1;
      } else score = planned >= 0 ? planned : 620 + (card?.atk ?? 0) / 100;
      if (score > 0) options.push({ action: 1, index, score, extra: (c.location & LOC.EXTRA) !== 0 });
    });

    if (!me.mzone.some(Boolean)) {
      msg.monster_sets.forEach((c, index) => {
        const card = this.db.get(c.code);
        if (handTrapKind(card) || (card && card.level >= 5)) return;
        options.push({ action: 3, index, score: 150 + (card?.def ?? 0) / 100 });
      });
    }

    msg.spell_sets.forEach((c, index) => {
      const card = this.db.get(c.code);
      if (!card) return;
      if (card.type & TYPE.TRAP || card.type & TYPE.QUICKPLAY || isHeld(card)) options.push({ action: 4, index, score: 200 });
    });

    // Repasser en Attaque un monstre qui a de quoi frapper.
    if (state.phase === PHASE.MAIN1) {
      msg.pos_changes.forEach((c, index) => {
        const fc = me.mzone[c.sequence];
        if (fc && fc.position & POS.DEFENSE && !(fc.position & POS.FACEDOWN) && fc.attack >= 1500 && fc.attack > fc.defense)
          options.push({ action: 2, index, score: 120 });
      });
    }

    if (!options.length) return done();
    const best = options.reduce((a, b) => (b.score > a.score ? b : a));
    if (best.key) this.used.set(best.key, (this.used.get(best.key) ?? 0) + 1);
    if (best.extra) this.extraSummons++;
    return { type: R.SELECT_IDLECMD, action: best.action as 0, index: best.index };
  }

  // --- Chaînes -------------------------------------------------------------------

  private chain(msg: Msg<T.SELECT_CHAIN>, state: DuelState): OcgResponse {
    if (msg.forced) return { type: R.SELECT_CHAIN, index: 0 };
    if (!msg.selects.length) return { type: R.SELECT_CHAIN, index: null };
    const me = msg.player;
    const myTurn = state.turnPlayer === me;
    const last = state.chain[state.chain.length - 1];
    const answeringOpp = !!last && last.controller !== me;
    const ownLinkPending = !!last && last.controller === me;
    const oppSummoned = this.event?.kind === "summon" && this.event.player !== me;
    const oppAttacks = this.event?.kind === "attack" && this.event.player !== me;
    const mainPhase = (state.phase & (PHASE.MAIN1 | PHASE.MAIN2)) !== 0;

    let best = -1, bestScore = 0;
    msg.selects.forEach((c, i) => {
      const card = this.db.get(c.code);
      const key = `${c.code}:${c.description}`;
      if ((this.used.get(key) ?? 0) >= 3) return;
      const ht = c.location & (LOC.HAND | LOC.GRAVE) ? handTrapKind(card) : null;
      const setCard = (c.location & LOC.SZONE) !== 0 && (c.position & POS.FACEDOWN) !== 0;
      const planned = this.rankOf(this.profile?.plan, c.code) >= 0;
      let score = 0;
      if (ht === "free") {
        // Maxx "C", Mulcharmy… : à lancer tôt dans le tour adverse.
        if (!myTurn && !ownLinkPending) score = state.phase === PHASE.MAIN1 || answeringOpp ? 95 : 40;
      } else if (ht === "reactive") {
        // Ash, Veiler, Ogre… : uniquement contre une activation adverse.
        if (answeringOpp) score = 100;
      } else if (isHeld(card) || setCard) {
        if (answeringOpp) score = 80;
        else if (!myTurn && !ownLinkPending && (oppSummoned && mainPhase || oppAttacks)) score = 60;
      } else if (myTurn) {
        // Nos propres effets pendant notre tour : on continue le combo, sans s'enchaîner sur soi-même sans raison.
        if (answeringOpp) score = 70;
        else if (c.location & LOC.MZONE && quickOnly(card) && !planned) score = 0;
        else if (!ownLinkPending || planned) score = 50;
        else score = 20;
      } else {
        // Effets rapides de nos monstres pendant le tour adverse.
        if (answeringOpp) score = 65;
        else if (!ownLinkPending && (oppSummoned || oppAttacks)) score = 45;
      }
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best < 0) return { type: R.SELECT_CHAIN, index: null };
    const c = msg.selects[best];
    const key = `${c.code}:${c.description}`;
    this.used.set(key, (this.used.get(key) ?? 0) + 1);
    return { type: R.SELECT_CHAIN, index: best };
  }

  // --- Combat ----------------------------------------------------------------------

  private battle(msg: Msg<T.SELECT_BATTLECMD>, state: DuelState): OcgResponse {
    const opp = state.players[1 - msg.player];
    const defenders = opp.mzone.filter((c): c is FieldCard => !!c);
    const attackers = msg.attacks
      .map((a, i) => ({ a, i, atk: state.players[msg.player].mzone[a.sequence]?.attack ?? 0 }))
      .sort((x, y) => y.atk - x.atk);
    for (const { a, i, atk } of attackers) {
      if (this.holdAttack.has(a.sequence) || (atk <= 0 && defenders.length)) continue;
      const beatable = defenders.some((d) => battleValue(d) < atk);
      if (!defenders.length || a.can_direct || beatable) {
        this.attackerAtk = atk;
        this.attackerSeq = a.sequence;
        return { type: R.SELECT_BATTLECMD, action: 1, index: i };
      }
    }
    return { type: R.SELECT_BATTLECMD, action: msg.to_m2 ? 2 : 3, index: null };
  }

  // --- Sélections ---------------------------------------------------------------------

  private selectCard(msg: Msg<T.SELECT_CARD>, state: DuelState, intent: Intent): OcgResponse {
    if (intent === "attack") {
      // La cible la plus forte qu'on bat ; sinon on renonce si c'est permis.
      const targets = msg.selects.map((c, i) => ({ i, v: this.fieldCard(c, state) }));
      const ok = targets.filter((t) => t.v && battleValue(t.v) < this.attackerAtk)
        .sort((x, y) => battleValue(y.v!) - battleValue(x.v!));
      if (ok.length) return { type: R.SELECT_CARD, indicies: [ok[0].i] };
      if (msg.can_cancel) {
        this.holdAttack.add(this.attackerSeq);
        return { type: R.SELECT_CARD, indicies: null };
      }
      const weakest = targets.sort((x, y) => (x.v ? battleValue(x.v) : 0) - (y.v ? battleValue(y.v) : 0));
      return { type: R.SELECT_CARD, indicies: [weakest[0].i] };
    }
    const order = this.rank(msg.selects, state, intent);
    let n = Math.max(msg.min, 1);
    // Effet qui frappe « jusqu'à N » cartes adverses : on en prend le plus possible.
    if (intent === "bad" || intent === "target") {
      const opp = order.filter((i) => msg.selects[i].controller !== this.player).length;
      n = Math.max(n, Math.min(msg.max, opp));
    }
    return { type: R.SELECT_CARD, indicies: order.slice(0, Math.min(n, msg.selects.length)) };
  }

  /** Une copie face recto est déjà sur notre terrain. */
  private onField(state: DuelState, code: number): boolean {
    const me = state.players[this.player];
    const base = this.db.baseId(code);
    return [...me.mzone, ...me.szone].some((f) => f && f.code && !(f.position & POS.FACEDOWN) && this.db.baseId(f.code) === base);
  }

  private fieldCard(c: OcgCardLoc, state: DuelState): FieldCard | null {
    const p = state.players[c.controller];
    if (c.location & LOC.MZONE) return p.mzone[c.sequence] ?? null;
    if (c.location & LOC.SZONE) return p.szone[c.sequence] ?? null;
    return null;
  }

  /** Classe les cartes proposées de la meilleure à la pire pour nous, selon le sens de la sélection. */
  private rank(cards: OcgCardLoc[], state: DuelState, intent: Intent): number[] {
    const score = (c: OcgCardLoc) => {
      const mine = c.controller === this.player;
      const fc = this.fieldCard(c, state);
      const card = this.db.get(c.code);
      if (intent === "good") return mine ? this.wanted(c, card, state) : this.threat(c, fc, card) - 5000;
      if (intent === "material") return mine ? -this.worth(c, fc, card) : 1000 + this.threat(c, fc, card);
      // "bad" / "target" : d'abord l'adversaire (ses meilleures cartes), puis ce qui nous coûte le moins.
      if (!mine) return 100000 + this.threat(c, fc, card);
      // Envoyer / bannir depuis notre Deck ou Extra Deck, c'est souvent un coût voulu (Foolish Burial…).
      if (c.location & (LOC.DECK | LOC.EXTRA)) return this.wanted(c, card, state);
      return -this.worth(c, fc, card);
    };
    return cards.map((c, i) => ({ i, s: score(c) })).sort((a, b) => b.s - a.s).map((x) => x.i);
  }

  /** Envie de prendre cette carte (recherche, Invocation depuis le Deck…). */
  private wanted(c: OcgCardLoc, card: Card | undefined, state: DuelState): number {
    const p = this.profile;
    const fromExtra = (c.location & LOC.EXTRA) !== 0 || (card && isExtra(card));
    let s = (card?.atk ?? 0) / 100;
    const i = this.rankOf(fromExtra ? p?.extraPlan : p?.search, c.code);
    if (i >= 0) s += 1000 - i * 20;
    else if (this.rankOf(p?.plan, c.code) >= 0) s += 500;
    if (hasSummonTrigger(card) || isSearcher(card)) s += 60;
    if (c.location & (LOC.DECK | LOC.GRAVE)) {
      // Éviter les doublons en main ou déjà en jeu.
      const inHand = state.players[this.player].hand.filter((h) => h.code && this.db.baseId(h.code) === this.db.baseId(c.code)).length;
      s -= inHand * 400 + (this.onField(state, c.code) ? 350 : 0) + (this.fetched.get(this.db.baseId(c.code)) ?? 0) * 300;
      if (likesGrave(card)) s += 30;
    }
    if (handTrapKind(card)) s += 80;
    return s;
  }

  /** Valeur d'une de nos cartes qu'on risque de perdre (coût, Matériel, sacrifice). */
  private worth(c: OcgCardLoc, fc: FieldCard | null, card: Card | undefined): number {
    const p = this.profile;
    if (card && card.type & TYPE.TOKEN) return -1000;
    let v = fc?.attack ?? card?.atk ?? 0;
    if (c.location & LOC.HAND) {
      if (handTrapKind(card)) v += 2500; // ne pas défausser ses hand traps
      if (this.rankOf(p?.plan, c.code) >= 0 || this.rankOf(p?.normal, c.code) >= 0) v += 1500;
    }
    if (c.location & LOC.GRAVE && likesGrave(card)) v += 800;
    if (c.location & (LOC.HAND | LOC.MZONE) && likesGrave(card)) v -= 600; // bonne carte à envoyer au Cimetière
    if (fc && card && isExtra(card)) v += 1200 + (this.rankOf(p?.extraPlan, c.code) >= 0 ? 600 : 0);
    if (this.rankOf(p?.fodder, c.code) >= 0) v -= 2000;
    return v;
  }

  /** Danger d'une carte adverse. */
  private threat(c: OcgCardLoc, fc: FieldCard | null, card: Card | undefined): number {
    if (c.location & LOC.MZONE) {
      if (!fc) return 0;
      if (fc.position & POS.FACEDOWN) return 1500;
      let v = Math.max(fc.attack, 0);
      if (card && isExtra(card)) v += 800;
      if (card && card.type & TYPE.EFFECT) v += 300;
      return v;
    }
    if (c.location & LOC.SZONE) return fc && fc.position & POS.FACEDOWN ? 1800 : 1200;
    return card?.atk ?? 500;
  }

  private position(msg: Msg<T.SELECT_POSITION>, state: DuelState): OcgPosition {
    const card = this.db.get(msg.code);
    const opp = state.players[1 - msg.player].mzone.filter((c): c is FieldCard => !!c && !(c.position & POS.FACEDOWN));
    const strongest = Math.max(0, ...opp.map((c) => c.attack));
    const defend = !!card && card.def > card.atk && (card.atk < 1500 || strongest > card.atk);
    const prefer = defend
      ? [POS.FACEUP_DEFENSE, POS.FACEUP_ATTACK, POS.FACEDOWN_DEFENSE, POS.FACEDOWN_ATTACK]
      : [POS.FACEUP_ATTACK, POS.FACEUP_DEFENSE, POS.FACEDOWN_DEFENSE, POS.FACEDOWN_ATTACK];
    return (prefer.find((p) => msg.positions & p) ?? POS.FACEUP_ATTACK) as OcgPosition;
  }

  /** Déclarer un nom : de préférence une carte que l'adversaire a déjà montrée. */
  private announce(opcodes: Parameters<typeof cardMatchesOpcode>[1]): number {
    const matches = (card: Card) => cardMatchesOpcode({
      code: card.id, alias: card.alias, setcodes: [], type: card.type, level: card.level, attribute: card.attribute,
      race: BigInt(card.race), attack: card.atk, defense: card.def, lscale: card.lscale, rscale: card.rscale, link_marker: card.linkMarker,
    }, opcodes);
    for (const code of this.seen) {
      const card = this.db.get(code);
      if (card && matches(card)) return card.id;
    }
    for (const card of this.db.searchable) if (matches(card)) return card.id;
    return 0;
  }
}

/** Le monstre n'a que des effets rapides (aucun effet à lancer pendant notre Main Phase). */
function quickOnly(card: Card | undefined): boolean {
  if (!card) return false;
  return /\(Quick Effect\)/.test(card.desc) && !/(During your Main Phase|You can (?!.*Quick Effect)[^.]*;)/.test(card.desc.replace(/[^.]*\(Quick Effect\)[^.]*\./g, ""));
}

function battleValue(c: FieldCard) {
  if (c.position & POS.FACEDOWN) return 1500;
  return c.position & POS.DEFENSE ? c.defense : c.attack;
}

function bits(v: bigint): bigint[] {
  const out: bigint[] = [];
  for (let b = 1n; b <= v; b <<= 1n) if (v & b) out.push(b);
  return out;
}

/** Zones Monstre : Extra d'abord (Liens), puis le centre ; Magie/Piège : du centre vers les bords. */
const MZONE_ORDER = [5, 6, 2, 1, 3, 0, 4];
const SZONE_ORDER = [2, 1, 3, 0, 4, 5];

/** Bits de field_mask : 0-6 mes monstres, 8-15 mes Magies/Pièges, +16 pour l'adversaire. Bit à 1 = indisponible. */
export function pickPlaces(player: number, mask: number, count: number, opponentFirst: boolean): SelectFieldPlace[] {
  const order = opponentFirst ? [16, 0] : [0, 16];
  const places: SelectFieldPlace[] = [];
  for (const offset of order) {
    for (const [base, seqs, location] of [[0, MZONE_ORDER, LOC.MZONE], [8, SZONE_ORDER, LOC.SZONE]] as const) {
      for (const seq of seqs) {
        if (places.length >= count) break;
        const bit = offset + base + seq;
        if (mask & (1 << bit)) continue;
        places.push({ player: offset ? 1 - player : player, location: location as OcgLocation, sequence: seq });
      }
    }
  }
  return places;
}

/** Somme exacte (ou minimale) de niveaux, en essayant d'abord les cartes qu'on préfère utiliser. */
function selectSum(msg: Msg<T.SELECT_SUM>, preferred?: number[]): number[] {
  const values = (amount: number) => [amount & 0xffff, amount >> 16].filter((v) => v > 0);
  let target = msg.amount;
  for (const c of msg.selects_must) target -= values(c.amount)[0] ?? 0;
  const order = preferred ?? msg.selects.map((_, i) => i);
  // Recherche exhaustive bornée (les listes sont courtes).
  const n = order.length;
  const exact = !msg.select_max;
  let best: number[] | null = null;
  // « Égal ou supérieur » : aucune carte superflue (sans la plus petite, on doit passer sous le total).
  const minimal = (chosen: number[], sum: number) => !chosen.length || sum - Math.min(...chosen.map((i) => values(msg.selects[i].amount)[0])) < target;
  const walk = (k: number, sum: number, chosen: number[]) => {
    if (best) return;
    if (exact ? sum === target : sum >= target) {
      if (!exact && !minimal(chosen, sum)) return;
      // max = 0 : pas de limite (rituels « égal ou supérieur »).
      if (chosen.length >= msg.min && (!msg.max || chosen.length <= Math.max(msg.max, msg.min))) best = [...chosen];
      return;
    }
    if (k >= n || chosen.length > 8) return;
    const i = order[k];
    for (const v of values(msg.selects[i].amount)) walk(k + 1, sum + v, [...chosen, i]);
    walk(k + 1, sum, chosen);
  };
  walk(0, 0, []);
  return best ?? order.slice(0, Math.max(msg.min, 1));
}

/** Réponse par défaut : annuler ou faire le choix minimal. */
export function safeResponse(msg: OcgMessage): OcgResponse {
  switch (msg.type) {
    case T.SELECT_IDLECMD: return { type: R.SELECT_IDLECMD, action: msg.to_ep ? 7 : 6, index: null };
    case T.SELECT_BATTLECMD: return { type: R.SELECT_BATTLECMD, action: msg.to_ep ? 3 : 2, index: null };
    case T.SELECT_CHAIN: return { type: R.SELECT_CHAIN, index: msg.forced ? 0 : null };
    case T.SELECT_EFFECTYN: return { type: R.SELECT_EFFECTYN, yes: false };
    case T.SELECT_YESNO: return { type: R.SELECT_YESNO, yes: false };
    case T.SELECT_OPTION: return { type: R.SELECT_OPTION, index: 0 };
    case T.SELECT_CARD: return { type: R.SELECT_CARD, indicies: msg.can_cancel ? null : Array.from({ length: msg.min }, (_, i) => i) };
    case T.SELECT_TRIBUTE: return { type: R.SELECT_TRIBUTE, indicies: msg.can_cancel ? null : Array.from({ length: msg.min }, (_, i) => i) };
    case T.SELECT_UNSELECT_CARD:
      return { type: R.SELECT_UNSELECT_CARD, index: msg.can_finish || msg.can_cancel || !msg.select_cards.length ? null : 0 };
    case T.SELECT_POSITION: return { type: R.SELECT_POSITION, position: ([1, 4, 8, 2].find((p) => msg.positions & p) ?? 1) as OcgPosition };
    case T.SELECT_PLACE: return { type: R.SELECT_PLACE, places: pickPlaces(msg.player, msg.field_mask, msg.count, false) };
    case T.SELECT_DISFIELD: return { type: R.SELECT_DISFIELD, places: pickPlaces(msg.player, msg.field_mask, msg.count, true) };
    case T.SELECT_SUM: return { type: R.SELECT_SUM, indicies: selectSum(msg) };
    case T.SELECT_COUNTER: {
      let left = msg.count;
      return { type: R.SELECT_COUNTER, counters: msg.cards.map((c) => { const n = Math.min(c.count, left); left -= n; return n; }) };
    }
    case T.SORT_CARD: case T.SORT_CHAIN: return { type: R.SORT_CARD, order: null };
    case T.ANNOUNCE_RACE: return { type: R.ANNOUNCE_RACE, races: bits(BigInt(msg.available)).slice(0, msg.count) as never };
    case T.ANNOUNCE_ATTRIB: return { type: R.ANNOUNCE_ATTRIB, attributes: bits(BigInt(msg.available)).slice(0, msg.count).map(Number) as never };
    case T.ANNOUNCE_NUMBER: return { type: R.ANNOUNCE_NUMBER, value: 0 };
    case T.ANNOUNCE_CARD: return { type: R.ANNOUNCE_CARD, card: 0 };
    case T.ROCK_PAPER_SCISSORS: return { type: R.ROCK_PAPER_SCISSORS, value: 1 };
    default: throw new Error(`Message sans réponse possible: ${msg.type}`);
  }
}

export const PROMPT_TYPES = new Set<number>([
  T.SELECT_BATTLECMD, T.SELECT_IDLECMD, T.SELECT_EFFECTYN, T.SELECT_YESNO, T.SELECT_OPTION, T.SELECT_CARD,
  T.SELECT_CHAIN, T.SELECT_PLACE, T.SELECT_POSITION, T.SELECT_TRIBUTE, T.SORT_CHAIN, T.SELECT_COUNTER,
  T.SELECT_SUM, T.SELECT_DISFIELD, T.SORT_CARD, T.SELECT_UNSELECT_CARD, T.ANNOUNCE_RACE, T.ANNOUNCE_ATTRIB,
  T.ANNOUNCE_CARD, T.ANNOUNCE_NUMBER, T.ROCK_PAPER_SCISSORS,
]);
