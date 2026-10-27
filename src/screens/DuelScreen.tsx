import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { OcgMessageType as T, OcgResponseType as R } from "ocgcore-wasm";
import type { OcgLocation, OcgResponse } from "ocgcore-wasm";
import { DuelController } from "../engine/controller";
import type { Fx } from "../engine/controller";
import type { DuelMode } from "../engine/controller";
import type { DeckList, FieldCard } from "../engine/protocol";
import { LOC, PHASE } from "../lib/constants";
import { CardDetail } from "../ui/CardDetail";
import { CardImage } from "../ui/CardImage";
import { Field } from "../ui/Field";
import { cardKey } from "../ui/keys";
import { PromptPanel } from "../ui/PromptPanel";
import { cardActions, placeZones } from "../ui/promptLogic";
import type { CardAction } from "../ui/promptLogic";
import { useDb } from "../ui/dbContext";

interface Props {
  mode: DuelMode;
  decks: [DeckList, DeckList];
  /** Joueur humain (en mode IA), 0 s'il commence. */
  human: number;
  names: [string, string];
  turnSeconds: number;
  onExit: () => void;
  onRematch: () => void;
}

type Inspect = { code: number; actions: CardAction[] } | null;
/** Menu d'actions rapide façon Master Duel, ouvert en touchant une carte jouable. */
type Menu = { key: string; code: number; actions: CardAction[] } | null;
type PileView = { player: number; location: number } | null;

export function DuelScreen({ mode, decks, human, names, turnSeconds, onExit, onRematch }: Props) {
  const db = useDb();
  const controller = useMemo(() => new DuelController(db, mode, decks, human, turnSeconds), [db, mode, decks, human, turnSeconds]);
  useEffect(() => () => controller.dispose(), [controller]);
  const view = useSyncExternalStore(controller.subscribe, controller.getView);
  const [inspect, setInspect] = useState<Inspect>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [pile, setPile] = useState<PileView>(null);
  const [showLog, setShowLog] = useState(false);
  const [chosenZones, setChosenZones] = useState<string[]>([]);
  const { state, prompt } = view;
  const msg = prompt?.message;

  const respond = (r: OcgResponse) => {
    setInspect(null);
    setMenu(null);
    setPile(null);
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

  const onCard = (controller: number, location: number, sequence: number, card: FieldCard) => {
    const key = cardKey(controller, location, sequence);
    const list = actions.get(key) ?? [];
    if (list.length) setMenu(menu?.key === key ? null : { key, code: card.code, actions: list });
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

  const handFor = (player: number, cards: FieldCard[], top: boolean) => {
    const visible = !top || mode === "solo";
    return (
      <div className={`hand ${top ? "hand-top" : ""}`} data-hand={player}>
        {cards.map((c, i) => {
          const key = cardKey(player, LOC.HAND, i);
          const act = actions.has(key);
          return (
            <div key={i} className={`hand-card ${act ? "zone-actionable" : ""} ${targets.has(key) ? "zone-target" : ""} ${menu?.key === key ? "menu-open" : ""}`}
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
    pile?.location === LOC.EXTRA && pile.player !== viewer && mode === "ai" && !(c.position & 0x5);

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
    <div className="duel">
      <div className="duel-top">
        <div className="top-tools">
          <button className="tool" onClick={() => confirm("Abandonner le duel ?") && onExit()} title="Quitter">✕</button>
          <button className="tool" onClick={() => setShowLog(!showLog)} title="Journal">☰</button>
        </div>
        {handFor(1 - viewer, op.hand, true)}
        <LpPlate name={label(1 - viewer)} lp={op.lp} active={!myTurn} side="op" thinking={view.thinking} />
        <DamagePops fx={view.fx} player={1 - viewer} />
      </div>

      <div className="duel-board">
        <Field
          state={state}
          viewer={viewer}
          actionable={new Set(actions.keys())}
          zones={zones}
          chosenZones={new Set(chosenZones)}
          targets={targets}
          revealAll={mode === "solo"}
          onCard={onCard}
          onZone={onZone}
          onPile={(player, location) => location !== LOC.DECK && setPile({ player, location })}
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
        {(msg?.type === T.SELECT_PLACE || msg?.type === T.SELECT_DISFIELD) && (
          <div className="banner">{prompt?.hint || "Choisissez une zone"} ({chosenZones.length}/{msg.count})</div>
        )}
      </div>

      <div className="duel-bottom">
        {handFor(viewer, me.hand, false)}
        <LpPlate name={label(viewer)} lp={me.lp} active={myTurn} side="me" />
        <DamagePops fx={view.fx} player={viewer} />
      </div>

      {view.clock !== null && prompt && (
        <div className={`clock ${view.clock <= 30 ? "low" : ""}`}>⏱ {Math.floor(view.clock / 60)}:{String(view.clock % 60).padStart(2, "0")}</div>
      )}

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

      {msg?.type === T.SELECT_IDLECMD && !menu && !inspect && state.turn <= 4 && (
        <div className="turn-hint">À vous ! Touchez une carte qui brille pour jouer, ou le bouton de phase pour continuer.</div>
      )}

      {prompt && msg && msg.type !== T.SELECT_IDLECMD && msg.type !== T.SELECT_BATTLECMD && (
        <PromptPanel
          key={prompt.id}
          prompt={prompt}
          respond={respond}
          inspect={(code) => setInspect({ code, actions: [] })}
          playerLabel={mode === "solo" && promptPlayer !== undefined ? label(promptPlayer) : ""}
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

function LpPlate({ name, lp, active, side, thinking }: { name: string; lp: number; active: boolean; side: "me" | "op"; thinking?: boolean }) {
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
      <div className="avatar">{name.slice(0, 1).toUpperCase()}</div>
      <div className="lp-body">
        <span className="pname">{name}{thinking && <span className="thinking-dots"> réfléchit<i>.</i><i>.</i><i>.</i></span>}</span>
        <span key={hit} className={`lp-value ${hit ? "lp-hit" : ""}`}><small>LP</small>{shown}</span>
        <span className="lp-bar"><span style={{ width: `${Math.max(0, Math.min(100, (shown / 8000) * 100))}%` }} /></span>
      </div>
    </div>
  );
}

const PHASE_LABELS: [number, string][] = [
  [PHASE.DRAW, "Draw"], [PHASE.STANDBY, "Standby"], [PHASE.MAIN1, "Main1"], [0x8 | 0x10 | 0x20 | 0x40 | 0x80, "Battle"],
  [PHASE.MAIN2, "Main2"], [PHASE.END, "End"],
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
        <small>Tour {turn}</small>
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

function DamagePops({ fx, player }: { fx: Fx[]; player: number }) {
  return (
    <>
      {fx.map((f) => f.kind === "damage" && f.player === player && (
        <div key={f.id} className={`damage-pop ${f.heal ? "heal" : ""}`}>{f.heal ? "+" : "−"}{f.amount}</div>
      ))}
    </>
  );
}
