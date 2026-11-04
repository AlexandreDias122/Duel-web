// Petits éléments d'interface façon Master Duel partagés par l'écran SOLO et le Salon.
import { useState } from "react";
import type { ReactNode } from "react";
import { cardImageSources } from "../../lib/cards";

export function MdHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="md-head">
      <button className="md-back" onClick={onBack} aria-label="Retour">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 4 7.5 12l8 8" /></svg>
      </button>
      <h1>{title}</h1>
    </header>
  );
}

export function BookIcon() {
  return (
    <svg className="md-book" viewBox="0 0 32 24" aria-hidden="true">
      <path d="M16 5c-3-2.4-7.5-3-13-2.4v17c5.5-.6 10 0 13 2.4 3-2.4 7.5-3 13-2.4v-17C23.5 2 19 2.6 16 5Z" />
      <path d="M16 5v17M6 7c3-.3 5.5.1 7.5 1.1M6 11c3-.3 5.5.1 7.5 1.1M6 15c3-.3 5.5.1 7.5 1.1M26 7c-3-.3-5.5.1-7.5 1.1M26 11c-3-.3-5.5.1-7.5 1.1M26 15c-3-.3-5.5.1-7.5 1.1" />
    </svg>
  );
}

/** Onglet blanc incliné avec un livre, en tête des panneaux d'information. */
export function MdTab({ children }: { children: ReactNode }) {
  return (
    <div className="md-tab">
      <BookIcon />
      <span>{children}</span>
    </div>
  );
}

/** Illustration d'une carte (recadrée), avec repli sur la carte entière. */
export function Art({ code, className = "" }: { code: number; className?: string }) {
  const sources = code ? [...cardImageSources(code, "art"), ...cardImageSources(code, "full")] : [];
  const [state, setState] = useState({ code, i: 0 });
  const i = state.code === code ? state.i : 0;
  if (i >= sources.length) return <span className={`md-art empty ${className}`} />;
  return (
    <img className={`md-art ${i > 0 ? "full" : ""} ${className}`} src={sources[i]} alt="" loading="lazy" draggable={false}
      onError={() => setState({ code, i: i + 1 })} />
  );
}

/** Décor de triangles qui flottent, comme le fond bleu de Master Duel. */
export function Triangles() {
  return (
    <div className="md-triangles" aria-hidden="true">
      {TRIS.map(([x, y, s, r, d], k) => (
        <svg key={k} viewBox="0 0 20 20" style={{ left: `${x}%`, top: `${y}%`, width: s, height: s, rotate: `${r}deg`, animationDelay: `${-d}s` }}>
          <path d="M10 2 18 17H2Z" />
        </svg>
      ))}
    </div>
  );
}

const TRIS: [number, number, number, number, number][] = [
  [8, 72, 22, 10, 1], [16, 88, 14, -20, 4], [27, 64, 10, 35, 2], [36, 92, 26, 190, 6], [48, 78, 12, 80, 3], [57, 60, 18, -40, 7],
  [66, 90, 30, 15, 5], [74, 70, 14, 200, 1], [82, 84, 20, -10, 8], [91, 66, 12, 60, 2], [95, 92, 24, 170, 6], [88, 40, 10, 25, 4],
  [70, 30, 8, -30, 3], [96, 18, 16, 45, 9], [3, 50, 12, 100, 5], [60, 96, 10, 0, 2],
];
