import { useState } from "react";
import { cardImageSources } from "../lib/cards";
import { CardFrame } from "./CardFrame";
import { frameOf } from "./frame";
import { useDb } from "./dbContext";

interface Props {
  code: number;
  /** Afficher le dos de la carte. */
  back?: boolean;
  big?: boolean;
  /** Illustration seule dans un cadre (cartes posées sur le terrain, façon Master Duel). */
  art?: boolean;
  className?: string;
  onClick?: () => void;
}

/** Image d'une carte, avec repli sur d'autres sources puis sur une carte dessinée en CSS. */
export function CardImage({ code, back, big, art, className = "", onClick }: Props) {
  const db = useDb();
  const [state, setState] = useState({ code, index: 0 });
  if (back || !code) return <div className={`card-img card-back ${className}`} onClick={onClick} />;
  const card = db.get(code);
  const sources = cardImageSources(code, art ? "art" : big ? "big" : "full");
  const index = state.code === code ? state.index : 0;
  if (index >= sources.length) return <CardFrame card={card} className={`card-img ${className}`} onClick={onClick} />;
  const img = (
    <img
      className={art ? "art-img" : `card-img ${className}`}
      src={sources[index]}
      alt={card?.name ?? String(code)}
      loading="lazy"
      draggable={false}
      onClick={art ? undefined : onClick}
      onError={() => setState({ code, index: index + 1 })}
    />
  );
  if (!art) return img;
  return (
    <div className={`card-img art-card frame-${frameOf(card)} ${className}`} onClick={onClick}>
      {img}
    </div>
  );
}
