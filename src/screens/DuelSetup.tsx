import { useState } from "react";
import type { DuelMode } from "../engine/controller";
import type { DeckList } from "../engine/protocol";
import type { Deck } from "../lib/deck";
import { adaptToBanlist, parseYdk, validateDeck } from "../lib/deck";
import { AI_DECKS } from "../engine/aiDecks";
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
  /** Nom court affiché pour l'IA. */
  label: string;
  group: "mine" | "meta" | "starter";
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
  // Les decks de démarrage et méta sont ajustés à la banlist choisie (cartes interdites remplacées).
  const adapted = (lists: { main: number[]; extra: number[] }) => {
    const l = adaptToBanlist(db, lists, banlist);
    return { main: l.main, extra: l.extra, note: l.removed.length ? [`Adapté à la banlist : ${l.removed.join(", ")} remplacé(s)`] : [] };
  };
  const options: Option[] = [
    ...decks.map((d): Option => ({ key: `d:${d.id}`, name: d.name, label: d.name, group: "mine", list: { main: d.main, extra: d.extra }, errors: validateDeck(db, d, banlist) })),
    ...AI_DECKS.map((m): Option => {
      const l = adapted(m);
      return { key: `m:${m.id}`, name: m.name, label: m.name, group: "meta", list: { main: l.main, extra: l.extra, profile: m.id }, errors: [], note: [m.blurb, ...l.note] };
    }),
    ...starters.map((s): Option => {
      const l = adapted(parseYdk(s.ydk));
      return { key: `s:${s.name}`, name: `${s.name} (démarrage)`, label: s.name, group: "starter", list: { main: l.main, extra: l.extra }, errors: [], note: l.note };
    }),
  ];
  const [mine, setMine] = useState(options[0]?.key ?? "");
  // Contre l'IA, on propose d'emblée un deck méta : c'est là qu'elle joue le mieux.
  const [theirs, setTheirs] = useState((mode === "ai" ? options.find((o) => o.group === "meta") : options[1])?.key ?? options[0]?.key ?? "");
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
      onStart({ mode, decks, human, turnSeconds, names: ["Vous", `IA (${b.label})`] });
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
          ? "L'IA joue l'autre deck. Avec un deck méta, elle connaît ses combos et garde ses hand traps pour vos effets."
          : "Vous contrôlez les deux joueurs : parfait pour tester des combos et des interactions."}
      </p>
      <label className="field-label">{mode === "ai" ? "Votre deck" : "Deck du joueur 1"}</label>
      <DeckSelect options={options} value={mine} onChange={setMine} />
      <DeckNotes o={a} />
      <label className="field-label">{mode === "ai" ? "Deck de l'IA" : "Deck du joueur 2"}</label>
      <DeckSelect options={options} value={theirs} onChange={setTheirs} />
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

const GROUPS: [Option["group"], string][] = [["mine", "Mes decks"], ["meta", "Decks méta"], ["starter", "Decks de démarrage"]];

function DeckSelect({ options, value, onChange }: { options: Option[]; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {GROUPS.map(([g, label]) => {
        const list = options.filter((o) => o.group === g);
        return list.length ? (
          <optgroup key={g} label={label}>
            {list.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
          </optgroup>
        ) : null;
      })}
    </select>
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
