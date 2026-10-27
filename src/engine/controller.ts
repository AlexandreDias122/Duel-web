// Côté interface : reçoit les mises à jour du worker, les rejoue à un rythme lisible
// et expose un état observable par React.
import { OcgMessageType as T } from "ocgcore-wasm";
import type { OcgMessage, OcgResponse } from "ocgcore-wasm";
import type { CardDb } from "../lib/cards";
import { LOC, PHASE_NAMES } from "../lib/constants";
import type { DeckList, DuelState, FromWorker, ToWorker } from "./protocol";

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
}

export type DuelMode = "ai" | "solo";

export class DuelController {
  private worker: Worker;
  private listeners = new Set<() => void>();
  private queue: FromWorker[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flashId = 0;
  private promptId = 0;
  view: DuelView = { loading: "Démarrage du moteur…", state: null, prompt: null, log: [], flash: null, end: null, error: null };

  constructor(private db: CardDb, readonly mode: DuelMode, decks: [DeckList, DeckList], readonly human: number) {
    this.worker = new Worker(new URL("./duel.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    this.worker.onerror = (e) => this.set({ error: e.message || "Erreur du moteur" });
    const rand = () => String(Math.floor(Math.random() * 2 ** 31) + 1);
    const ai: [boolean, boolean] = mode === "ai" ? [human !== 0, human !== 1] : [false, false];
    this.send({
      kind: "start",
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
    this.set({ prompt: null });
    this.send({ kind: "respond", response });
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.worker.terminate();
  }

  private send(m: ToWorker) {
    this.worker.postMessage(m);
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
      } else if (m.kind === "end") {
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
    case T.CHAINING: case T.SUMMONING: case T.SPSUMMONING: case T.FLIPSUMMONING: return 650;
    case T.ATTACK: case T.DAMAGE: case T.CHAIN_SOLVED: return 450;
    case T.MOVE: case T.SET: case T.POS_CHANGE: case T.NEW_PHASE: return 250;
    default: return 0;
  }
}
