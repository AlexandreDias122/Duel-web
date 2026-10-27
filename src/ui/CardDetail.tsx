import { statLine, typeLine } from "../lib/cards";
import { CardImage } from "./CardImage";
import { useDb } from "./dbContext";
import type { ReactNode } from "react";

/** Fiche détaillée d'une carte : image, type, statistiques et texte. */
export function CardDetail({ code, children, extra }: { code: number; children?: ReactNode; extra?: ReactNode }) {
  const db = useDb();
  const card = db.get(code);
  if (!card) return null;
  const sets = db.setNames(card);
  return (
    <div className="card-detail">
      <div className="card-detail-head">
        <CardImage code={code} big className="card-detail-img" />
        <div className="card-detail-info">
          <h3>{card.name}</h3>
          <div className="muted">{typeLine(card)}</div>
          {statLine(card) && <div className="stat">{statLine(card)}</div>}
          {sets.length > 0 && <div className="muted small">Archétype : {sets.join(", ")}</div>}
          {extra}
        </div>
      </div>
      {children}
      <p className="card-text-desc">{card.desc}</p>
    </div>
  );
}
