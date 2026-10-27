import { useEffect, useMemo, useRef, useState } from "react";
import type { Card } from "../lib/cards";
import { isExtra, isMonster } from "../lib/cards";
import { ATTRIBUTES, RACES, TYPE } from "../lib/constants";
import type { Banlist, Deck } from "../lib/deck";
import { limitOf, toYdk, toYdke, validateDeck } from "../lib/deck";
import { CardDetail } from "../ui/CardDetail";
import { CardImage } from "../ui/CardImage";
import { useBanlists, useDb } from "../ui/dbContext";

interface Props {
  deck: Deck;
  onChange: (d: Deck) => void;
  onBack: () => void;
}

type Section = "main" | "extra" | "side";

interface Filters {
  text: string;
  inDesc: boolean;
  kind: "" | "monster" | "spell" | "trap" | "extra";
  attribute: number;
  race: number;
  levelMin: string;
  levelMax: string;
  atkMin: string;
  atkMax: string;
  region: "" | "tcg" | "ocg";
  limit: "" | "0" | "1" | "2";
  sort: "name" | "atk" | "def" | "level";
}

const EMPTY: Filters = {
  text: "", inDesc: false, kind: "", attribute: 0, race: 0, levelMin: "", levelMax: "", atkMin: "", atkMax: "",
  region: "", limit: "", sort: "name",
};

const PAGE = 90;

export function DeckEditor({ deck, onChange, onBack }: Props) {
  const db = useDb();
  const banlists = useBanlists();
  const [banlistName, setBanlistName] = useState(() => banlists[0]?.name ?? "");
  const banlist: Banlist | null = banlists.find((b) => b.name === banlistName) ?? null;
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [showFilters, setShowFilters] = useState(false);
  const [detail, setDetail] = useState<{ id: number; from?: Section; index?: number } | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState("");
  const sentinel = useRef<HTMLDivElement>(null);

  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const id of [...deck.main, ...deck.extra, ...deck.side]) m.set(db.baseId(id), (m.get(db.baseId(id)) ?? 0) + 1);
    return m;
  }, [deck, db]);

  const results = useMemo(() => filterCards(db.searchable, filters, (c) => limitOf(db, c.id, banlist)), [db, filters, banlist]);
  useEffect(() => setLimit(PAGE), [filters]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setLimit((l) => l + PAGE));
    io.observe(el);
    return () => io.disconnect();
  }, [results]);

  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(""), 1600);
  };

  const add = (id: number, side = false) => {
    const card = db.get(id)!;
    const n = counts.get(db.baseId(id)) ?? 0;
    const lim = limitOf(db, id, banlist);
    if (n >= lim) return flash(lim === 0 ? "Carte interdite" : `Maximum ${lim} exemplaire(s)`);
    const section: Section = side ? "side" : isExtra(card) ? "extra" : "main";
    const max = section === "main" ? 60 : 15;
    if (deck[section].length >= max) return flash(`${sectionName(section)} plein`);
    onChange({ ...deck, [section]: sortSection(db, [...deck[section], id]), updated: Date.now() });
  };

  const remove = (section: Section, index: number) => {
    const list = [...deck[section]];
    list.splice(index, 1);
    onChange({ ...deck, [section]: list, updated: Date.now() });
  };

  const moveToSide = (section: Section, index: number) => {
    const id = deck[section][index];
    const list = [...deck[section]];
    list.splice(index, 1);
    if (section === "side") {
      const card = db.get(id)!;
      const target: Section = isExtra(card) ? "extra" : "main";
      onChange({ ...deck, side: list, [target]: sortSection(db, [...deck[target], id]), updated: Date.now() });
    } else {
      onChange({ ...deck, [section]: list, side: [...deck.side, id], updated: Date.now() });
    }
  };

  const errors = validateDeck(db, deck, banlist);
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });

  const exportYdk = () => {
    const blob = new Blob([toYdk(deck)], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${deck.name}.ydk`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const copyYdke = async () => {
    try {
      await navigator.clipboard.writeText(toYdke(deck));
      flash("Lien YDKE copié");
    } catch {
      prompt("Copiez ce lien :", toYdke(deck));
    }
  };

  return (
    <div className="editor">
      <header className="editor-head">
        <button className="ghost" onClick={onBack}>‹</button>
        <input className="deck-name" value={deck.name} onChange={(e) => onChange({ ...deck, name: e.target.value, updated: Date.now() })} />
        <span className={`count ${errors.length ? "bad" : "good"}`} title={errors.join("\n")}>
          {deck.main.length}/{deck.extra.length}/{deck.side.length}
        </span>
        <button className="ghost" onClick={() => setMenu(!menu)}>⋯</button>
        {menu && (
          <div className="menu" onClick={() => setMenu(false)}>
            <button onClick={exportYdk}>Exporter en .ydk</button>
            <button onClick={copyYdke}>Copier le lien YDKE</button>
            <button onClick={() => confirm("Vider le deck ?") && onChange({ ...deck, main: [], extra: [], side: [], updated: Date.now() })}>Vider le deck</button>
            <label className="menu-row" onClick={(e) => e.stopPropagation()}>
              Banlist
              <select value={banlistName} onChange={(e) => setBanlistName(e.target.value)}>
                {banlists.map((b) => <option key={b.name}>{b.name}</option>)}
                <option value="">Aucune</option>
              </select>
            </label>
          </div>
        )}
      </header>

      <div className="editor-deck">
        {(["main", "extra", "side"] as Section[]).map((section) => (
          <div key={section} className="deck-section">
            <div className="deck-section-head">{sectionName(section)} <b>{deck[section].length}</b></div>
            <div className="deck-grid">
              {deck[section].map((id, i) => (
                <div key={`${id}-${i}`} className="deck-card" onClick={() => setDetail({ id, from: section, index: i })}>
                  <CardImage code={id} />
                  <LimitBadge n={limitOf(db, id, banlist)} />
                </div>
              ))}
            </div>
          </div>
        ))}
        {errors.length > 0 && <div className="deck-errors">{errors.slice(0, 3).map((e) => <div key={e}>⚠ {e}</div>)}</div>}
      </div>

      <div className="editor-search">
        <div className="search-row">
          <input className="search" placeholder={filters.inDesc ? "Rechercher dans le nom ou le texte" : "Rechercher une carte"}
            value={filters.text} onChange={(e) => set({ text: e.target.value })} />
          <button className={`ghost ${showFilters ? "on" : ""}`} onClick={() => setShowFilters(!showFilters)}>Filtres</button>
        </div>
        {showFilters && (
          <div className="filters">
            <select value={filters.kind} onChange={(e) => set({ kind: e.target.value as Filters["kind"] })}>
              <option value="">Tous types</option><option value="monster">Monstres</option><option value="extra">Extra Deck</option>
              <option value="spell">Magies</option><option value="trap">Pièges</option>
            </select>
            <select value={filters.attribute} onChange={(e) => set({ attribute: Number(e.target.value) })}>
              <option value={0}>Attribut</option>{ATTRIBUTES.map(([f, n]) => <option key={f} value={f}>{n}</option>)}
            </select>
            <select value={filters.race} onChange={(e) => set({ race: Number(e.target.value) })}>
              <option value={0}>Type</option>{RACES.map(([f, n]) => <option key={f} value={f}>{n}</option>)}
            </select>
            <input inputMode="numeric" placeholder="Niv. min" value={filters.levelMin} onChange={(e) => set({ levelMin: e.target.value })} />
            <input inputMode="numeric" placeholder="Niv. max" value={filters.levelMax} onChange={(e) => set({ levelMax: e.target.value })} />
            <input inputMode="numeric" placeholder="ATK min" value={filters.atkMin} onChange={(e) => set({ atkMin: e.target.value })} />
            <input inputMode="numeric" placeholder="ATK max" value={filters.atkMax} onChange={(e) => set({ atkMax: e.target.value })} />
            <select value={filters.region} onChange={(e) => set({ region: e.target.value as Filters["region"] })}>
              <option value="">TCG + OCG</option><option value="tcg">TCG</option><option value="ocg">OCG</option>
            </select>
            <select value={filters.limit} onChange={(e) => set({ limit: e.target.value as Filters["limit"] })}>
              <option value="">Statut banlist</option><option value="0">Interdites</option><option value="1">Limitées</option><option value="2">Semi-limitées</option>
            </select>
            <select value={filters.sort} onChange={(e) => set({ sort: e.target.value as Filters["sort"] })}>
              <option value="name">Tri : nom</option><option value="atk">Tri : ATK</option><option value="def">Tri : DEF</option><option value="level">Tri : niveau</option>
            </select>
            <label className="check"><input type="checkbox" checked={filters.inDesc} onChange={(e) => set({ inDesc: e.target.checked })} /> Chercher dans le texte</label>
            <button className="ghost" onClick={() => setFilters(EMPTY)}>Réinitialiser</button>
          </div>
        )}
        <div className="muted small result-count">{results.length} carte(s)</div>
        <div className="result-grid">
          {results.slice(0, limit).map((c) => (
            <div key={c.id} className="result-card">
              <div onClick={() => setDetail({ id: c.id })}>
                <CardImage code={c.id} />
                <LimitBadge n={limitOf(db, c.id, banlist)} />
                {(counts.get(c.id) ?? 0) > 0 && <span className="in-deck">×{counts.get(c.id)}</span>}
              </div>
              <button className="quick-add" onClick={() => add(c.id)} aria-label="Ajouter">+</button>
            </div>
          ))}
          <div ref={sentinel} className="sentinel" />
        </div>
      </div>

      {detail && (
        <div className="sheet-backdrop" onClick={() => setDetail(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <span className="muted small">Dans le deck : {counts.get(db.baseId(detail.id)) ?? 0} / {limitOf(db, detail.id, banlist)}</span>
              <button className="ghost" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div className="action-list">
              <button className="primary" onClick={() => add(detail.id)}>+ {isExtra(db.get(detail.id)!) ? "Extra Deck" : "Main Deck"}</button>
              <button onClick={() => add(detail.id, true)}>+ Side</button>
              {detail.from && detail.index !== undefined && (
                <>
                  <button onClick={() => { remove(detail.from!, detail.index!); setDetail(null); }}>Retirer</button>
                  <button onClick={() => { moveToSide(detail.from!, detail.index!); setDetail(null); }}>
                    {detail.from === "side" ? "Vers Main/Extra" : "Vers le Side"}
                  </button>
                </>
              )}
            </div>
            <CardDetail code={detail.id} />
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function LimitBadge({ n }: { n: number }) {
  if (n >= 3) return null;
  return <span className={`limit limit-${n}`}>{n === 0 ? "⊘" : n}</span>;
}

function sectionName(s: Section) {
  return s === "main" ? "Main Deck" : s === "extra" ? "Extra Deck" : "Side Deck";
}

/** Tri façon Master Duel : monstres, magies, pièges, puis par nom. */
function sortSection(db: ReturnType<typeof useDb>, list: number[]): number[] {
  const rank = (c: Card) => (c.type & TYPE.MONSTER ? 0 : c.type & TYPE.SPELL ? 1 : 2);
  return [...list].sort((a, b) => {
    const ca = db.get(a)!, cb = db.get(b)!;
    return rank(ca) - rank(cb) || (ca.type & TYPE.MONSTER ? cb.level - ca.level : 0) || ca.name.localeCompare(cb.name) || a - b;
  });
}

function filterCards(cards: Card[], f: Filters, limit: (c: Card) => number): Card[] {
  const text = f.text.trim().toLowerCase();
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const [lmin, lmax, amin, amax] = [num(f.levelMin), num(f.levelMax), num(f.atkMin), num(f.atkMax)];
  const out = cards.filter((c) => {
    if (text && !c.name.toLowerCase().includes(text) && !(f.inDesc && c.desc.toLowerCase().includes(text))) return false;
    if (f.kind === "monster" && !isMonster(c)) return false;
    if (f.kind === "extra" && !isExtra(c)) return false;
    if (f.kind === "spell" && !(c.type & TYPE.SPELL)) return false;
    if (f.kind === "trap" && !(c.type & TYPE.TRAP)) return false;
    if (f.attribute && !(c.attribute & f.attribute)) return false;
    if (f.race && !(c.race & f.race)) return false;
    if ((lmin !== null || lmax !== null || amin !== null || amax !== null) && !isMonster(c)) return false;
    if (lmin !== null && c.level < lmin) return false;
    if (lmax !== null && c.level > lmax) return false;
    if (amin !== null && c.atk < amin) return false;
    if (amax !== null && c.atk > amax) return false;
    if (f.region === "tcg" && !(c.ot & 0x2)) return false;
    if (f.region === "ocg" && !(c.ot & 0x1)) return false;
    if (f.limit && limit(c) !== Number(f.limit)) return false;
    return true;
  });
  if (f.sort === "atk") out.sort((a, b) => b.atk - a.atk);
  else if (f.sort === "def") out.sort((a, b) => b.def - a.def);
  else if (f.sort === "level") out.sort((a, b) => b.level - a.level);
  else if (text) {
    // Les correspondances en début de nom d'abord.
    out.sort((a, b) => Number(!a.name.toLowerCase().startsWith(text)) - Number(!b.name.toLowerCase().startsWith(text)));
  }
  return out;
}
