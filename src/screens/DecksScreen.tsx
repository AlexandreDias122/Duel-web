import { useRef, useState } from "react";
import type { Deck } from "../lib/deck";
import { newId, parseYdk, parseYdke } from "../lib/deck";
import { CardImage } from "../ui/CardImage";
import { useDb } from "../ui/dbContext";

export interface StarterDeck {
  name: string;
  ydk: string;
}

interface Props {
  decks: Deck[];
  starters: StarterDeck[];
  onOpen: (id: string) => void;
  onSave: (d: Deck) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}

export function DecksScreen({ decks, starters, onOpen, onSave, onDelete, onBack }: Props) {
  const db = useDb();
  const file = useRef<HTMLInputElement>(null);
  const [ydke, setYdke] = useState("");

  const create = (name: string, lists = { main: [] as number[], extra: [] as number[], side: [] as number[] }) => {
    const known = (l: number[]) => l.filter((id) => db.get(id));
    const deck: Deck = { id: newId(), name, main: known(lists.main), extra: known(lists.extra), side: known(lists.side), updated: Date.now() };
    onSave(deck);
    return deck;
  };

  const importFile = async (f: File) => {
    const text = await f.text();
    onOpen(create(f.name.replace(/\.ydk$/i, ""), parseYdk(text)).id);
  };

  const importYdke = () => {
    const lists = parseYdke(ydke);
    if (!lists) return alert("Lien YDKE invalide");
    setYdke("");
    onOpen(create("Deck importé", lists).id);
  };

  const cover = (d: { main: number[]; extra: number[] }) => d.extra[0] ?? d.main[0] ?? 0;
  const sorted = [...decks].sort((a, b) => b.updated - a.updated);

  return (
    <div className="screen">
      <header className="screen-head">
        <button className="ghost" onClick={onBack}>‹</button>
        <h2>Mes decks</h2>
      </header>
      <div className="row-actions">
        <button className="primary" onClick={() => onOpen(create("Nouveau deck").id)}>+ Nouveau deck</button>
        <button onClick={() => file.current?.click()}>Importer un .ydk</button>
        <input ref={file} type="file" accept=".ydk,text/plain" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
      </div>
      <div className="row-actions">
        <input className="search" placeholder="Coller un lien ydke://…" value={ydke} onChange={(e) => setYdke(e.target.value)} />
        <button disabled={!ydke} onClick={importYdke}>Importer</button>
      </div>

      <div className="deck-list">
        {sorted.map((d) => (
          <div key={d.id} className="deck-tile" onClick={() => onOpen(d.id)}>
            <CardImage code={cover(d)} />
            <div>
              <b>{d.name}</b>
              <span className="muted small">{d.main.length} · {d.extra.length} · {d.side.length}</span>
            </div>
            <button className="ghost" onClick={(e) => { e.stopPropagation(); if (confirm(`Supprimer « ${d.name} » ?`)) onDelete(d.id); }}>🗑</button>
          </div>
        ))}
        {sorted.length === 0 && <p className="muted">Aucun deck pour l'instant. Créez-en un ou copiez un deck de démarrage.</p>}
      </div>

      <h3>Decks de démarrage</h3>
      <div className="deck-list">
        {starters.map((s) => {
          const lists = parseYdk(s.ydk);
          return (
            <div key={s.name} className="deck-tile" onClick={() => onOpen(create(s.name, lists).id)}>
              <CardImage code={cover(lists)} />
              <div>
                <b>{s.name}</b>
                <span className="muted small">Copier dans mes decks</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
