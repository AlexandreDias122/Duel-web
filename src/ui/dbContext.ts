import { createContext, useContext } from "react";
import type { CardDb } from "../lib/cards";
import type { Banlist } from "../lib/deck";

export const DbContext = createContext<{ db: CardDb; banlists: Banlist[] } | null>(null);

export function useDb(): CardDb {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error("Base de cartes non chargée");
  return ctx.db;
}

export function useBanlists(): Banlist[] {
  return useContext(DbContext)?.banlists ?? [];
}
