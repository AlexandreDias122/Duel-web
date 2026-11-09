import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { OcgMessageType as T, OcgResponseType as R } from "ocgcore-wasm";
import type { OcgLocation, OcgResponse } from "ocgcore-wasm";
import { DuelController } from "../engine/controller";
import type { Fx } from "../engine/controller";
import type { DuelMode } from "../engine/controller";
import type { DeckList, DuelRules, FieldCard } from "../engine/protocol";
import { LOC, PHASE, POS } from "../lib/constants";
import { CardDetail } from "../ui/CardDetail";
import { CardImage } from "../ui/CardImage";
import { Field } from "../ui/Field";
import { cardKey } from "../ui/keys";
import { PromptPanel } from "../ui/PromptPanel";
import { cardActions, placeZones } from "../ui/promptLogic";
import type { CardAction } from "../ui/promptLogic";
import { useDb } from "../ui/dbContext";
import { Board3DLayer } from "../ui/Board3DLayer";
import { board3dEnabled, fileToPlaymat, playmatImage, setBoard3dEnabled, setPlaymatImage } from "../ui/board3dPrefs";

interface Props {
  mode: DuelMode;
  decks: [DeckList, DeckList];
  /** Joueur humain (en mode IA), 0 s'il commence. */
  human: number;
  names: [string, string];
  turnSeconds: number;
  lp?: number;
  rules?: DuelRules;
  onExit: () => void;
  onRematch: () => void;
}

type Inspect = { code: number; actions: CardAction[] } | null;
/** Menu d'actions rapide façon Master Duel, ouvert en touchant une carte jouable. */
type Menu = { key: string; code: number; actions: CardAction[] } | null;
type PileView = { player: number; location: number } | null;
type PilePick = { player: number; location: number; kind: PileActionKind } | null;
type PileActionKind = "special" | "activate";

export function DuelScreen({ mode, decks, human, names, turnSeconds, lp = 8000, rules, onExit, onRematch }: Props) {
  const db = useDb();
  const controller = useMemo(() => new DuelController(db, mode, decks, human, turnSeconds, lp, rules), [db, mode, decks, human, turnSeconds, lp, rules]);
  useEffect(() => () => controller.dispose(), [controller]);
  const view = useSyncExternalStore(controller.subscribe, controller.getView);
  const [inspect, setInspectRaw] = useState<Inspect>(null);
  // Écran large (paysage, tablette, ordinateur) : fiche de la carte affichée en permanence à gauche, comme dans Master Duel.
  const wide = useMediaQuery(WIDE_QUERY);
  // Fiche permanente seulement si l'écran est assez haut (pas sur un téléphone à l'horizontale).
  const panel = useMediaQuery(PANEL_QUERY);
  const [focus, setFocus] = useState(0);
  const setInspect = (i: Inspect) => {
    if (i && panel && !i.actions.length) {
      setFocus(i.code);
      return;
    }
    setInspectRaw(i);
  };
  const [menu, setMenu] = useState<Menu>(null);
  const [pile, setPile] = useState<PileView>(null);
  const [showLog, setShowLog] = useState(false);
  // Plateau 3D (forêt + compagnon) : activé par défaut, désactivable pour les appareils modestes.
  const [use3d, setUse3d] = useState(board3dEnabled);
  const [ready3d, setReady3d] = useState(false);
  const [playmat, setPlaymat] = useState(playmatImage);
  const [showMat, setShowMat] = useState(false);
  // Avance rapide façon Master Duel : accélère les enchaînements de l'adversaire (et du duel en général).
  const [fast, setFast] = useState(() => { try { return localStorage.getItem("duelweb-fast") === "1"; } catch { return false; } });
  useEffect(() => {
    controller.setSpeed(fast ? 3 : 1);
    try { localStorage.setItem("duelweb-fast", fast ? "1" : "0"); } catch { /* réglage non mémorisé */ }
  }, [fast, controller]);
  const [chosenZones, setChosenZones] = useState<string[]>([]);
  /** Boutons « Activer Effet » / « Invocation Spéciale » au-dessus d'une pile (Cimetière, Extra Deck…) qui a des cartes jouables. */
  const [pileMenu, setPileMenu] = useState<PileView>(null);
  /** Choix de la carte à jouer depuis une pile, façon Master Duel. */
  const [pilePick, setPilePick] = useState<PilePick>(null);
  const { state, prompt } = view;
  const msg = prompt?.message;

  const respond = (r: OcgResponse) => {
    setInspect(null);
    setMenu(null);
    setPile(null);
    setPileMenu(null);
    setPilePick(null);
    setChosenZones([]);
    controller.respond(r);
  };

  // Réponses automatiques : pas de carte à enchaîner, tri par défaut.
  useEffect(() => {
    if (!msg) return;
    if (msg.type === T.SELECT_CHAIN && msg.selects.length === 0) respond({ type: R.SELECT_CHAIN, index: null });
    else if (msg.type === T.SORT_CARD || msg.type === T.SORT_CHAIN) respond({ type: R.SORT_CARD, order: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg]);

  const actions = useMemo(() => cardActions(msg, db), [msg, db]);
  // Liseré bleu (Master Duel) : la carte ne peut qu'être invoquée normalement, posée ou changer de position.
  const blue = useMemo(() => new Set([...actions].filter(([, list]) => list.every((a) => BLUE_KINDS.has(actionKind(a.label)))).map(([k]) => k)), [actions]);

  // La fiche suit la dernière carte jouée, tant que le joueur n'en touche pas une autre.
  const lastFx = [...view.fx].reverse().find((f) => "code" in f && f.code > 0 && f.kind !== "leave" && f.kind !== "bury" && f.kind !== "travel"
    && !(mode === "ai" && f.kind === "set" && f.player !== human) && !(mode === "ai" && f.kind === "fly" && f.faceDown && f.player !== human));
  const lastFxCode = lastFx && "code" in lastFx ? lastFx.code : 0;
  useEffect(() => {
    if (lastFxCode) setFocus(lastFxCode);
  }, [lastFxCode]);
  const zones = useMemo(() => placeZones(msg), [msg]);
  const targets = useMemo(() => {
    const s = new Set<string>();
    if (msg && (msg.type === T.SELECT_CARD || msg.type === T.SELECT_TRIBUTE)) msg.selects.forEach((c) => s.add(cardKey(c.controller, c.location, c.sequence)));
    if (msg && msg.type === T.SELECT_UNSELECT_CARD) msg.select_cards.forEach((c) => s.add(cardKey(c.controller, c.location, c.sequence)));
    return s;
  }, [msg]);

  const promptPlayer = msg && "player" in msg ? msg.player : undefined;
  // En solo, la vue suit le joueur du tour ; contre l'IA, on reste du côté humain.
  const viewer = mode === "ai" ? human : (state?.turnPlayer ?? 0);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [view.log, showLog]);

  if (view.error) {
    return (
      <div className="screen center">
        <h2>Erreur du moteur</h2>
        <pre className="error">{view.error}</pre>
        <button onClick={onExit}>Retour au menu</button>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="screen center">
        <div className="spinner" />
        <p>{view.loading ?? "Préparation du duel…"}</p>
      </div>
    );
  }

  const me = state.players[viewer];
  const op = state.players[1 - viewer];
  const label = (p: number) => (mode === "ai" ? (p === human ? names[0] : names[1]) : names[p]);

  /** Carte de l'adversaire qu'on ne doit pas voir : face cachée sur le terrain (sauf déjà révélée), en main, ou bannie face cachée. */
  const hiddenCard = (c: { controller: number; location: number; sequence: number }) => {
    if (mode !== "ai" || c.controller === viewer) return false;
    const pl = state.players[c.controller];
    const loc = c.location & ~LOC.OVERLAY;
    if (loc & (LOC.MZONE | LOC.SZONE)) {
      const zone = loc & LOC.MZONE ? LOC.MZONE : LOC.SZONE;
      const card = (zone === LOC.MZONE ? pl.mzone : pl.szone)[c.sequence];
      return !!card && (card.position & POS.FACEDOWN) !== 0 && !view.known.has(cardKey(c.controller, zone, c.sequence));
    }
    if (loc & LOC.HAND) return !pl.hand[c.sequence]?.isPublic;
    if (loc & LOC.DECK) return true;
    if (loc & (LOC.REMOVED | LOC.EXTRA)) {
      const card = (loc & LOC.REMOVED ? pl.removed : pl.extra)[c.sequence];
      return !card || !(card.position & POS.FACEUP);
    }
    return false;
  };

  const onCard = (controller: number, location: number, sequence: number, card: FieldCard) => {
    const key = cardKey(controller, location, sequence);
    const list = actions.get(key) ?? [];
    if (!list.length && hiddenCard({ controller, location, sequence })) return setMenu(null);
    if (list.length) {
      setMenu(menu?.key === key ? null : { key, code: card.code, actions: list });
      if (card.code) setFocus(card.code);
    }
    else if (card.code) {
      setMenu(null);
      setInspect({ code: card.code, actions: [] });
    }
  };
  const onZone = (player: number, location: number, sequence: number) => {
    if (!msg || (msg.type !== T.SELECT_PLACE && msg.type !== T.SELECT_DISFIELD)) return;
    const key = cardKey(player, location, sequence);
    const next = chosenZones.includes(key) ? chosenZones.filter((k) => k !== key) : [...chosenZones, key];
    if (next.length >= msg.count) {
      const places = next.slice(0, msg.count).map((k) => {
        const [pl, loc, seq] = k.split("-").map(Number);
        return { player: pl, location: loc as OcgLocation, sequence: seq };
      });
      respond({ type: msg.type === T.SELECT_PLACE ? R.SELECT_PLACE : R.SELECT_DISFIELD, places });
    } else setChosenZones(next);
  };

  // Bouton de phase façon Master Duel
  const phaseButtons: { label: string; response: OcgResponse }[] = [];
  if (msg?.type === T.SELECT_IDLECMD) {
    if (msg.to_bp) phaseButtons.push({ label: "Battle Phase", response: { type: R.SELECT_IDLECMD, action: 6, index: null } });
    if (msg.to_ep) phaseButtons.push({ label: "Fin du tour", response: { type: R.SELECT_IDLECMD, action: 7, index: null } });
  } else if (msg?.type === T.SELECT_BATTLECMD) {
    if (msg.to_m2) phaseButtons.push({ label: "Main Phase 2", response: { type: R.SELECT_BATTLECMD, action: 2, index: null } });
    if (msg.to_ep) phaseButtons.push({ label: "Fin du tour", response: { type: R.SELECT_BATTLECMD, action: 3, index: null } });
  }

  // Cartes en route vers la main : on cache la vraie carte le temps que la carte volante arrive.
  const arriving = new Set(view.fx.flatMap((f) => (f.kind === "travel" && f.to.startsWith("hand:") ? [f.to.slice(5)] : [])));
  const handFor = (player: number, cards: FieldCard[], top: boolean) => {
    const visible = !top || mode === "solo";
    return (
      <div className={`hand ${top ? "hand-top" : ""}`} data-hand={player}>
        {cards.map((c, i) => {
          const key = cardKey(player, LOC.HAND, i);
          // Éventail : les cartes s'inclinent de part et d'autre du centre de la main.
          const fan = i - (cards.length - 1) / 2;
          const act = actions.has(key);
          return (
            <div key={i} className={`hand-card ${arriving.has(`${player}-${i}`) ? "hand-arriving" : ""} ${act ? "zone-actionable" : ""} ${act && blue.has(key) ? "act-blue" : ""} ${targets.has(key) ? "zone-target" : ""} ${menu?.key === key ? "menu-open" : ""}`}
              style={{ "--fan": fan, "--fan2": fan * fan } as React.CSSProperties}
              onClick={() => visible || c.isPublic ? onCard(player, LOC.HAND, i, c) : undefined}>
              <CardImage code={c.code} back={!visible && !c.isPublic} />
            </div>
          );
        })}
      </div>
    );
  };

  const pileCards = pile
    ? (pile.location === LOC.GRAVE ? state.players[pile.player].grave
      : pile.location === LOC.REMOVED ? state.players[pile.player].removed
      : pile.location === LOC.EXTRA ? state.players[pile.player].extra : [])
    : [];
  const pileHidden = (c: FieldCard) =>
    !!pile && (pile.location === LOC.EXTRA || pile.location === LOC.REMOVED) && pile.player !== viewer && mode === "ai" && !(c.position & POS.FACEUP);

  // Actions jouables depuis une pile, regroupées comme dans Master Duel : « Invocation Spéciale » ou « Activer Effet ».
  const pileActions = (player: number, location: number) => {
    const list = location === LOC.GRAVE ? state.players[player].grave : location === LOC.REMOVED ? state.players[player].removed
      : location === LOC.EXTRA ? state.players[player].extra : [];
    const out: Record<PileActionKind, { index: number; card: FieldCard; actions: CardAction[] }[]> = { special: [], activate: [] };
    list.forEach((card, index) => {
      for (const kind of ["special", "activate"] as const) {
        const acts = (actions.get(cardKey(player, location, index)) ?? []).filter((a) => pileKind(a.label) === kind);
        if (acts.length) out[kind].push({ index, card, actions: acts });
      }
    });
    return out;
  };
  const onPile = (player: number, location: number) => {
    if (location === LOC.DECK) return;
    const acts = pileActions(player, location);
    if (acts.special.length || acts.activate.length) {
      setMenu(null);
      setPileMenu(pileMenu?.player === player && pileMenu.location === location ? null : { player, location });
    } else setPile({ player, location });
  };

  const waitingAi = !prompt && !view.end;
  const myTurn = state.turnPlayer === viewer;

  // Animations localisées sur les zones du terrain
  const zoneFx = new Map<string, { cls: string; code: number; id: number }[]>();
  const pushZoneFx = (key: string, cls: string, code: number, id: number) => zoneFx.set(key, [...(zoneFx.get(key) ?? []), { cls, code, id }]);
  for (const f of view.fx) {
    if (f.kind === "summon" || f.kind === "spsummon" || f.kind === "flip" || f.kind === "set") pushZoneFx(f.key, `fx-${f.kind}`, f.code, f.id);
    else if (f.kind === "leave") pushZoneFx(f.key, "fx-leave", f.code, f.id);
    else if (f.kind === "fly") pushZoneFx(f.to, "fx-arrive", 0, f.id);
    else if (f.kind === "attack") {
      pushZoneFx(f.from, f.player === viewer ? "fx-lunge-up" : "fx-lunge-down", 0, f.id);
      if (f.to) pushZoneFx(f.to, "fx-hit", 0, f.id);
    }
  }
  const chainAt = new Map<string, number>();
  state.chain.forEach((c, i) => {
    if (c.location & (LOC.MZONE | LOC.SZONE)) chainAt.set(cardKey(c.controller, c.location, c.sequence), i + 1);
  });
  const side = (player: number) => (player === viewer || mode === "solo" ? "me" : "op");
  const directHit = view.fx.find((f) => f.kind === "attack" && !f.to);

  return (
    <div className={`duel ${wide ? "duel-wide" : ""} ${wide && !panel ? "duel-nopanel" : ""}`}>
      {use3d && <Board3DLayer onReady={setReady3d} myTurn={myTurn} />}
      {panel && (
        <aside className="card-panel">
          {focus ? <CardDetail code={focus} /> : <p className="muted small">Touchez une carte pour afficher ses informations.</p>}
        </aside>
      )}
      <div className="duel-top">
        <div className="top-tools">
          <button className="tool" onClick={() => confirm("Abandonner le duel ?") && onExit()} title="Quitter">✕</button>
          <button className="tool" onClick={() => setShowLog(!showLog)} title="Journal">☰</button>
          <button className="tool" title="Terrain : plateau 3D ou tapis" onClick={() => setShowMat(true)}>▦</button>
        </div>
        {handFor(1 - viewer, op.hand, true)}
        <LpPlate name={label(1 - viewer)} lp={op.lp} max={lp} active={!myTurn} side="op" thinking={view.thinking} />
        <DamagePops fx={view.fx} player={1 - viewer} />
        {view.chat && view.chat.player !== viewer && <div key={view.chat.id} className="bot-chat">{view.chat.text}</div>}
      </div>

      <div className={`duel-board ${use3d && ready3d ? "has-3d" : ""} ${playmat ? "has-playmat" : ""}`}
        style={playmat ? ({ "--playmat": `url("${playmat}")` } as React.CSSProperties) : undefined}>
        <Field
          state={state}
          viewer={viewer}
          actionable={new Set(actions.keys())}
          actionBlue={blue}
          zones={zones}
          chosenZones={new Set(chosenZones)}
          targets={targets}
          revealAll={mode === "solo"}
          hidden={hiddenCard}
          onCard={onCard}
          onZone={onZone}
          onPile={onPile}
          zoneFx={zoneFx}
          chainAt={chainAt}
        />
        {directHit && <div key={directHit.id} className={`direct-hit ${directHit.kind === "attack" && directHit.player === viewer ? "to-op" : "to-me"}`} />}
        {state.chain.length > 0 && (
          <div className="chain">
            <div className="chain-title">Chaîne</div>
            {state.chain.map((c, i) => (
              <div key={i}
                className={`chain-link ${c.controller === viewer ? "mine" : "theirs"} ${state.solving === i + 1 ? "solving" : ""} ${state.solving && state.solving < i + 1 ? "done" : ""}`}
                onClick={() => setInspect({ code: c.code, actions: [] })}>
                <CardImage code={c.code} />
                <span className="chain-num">{i + 1}</span>
              </div>
            ))}
          </div>
        )}
        {view.fx.map((f) => {
          if (f.kind === "activate")
            return (
              <div key={f.id} className={`fx-activate from-${side(f.player)}`}>
                <div className="fx-activate-card">
                  <CardImage code={f.code} big />
                  <span className="chain-num">{f.chain}</span>
                </div>
              </div>
            );
          if (f.kind === "banner")
            return <div key={f.id} className={`fx-banner side-${side(f.player)} ${f.big ? "big" : ""}`}><span>{f.text}</span></div>;
          if (f.kind === "chain")
            return (
              <div key={f.id} className="fx-chain">
                {f.links.map((l, i) => (
                  <div key={i} className={`fx-chain-card c${i} side-${side(l.player)}`}>
                    <CardImage code={l.code} />
                    <b>{f.size - f.links.length + i + 1}</b>
                  </div>
                ))}
                <span className="fx-chain-text">Chaîne</span>
              </div>
            );
          if (f.kind === "fly") return <FlyCard key={f.id} fx={f} reveal={!f.faceDown || (f.player === viewer && mode === "ai") || mode === "solo"} />;
          if (f.kind === "bury") return <BuryCard key={f.id} fx={f} hidden={f.faceDown && mode === "ai" && f.player !== viewer} />;
          if (f.kind === "travel") {
            // On ne montre pas la carte piochée ou ajoutée depuis le Deck par l'adversaire, ni une carte qui part face cachée chez lui.
            const secret = mode === "ai" && f.owner !== viewer && (f.faceDown || (f.toLoc & LOC.HAND && f.fromLoc & LOC.DECK));
            const mine = f.owner === viewer || mode === "solo";
            return <TravelCard key={f.id} fx={f} reveal={!!f.code && !secret && (mine || !f.faceDown)} />;
          }
          if (f.kind === "resolve") return <div key={f.id} className="fx-resolve"><span>Résolution</span></div>;
          return null;
        })}
        <PhaseOrb
          turn={state.turn}
          phase={state.phase}
          mine={myTurn}
          waiting={waitingAi && mode === "ai"}
          buttons={phaseButtons}
          onPick={(r) => respond(r)}
        />
        {view.clock !== null && prompt && (
          <div className={`clock ${view.clock <= 30 ? "low" : ""}`}><span>⏱ </span>{Math.floor(view.clock / 60)}:{String(view.clock % 60).padStart(2, "0")}</div>
        )}
        {(msg?.type === T.SELECT_PLACE || msg?.type === T.SELECT_DISFIELD) && (
          <div className="banner">{prompt?.hint || "Choisissez une zone"} ({chosenZones.length}/{msg.count})</div>
        )}
      </div>

      {mode === "ai" && (
        <button className={`speed-btn ${fast ? "on" : ""}`} onClick={() => setFast(!fast)} title={fast ? "Vitesse normale" : "Accélérer"}>
          <span>▶▶</span>{fast && <small>×3</small>}
        </button>
      )}

      <div className="duel-bottom">
        {handFor(viewer, me.hand, false)}
        <LpPlate name={label(viewer)} lp={me.lp} max={lp} active={myTurn} side="me" />
        <DamagePops fx={view.fx} player={viewer} />
      </div>


      {menu && actions.get(menu.key) && (
        <div className="menu-backdrop" onClick={() => setMenu(null)}>
          <div className="action-menu" onClick={(e) => e.stopPropagation()}>
            {menu.code > 0 && (
              <button className="action-card" onClick={() => { setInspect({ code: menu.code, actions: [] }); }} title="Voir la carte">
                <CardImage code={menu.code} />
                <span>ⓘ</span>
              </button>
            )}
            <div className="action-buttons">
              {menu.actions.map((a, i) => (
                <button key={i} className={`action-btn act-${actionKind(a.label)}`} onClick={() => respond(a.response)}>
                  <span className="action-icon">{ACTION_ICONS[actionKind(a.label)]}</span>
                  <span className="action-label">{a.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {msg?.type === T.SELECT_IDLECMD && !menu && !pileMenu && !pilePick && !inspect && state.turn <= 4 && (
        <div className="turn-hint">À vous ! Touchez une carte qui brille pour jouer, ou le bouton de phase pour continuer.</div>
      )}

      {prompt && msg && msg.type !== T.SELECT_IDLECMD && msg.type !== T.SELECT_BATTLECMD && (
        <PromptPanel
          key={prompt.id}
          prompt={prompt}
          respond={respond}
          inspect={(code) => setInspect({ code, actions: [] })}
          playerLabel={mode === "solo" && promptPlayer !== undefined ? label(promptPlayer) : ""}
          respondingTo={state.chain[state.chain.length - 1]?.code}
          hidden={hiddenCard}
          context={[...view.log].reverse().find((l) => l.player >= 0 && !l.text.startsWith("—"))?.text}
        />
      )}

      {pileMenu && (() => {
        const acts = pileActions(pileMenu.player, pileMenu.location);
        return (
          <PileMenu onClose={() => setPileMenu(null)}
            buttons={(["special", "activate"] as const).filter((k) => acts[k].length).map((kind) => ({
              kind, label: kind === "special" ? "Invocation Spéciale" : "Activer Effet",
              onClick: () => { setPileMenu(null); setPilePick({ ...pileMenu, kind }); },
            }))}
            onBrowse={() => { setPile(pileMenu); setPileMenu(null); }} />
        );
      })()}

      {pilePick && (
        <PilePickDialog
          title={pilePick.kind === "special" ? "Sélectionnez le Monstre à Invoquer Spécialement." : "Sélectionnez un effet à activer."}
          choices={pileActions(pilePick.player, pilePick.location)[pilePick.kind]}
          onInspect={(code) => setInspect({ code, actions: [] })}
          onCancel={() => setPilePick(null)}
          onChoose={(c) => {
            setPilePick(null);
            if (c.actions.length === 1) respond(c.actions[0].response);
            else setMenu({ key: cardKey(pilePick.player, pilePick.location, c.index), code: c.card.code, actions: c.actions });
          }}
        />
      )}

      {pile && (
        <div className="sheet-backdrop" onClick={() => setPile(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <strong>{{ [LOC.GRAVE]: "Cimetière", [LOC.REMOVED]: "Bannies", [LOC.EXTRA]: "Extra Deck" }[pile.location]} — {label(pile.player)}</strong>
              <button className="ghost" onClick={() => setPile(null)}>✕</button>
            </div>
            <div className="pick-grid">
              {pileCards.map((c, i) => {
                const key = cardKey(pile.player, pile.location, i);
                return (
                  <div key={i} className={`pick ${actions.has(key) ? "zone-actionable" : ""}`}
                    onClick={() => !pileHidden(c) && setInspect({ code: c.code, actions: actions.get(key) ?? [] })}>
                    <CardImage code={c.code} back={pileHidden(c)} />
                  </div>
                );
              })}
              {pileCards.length === 0 && <p className="muted">Vide</p>}
            </div>
          </div>
        </div>
      )}

      {inspect && (
        <div className="sheet-backdrop" onClick={() => setInspect(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <span />
              <button className="ghost" onClick={() => setInspect(null)}>✕</button>
            </div>
            {inspect.actions.length > 0 && (
              <div className="action-list">
                {inspect.actions.map((a, i) => <button key={i} className="primary" onClick={() => respond(a.response)}>{a.label}</button>)}
              </div>
            )}
            {inspect.code > 0 && <CardDetail code={inspect.code} />}
          </div>
        </div>
      )}

      {showMat && (
        <MatSheet
          use3d={use3d}
          playmat={playmat}
          onClose={() => setShowMat(false)}
          on3d={(on) => { setBoard3dEnabled(on); setUse3d(on); }}
          onPlaymat={(url) => {
            if (!setPlaymatImage(url)) alert("Image trop lourde pour être gardée sur cet appareil : elle ne restera que pour ce duel.");
            setPlaymat(url);
            // Le tapis se voit sans le plateau 3D.
            if (url && use3d) { setBoard3dEnabled(false); setUse3d(false); }
          }}
        />
      )}

      {showLog && (
        <div className="log" ref={logRef}>
          {view.log.map((l, i) => <div key={i} className={l.player === viewer ? "log-me" : l.player === 1 - viewer ? "log-op" : "log-sys"}>{l.text}</div>)}
        </div>
      )}

      {view.end && (
        <div className="end-overlay">
          <h1 className={view.end.winner === viewer || mode === "solo" ? "win" : "lose"}>
            {mode === "solo" ? `${label(view.end.winner)} gagne !` : view.end.winner === human ? "VICTOIRE" : view.end.winner < 0 ? "ÉGALITÉ" : "DÉFAITE"}
          </h1>
          <p>{view.end.reason}</p>
          <div className="sheet-actions">
            <button className="primary" onClick={onRematch}>Rejouer</button>
            <button onClick={onExit}>Menu</button>
          </div>
        </div>
      )}
    </div>
  );
}

const WIDE_QUERY = "(orientation: landscape) and (min-aspect-ratio: 4/3) and (min-width: 640px)";
const PANEL_QUERY = `${WIDE_QUERY} and (min-height: 560px)`;

function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

const BLUE_KINDS = new Set(["summon", "set", "position"]);

/** Réglages du terrain : plateau 3D, ou tapis 2D avec une image de fond au choix. */
function MatSheet({ use3d, playmat, on3d, onPlaymat, onClose }: {
  use3d: boolean; playmat: string | null; on3d: (on: boolean) => void; onPlaymat: (url: string | null) => void; onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet mat-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <strong>Terrain</strong>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>
        <div className="segmented">
          <button className={!use3d ? "on" : ""} onClick={() => on3d(false)}>Tapis</button>
          <button className={use3d ? "on" : ""} onClick={() => on3d(true)}>Plateau 3D (forêt)</button>
        </div>
        <div className={`mat-preview ${playmat ? "" : "mat-preview-default"}`} style={playmat ? { backgroundImage: `url("${playmat}")` } : undefined} />
        <p className="muted small">Choisissez n'importe quelle image (paysage de préférence) : elle devient le fond du tapis, sous les zones.</p>
        <input ref={input} type="file" accept="image/*" hidden onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try { onPlaymat(await fileToPlaymat(file)); } catch { alert("Impossible de lire cette image."); }
          setBusy(false);
        }} />
        <div className="sheet-actions">
          <button className="primary" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Chargement…" : "Choisir une image"}</button>
          {playmat && <button onClick={() => onPlaymat(null)}>Tapis gris par défaut</button>}
        </div>
      </div>
    </div>
  );
}

const ACTION_ICONS: Record<string, string> = {
  summon: "⬆", special: "✦", set: "▼", activate: "⚡", position: "⟳", attack: "⚔", other: "•",
};

function actionKind(label: string): string {
  if (label.startsWith("Invocation Normale")) return "summon";
  if (label.startsWith("Invocation Spéciale")) return "special";
  if (label.startsWith("Poser")) return "set";
  if (label.startsWith("Activer")) return "activate";
  if (label.startsWith("Changer")) return "position";
  if (label.startsWith("Attaquer")) return "attack";
  return "other";
}

function LpPlate({ name, lp, max, active, side, thinking }: { name: string; lp: number; max: number; active: boolean; side: "me" | "op"; thinking?: boolean }) {
  const [shown, setShown] = useState(lp);
  const [hit, setHit] = useState(0);
  // Les LP défilent jusqu'à la nouvelle valeur, comme dans Master Duel.
  useEffect(() => {
    if (shown === lp) return;
    if (lp < shown) setHit((h) => h + 1);
    const step = Math.max(10, Math.round(Math.abs(lp - shown) / 12));
    const t = setTimeout(() => setShown((v) => (v < lp ? Math.min(lp, v + step) : Math.max(lp, v - step))), 30);
    return () => clearTimeout(t);
  }, [lp, shown]);
  return (
    <div className={`lp-plate lp-${side} ${active ? "active" : ""}`}>
      {side === "me"
        ? <img className="avatar avatar-img" src={`${import.meta.env.BASE_URL}img/duelist-icon.webp`} alt="" draggable={false} />
        : <div className="avatar">{name.slice(0, 1).toUpperCase()}</div>}
      <div className="lp-body">
        <span className="pname">{name}{thinking && <span className="thinking-dots"> réfléchit<i>.</i><i>.</i><i>.</i></span>}</span>
        <span key={hit} className={`lp-value ${hit ? "lp-hit" : ""}`}><small>LP</small>{shown}</span>
        <span className="lp-bar"><span style={{ width: `${Math.max(0, Math.min(100, (shown / max) * 100))}%` }} /></span>
      </div>
    </div>
  );
}

const PHASE_LABELS: [number, string][] = [
  [PHASE.DRAW, "Draw"], [PHASE.STANDBY, "Standby"], [PHASE.MAIN1, "Main 1"], [0x8 | 0x10 | 0x20 | 0x40 | 0x80, "Battle"],
  [PHASE.MAIN2, "Main 2"], [PHASE.END, "End"],
];

function PhaseOrb({ turn, phase, mine, waiting, buttons, onPick }: {
  turn: number; phase: number; mine: boolean; waiting: boolean;
  buttons: { label: string; response: OcgResponse }[]; onPick: (r: OcgResponse) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = PHASE_LABELS.find(([m]) => phase & m)?.[1] ?? "";
  const ready = buttons.length > 0;
  return (
    <div className="phase-wrap">
      {open && ready && (
        <div className="phase-menu">
          {buttons.map((b) => (
            <button key={b.label} onClick={() => { setOpen(false); onPick(b.response); }}>{b.label}</button>
          ))}
        </div>
      )}
      <button className={`phase-orb ${mine ? "mine" : "op"} ${ready ? "ready" : ""} ${waiting ? "thinking" : ""}`}
        onClick={() => ready && setOpen(!open)}>
        <small>Turn {turn}</small>
        <b>{label}</b>
      </button>
    </div>
  );
}

/** Carte qui glisse de sa pile d'origine (main, deck…) jusqu'à la zone visée. */
function FlyCard({ fx, reveal }: { fx: Extract<Fx, { kind: "fly" }>; reveal: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const target = document.querySelector(`[data-zone="${fx.to}"]`);
    const source = fx.from & LOC.HAND
      ? document.querySelector(`[data-hand="${fx.player}"]`)
      : document.querySelector(`[data-pile="${fx.player}-${fx.from & LOC.REMOVED ? LOC.REMOVED : fx.from & LOC.GRAVE ? LOC.GRAVE : fx.from & LOC.EXTRA ? LOC.EXTRA : LOC.DECK}"]`);
    if (!el || !target || !source) return;
    // Coordonnées relatives au plateau (qui sert de repère à la carte volante)
    const box = el.parentElement!.getBoundingClientRect();
    const tr = target.getBoundingClientRect();
    const sr = source.getBoundingClientRect();
    const t = { left: tr.left - box.left, top: tr.top - box.top, width: tr.width, height: tr.height };
    const s = { left: sr.left - box.left, top: sr.top - box.top, width: sr.width, height: sr.height };
    if (fx.from & LOC.HAND) {
      // Position de la carte dans la main avant son départ (la main compte une carte de plus).
      const count = source.children.length + 1;
      const slot = sr.width / count;
      s.left += slot * Math.min(fx.seq, count - 1);
      s.width = slot;
    }
    const w = t.width * 0.82;
    el.style.width = `${w}px`;
    el.style.left = `${t.left + (t.width - w) / 2}px`;
    el.style.top = `${t.top + (t.height - w * 1.46) / 2}px`;
    const dx = s.left + s.width / 2 - (t.left + t.width / 2);
    const dy = s.top + s.height / 2 - (t.top + t.height / 2);
    const fromScale = fx.from & LOC.HAND ? 1.6 : 1;
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${fromScale})`, opacity: 0.9 },
        { transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 30}px) scale(${(fromScale + 1.25) / 2}) rotateX(18deg)`, opacity: 1, offset: 0.55 },
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
      ],
      { duration: 480, easing: "cubic-bezier(0.25, 0.8, 0.3, 1)", fill: "forwards" },
    ).onfinish = () => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards" });
  }, [fx]);
  return (
    <div ref={ref} className="fly-card">
      <CardImage code={fx.code} back={!reveal || !fx.code} />
    </div>
  );
}

/**
 * Carte envoyée au cimetière ou bannie : elle se fissure sur sa zone (si elle vient du terrain),
 * glisse jusqu'à son socle et s'y engouffre, comme dans Master Duel. Le socle ne garde pas la carte.
 */
function BuryCard({ fx, hidden }: { fx: Extract<Fx, { kind: "bury" }>; hidden: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current, halo = glow.current;
    const target = document.querySelector(`[data-pile="${fx.to}"]`);
    const source = fx.fromKey
      ? document.querySelector(`[data-zone="${fx.fromKey}"]`)
      : fx.from & LOC.HAND
        ? document.querySelector(`[data-hand="${fx.player}"]`)
        : document.querySelector(`[data-pile="${fx.player}-${fx.from & LOC.EXTRA ? LOC.EXTRA : LOC.DECK}"]`);
    if (!el || !halo || !target || !source) return;
    const box = el.parentElement!.getBoundingClientRect();
    const tr = target.getBoundingClientRect();
    const sr = source.getBoundingClientRect();
    const tx = tr.left - box.left + tr.width / 2, ty = tr.top - box.top + tr.height / 2;
    const sx = sr.left - box.left + sr.width / 2, sy = sr.top - box.top + sr.height / 2;
    const w = tr.width * 0.84;
    const from = fx.fromKey ? (sr.width * 0.86) / w : fx.from & LOC.HAND ? 1.5 : 1;
    el.style.width = `${w}px`;
    el.style.left = `${tx - w / 2}px`;
    el.style.top = `${ty - (w * 1.46) / 2}px`;
    const dx = sx - tx, dy = sy - ty;
    const hold = fx.fromKey ? 0.3 : 0.05;
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${from})`, opacity: 1, filter: "brightness(1)" },
        { transform: `translate(${dx}px, ${dy}px) scale(${from * 1.04})`, opacity: 1, filter: "brightness(1.5)", offset: hold },
        { transform: `translate(${dx * 0.4}px, ${dy * 0.4 - 26}px) scale(${(from + 1) / 2}) rotate(${dx > 0 ? -8 : 8}deg)`, opacity: 1, filter: "brightness(1.2)", offset: hold + 0.3 },
        { transform: "translate(0, 0) scale(0.9)", opacity: 1, filter: "brightness(1.4)", offset: 0.82 },
        { transform: "translate(0, 6px) scale(0.35)", opacity: 0, filter: "brightness(3)" },
      ],
      { duration: fx.fromKey ? 1050 : 800, easing: "cubic-bezier(0.4, 0, 0.3, 1)", fill: "forwards" },
    );
    halo.style.left = `${tx}px`;
    halo.style.top = `${ty}px`;
    halo.animate(
      [{ opacity: 0, transform: "translate(-50%, -50%) scale(0.4)" }, { opacity: 1, transform: "translate(-50%, -50%) scale(1)", offset: 0.4 }, { opacity: 0, transform: "translate(-50%, -50%) scale(1.5)" }],
      { duration: 520, delay: fx.fromKey ? 780 : 560, easing: "ease-out", fill: "both" },
    );
  }, [fx]);
  return (
    <>
      <div ref={ref} className={`fly-card bury-card ${fx.fromKey ? "from-field" : ""}`}>
        <CardImage code={fx.code} back={!fx.code || hidden} />
      </div>
      <div ref={glow} className={`bury-glow ${fx.banish ? "banish" : ""}`} />
    </>
  );
}

/** Élément visé par une extrémité d'un déplacement (« zone:… », « pile:… », « hand:joueur-index »). */
function endpointRect(ep: string): { rect: DOMRect; hand: boolean } | null {
  const [kind, id] = [ep.slice(0, ep.indexOf(":")), ep.slice(ep.indexOf(":") + 1)];
  if (kind === "zone") {
    const el = document.querySelector(`[data-zone="${id}"]`);
    return el ? { rect: el.getBoundingClientRect(), hand: false } : null;
  }
  if (kind === "pile") {
    const el = document.querySelector(`[data-pile="${id}"]`);
    return el ? { rect: el.getBoundingClientRect(), hand: false } : null;
  }
  const [player, index] = id.split("-").map(Number);
  const hand = document.querySelector(`[data-hand="${player}"]`);
  if (!hand) return null;
  const card = hand.children[Math.min(index, hand.children.length - 1)];
  return { rect: (card ?? hand).getBoundingClientRect(), hand: true };
}

/**
 * Tout déplacement qui n'est ni une arrivée sur le terrain ni un envoi au Cimetière : pioche, ajout à la main,
 * retour au Deck, Cimetière → bannis… La carte suit un arc de sa position de départ à son arrivée.
 */
function TravelCard({ fx, reveal }: { fx: Extract<Fx, { kind: "travel" }>; reveal: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const from = endpointRect(fx.from), to = endpointRect(fx.to);
    if (!el || !from || !to) return;
    const box = el.parentElement!.getBoundingClientRect();
    const tr = to.rect, sr = from.rect;
    // Taille d'arrivée : celle de la carte en main, sinon une carte du terrain.
    const w = to.hand ? tr.width : Math.min(tr.width * 0.84, tr.height / 1.46);
    const sw = from.hand ? sr.width : Math.min(sr.width * 0.84, sr.height / 1.46);
    const tx = tr.left - box.left + tr.width / 2, ty = tr.top - box.top + tr.height / 2;
    const sx = sr.left - box.left + sr.width / 2, sy = sr.top - box.top + sr.height / 2;
    el.style.width = `${w}px`;
    el.style.left = `${tx - w / 2}px`;
    el.style.top = `${ty - (w * 1.46) / 2}px`;
    const dx = sx - tx, dy = sy - ty, s0 = sw / w;
    // La pioche part du Deck incliné et se redresse en montant dans la main.
    const tilt = fx.fromLoc & LOC.DECK ? (dx > 0 ? -20 : 20) : 0;
    const toPile = fx.to.startsWith("pile:");
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${s0}) rotate(${tilt}deg)`, opacity: 0 },
        { transform: `translate(${dx}px, ${dy - 8}px) scale(${s0 * 1.05}) rotate(${tilt}deg)`, opacity: 1, offset: 0.12 },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 40}px) scale(${(s0 + 1) / 2 + 0.12}) rotate(${tilt / 2}deg)`, opacity: 1, offset: 0.55 },
        { transform: "translate(0, 0) scale(1) rotate(0)", opacity: 1, offset: toPile ? 0.85 : 1 },
        ...(toPile ? [{ transform: "translate(0, 0) scale(0.6)", opacity: 0 }] : []),
      ],
      { duration: 560, delay: fx.delay, easing: "cubic-bezier(0.3, 0.7, 0.3, 1)", fill: "both" },
    );
  }, [fx]);
  return (
    <div ref={ref} className="fly-card travel-card">
      <CardImage code={fx.code} back={!reveal} />
    </div>
  );
}

function pileKind(label: string): PileActionKind | null {
  if (label.startsWith("Invocation Spéciale")) return "special";
  if (label.startsWith("Activer")) return "activate";
  return null;
}

/** Menu d'une pile jouable (Cimetière, Extra Deck…), au même endroit et du même style que celui des cartes en main. */
function PileMenu({ buttons, onBrowse, onClose }: {
  onClose: () => void; onBrowse: () => void;
  buttons: { kind: PileActionKind; label: string; onClick: () => void }[];
}) {
  return (
    <div className="menu-backdrop" onClick={onClose}>
      <div className="action-menu" onClick={(e) => e.stopPropagation()}>
        <div className="action-buttons">
          {buttons.map((b) => (
            <button key={b.kind} className={`action-btn act-${b.kind}`} onClick={b.onClick}>
              <span className="action-icon">{ACTION_ICONS[b.kind]}</span>
              <span className="action-label">{b.label}</span>
            </button>
          ))}
          <button className="action-btn act-other" onClick={onBrowse}>
            <span className="action-icon">☰</span>
            <span className="action-label">Voir les cartes</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** Fenêtre « Sélectionnez… » de Master Duel : les cartes jouables de la pile, puis Annuler / Choisir. */
function PilePickDialog({ title, choices, onChoose, onCancel, onInspect }: {
  title: string; choices: { index: number; card: FieldCard; actions: CardAction[] }[];
  onChoose: (c: { index: number; card: FieldCard; actions: CardAction[] }) => void; onCancel: () => void; onInspect: (code: number) => void;
}) {
  const [sel, setSel] = useState(choices.length === 1 ? 0 : -1);
  return (
    <div className="sheet-backdrop md-dialog-backdrop" onClick={onCancel}>
      <div className="md-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="md-dialog-title">{title}</div>
        <div className="md-dialog-cards">
          {choices.map((c, i) => (
            <button key={c.index} className={`md-dialog-card ${sel === i ? "on" : ""}`} onClick={() => setSel(i)} onDoubleClick={() => onChoose(c)}>
              <CardImage code={c.card.code} />
              <span className="md-dialog-info" onClick={(e) => { e.stopPropagation(); onInspect(c.card.code); }}>ⓘ</span>
            </button>
          ))}
        </div>
        <div className="md-dialog-actions">
          <button className="md-btn" onClick={onCancel}>Annuler</button>
          <button className="md-btn" disabled={sel < 0} onClick={() => sel >= 0 && onChoose(choices[sel])}>Choisir</button>
        </div>
      </div>
    </div>
  );
}

function DamagePops({ fx, player }: { fx: Fx[]; player: number }) {
  return (
    <>
      {fx.map((f) => f.kind === "damage" && f.player === player && (
        <div key={f.id} className={`damage-pop ${f.heal ? "heal" : ""}`}>{f.heal ? "+" : "−"}{f.amount}</div>
      ))}
    </>
  );
}
