// Écran SOLO façon Master Duel : liste des adversaires (avec la carte phare de leur deck) et réglages du duel.
import { useEffect, useMemo, useState } from "react";
import type { WindBotDeck } from "../engine/windbot";
import type { Deck } from "../lib/deck";
import { useBanlists, useDb } from "../ui/dbContext";
import type { StarterDeck } from "./DecksScreen";
import type { DeckOption, SoloSettings } from "./solo/options";
import { buildOptions, loadPick, loadSettings, loadWindBotDecks, RULE_LABELS, savePick, saveSettings, TIMERS, timerLabel } from "./solo/options";
import { Art, MdHeader, MdTab, Triangles } from "./solo/ui";
import "./solo/solo.css";

interface Props {
  decks: Deck[];
  starters: StarterDeck[];
  onBack: () => void;
  onStart: (opponent: DeckOption, settings: SoloSettings) => void;
}

type Tab = "all" | "windbot" | "decks" | "mine";
type Sort = "name" | "easy" | "hard";

/** Adversaire proposé par défaut. */
const DEFAULT_OPPONENT = "w:Maliss";

export function SoloScreen({ decks, starters, onBack, onStart }: Props) {
  const db = useDb();
  const banlists = useBanlists();
  const [settings, setSettings] = useState(() => loadSettings(banlists[0]?.name ?? ""));
  const set = (patch: Partial<SoloSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const [bots, setBots] = useState<WindBotDeck[]>([]);
  useEffect(() => {
    let live = true;
    loadWindBotDecks().then((l) => live && setBots(l));
    return () => {
      live = false;
    };
  }, []);
  const banlist = settings.deckCheck ? banlists.find((b) => b.name === settings.banlist) ?? null : null;
  const options = useMemo(() => buildOptions(db, banlist, decks, starters, bots), [db, banlist, decks, starters, bots]);

  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(() => loadPick().opponent ?? DEFAULT_OPPONENT);
  const opponent = options.find((o) => o.key === picked) ?? options.find((o) => o.key === DEFAULT_OPPONENT) ?? options[0];

  const inTab = (o: DeckOption, t: Tab) =>
    t === "all" ? true : t === "windbot" ? o.group === "windbot" : t === "decks" ? o.group === "meta" || o.group === "starter" : o.group === "mine";
  const tabs: [Tab, string][] = [["all", "Tous"], ["windbot", "WindBot"], ["decks", "Decks"], ["mine", "Votre deck"]];
  const q = query.trim().toLowerCase();
  const shown = options.filter((o) => inTab(o, tab) && (!q || o.name.toLowerCase().includes(q)));
  const [sort, setSort] = useState<Sort>("name");
  const sorted = sort === "name" ? shown : [...shown].sort((x, y) => {
    // Les decks sans difficulté (méta, démarrage, les vôtres) passent après les WindBot.
    const dx = x.difficulty ?? (sort === "easy" ? 99 : -1), dy = y.difficulty ?? (sort === "easy" ? 99 : -1);
    return (sort === "easy" ? dx - dy : dy - dx) || x.name.localeCompare(y.name);
  });

  const start = () => {
    if (!opponent) return;
    saveSettings(settings);
    savePick({ opponent: opponent.key });
    onStart(opponent, settings);
  };
  const oppIllegal = !!opponent && settings.deckCheck && opponent.errors.length > 0;

  return (
    <div className="solo md-screen">
      <section className="solo-left">
        <MdHeader title="SOLO" onBack={onBack} />
        <div className="solo-count">
          <span>Adversaires</span><b>{options.length}</b>
          <label className="solo-sort">
            <span>Trier :</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="name">Nom</option>
              <option value="easy">Difficulté ★ → ★★★★★</option>
              <option value="hard">Difficulté ★★★★★ → ★</option>
            </select>
          </label>
        </div>
        <label className="md-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
          <input type="search" placeholder="Rechercher un adversaire" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="md-tabs" role="tablist">
          {tabs.map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {label}<small>{options.filter((o) => inTab(o, t)).length}</small>
            </button>
          ))}
        </div>
        <ul className="solo-list">
          {sorted.map((o) => (
            <li key={o.key}>
              <button className={`solo-item ${o.key === opponent?.key ? "on" : ""}`} onClick={() => setPicked(o.key)}>
                <span className="solo-thumb"><Art code={o.cover} /></span>
                <span className="solo-name">{o.name}</span>
                {!!o.difficulty && <span className="solo-stars" aria-label={`Difficulté ${o.difficulty} sur 5`}>{"★".repeat(Math.min(5, o.difficulty))}</span>}
              </button>
            </li>
          ))}
          {!shown.length && (
            <li className="solo-empty">{tab === "mine" && !q ? "Aucun deck : créez-en un dans l'éditeur de deck." : "Aucun adversaire ne correspond."}</li>
          )}
        </ul>
      </section>

      <section className="solo-right">
        <Triangles />
        <div className="solo-settings">
          <button className={`md-pill toggle ${settings.deckCheck ? "on" : ""}`} onClick={() => set({ deckCheck: !settings.deckCheck })}>
            Vérification du Deck<i>{settings.deckCheck ? "ON" : "OFF"}</i>
          </button>
          <p className="md-note">
            Ignorer la vérification du Deck permet de jouer librement avec des cartes hors banlist et ignore aussi les autres restrictions du Deck.
          </p>
          <button className={`md-pill toggle ${settings.shuffle ? "on" : ""}`} onClick={() => set({ shuffle: !settings.shuffle })}>
            Mélange<i>{settings.shuffle ? "ON" : "OFF"}</i>
          </button>
          <div className="md-fields">
            <label className="md-field md-select">
              <span>Temps par tour :</span>
              <select value={settings.turnSeconds} onChange={(e) => set({ turnSeconds: Number(e.target.value) })}>
                {TIMERS.map((t) => <option key={t} value={t}>{timerLabel(t)}</option>)}
              </select>
            </label>
            <NumberField label="Points de vie :" value={settings.lp} min={100} max={99999} onChange={(lp) => set({ lp })} />
            <NumberField label="Main de départ :" value={settings.startHand} min={1} max={20} onChange={(startHand) => set({ startHand })} />
            <NumberField label="Cartes par pioche :" value={settings.drawCount} min={1} max={10} onChange={(drawCount) => set({ drawCount })} />
          </div>
          <label className={`md-pill md-select ${settings.deckCheck ? "" : "off"}`}>
            <span>Banlist :</span>
            <select value={settings.deckCheck ? settings.banlist : ""} disabled={!settings.deckCheck} onChange={(e) => set({ banlist: e.target.value })}>
              {banlists.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
              <option value="">Aucune (tout autorisé)</option>
            </select>
          </label>
          <label className="md-pill md-select">
            <span>Règle :</span>
            <select value={settings.masterRule} onChange={(e) => set({ masterRule: Number(e.target.value) as SoloSettings["masterRule"] })}>
              {([5, 4, 3, 2, 1] as const).map((r) => <option key={r} value={r}>{RULE_LABELS[r]}</option>)}
            </select>
          </label>
          <div className="md-desc">
            <MdTab>Description du Deck IA</MdTab>
            {opponent && (
              <div className="md-desc-body">
                <b>{opponent.name}</b>
                <p>{opponent.blurb}</p>
                {opponent.group === "windbot" && <p className="dim">WindBot (l'IA d'EDOPro) joue avec son propre deck.</p>}
                {oppIllegal && <p className="warn">⚠ {opponent.errors[0]}</p>}
              </div>
            )}
          </div>
        </div>
        <button className="md-cta" disabled={!opponent || oppIllegal} onClick={start}>Commencer le duel</button>
      </section>
    </div>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const commit = () => {
    setEditing(false);
    const n = Math.round(Number(text));
    const v = Number.isFinite(n) && text.trim() ? Math.min(max, Math.max(min, n)) : value;
    setText(String(v));
    onChange(v);
  };
  return (
    <label className="md-field">
      <span>{label}</span>
      <input type="text" inputMode="numeric" pattern="[0-9]*" value={editing ? text : String(value)}
        onFocus={(e) => {
          setEditing(true);
          setText(String(value));
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value.replace(/\D/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
    </label>
  );
}
