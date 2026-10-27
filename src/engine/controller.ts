// Côté interface : reçoit les mises à jour du worker, les rejoue à un rythme lisible
// et expose un état observable par React.
import { OcgMessageType as T } from "ocgcore-wasm";
import type { OcgMessage, OcgResponse } from "ocgcore-wasm";
import type { CardDb } from "../lib/cards";
import { LOC, PHASE, PHASE_NAMES, POS } from "../lib/constants";
import { cardKey } from "../ui/keys";
import type { DeckList, DuelState, FromWorker, FromWorkerTagged, ToWorker } from "./protocol";

export interface Prompt {
  id: number;
  message: OcgMessage;
  hint: string;
  retry: boolean;
}

/** Effets visuels ponctuels du duel, façon Master Duel. Chaque effet s'efface seul. */
export type Fx = { id: number } & (
  | { kind: "activate"; code: number; player: number; chain: number }
  | { kind: "summon" | "spsummon" | "flip" | "set"; code: number; player: number; key: string }
  | { kind: "banner"; text: string; player: number; big?: boolean }
  | { kind: "chain"; links: { code: number; player: number }[]; size: number }
  | { kind: "resolve" }
  | { kind: "attack"; from: string; to: string | null; player: number }
  | { kind: "damage"; player: number; amount: number; heal: boolean }
  | { kind: "leave"; code: number; key: string }
  /** Carte qui glisse d'une pile (main, deck, Extra Deck…) jusqu'à sa zone. */
  | { kind: "fly"; code: number; player: number; from: number; seq: number; to: string; faceDown: boolean }
);
type FxInput = Fx extends infer F ? (F extends Fx ? Omit<F, "id"> : never) : never;

const FX_LIFETIME: Record<Fx["kind"], number> = {
  activate: 1100, summon: 900, spsummon: 1100, flip: 800, set: 600, banner: 1200, chain: 1300, resolve: 900, attack: 900, damage: 1300, leave: 700, fly: 700,
};

export interface DuelView {
  loading: string | null;
  state: DuelState | null;
  prompt: Prompt | null;
  log: { text: string; player: number }[];
  fx: Fx[];
  /** L'IA est en train de réfléchir. */
  thinking: boolean;
  end: { winner: number; reason: string } | null;
  error: string | null;
  /** Temps restant ce tour (secondes), null sans minuteur. */
  clock: number | null;
}

// Un seul worker pour toute la session : le moteur et les cartes restent chargés entre deux duels.
let sharedWorker: Worker | null = null;
let duelCounter = 0;
const handlers = new Map<number, (m: FromWorker) => void>();

function worker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL("./duel.worker.ts", import.meta.url), { type: "module" });
    sharedWorker.onmessage = (e: MessageEvent<FromWorkerTagged>) => handlers.get(e.data.duel)?.(e.data);
    sharedWorker.onerror = (e) => handlers.forEach((h) => h({ kind: "error", error: e.message || "Erreur du moteur" }));
  }
  return sharedWorker;
}

/** Démarre le moteur en arrière-plan dès l'accueil, pour que le premier duel se lance vite. */
export function warmupEngine() {
  worker().postMessage({ kind: "warmup", base: new URL(import.meta.env.BASE_URL, location.href).href } satisfies ToWorker);
}

export type DuelMode = "ai" | "solo";

export class DuelController {
  private id = ++duelCounter;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private clockTurn = -1;
  private listeners = new Set<() => void>();
  private disposed = false;
  private queue: FromWorker[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private fxId = 0;
  private promptId = 0;
  view: DuelView = { loading: "Démarrage du moteur…", state: null, prompt: null, log: [], fx: [], thinking: false, end: null, error: null, clock: null };

  /** turnSeconds : temps de réflexion par tour (0 = illimité). */
  constructor(private db: CardDb, readonly mode: DuelMode, decks: [DeckList, DeckList], readonly human: number, private turnSeconds = 0) {
    handlers.set(this.id, (m) => this.receive(m));
    const rand = () => String(Math.floor(Math.random() * 2 ** 31) + 1);
    const ai: [boolean, boolean] = mode === "ai" ? [human !== 0, human !== 1] : [false, false];
    this.send({
      kind: "start",
      duel: this.id,
      options: {
        base: new URL(import.meta.env.BASE_URL, location.href).href,
        decks, ai, lp: 8000,
        seed: [rand(), rand(), rand(), rand()],
      },
    });
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getView = () => this.view;

  respond(response: OcgResponse) {
    this.stopClock();
    this.set({ prompt: null });
    this.send({ kind: "respond", duel: this.id, response });
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.stopClock();
    handlers.delete(this.id);
  }

  private send(m: ToWorker) {
    worker().postMessage(m);
  }

  /** Le minuteur ne tourne que pendant que le joueur doit décider ; il repart à chaque tour. */
  private startClock() {
    if (!this.turnSeconds || !this.view.state) return;
    if (this.clockTurn !== this.view.state.turn) {
      this.clockTurn = this.view.state.turn;
      this.set({ clock: this.turnSeconds });
    }
    if ((this.view.clock ?? 0) <= 0) return this.expire();
    this.stopClock();
    this.clockTimer = setInterval(() => {
      const left = (this.view.clock ?? 0) - 1;
      this.set({ clock: Math.max(0, left) });
      if (left <= 0) this.expire();
    }, 1000);
  }

  private stopClock() {
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = null;
  }

  private expire() {
    this.stopClock();
    if (!this.view.prompt) return;
    this.set({ prompt: null });
    this.send({ kind: "timeout", duel: this.id });
  }

  private set(patch: Partial<DuelView>) {
    this.view = { ...this.view, ...patch };
    this.listeners.forEach((l) => l());
  }

  private receive(m: FromWorker) {
    if (m.kind === "loading") return this.set({ loading: m.text });
    if (m.kind === "error") return this.set({ error: m.error, loading: null });
    this.queue.push(m);
    if (!this.timer) this.drain();
  }

  /**
   * Rejoue la file à un rythme lisible : chaque événement marquant (invocation, activation,
   * phase, attaque…) déclenche son animation et laisse le temps de la voir avant la suite.
   */
  private drain() {
    this.timer = null;
    while (this.queue.length && !this.disposed) {
      const m = this.queue.shift()!;
      let pause = 0;
      if (m.kind === "think") {
        this.set({ thinking: true });
        pause = m.ms;
      } else if (m.kind === "update") {
        const log = [...this.view.log];
        const fx: FxInput[] = [];
        for (const msg of m.messages) {
          const line = this.describe(msg);
          if (line) log.push(line);
          const f = this.fxFor(msg, m.state);
          fx.push(...f);
          pause += pauseFor(msg, m.state);
        }
        this.set({ state: m.state, loading: null, thinking: false, log: log.slice(-200) });
        fx.forEach((f) => this.addFx(f));
        pause = Math.min(pause, 2200);
      } else if (m.kind === "prompt") {
        this.set({ thinking: false, prompt: { id: ++this.promptId, message: m.message, hint: m.hint, retry: m.retry } });
        this.startClock();
      } else if (m.kind === "end") {
        this.stopClock();
        this.set({ end: { winner: m.winner, reason: m.reason }, prompt: null, thinking: false });
      }
      if (pause) {
        this.timer = setTimeout(() => this.drain(), pause);
        return;
      }
    }
  }

  private addFx(f: FxInput) {
    const fx = { ...f, id: ++this.fxId } as Fx;
    this.set({ fx: [...this.view.fx, fx] });
    setTimeout(() => {
      if (!this.disposed) this.set({ fx: this.view.fx.filter((x) => x.id !== fx.id) });
    }, FX_LIFETIME[fx.kind]);
  }

  private fxFor(msg: OcgMessage, state: DuelState): FxInput[] {
    switch (msg.type) {
      case T.NEW_TURN: return [{ kind: "banner", text: "Changement de tour", player: msg.player, big: true }];
      case T.NEW_PHASE: {
        const text = PHASE_BANNERS.find(([p]) => msg.phase & p)?.[1];
        return text ? [{ kind: "banner", text, player: state.turnPlayer }] : [];
      }
      case T.SUMMONING: return [{ kind: "summon", code: msg.code, player: msg.controller, key: cardKey(msg.controller, msg.location, msg.sequence) }];
      case T.SPSUMMONING: return [{ kind: "spsummon", code: msg.code, player: msg.controller, key: cardKey(msg.controller, msg.location, msg.sequence) }];
      case T.FLIPSUMMONING: return [{ kind: "flip", code: msg.code, player: msg.controller, key: cardKey(msg.controller, msg.location, msg.sequence) }];
      case T.SET: return [{ kind: "set", code: msg.code, player: msg.controller, key: cardKey(msg.controller, msg.location, msg.sequence) }];
      case T.CHAINING: {
        // Premier maillon : la carte s'active au centre ; ensuite, l'animation « CHAÎNE » relie les deux derniers maillons.
        if (msg.chain_size < 2) return [{ kind: "activate", code: msg.code, player: msg.controller, chain: msg.chain_size }];
        const links = state.chain.slice(-2).map((c) => ({ code: c.code, player: c.controller }));
        return [{ kind: "chain", links, size: msg.chain_size }];
      }
      case T.CHAIN_SOLVING:
        return msg.chain_size === state.chain.length && msg.chain_size >= 2 ? [{ kind: "resolve" }] : [];
      case T.ATTACK:
        return [{
          kind: "attack", player: msg.card.controller,
          from: cardKey(msg.card.controller, msg.card.location, msg.card.sequence),
          to: msg.target ? cardKey(msg.target.controller, msg.target.location, msg.target.sequence) : null,
        }];
      case T.DAMAGE: case T.PAY_LPCOST: return msg.amount ? [{ kind: "damage", player: msg.player, amount: msg.amount, heal: false }] : [];
      case T.RECOVER: return msg.amount ? [{ kind: "damage", player: msg.player, amount: msg.amount, heal: true }] : [];
      case T.MOVE:
        if (isArrival(msg))
          return [{
            kind: "fly", code: msg.card, player: msg.from.controller, from: msg.from.location, seq: msg.from.sequence,
            to: cardKey(msg.to.controller, msg.to.location, msg.to.sequence), faceDown: (msg.to.position & POS.FACEDOWN) !== 0,
          }];
        if (msg.from.location & (LOC.MZONE | LOC.SZONE) && msg.to.location & (LOC.GRAVE | LOC.REMOVED) && msg.card)
          return [{ kind: "leave", code: msg.card, key: cardKey(msg.from.controller, msg.from.location, msg.from.sequence) }];
        return [];
      default: return [];
    }
  }

  private describe(msg: OcgMessage): { text: string; player: number } | null {
    const name = (code: number) => this.db.get(code)?.name ?? "carte face cachée";
    const who = (p: number) => (this.mode === "solo" ? `J${p + 1}` : p === this.human ? "Vous" : "L'IA");
    switch (msg.type) {
      case T.NEW_TURN: return { text: `— Tour de ${who(msg.player)} —`, player: msg.player };
      case T.NEW_PHASE: return { text: PHASE_NAMES[msg.phase] ?? "", player: -1 };
      case T.SUMMONING: return { text: `${who(msg.controller)} invoque ${name(msg.code)}`, player: msg.controller };
      case T.SPSUMMONING: return { text: `${who(msg.controller)} invoque spécialement ${name(msg.code)}`, player: msg.controller };
      case T.FLIPSUMMONING: return { text: `${who(msg.controller)} invoque par Flip ${name(msg.code)}`, player: msg.controller };
      case T.SET: return { text: `${who(msg.controller)} pose une carte`, player: msg.controller };
      case T.CHAINING: return { text: `${who(msg.controller)} active ${name(msg.code)} (maillon ${msg.chain_size})`, player: msg.controller };
      case T.CHAIN_NEGATED: case T.CHAIN_DISABLED: return { text: `Maillon ${msg.chain_size} annulé`, player: -1 };
      case T.DAMAGE: return { text: `${who(msg.player)} subit ${msg.amount} points de dégâts`, player: msg.player };
      case T.RECOVER: return { text: `${who(msg.player)} gagne ${msg.amount} LP`, player: msg.player };
      case T.PAY_LPCOST: return { text: `${who(msg.player)} paie ${msg.amount} LP`, player: msg.player };
      case T.ATTACK: return { text: `${who(msg.card.controller)} attaque ${msg.target ? "un monstre" : "directement"}`, player: msg.card.controller };
      case T.DRAW: return { text: `${who(msg.player)} pioche ${msg.drawn.length} carte(s)`, player: msg.player };
      case T.MOVE: {
        if (msg.to.location & LOC.GRAVE && msg.from.location & (LOC.MZONE | LOC.SZONE | LOC.HAND))
          return { text: `${name(msg.card)} est envoyé au Cimetière`, player: msg.to.controller };
        if (msg.to.location & LOC.REMOVED) return { text: `${name(msg.card)} est banni`, player: msg.to.controller };
        if (msg.to.location & LOC.HAND && !(msg.from.location & LOC.HAND))
          return { text: `${msg.card ? name(msg.card) : "Une carte"} est ajoutée à la main`, player: msg.to.controller };
        return null;
      }
      case T.TOSS_COIN: return { text: `Pile ou face : ${msg.results.map((r) => (r ? "Pile" : "Face")).join(", ")}`, player: msg.player };
      case T.TOSS_DICE: return { text: `Dé : ${msg.results.join(", ")}`, player: msg.player };
      case T.HINT:
        if (msg.hint_type === 4) return { text: `Choix : ${this.db.desc(msg.hint)}`, player: msg.player };
        return null;
      default: return null;
    }
  }
}

/** Une carte arrive sur le terrain depuis la main, le deck, l'Extra Deck, le Cimetière ou les bannies. */
function isArrival(msg: Extract<OcgMessage, { type: T.MOVE }>) {
  return (msg.to.location & (LOC.MZONE | LOC.SZONE)) !== 0
    && (msg.from.location & (LOC.HAND | LOC.DECK | LOC.EXTRA | LOC.GRAVE | LOC.REMOVED)) !== 0
    && !(msg.to.location & LOC.OVERLAY);
}

const PHASE_BANNERS: [number, string][] = [
  [PHASE.DRAW, "Phase de Pioche"], [PHASE.STANDBY, "Phase de Préparation"], [PHASE.MAIN1, "Phase Principale 1"],
  [PHASE.BATTLE_START, "Phase de Combat"], [PHASE.MAIN2, "Phase Principale 2"], [PHASE.END, "Phase Finale"],
];

function pauseFor(msg: OcgMessage, state: DuelState): number {
  switch (msg.type) {
    case T.NEW_TURN: return 900;
    case T.NEW_PHASE: return msg.phase & (PHASE.DRAW | PHASE.STANDBY) ? 450 : 650;
    case T.SUMMONING: case T.FLIPSUMMONING: return 750;
    case T.SPSUMMONING: return 850;
    case T.CHAINING: return msg.chain_size >= 2 ? 1250 : 950;
    case T.CHAIN_SOLVING: return msg.chain_size === state.chain.length && msg.chain_size >= 2 ? 750 : 350;
    case T.CHAIN_SOLVED: return 200;
    case T.ATTACK: return 750;
    case T.BATTLE: return 350;
    case T.DAMAGE: case T.RECOVER: case T.PAY_LPCOST: return 650;
    case T.MOVE: return isArrival(msg) ? 520 : msg.from.location & (LOC.MZONE | LOC.SZONE) && msg.to.location & (LOC.GRAVE | LOC.REMOVED) ? 450 : 200;
    case T.SET: return 400;
    case T.POS_CHANGE: return 300;
    case T.DRAW: return 300;
    case T.SHUFFLE_HAND: case T.SHUFFLE_DECK: return 200;
    default: return 0;
  }
}
