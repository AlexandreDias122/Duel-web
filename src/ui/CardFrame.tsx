import { useState } from "react";
import type { Card } from "../lib/cards";
import { cardImageSources, isMonster } from "../lib/cards";
import { LINK_MARKERS, RACES, TYPE, flagNames } from "../lib/constants";
import { attributeGlyph, frameOf } from "./frame";

function bracketLine(c: Card): string {
  if (!isMonster(c)) {
    const sub =
      c.type & TYPE.QUICKPLAY ? " ⚡" : c.type & TYPE.CONTINUOUS ? " ∞" : c.type & TYPE.EQUIP ? " ✚"
      : c.type & TYPE.FIELD ? " ⛰" : c.type & TYPE.RITUAL ? " 🔥" : c.type & TYPE.COUNTER ? " ↺" : "";
    return `[${c.type & TYPE.SPELL ? "Carte Magie" : "Carte Piège"}${sub}]`;
  }
  const parts = [flagNames(c.race, RACES)];
  const subs: [number, string][] = [
    [TYPE.FUSION, "Fusion"], [TYPE.RITUAL, "Rituel"], [TYPE.SYNCHRO, "Synchro"], [TYPE.XYZ, "Xyz"], [TYPE.PENDULUM, "Pendule"],
    [TYPE.LINK, "Lien"], [TYPE.TUNER, "Syntoniseur"], [TYPE.FLIP, "Flip"], [TYPE.TOON, "Toon"], [TYPE.SPIRIT, "Spirit"],
    [TYPE.UNION, "Union"], [TYPE.GEMINI, "Gémeau"], [TYPE.NORMAL, "Normal"], [TYPE.EFFECT, "Effet"],
  ];
  for (const [f, n] of subs) if (c.type & f) parts.push(n);
  return `[${parts.join(" / ")}]`;
}

/**
 * Carte dessinée entièrement en CSS : cadre, nom, attribut, étoiles, illustration,
 * texte et ATK/DEF. Sert quand l'image complète n'est pas disponible.
 */
export function CardFrame({ card, className = "", onClick }: { card: Card | undefined; className?: string; onClick?: () => void }) {
  const [artFailed, setArtFailed] = useState(false);
  if (!card) return <div className={`card-img card-back ${className}`} onClick={onClick} />;
  const frame = frameOf(card);
  const monster = isMonster(card);
  const attr = attributeGlyph(card);
  const isXyz = (card.type & TYPE.XYZ) !== 0;
  const isLink = (card.type & TYPE.LINK) !== 0;
  const nameSize = card.name.length > 28 ? "xs" : card.name.length > 20 ? "sm" : "";
  return (
    <div className={`cf cf-${frame} ${card.type & TYPE.PENDULUM ? "cf-pendulum" : ""} ${className}`} onClick={onClick}>
      <div className="cf-body">
      <div className="cf-head">
        <span className={`cf-name ${nameSize}`}>{card.name}</span>
        <span className={`cf-attr attr-${attr[1]}`}>{attr[0]}</span>
      </div>
      {monster && !isLink && (
        <div className={`cf-stars ${isXyz ? "rank" : ""}`}>{(isXyz ? "✪" : "★").repeat(Math.min(card.level, 13))}</div>
      )}
      {!monster && <div className="cf-stars" />}
      <div className="cf-art">
        {!artFailed && <img src={cardImageSources(card.id, "art")[0]} alt="" loading="lazy" draggable={false} onError={() => setArtFailed(true)} />}
        {artFailed && <span className="cf-art-ph">{card.name.slice(0, 1)}</span>}
        {isLink && <span className="cf-link">{flagNames(card.linkMarker, LINK_MARKERS)}</span>}
      </div>
      <div className="cf-text">
        <div className="cf-type">{bracketLine(card)}</div>
        <div className="cf-desc">{card.desc}</div>
        {monster && (
          <div className="cf-stats">
            ATK/{card.atk < 0 ? "?" : card.atk} {isLink ? `LINK–${card.level}` : `DEF/${card.def < 0 ? "?" : card.def}`}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

