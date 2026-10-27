import { isMonster, statLine, typeLine } from "../lib/cards";
import { TYPE } from "../lib/constants";
import { CardImage } from "./CardImage";
import { useDb } from "./dbContext";
import { attributeGlyph, frameOf } from "./frame";
import type { ReactNode } from "react";

/** Fiche détaillée façon Master Duel : bandeau de nom, illustration, statistiques et texte. */
export function CardDetail({ code, children, extra }: { code: number; children?: ReactNode; extra?: ReactNode }) {
  const db = useDb();
  const card = db.get(code);
  if (!card) return null;
  const sets = db.setNames(card);
  const [glyph, attrClass] = attributeGlyph(card);
  const monster = isMonster(card);
  const isLink = (card.type & TYPE.LINK) !== 0;
  const isXyz = (card.type & TYPE.XYZ) !== 0;
  return (
    <div className="card-detail">
      <div className={`detail-banner frame-${frameOf(card)}`}>
        <span className="detail-name">{card.name}</span>
        <span className={`cf-attr attr-${attrClass}`}>{glyph}</span>
      </div>
      <div className="card-detail-head">
        <CardImage code={code} big className="card-detail-img" />
        <div className="card-detail-info">
          {monster && !isLink && <div className={`detail-stars ${isXyz ? "rank" : ""}`}>{(isXyz ? "✪" : "★").repeat(card.level)} <small>{isXyz ? "Rang" : "Niveau"} {card.level}</small></div>}
          <div className="detail-type">{typeLine(card)}</div>
          {monster && (
            <div className="detail-stats">
              <span><small>ATK</small>{card.atk < 0 ? "?" : card.atk}</span>
              {isLink ? <span><small>LINK</small>{card.level}</span> : <span><small>DEF</small>{card.def < 0 ? "?" : card.def}</span>}
            </div>
          )}
          {monster && <div className="muted small">{statLine(card).split(" · ")[0]}</div>}
          {sets.length > 0 && <div className="muted small">Archétype : {sets.join(", ")}</div>}
          {extra}
        </div>
      </div>
      {children}
      <p className="card-text-desc">{card.desc}</p>
    </div>
  );
}
