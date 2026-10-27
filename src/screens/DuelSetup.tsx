import { useState } from "react";
import type { DuelMode } from "../engine/controller";
import type { DeckList } from "../engine/protocol";
import type { Deck } from "../lib/deck";
import { adaptToBanlist, parseYdk, validateDeck } from "../lib/deck";
import { useBanlists, useDb } from "../ui/dbContext";
import type { StarterDeck } from "./DecksScreen";

export interface DuelConfig {
  mode: DuelMode;
  decks: [DeckList, DeckList];
  names: [string, string];
  /** En mode IA : index du joueur humain dans le moteur (1 si l'IA commence). */
  human: number;
  /** Temps de réflexion par tour, en secondes (0 = illimité). */
  turnSeconds: number;
}

const TIMERS: [number, string][] = [[0, "Aucun"], [60, "1 min"], [180, "3 min"], [300, "5 min"]];
const SETTINGS_KEY = "ygo-web.duel-settings";

function loadSettings(): { banlist?: string; timer?: number } {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
  } catch {
    return {};
  }
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
  note?: string[];
}

export function DuelSetup({ mode, decks, starters, onStart, onBack }: Props) {
  const db = useDb();
  const banlists = useBanlists();
  const [saved] = useState(loadSettings);
  const [banlistName, setBanlistName] = useState(saved.banlist ?? banlists[0]?.name ?? "");
  const [timer, setTimer] = useState(saved.timer ?? 180);
  const banlist = banlists.find((b) => b.name === banlistName) ?? null;
  const options: Option[] = [
    ...decks.map((d) => ({ key: `d:${d.id}`, name: d.name, list: { main: d.main, extra: d.extra }, errors: validateDeck(db, d, banlist) })),
    ...starters.map((s) => {
      // Les decks de démarrage sont ajustés à la banlist choisie (cartes interdites remplacées).
      const l = adaptToBanlist(db, parseYdk(s.ydk), banlist);
      const note = l.removed.length ? [`Adapté à la banlist : ${l.removed.join(", ")} remplacé(s)`] : [];
      return { key: `s:${s.name}`, name: `${s.name} (démarrage)`, list: { main: l.main, extra: l.extra }, errors: [], note };
    }),
  ];
  const [mine, setMine] = useState(options[0]?.key ?? "");
  const [theirs, setTheirs] = useState(options[Math.min(1, options.length - 1)]?.key ?? "");
  const [first, setFirst] = useState<"random" | "me" | "them">("random");
  const a = options.find((o) => o.key === mine);
  const b = options.find((o) => o.key === theirs);

  const start = () => {
    if (!a || !b) return;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ banlist: banlistName, timer }));
    } catch {
      // Réglages non mémorisés (navigation privée).
    }
    const turnSeconds = timer;
    const meFirst = first === "me" || (first === "random" && Math.random() < 0.5);
    if (mode === "ai") {
      // Le moteur fait toujours commencer l'équipe 0 : on place l'humain en conséquence.
      const human = meFirst ? 0 : 1;
      const decks: [DeckList, DeckList] = meFirst ? [a.list, b.list] : [b.list, a.list];
      onStart({ mode, decks, human, turnSeconds, names: ["Vous", `IA (${b.name.replace(/ \(démarrage\)$/, "")})`] });
    } else {
      onStart(meFirst
        ? { mode, decks: [a.list, b.list], human: 0, turnSeconds, names: ["Joueur 1", "Joueur 2"] }
        : { mode, decks: [b.list, a.list], human: 0, turnSeconds, names: ["Joueur 2", "Joueur 1"] });
    }
  };

  const illegal = !!banlist && [a, b].some((o) => o && o.errors.length > 0);

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
      <DeckNotes o={a} />
      <label className="field-label">{mode === "ai" ? "Deck de l'IA" : "Deck du joueur 2"}</label>
      <select value={theirs} onChange={(e) => setTheirs(e.target.value)}>
        {options.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
      </select>
      <DeckNotes o={b} />
      <label className="field-label">Qui commence ?</label>
      <div className="segmented">
        {([["random", "Au hasard"], ["me", mode === "ai" ? "Moi" : "Joueur 1"], ["them", mode === "ai" ? "L'IA" : "Joueur 2"]] as const).map(([k, n]) => (
          <button key={k} className={first === k ? "on" : ""} onClick={() => setFirst(k)}>{n}</button>
        ))}
      </div>
      <label className="field-label">Banlist</label>
      <select value={banlistName} onChange={(e) => setBanlistName(e.target.value)}>
        {banlists.map((bl) => <option key={bl.name} value={bl.name}>{bl.name}</option>)}
        <option value="">Aucune (tout autorisé)</option>
      </select>
      <label className="field-label">Temps par tour</label>
      <div className="segmented">
        {TIMERS.map(([v, n]) => (
          <button key={v} className={timer === v ? "on" : ""} onClick={() => setTimer(v)}>{n}</button>
        ))}
      </div>
      {illegal && <div className="warn small">Un deck ne respecte pas la banlist ou les règles : corrigez-le dans l'éditeur ou choisissez « Aucune ».</div>}
      <button className="primary big" disabled={!a || !b || !a.list.main.length || !b.list.main.length || illegal} onClick={start}>Lancer le duel</button>
    </div>
  );
}

function DeckNotes({ o }: { o: Option | undefined }) {
  if (!o) return null;
  return (
    <>
      {o.errors.slice(0, 3).map((e) => <div key={e} className="warn small">⚠ {e}</div>)}
      {o.note?.map((n) => <div key={n} className="muted small">{n}</div>)}
    </>
  );
}
