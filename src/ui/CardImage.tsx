import { useState } from "react";
import { cardImage, isMonster } from "../lib/cards";
import { TYPE } from "../lib/constants";
import { useDb } from "./dbContext";

interface Props {
  code: number;
  /** Afficher le dos de la carte. */
  back?: boolean;
  big?: boolean;
  className?: string;
  onClick?: () => void;
}

/** Image d'une carte, avec repli sur une source alternative puis sur un cadre texte. */
export function CardImage({ code, back, big, className = "", onClick }: Props) {
  const db = useDb();
  const [fallback, setFallback] = useState(0);
  const [failedFor, setFailedFor] = useState<number | null>(null);
  if (back || !code) return <div className={`card-img card-back ${className}`} onClick={onClick} />;
  const card = db.get(code);
  const src = failedFor === code ? "" : cardImage(code, big ? "big" : "small", fallback);
  if (!src) {
    const frame = !card ? "" : card.type & TYPE.SPELL ? "spell" : card.type & TYPE.TRAP ? "trap" : card.type & TYPE.LINK ? "link"
      : card.type & TYPE.XYZ ? "xyz" : card.type & TYPE.SYNCHRO ? "synchro" : card.type & TYPE.FUSION ? "fusion"
      : card.type & TYPE.RITUAL ? "ritual" : card.type & TYPE.NORMAL ? "normal" : "effect";
    return (
      <div className={`card-img card-text frame-${frame} ${className}`} onClick={onClick}>
        <span className="card-text-name">{card?.name ?? code}</span>
        {card && isMonster(card) && <span className="card-text-stats">{card.atk}/{card.type & TYPE.LINK ? `L${card.level}` : card.def}</span>}
      </div>
    );
  }
  return (
    <img
      className={`card-img ${className}`}
      src={src}
      alt={card?.name ?? String(code)}
      loading="lazy"
      draggable={false}
      onClick={onClick}
      onError={() => {
        if (fallback + 1 < 2) setFallback(fallback + 1);
        else setFailedFor(code);
      }}
    />
  );
}
