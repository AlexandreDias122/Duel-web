import { useMemo, useState } from "react";
import { OcgMessageType as T, OcgResponseType as R, cardMatchesOpcode } from "ocgcore-wasm";
import type { OcgMessage, OcgResponse, OcgCardLoc } from "ocgcore-wasm";
import type { Prompt } from "../engine/controller";
import { ATTRIBUTES, POS, RACES } from "../lib/constants";
import { CardImage } from "./CardImage";
import { useDb } from "./dbContext";
import { locationName, sumValid } from "./promptLogic";

interface Props {
  prompt: Prompt;
  respond: (r: OcgResponse) => void;
  inspect: (code: number) => void;
  playerLabel: string;
}

/** Fenêtre de question pour tout ce qui ne se joue pas directement sur le terrain. */
export function PromptPanel({ prompt, respond, inspect, playerLabel }: Props) {
  const [hidden, setHidden] = useState(false);
  const db = useDb();
  const m = prompt.message;
  const body = renderBody(m, respond, inspect, db);
  if (!body) return null;
  const title = prompt.hint || defaultTitle(m);
  if (hidden)
    return (
      <button className="prompt-restore" onClick={() => setHidden(false)}>
        ▲ {title}
      </button>
    );
  return (
    <div className="sheet prompt">
      <div className="sheet-head">
        <div>
          {playerLabel && <span className="tag">{playerLabel}</span>}
          <strong>{title}</strong>
          {prompt.retry && <div className="warn small">Choix refusé par le moteur, réessayez.</div>}
        </div>
        <button className="ghost" onClick={() => setHidden(true)} title="Voir le terrain">▼</button>
      </div>
      {body}
    </div>
  );
}

function defaultTitle(m: OcgMessage): string {
  switch (m.type) {
    case T.SELECT_CHAIN: return "Activer un effet en chaîne ?";
    case T.SELECT_EFFECTYN: return "Activer cet effet ?";
    case T.SELECT_YESNO: return "Confirmer ?";
    case T.SELECT_OPTION: return "Choisissez un effet";
    case T.SELECT_CARD: case T.SELECT_UNSELECT_CARD: return "Sélectionnez des cartes";
    case T.SELECT_TRIBUTE: return "Sélectionnez les monstres à Sacrifier";
    case T.SELECT_SUM: return "Sélectionnez des cartes (somme)";
    case T.SELECT_POSITION: return "Choisissez la position";
    case T.SELECT_PLACE: return "Choisissez une zone";
    case T.SELECT_DISFIELD: return "Choisissez une zone à rendre inutilisable";
    case T.ANNOUNCE_RACE: return "Déclarez un Type";
    case T.ANNOUNCE_ATTRIB: return "Déclarez un Attribut";
    case T.ANNOUNCE_CARD: return "Déclarez un nom de carte";
    case T.ANNOUNCE_NUMBER: return "Déclarez un nombre";
    case T.SELECT_COUNTER: return "Retirez des compteurs";
    case T.ROCK_PAPER_SCISSORS: return "Pierre, feuille, ciseaux";
    default: return "";
  }
}

type Db = ReturnType<typeof useDb>;

function renderBody(m: OcgMessage, respond: (r: OcgResponse) => void, inspect: (c: number) => void, db: Db) {
  switch (m.type) {
    case T.SELECT_CHAIN:
      return (
        <>
          <div className="choice-list">
            {m.selects.map((c, i) => (
              <button key={i} className="choice" onClick={() => respond({ type: R.SELECT_CHAIN, index: i })}>
                <CardImage code={c.code} />
                <span>
                  <b>{db.get(c.code)?.name}</b>
                  <small>{db.desc(c.description) || "Activer l'effet"}</small>
                </span>
              </button>
            ))}
          </div>
          {!m.forced && <div className="sheet-actions"><button onClick={() => respond({ type: R.SELECT_CHAIN, index: null })}>Ne pas enchaîner</button></div>}
        </>
      );
    case T.SELECT_EFFECTYN:
    case T.SELECT_YESNO: {
      const code = m.type === T.SELECT_EFFECTYN ? m.code : 0;
      const yes = (v: boolean): OcgResponse => (m.type === T.SELECT_EFFECTYN ? { type: R.SELECT_EFFECTYN, yes: v } : { type: R.SELECT_YESNO, yes: v });
      return (
        <>
          <div className="yn">
            {code > 0 && <CardImage code={code} onClick={() => inspect(code)} />}
            <p>{code > 0 && <b>{db.get(code)?.name}<br /></b>}{db.desc(m.description) || (code > 0 ? "Utiliser cet effet ?" : "")}</p>
          </div>
          <div className="sheet-actions">
            <button className="primary" onClick={() => respond(yes(true))}>Oui</button>
            <button onClick={() => respond(yes(false))}>Non</button>
          </div>
        </>
      );
    }
    case T.SELECT_OPTION:
      return (
        <div className="option-list">
          {m.options.map((o, i) => (
            <button key={i} onClick={() => respond({ type: R.SELECT_OPTION, index: i })}>{db.desc(o) || `Option ${i + 1}`}</button>
          ))}
        </div>
      );
    case T.SELECT_CARD:
    case T.SELECT_TRIBUTE:
      return <MultiSelect key={JSON.stringify(m.selects.map((c) => [c.code, c.location, c.sequence]))} m={m} respond={respond} inspect={inspect} />;
    case T.SELECT_UNSELECT_CARD:
      return (
        <>
          <div className="pick-grid">
            {m.select_cards.map((c, i) => (
              <CardTile key={`s${i}`} c={c} onClick={() => respond({ type: R.SELECT_UNSELECT_CARD, index: i })} onInspect={inspect} />
            ))}
            {m.unselect_cards.map((c, i) => (
              <CardTile key={`u${i}`} c={c} selected onClick={() => respond({ type: R.SELECT_UNSELECT_CARD, index: m.select_cards.length + i })} onInspect={inspect} />
            ))}
          </div>
          {(m.can_finish || m.can_cancel) && (
            <div className="sheet-actions">
              {m.can_finish && <button className="primary" onClick={() => respond({ type: R.SELECT_UNSELECT_CARD, index: null })}>Terminer</button>}
              {m.can_cancel && !m.can_finish && <button onClick={() => respond({ type: R.SELECT_UNSELECT_CARD, index: null })}>Annuler</button>}
            </div>
          )}
        </>
      );
    case T.SELECT_SUM:
      return <SumSelect m={m} respond={respond} inspect={inspect} />;
    case T.SELECT_POSITION: {
      const options = [POS.FACEUP_ATTACK, POS.FACEDOWN_ATTACK, POS.FACEUP_DEFENSE, POS.FACEDOWN_DEFENSE].filter((p) => m.positions & p);
      const label = { [POS.FACEUP_ATTACK]: "Attaque", [POS.FACEDOWN_ATTACK]: "Attaque face cachée", [POS.FACEUP_DEFENSE]: "Défense", [POS.FACEDOWN_DEFENSE]: "Défense face cachée" } as Record<number, string>;
      return (
        <div className="position-list">
          {options.map((p) => (
            <button key={p} onClick={() => respond({ type: R.SELECT_POSITION, position: p })}>
              <div className={`pos-preview ${p & POS.DEFENSE ? "def" : ""}`}><CardImage code={m.code} back={(p & POS.FACEDOWN) !== 0} /></div>
              {label[p]}
            </button>
          ))}
        </div>
      );
    }
    case T.ANNOUNCE_RACE:
    case T.ANNOUNCE_ATTRIB:
      return <FlagAnnounce m={m} respond={respond} />;
    case T.ANNOUNCE_NUMBER:
      return (
        <div className="option-list">
          {m.options.map((o, i) => <button key={i} onClick={() => respond({ type: R.ANNOUNCE_NUMBER, value: i })}>{String(o)}</button>)}
        </div>
      );
    case T.ANNOUNCE_CARD:
      return <CardAnnounce m={m} respond={respond} />;
    case T.SELECT_COUNTER:
      return <CounterSelect m={m} respond={respond} />;
    case T.ROCK_PAPER_SCISSORS:
      return (
        <div className="sheet-actions">
          {(["Ciseaux", "Pierre", "Feuille"] as const).map((n, i) => (
            <button key={n} onClick={() => respond({ type: R.ROCK_PAPER_SCISSORS, value: (i + 1) as 1 | 2 | 3 })}>{n}</button>
          ))}
        </div>
      );
    default:
      return null;
  }
}

function CardTile({ c, selected, onClick, onInspect }: { c: OcgCardLoc; selected?: boolean; onClick: () => void; onInspect: (code: number) => void }) {
  const db = useDb();
  return (
    <div className={`pick ${selected ? "picked" : ""}`}>
      <button className="pick-card" onClick={onClick}>
        <CardImage code={c.code} />
        {selected && <span className="pick-check">✓</span>}
      </button>
      <button className="pick-info" onClick={() => c.code && onInspect(c.code)}>
        <span className="pick-name">{db.get(c.code)?.name ?? "Face cachée"}</span>
        <span className="pick-loc">{locationName(c.location)}{c.controller !== undefined ? "" : ""}</span>
      </button>
    </div>
  );
}

function MultiSelect({ m, respond, inspect }: {
  m: Extract<OcgMessage, { type: T.SELECT_CARD | T.SELECT_TRIBUTE }>; respond: (r: OcgResponse) => void; inspect: (c: number) => void;
}) {
  const [chosen, setChosen] = useState<number[]>([]);
  const weight = (i: number) => (m.type === T.SELECT_TRIBUTE ? Math.max(1, m.selects[i].release_param & 0xff || 1) : 1);
  const total = chosen.reduce((a, i) => a + weight(i), 0);
  const ok = m.type === T.SELECT_TRIBUTE ? total >= m.min && chosen.length <= m.max : chosen.length >= m.min && chosen.length <= m.max;
  const send = (list: number[] | null) =>
    respond(m.type === T.SELECT_CARD ? { type: R.SELECT_CARD, indicies: list } : { type: R.SELECT_TRIBUTE, indicies: list });
  const toggle = (i: number) => {
    if (chosen.includes(i)) return setChosen(chosen.filter((x) => x !== i));
    // Sélection unique : on valide directement.
    if (m.max === 1 && m.min === 1 && m.type === T.SELECT_CARD) return send([i]);
    if (chosen.length < m.max) setChosen([...chosen, i]);
  };
  return (
    <>
      <div className="pick-grid">
        {m.selects.map((c, i) => <CardTile key={i} c={c} selected={chosen.includes(i)} onClick={() => toggle(i)} onInspect={inspect} />)}
      </div>
      <div className="sheet-actions">
        <span className="muted small">{chosen.length} / {m.min === m.max ? m.min : `${m.min}–${m.max}`}</span>
        <button className="primary" disabled={!ok} onClick={() => send(chosen)}>Valider</button>
        {m.can_cancel && <button onClick={() => send(null)}>Annuler</button>}
      </div>
    </>
  );
}

function SumSelect({ m, respond, inspect }: { m: Extract<OcgMessage, { type: T.SELECT_SUM }>; respond: (r: OcgResponse) => void; inspect: (c: number) => void }) {
  const [chosen, setChosen] = useState<number[]>([]);
  const ok = sumValid(m, chosen);
  const value = (a: number) => a & 0xffff;
  const sum = [...m.selects_must.map((c) => value(c.amount)), ...chosen.map((i) => value(m.selects[i].amount))].reduce((a, b) => a + b, 0);
  return (
    <>
      <div className="pick-grid">
        {m.selects_must.map((c, i) => <CardTile key={`m${i}`} c={c} selected onClick={() => {}} onInspect={inspect} />)}
        {m.selects.map((c, i) => (
          <CardTile key={i} c={c} selected={chosen.includes(i)} onClick={() => setChosen(chosen.includes(i) ? chosen.filter((x) => x !== i) : [...chosen, i])} onInspect={inspect} />
        ))}
      </div>
      <div className="sheet-actions">
        <span className="muted small">Total {sum} / {m.amount}</span>
        <button className="primary" disabled={!ok} onClick={() => respond({ type: R.SELECT_SUM, indicies: chosen })}>Valider</button>
      </div>
    </>
  );
}

function FlagAnnounce({ m, respond }: { m: Extract<OcgMessage, { type: T.ANNOUNCE_RACE | T.ANNOUNCE_ATTRIB }>; respond: (r: OcgResponse) => void }) {
  const [chosen, setChosen] = useState<number[]>([]);
  const table = m.type === T.ANNOUNCE_RACE ? RACES : ATTRIBUTES;
  const avail = BigInt(m.available);
  const options = table.filter(([f]) => avail & BigInt(f));
  const send = (list: number[]) =>
    respond(m.type === T.ANNOUNCE_RACE
      ? { type: R.ANNOUNCE_RACE, races: list.map(BigInt) as never }
      : { type: R.ANNOUNCE_ATTRIB, attributes: list as never });
  return (
    <>
      <div className="chip-list">
        {options.map(([f, n]) => (
          <button key={f} className={`chip ${chosen.includes(f) ? "on" : ""}`}
            onClick={() => setChosen(chosen.includes(f) ? chosen.filter((x) => x !== f) : chosen.length < m.count ? [...chosen, f] : chosen)}>{n}</button>
        ))}
      </div>
      <div className="sheet-actions">
        <button className="primary" disabled={chosen.length !== m.count} onClick={() => send(chosen)}>Valider</button>
      </div>
    </>
  );
}

function CardAnnounce({ m, respond }: { m: Extract<OcgMessage, { type: T.ANNOUNCE_CARD }>; respond: (r: OcgResponse) => void }) {
  const db = useDb();
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (query.length < 2) return [];
    const out = [];
    for (const c of db.searchable) {
      if (!c.name.toLowerCase().includes(query)) continue;
      const data = {
        code: c.id, alias: c.alias, setcodes: [], type: c.type, level: c.level, attribute: c.attribute, race: BigInt(c.race),
        attack: c.atk, defense: c.def, lscale: c.lscale, rscale: c.rscale, link_marker: c.linkMarker,
      };
      if (m.opcodes.length && !cardMatchesOpcode(data, m.opcodes)) continue;
      out.push(c);
      if (out.length >= 30) break;
    }
    return out;
  }, [q, db, m.opcodes]);
  return (
    <>
      <input className="search" autoFocus placeholder="Nom de la carte (en anglais)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="option-list">
        {results.map((c) => <button key={c.id} onClick={() => respond({ type: R.ANNOUNCE_CARD, card: c.id })}>{c.name}</button>)}
      </div>
    </>
  );
}

function CounterSelect({ m, respond }: { m: Extract<OcgMessage, { type: T.SELECT_COUNTER }>; respond: (r: OcgResponse) => void }) {
  const db = useDb();
  const [counts, setCounts] = useState(() => m.cards.map(() => 0));
  const total = counts.reduce((a, b) => a + b, 0);
  return (
    <>
      <div className="option-list">
        {m.cards.map((c, i) => (
          <div key={i} className="counter-row">
            <span>{db.get(c.code)?.name} ({c.count})</span>
            <button onClick={() => setCounts(counts.map((v, j) => (j === i ? Math.max(0, v - 1) : v)))}>−</button>
            <b>{counts[i]}</b>
            <button onClick={() => setCounts(counts.map((v, j) => (j === i && v < c.count && total < m.count ? v + 1 : v)))}>+</button>
          </div>
        ))}
      </div>
      <div className="sheet-actions">
        <span className="muted small">{total} / {m.count}</span>
        <button className="primary" disabled={total !== m.count} onClick={() => respond({ type: R.SELECT_COUNTER, counters: counts })}>Valider</button>
      </div>
    </>
  );
}
