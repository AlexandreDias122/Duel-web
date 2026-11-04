// Salon façon Master Duel : rappel des réglages, choix de son deck, « Prêt », puis pile ou face.
import { useMemo, useState } from "react";
import type { DeckList } from "../engine/protocol";
import type { Deck } from "../lib/deck";
import { useBanlists, useDb } from "../ui/dbContext";
import type { StarterDeck } from "./DecksScreen";
import type { DuelConfig } from "./DuelSetup";
import { CoinToss } from "./solo/CoinToss";
import type { DeckOption, SoloSettings } from "./solo/options";
import { asset, buildOptions, loadPick, RULE_LABELS, savePick, timerLabel } from "./solo/options";
import { Art, MdHeader, MdTab } from "./solo/ui";
import "./solo/solo.css";

interface Props {
  opponent: DeckOption;
  settings: SoloSettings;
  decks: Deck[];
  starters: StarterDeck[];
  playerName: string;
  onBack: () => void;
  onStart: (c: DuelConfig) => void;
  onEditDecks: () => void;
}

const GROUPS: [DeckOption["group"], string][] = [["mine", "Mes decks"], ["meta", "Decks méta"], ["starter", "Decks de démarrage"]];

export function LobbyScreen({ opponent, settings, decks, starters, playerName, onBack, onStart, onEditDecks }: Props) {
  const db = useDb();
  const banlists = useBanlists();
  const banlist = settings.deckCheck ? banlists.find((b) => b.name === settings.banlist) ?? null : null;
  const options = useMemo(() => buildOptions(db, banlist, decks, starters, []), [db, banlist, decks, starters]);
  const [picked, setPicked] = useState(() => loadPick().deck ?? "");
  const mine = options.find((o) => o.key === picked) ?? options.find((o) => o.group === "mine") ?? options.find((o) => o.group === "meta");
  const [ready, setReady] = useState(false);
  const [picker, setPicker] = useState(false);
  const [toss, setToss] = useState(false);
  const illegal = !!mine && settings.deckCheck && mine.errors.length > 0;
  const empty = !mine || !mine.list.main.length;

  const choose = (key: string) => {
    setPicked(key);
    savePick({ deck: key });
    setReady(false);
    setPicker(false);
  };

  const launch = (meFirst: boolean) => {
    if (!mine) return;
    const a: DeckList = mine.list, b: DeckList = opponent.list;
    const oppName = opponent.group === "windbot" ? `WindBot (${opponent.name})` : `IA (${opponent.name})`;
    // Le moteur fait toujours commencer le joueur 0 : on place l'humain en conséquence.
    onStart({
      mode: "ai",
      decks: meFirst ? [a, b] : [b, a],
      human: meFirst ? 0 : 1,
      names: [playerName, oppName],
      turnSeconds: settings.turnSeconds,
      lp: settings.lp,
      rules: { startHand: settings.startHand, drawCount: settings.drawCount, masterRule: settings.masterRule, shuffle: settings.shuffle },
    });
  };

  const rows: [string, string, boolean?][] = [
    ["Mode Duel", "Duel"],
    ["Règles", RULE_LABELS[settings.masterRule], true],
    ["Cartes autorisées", settings.deckCheck ? "Selon la banlist" : "Toutes les cartes", true],
    ["Ban List", banlist?.name ?? "N/A"],
    ["LP de départ", String(settings.lp)],
    ["Main de départ", String(settings.startHand)],
    ["Cartes par pioche", String(settings.drawCount)],
    ["Limite de temps", timerLabel(settings.turnSeconds)],
    ["Mélange", settings.shuffle ? "Oui" : "Non"],
  ];

  return (
    <div className="lobby md-screen">
      <aside className="lobby-left">
        <MdHeader title="Salon" onBack={onBack} />
        <div className="lobby-params">
          <MdTab>Paramètres du duel</MdTab>
          <div className="lobby-kind">Duel solo</div>
          <dl>
            {rows.map(([k, v, stacked]) => (
              <div key={k} className={stacked ? "stacked" : ""}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </div>
        <div className="lobby-deck">
          <span>Votre deck</span>
          <button className="deck-box" onClick={() => setPicker(true)}>
            <img src={asset("deck-case.webp")} alt="" draggable={false} />
            <b>{mine?.name ?? "Choisir un deck"}</b>
          </button>
        </div>
      </aside>

      <main className="lobby-main">
        <h2>Duellistes</h2>
        <div className="lobby-sub">2 / 2 <i>·</i> Prêts : {ready ? 2 : 1}</div>
        <p className="lobby-wait">Veuillez attendre que tous les joueurs soient prêts avant de commencer le Duel.</p>
        <div className="duelists">
          <div className={`duelist me ${ready ? "is-ready" : ""}`}>
            <img className="duelist-icon" src={asset("duelist-icon.webp")} alt="" draggable={false} />
            <div className="duelist-text">
              <b>{playerName}</b>
              <span>{ready ? <em>Prêt au duel</em> : <>Vous <i>·</i> Choix du deck</>}</span>
            </div>
            {ready && <span className="ready-badge">READY</span>}
          </div>
          <div className="duelist op is-ready">
            <span className="duelist-icon hex"><Art code={opponent.cover} /></span>
            <div className="duelist-text">
              <b>{opponent.name}</b>
              <span><em>Prêt au duel</em></span>
            </div>
            <span className="ready-badge">READY</span>
          </div>
        </div>
        {(illegal || empty) && (
          <p className="lobby-warn">
            {empty ? "Choisissez un deck pour jouer." : `Votre deck ne passe pas la vérification : ${mine?.errors[0]}`}
          </p>
        )}
        <div className="lobby-actions">
          <button className={`md-btn ${ready ? "on" : ""}`} disabled={illegal || empty} onClick={() => setReady(!ready)}>
            {ready ? "Annuler" : "Prêt"}
          </button>
          <button className="md-btn" disabled={!ready} onClick={() => setToss(true)}>Commencer</button>
        </div>
      </main>

      {picker && (
        <div className="md-modal" onClick={() => setPicker(false)}>
          <div className="md-sheet" onClick={(e) => e.stopPropagation()}>
            <MdTab>Choisir un deck</MdTab>
            <div className="picker-list">
              {GROUPS.map(([g, label]) => {
                const list = options.filter((o) => o.group === g);
                return (
                  <section key={g}>
                    <h3>{label}</h3>
                    {!list.length && g === "mine" && (
                      <button className="picker-item" onClick={onEditDecks}><span className="picker-art" /><span className="picker-text"><b>Créer un deck…</b></span></button>
                    )}
                    {list.map((o) => (
                      <button key={o.key} className={`picker-item ${o.key === mine?.key ? "on" : ""}`} onClick={() => choose(o.key)}>
                        <span className="picker-art"><Art code={o.cover} /></span>
                        <span className="picker-text">
                          <b>{o.name}</b>
                          {settings.deckCheck && o.errors.length > 0 && <small>⚠ {o.errors[0]}</small>}
                        </span>
                      </button>
                    ))}
                  </section>
                );
              })}
            </div>
            <button className="md-btn" onClick={() => setPicker(false)}>Fermer</button>
          </div>
        </div>
      )}

      {toss && (
        <CoinToss opponentName={opponent.name} opponentGoesSecond={!!opponent.goSecond}
          onDone={launch} onCancel={() => setToss(false)} />
      )}
    </div>
  );
}
