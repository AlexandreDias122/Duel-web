import type { ReactElement } from "react";
import type { DuelState, FieldCard } from "../engine/protocol";
import { LOC, POS, TYPE } from "../lib/constants";
import { CardImage } from "./CardImage";

import { cardKey } from "./keys";

export interface FieldProps {
  state: DuelState;
  viewer: number;
  /** Cartes ayant une action possible (clé cardKey). */
  actionable: Set<string>;
  /** Zones sélectionnables pour SELECT_PLACE (clé cardKey). */
  zones: Set<string>;
  chosenZones: Set<string>;
  targets: Set<string>;
  /** Montrer les cartes face cachée de l'adversaire (mode solo). */
  revealAll: boolean;
  onCard: (controller: number, location: number, sequence: number, card: FieldCard) => void;
  onZone: (controller: number, location: number, sequence: number) => void;
  onPile: (controller: number, location: number) => void;
}

export function Field(p: FieldProps) {
  const me = p.viewer;
  const op = 1 - me;
  const cells: ReactElement[] = [];
  const add = (row: number, col: number, el: ReactElement | null) => {
    if (el) cells.push(<div key={`${row}-${col}`} style={{ gridRow: row, gridColumn: col }} className="cell">{el}</div>);
  };

  // Adversaire (tourné à 180° : sa zone 0 est à notre droite)
  add(1, 1, <Pile {...p} player={op} location={LOC.DECK} />);
  for (let i = 0; i < 5; i++) add(1, 6 - i, <Zone {...p} player={op} location={LOC.SZONE} seq={i} />);
  add(1, 7, <Pile {...p} player={op} location={LOC.EXTRA} />);
  add(2, 1, <Pile {...p} player={op} location={LOC.GRAVE} />);
  for (let i = 0; i < 5; i++) add(2, 6 - i, <Zone {...p} player={op} location={LOC.MZONE} seq={i} />);
  add(2, 7, <Zone {...p} player={op} location={LOC.SZONE} seq={5} />);
  // Zones Monstre Extra : à gauche = ma zone 5 / zone 6 adverse
  add(3, 1, <Pile {...p} player={op} location={LOC.REMOVED} />);
  add(3, 3, <ExtraZone {...p} left />);
  add(3, 5, <ExtraZone {...p} left={false} />);
  add(3, 7, <Pile {...p} player={me} location={LOC.REMOVED} />);
  // Moi
  add(4, 1, <Zone {...p} player={me} location={LOC.SZONE} seq={5} />);
  for (let i = 0; i < 5; i++) add(4, 2 + i, <Zone {...p} player={me} location={LOC.MZONE} seq={i} />);
  add(4, 7, <Pile {...p} player={me} location={LOC.GRAVE} />);
  add(5, 1, <Pile {...p} player={me} location={LOC.EXTRA} />);
  for (let i = 0; i < 5; i++) add(5, 2 + i, <Zone {...p} player={me} location={LOC.SZONE} seq={i} />);
  add(5, 7, <Pile {...p} player={me} location={LOC.DECK} />);

  return <div className="field">{cells}</div>;
}

function ExtraZone(p: FieldProps & { left: boolean }) {
  const me = p.viewer;
  const mine = p.state.players[me].mzone[p.left ? 5 : 6];
  const theirs = p.state.players[1 - me].mzone[p.left ? 6 : 5];
  if (theirs) return <Zone {...p} player={1 - me} location={LOC.MZONE} seq={p.left ? 6 : 5} />;
  if (mine) return <Zone {...p} player={me} location={LOC.MZONE} seq={p.left ? 5 : 6} />;
  // Zone vide : sélectionnable par l'un ou l'autre joueur
  const keyMine = cardKey(me, LOC.MZONE, p.left ? 5 : 6);
  const keyTheirs = cardKey(1 - me, LOC.MZONE, p.left ? 6 : 5);
  if (p.zones.has(keyTheirs) && !p.zones.has(keyMine)) return <Zone {...p} player={1 - me} location={LOC.MZONE} seq={p.left ? 6 : 5} />;
  return <Zone {...p} player={me} location={LOC.MZONE} seq={p.left ? 5 : 6} emz />;
}

function Zone(p: FieldProps & { player: number; location: number; seq: number; emz?: boolean }) {
  const pl = p.state.players[p.player];
  const card = p.location === LOC.MZONE ? pl.mzone[p.seq] : pl.szone[p.seq];
  const key = cardKey(p.player, p.location, p.seq);
  const selectable = p.zones.has(key);
  const chosen = p.chosenZones.has(key);
  const opp = p.player !== p.viewer;
  const cls = [
    "zone",
    p.location === LOC.MZONE ? "zone-m" : "zone-s",
    p.location === LOC.SZONE && p.seq === 5 ? "zone-field" : "",
    p.emz || p.seq >= 5 ? "zone-emz" : "",
    selectable ? "zone-selectable" : "",
    chosen ? "zone-chosen" : "",
    card && p.actionable.has(key) ? "zone-actionable" : "",
    card && p.targets.has(key) ? "zone-target" : "",
    opp ? "zone-opp" : "",
  ].join(" ");
  return (
    <div className={cls} onClick={() => (selectable ? p.onZone(p.player, p.location, p.seq) : card && p.onCard(p.player, p.location, p.seq, card))}>
      {card && <FieldCardView card={card} opp={opp} reveal={!opp || p.revealAll} monsterZone={p.location === LOC.MZONE} />}
    </div>
  );
}

function FieldCardView({ card, opp, reveal, monsterZone }: { card: FieldCard; opp: boolean; reveal: boolean; monsterZone: boolean }) {
  const facedown = (card.position & POS.FACEDOWN) !== 0;
  const defense = monsterZone && (card.position & POS.DEFENSE) !== 0;
  const isMonster = monsterZone && (card.type & TYPE.MONSTER) !== 0;
  const isLink = (card.type & TYPE.LINK) !== 0;
  const counters = Object.values(card.counters).reduce((a, b) => a + b, 0);
  return (
    <div className={`fcard ${defense ? "fcard-def" : ""} ${opp ? "fcard-opp" : ""}`}>
      <CardImage code={card.code} back={facedown && (!reveal || !card.code)} className={facedown ? "facedown" : ""} />
      {isMonster && !facedown && card.position & POS.FACEUP && (
        <div className={`stats ${card.attack > card.baseAttack ? "up" : card.attack < card.baseAttack ? "down" : ""}`}>
          {card.attack}{!isLink && <span>/{card.defense}</span>}
        </div>
      )}
      {card.overlays.length > 0 && <div className="badge badge-xyz">{card.overlays.length}</div>}
      {counters > 0 && <div className="badge badge-counter">{counters}</div>}
      {(card.type & TYPE.PENDULUM) !== 0 && !isMonster && <div className="badge badge-scale">{card.lscale}</div>}
    </div>
  );
}

function Pile(p: FieldProps & { player: number; location: number }) {
  const pl = p.state.players[p.player];
  const list = p.location === LOC.GRAVE ? pl.grave : p.location === LOC.REMOVED ? pl.removed : p.location === LOC.EXTRA ? pl.extra : null;
  const count = list ? list.length : pl.deck;
  const top = list?.[list.length - 1];
  const faceUp = p.location === LOC.GRAVE || p.location === LOC.REMOVED;
  const label = { [LOC.GRAVE]: "Cim.", [LOC.REMOVED]: "Bannis", [LOC.EXTRA]: "Extra", [LOC.DECK]: "Deck" }[p.location];
  const actionable = list?.some((_, i) => p.actionable.has(cardKey(p.player, p.location, i)));
  return (
    <div className={`pile ${actionable ? "zone-actionable" : ""} ${p.player !== p.viewer ? "zone-opp" : ""}`} onClick={() => p.onPile(p.player, p.location)}>
      {count > 0 ? <CardImage code={top?.code ?? 0} back={!faceUp && !(top && top.position & POS.FACEUP)} /> : <div className="pile-empty" />}
      <div className="pile-label">{label} <b>{count}</b></div>
    </div>
  );
}
