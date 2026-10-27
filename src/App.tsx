import { useEffect, useState } from "react";
import type { CardDb } from "./lib/cards";
import { loadCardDb } from "./lib/cards";
import type { Banlist, Deck } from "./lib/deck";
import { loadDecks, saveDecks } from "./lib/deck";
import { DbContext } from "./ui/dbContext";
import { DeckEditor } from "./screens/DeckEditor";
import { DecksScreen } from "./screens/DecksScreen";
import type { StarterDeck } from "./screens/DecksScreen";
import { DuelScreen } from "./screens/DuelScreen";
import { DuelSetup } from "./screens/DuelSetup";
import type { DuelConfig } from "./screens/DuelSetup";
import type { DuelMode } from "./engine/controller";

type Route =
  | { name: "home" }
  | { name: "decks" }
  | { name: "editor"; id: string }
  | { name: "setup"; mode: DuelMode }
  | { name: "duel"; config: DuelConfig; round: number };

const BASE = new URL(import.meta.env.BASE_URL, location.href);

export default function App() {
  const [data, setData] = useState<{ db: CardDb; banlists: Banlist[]; starters: StarterDeck[] } | null>(null);
  const [error, setError] = useState("");
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [decks, setDecks] = useState<Deck[]>(loadDecks);

  useEffect(() => {
    Promise.all([
      loadCardDb(BASE.href),
      fetch(new URL("data/banlists.json", BASE)).then((r) => r.json()),
      fetch(new URL("data/decks/starter.json", BASE)).then((r) => r.json()),
    ])
      .then(([db, banlists, starters]) => setData({ db, banlists, starters }))
      .catch((e) => setError(String(e)));
  }, []);

  const updateDecks = (next: Deck[]) => {
    setDecks(next);
    saveDecks(next);
  };
  const saveDeck = (d: Deck) => updateDecks(decks.some((x) => x.id === d.id) ? decks.map((x) => (x.id === d.id ? d : x)) : [...decks, d]);

  if (error) return <div className="screen center"><h2>Chargement impossible</h2><p className="error">{error}</p></div>;
  if (!data) {
    return (
      <div className="screen center splash">
        <h1 className="logo">DUEL<span>WEB</span></h1>
        <div className="spinner" />
        <p className="muted">Chargement des 15 000 cartes…</p>
      </div>
    );
  }

  let content;
  switch (route.name) {
    case "home":
      content = <Home go={setRoute} deckCount={decks.length} />;
      break;
    case "decks":
      content = (
        <DecksScreen decks={decks} starters={data.starters} onBack={() => setRoute({ name: "home" })}
          onOpen={(id) => setRoute({ name: "editor", id })}
          onSave={(d) => setDecks((prev) => { const next = [...prev.filter((x) => x.id !== d.id), d]; saveDecks(next); return next; })}
          onDelete={(id) => updateDecks(decks.filter((d) => d.id !== id))} />
      );
      break;
    case "editor": {
      const deck = decks.find((d) => d.id === route.id);
      content = deck
        ? <DeckEditor deck={deck} onChange={saveDeck} onBack={() => setRoute({ name: "decks" })} />
        : <DecksScreen decks={decks} starters={data.starters} onBack={() => setRoute({ name: "home" })} onOpen={(id) => setRoute({ name: "editor", id })} onSave={saveDeck} onDelete={(id) => updateDecks(decks.filter((d) => d.id !== id))} />;
      break;
    }
    case "setup":
      content = <DuelSetup mode={route.mode} decks={decks} starters={data.starters} onBack={() => setRoute({ name: "home" })}
        onStart={(config) => setRoute({ name: "duel", config, round: 1 })} />;
      break;
    case "duel":
      content = (
        <DuelScreen key={route.round} {...route.config}
          onExit={() => setRoute({ name: "home" })}
          onRematch={() => setRoute({ ...route, round: route.round + 1 })} />
      );
      break;
  }

  return <DbContext.Provider value={{ db: data.db, banlists: data.banlists }}>{content}</DbContext.Provider>;
}

function Home({ go, deckCount }: { go: (r: Route) => void; deckCount: number }) {
  return (
    <div className="screen home">
      <h1 className="logo">DUEL<span>WEB</span></h1>
      <p className="muted tagline">Yu-Gi-Oh! dans le navigateur, sans rien installer.</p>
      <nav className="home-menu">
        <button className="home-btn hb-duel" onClick={() => go({ name: "setup", mode: "ai" })}>
          <b>Duel contre l'IA</b><span>Affrontez une IA basique</span>
        </button>
        <button className="home-btn hb-solo" onClick={() => go({ name: "setup", mode: "solo" })}>
          <b>Duel solo</b><span>Jouez les deux côtés pour tester vos combos</span>
        </button>
        <button className="home-btn hb-decks" onClick={() => go({ name: "decks" })}>
          <b>Mes decks</b><span>{deckCount} deck(s) · éditeur, import .ydk / YDKE</span>
        </button>
      </nav>
      <InstallHint />
      <footer className="muted small credits">
        Moteur ygopro-core (EDOPro) et données Project Ignis. Images : YGOPRODeck.
        Projet de fans non officiel, sans lien avec Konami.
      </footer>
    </div>
  );
}

function InstallHint() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (standalone || !ios) return null;
  return <div className="install-hint">Sur iPhone : touchez <b>Partager</b> puis <b>Sur l'écran d'accueil</b> pour l'installer comme une appli.</div>;
}
