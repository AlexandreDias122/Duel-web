// Côté interface : reçoit les mises à jour du worker, les rejoue à un rythme lisible
// et expose un état observable par React.
import { OcgMessageType as T } from "ocgcore-wasm";
import type { OcgMessage, OcgResponse } from "ocgcore-wasm";
import type { CardDb } from "../lib/cards";
import { LOC, PHASE_NAMES } from "../lib/constants";
import type { DeckList, DuelState, FromWorker, FromWorkerTagged, ToWorker } from "./protocol";

export interface Prompt {
  id: number;
  message: OcgMessage;
  hint: string;
  retry: boolean;
}

export interface Flash {
  id: number;
  code: number;
  player: number;
  text: string;
}

export interface DuelView {
  loading: string | null;
  state: DuelState | null;
  prompt: Prompt | null;
  log: { text: string; player: number }[];
  flash: Flash | null;
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
  private queue: FromWorker[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flashId = 0;
  private promptId = 0;
  view: DuelView = { loading: "Démarrage du moteur…", state: null, prompt: null, log: [], flash: null, end: null, error: null, clock: null };

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

  /** Rejoue la file : les messages marquants (invocation, chaîne, dégâts) laissent le temps de voir. */
  private drain() {
    this.timer = null;
    while (this.queue.length) {
      const m = this.queue.shift()!;
      if (m.kind === "update") {
        const log = [...this.view.log];
        let flash: Flash | null = null;
        let pause = 0;
        for (const msg of m.messages) {
          const line = this.describe(msg);
          if (line) log.push(line);
          const f = this.flashFor(msg);
          if (f) flash = f;
          pause = Math.max(pause, pauseFor(msg));
        }
        this.set({ state: m.state, loading: null, log: log.slice(-200), ...(flash ? { flash } : {}) });
        if (pause && this.queue.length) {
          this.timer = setTimeout(() => this.drain(), pause);
          return;
        }
      } else if (m.kind === "prompt") {
        this.set({ prompt: { id: ++this.promptId, message: m.message, hint: m.hint, retry: m.retry } });
        this.startClock();
      } else if (m.kind === "end") {
        this.stopClock();
        this.set({ end: { winner: m.winner, reason: m.reason }, prompt: null });
      }
    }
  }

  private flashFor(msg: OcgMessage): Flash | null {
    const make = (code: number, player: number, text: string) => ({ id: ++this.flashId, code, player, text });
    switch (msg.type) {
      case T.CHAINING: return make(msg.code, msg.controller, `Maillon ${msg.chain_size}`);
      case T.SUMMONING: return make(msg.code, msg.controller, "Invocation Normale");
      case T.SPSUMMONING: return make(msg.code, msg.controller, "Invocation Spéciale");
      case T.FLIPSUMMONING: return make(msg.code, msg.controller, "Invocation Flip");
      default: return null;
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

function pauseFor(msg: OcgMessage): number {
  switch (msg.type) {
    case T.CHAINING: case T.SUMMONING: case T.SPSUMMONING: case T.FLIPSUMMONING: return 500;
    case T.ATTACK: case T.DAMAGE: case T.CHAIN_SOLVED: return 300;
    case T.MOVE: case T.SET: case T.POS_CHANGE: return 140;
    default: return 0;
  }
}
