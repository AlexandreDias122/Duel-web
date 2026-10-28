import { useEffect, useState } from "react";
import type { CardDb } from "./lib/cards";
import { cardImageSources, loadCardDb } from "./lib/cards";
import type { Banlist } from "./lib/deck";
import { useDeckStore } from "./lib/useDeckStore";
import type { Account } from "./lib/useDeckStore";
import { AccountScreen, ImportBanner } from "./screens/AccountScreen";
import { DbContext } from "./ui/dbContext";
import { DeckEditor } from "./screens/DeckEditor";
import { DecksScreen } from "./screens/DecksScreen";
import type { StarterDeck } from "./screens/DecksScreen";
import { DuelScreen } from "./screens/DuelScreen";
import { DuelSetup } from "./screens/DuelSetup";
import type { DuelConfig } from "./screens/DuelSetup";
import type { DuelMode } from "./engine/controller";
import { warmupEngine } from "./engine/controller";

type Route =
  | { name: "home" }
  | { name: "decks" }
  | { name: "account" }
  | { name: "editor"; id: string }
  | { name: "setup"; mode: DuelMode }
  | { name: "duel"; config: DuelConfig; round: number };

const BASE = new URL(import.meta.env.BASE_URL, location.href);

export default function App() {
  const [data, setData] = useState<{ db: CardDb; banlists: Banlist[]; starters: StarterDeck[] } | null>(null);
  const [error, setError] = useState("");
  const [route, setRoute] = useState<Route>({ name: "home" });
  const { decks, saveDeck, deleteDeck, account } = useDeckStore();

  // Lien « mot de passe oublié » ouvert : on affiche directement le formulaire.
  useEffect(() => {
    if (account.recovery) setRoute({ name: "account" });
  }, [account.recovery]);

  useEffect(() => {
    Promise.all([
      loadCardDb(BASE.href),
      fetch(new URL("data/banlists.json", BASE)).then((r) => r.json()),
      fetch(new URL("data/decks/starter.json", BASE)).then((r) => r.json()),
    ])
      .then(([db, banlists, starters]) => {
        setData({ db, banlists, starters });
        warmupEngine();
      })
      .catch((e) => setError(String(e)));
  }, []);

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
      content = <Home go={setRoute} deckCount={decks.length} account={account} />;
      break;
    case "decks":
      content = (
        <DecksScreen decks={decks} starters={data.starters} onBack={() => setRoute({ name: "home" })}
          onOpen={(id) => setRoute({ name: "editor", id })} onSave={saveDeck} onDelete={deleteDeck}
          notice={<ImportBanner account={account} />} />
      );
      break;
    case "editor": {
      const deck = decks.find((d) => d.id === route.id);
      content = deck
        ? <DeckEditor deck={deck} onChange={saveDeck} onBack={() => setRoute({ name: "decks" })} />
        : <DecksScreen decks={decks} starters={data.starters} onBack={() => setRoute({ name: "home" })} onOpen={(id) => setRoute({ name: "editor", id })} onSave={saveDeck} onDelete={deleteDeck} />;
      break;
    }
    case "account":
      content = <AccountScreen account={account} deckCount={decks.length} onBack={() => setRoute({ name: "home" })} />;
      break;
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

const HERO_CARDS = [89631139, 46986414, 74677422, 70095154, 44508094, 10000020];

function Home({ go, deckCount, account }: { go: (r: Route) => void; deckCount: number; account: Account }) {
  const [active, setActive] = useState(0);
  const [hero] = useState(() => HERO_CARDS[Math.floor(Math.random() * HERO_CARDS.length)]);
  const [heroOk, setHeroOk] = useState(true);
  const items: { label: string; sub: string; route: Route }[] = [
    { label: "SOLO", sub: "Duel contre l'IA", route: { name: "setup", mode: "ai" } },
    { label: "DUEL LIBRE", sub: "Jouez les deux côtés", route: { name: "setup", mode: "solo" } },
    { label: "DECK", sub: `${deckCount} deck(s) · éditeur`, route: { name: "decks" } },
    ...(account.enabled
      ? [{ label: "COMPTE", sub: account.user ? account.user.email : "Se connecter pour garder ses decks", route: { name: "account" } as Route }]
      : []),
  ];
  return (
    <div className="home">
      {heroOk && <img className="home-hero" src={cardImageSources(hero, "art")[0]} alt="" onError={() => setHeroOk(false)} />}
      <div className="home-shade" />
      <div className="home-content">
        <h1 className="home-title">DuelWeb <small>v0.1</small></h1>
        <nav className="home-menu">
          {items.map((it, i) => (
            <button key={it.label} className={`home-item ${active === i ? "on" : ""}`}
              onPointerEnter={() => setActive(i)} onFocus={() => setActive(i)} onClick={() => go(it.route)}>
              <span className="home-label">{it.label}</span>
              <span className="home-sub">{it.sub}</span>
              {active === i && <span className="home-arrow">›</span>}
            </button>
          ))}
        </nav>
        <InstallHint />
        <footer className="credits">
          Moteur ygopro-core (EDOPro) et données Project Ignis. Images : YGOPRODeck.
          Projet de fans non officiel, sans lien avec Konami.
        </footer>
      </div>
    </div>
  );
}

function InstallHint() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (standalone || !ios) return null;
  return <div className="install-hint">Sur iPhone : touchez <b>Partager</b> puis <b>Sur l'écran d'accueil</b> pour l'installer comme une appli.</div>;
}
