import { useState } from "react";
import type { DuelMode } from "../engine/controller";
import type { DeckList } from "../engine/protocol";
import type { Deck } from "../lib/deck";
import { parseYdk, validateDeck } from "../lib/deck";
import { useDb } from "../ui/dbContext";
import type { StarterDeck } from "./DecksScreen";

export interface DuelConfig {
  mode: DuelMode;
  decks: [DeckList, DeckList];
  names: [string, string];
  /** En mode IA : index du joueur humain dans le moteur (1 si l'IA commence). */
  human: number;
}

interface Props {
  mode: DuelMode;
  decks: Deck[];
  starters: StarterDeck[];
  onStart: (c: DuelConfig) => void;
  onBack: () => void;
}

interface Option {
  key: string;
  name: string;
  list: DeckList;
  errors: string[];
}

export function DuelSetup({ mode, decks, starters, onStart, onBack }: Props) {
  const db = useDb();
  const options: Option[] = [
    ...decks.map((d) => ({ key: `d:${d.id}`, name: d.name, list: { main: d.main, extra: d.extra }, errors: validateDeck(db, d, null) })),
    ...starters.map((s) => {
      const l = parseYdk(s.ydk);
      return { key: `s:${s.name}`, name: `${s.name} (démarrage)`, list: { main: l.main, extra: l.extra }, errors: validateDeck(db, l, null) };
    }),
  ];
  const [mine, setMine] = useState(options[0]?.key ?? "");
  const [theirs, setTheirs] = useState(options[Math.min(1, options.length - 1)]?.key ?? "");
  const [first, setFirst] = useState<"random" | "me" | "them">("random");
  const a = options.find((o) => o.key === mine);
  const b = options.find((o) => o.key === theirs);

  const start = () => {
    if (!a || !b) return;
    const meFirst = first === "me" || (first === "random" && Math.random() < 0.5);
    if (mode === "ai") {
      // Le moteur fait toujours commencer l'équipe 0 : on place l'humain en conséquence.
      const human = meFirst ? 0 : 1;
      const decks: [DeckList, DeckList] = meFirst ? [a.list, b.list] : [b.list, a.list];
      onStart({ mode, decks, human, names: ["Vous", `IA (${b.name.replace(/ \(démarrage\)$/, "")})`] });
    } else {
      onStart(meFirst
        ? { mode, decks: [a.list, b.list], human: 0, names: ["Joueur 1", "Joueur 2"] }
        : { mode, decks: [b.list, a.list], human: 0, names: ["Joueur 2", "Joueur 1"] });
    }
  };

  return (
    <div className="screen">
      <header className="screen-head">
        <button className="ghost" onClick={onBack}>‹</button>
        <h2>{mode === "ai" ? "Duel contre l'IA" : "Duel solo"}</h2>
      </header>
      <p className="muted">
        {mode === "ai"
          ? "Une IA basique joue l'autre deck. Idéal pour prendre en main l'appli."
          : "Vous contrôlez les deux joueurs : parfait pour tester des combos et des interactions."}
      </p>
      <label className="field-label">{mode === "ai" ? "Votre deck" : "Deck du joueur 1"}</label>
      <select value={mine} onChange={(e) => setMine(e.target.value)}>
        {options.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
      </select>
      {a && a.errors.length > 0 && <div className="warn small">⚠ {a.errors[0]}</div>}
      <label className="field-label">{mode === "ai" ? "Deck de l'IA" : "Deck du joueur 2"}</label>
      <select value={theirs} onChange={(e) => setTheirs(e.target.value)}>
        {options.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
      </select>
      {b && b.errors.length > 0 && <div className="warn small">⚠ {b.errors[0]}</div>}
      <label className="field-label">Qui commence ?</label>
      <div className="segmented">
        {([["random", "Au hasard"], ["me", mode === "ai" ? "Moi" : "Joueur 1"], ["them", mode === "ai" ? "L'IA" : "Joueur 2"]] as const).map(([k, n]) => (
          <button key={k} className={first === k ? "on" : ""} onClick={() => setFirst(k)}>{n}</button>
        ))}
      </div>
      <button className="primary big" disabled={!a || !b || !a.list.main.length || !b.list.main.length} onClick={start}>Lancer le duel</button>
    </div>
  );
}
