// Comptes et synchronisation des decks via Supabase.
// Facultatif : sans configuration (cloudConfig.ts), l'appli reste 100 % locale.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Deck } from "./deck";
import { SUPABASE_KEY, SUPABASE_URL } from "./cloudConfig";

export const cloudEnabled = Boolean(SUPABASE_URL && SUPABASE_KEY);

export interface CloudUser {
  id: string;
  email: string;
}

/** Deck tel que stocké dans un compte : une suppression est gardée comme « pierre tombale ». */
export type CloudDeck = Deck & { deleted?: boolean };

let client: Promise<SupabaseClient> | null = null;

/** Client Supabase chargé à la demande (la librairie n'est téléchargée que si les comptes sont activés). */
export function getClient(): Promise<SupabaseClient> {
  if (!cloudEnabled) return Promise.reject(new Error("Comptes non configurés"));
  client ??= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }),
  );
  return client;
}

// ---------- Cache local par compte (pour démarrer et jouer hors ligne) ----------

const USER_KEY = "ygo-web.cloud.user";
const cacheKey = (uid: string) => `ygo-web.cloud.${uid}.decks`;
const dismissKey = (uid: string) => `ygo-web.cloud.${uid}.import-dismissed`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Stockage indisponible : tant pis, le compte reste la référence.
  }
}

export const loadLastUser = () => read<CloudUser | null>(USER_KEY, null);
export const saveLastUser = (u: CloudUser | null) => write(USER_KEY, u);
export const loadCache = (uid: string) => read<CloudDeck[]>(cacheKey(uid), []);
export const saveCache = (uid: string, decks: CloudDeck[]) => write(cacheKey(uid), decks);
export const clearCache = (uid: string) => write(cacheKey(uid), null);
export const loadDismissed = (uid: string) => read<string[]>(dismissKey(uid), []);
export const saveDismissed = (uid: string, ids: string[]) => write(dismissKey(uid), ids);

// ---------- Fusion ----------

/**
 * Fusionne les decks de l'appareil et ceux du compte : pour chaque deck, la version
 * modifiée le plus récemment l'emporte. Renvoie aussi les versions locales à envoyer.
 */
export function mergeDecks(local: CloudDeck[], remote: CloudDeck[]) {
  const remoteById = new Map(remote.map((d) => [d.id, d]));
  const merged = new Map(remote.map((d) => [d.id, d]));
  const toPush: CloudDeck[] = [];
  for (const l of local) {
    const r = remoteById.get(l.id);
    if (!r || l.updated > r.updated) {
      merged.set(l.id, l);
      toPush.push(l);
    }
  }
  return { merged: [...merged.values()], toPush };
}

// ---------- Échanges avec Supabase ----------

interface Row {
  id: string;
  name: string;
  main: number[];
  extra: number[];
  side: number[];
  updated: number;
  deleted: boolean;
}

const fromRow = (r: Row): CloudDeck => ({
  id: r.id, name: r.name, main: (r.main ?? []).map(Number), extra: (r.extra ?? []).map(Number),
  side: (r.side ?? []).map(Number), updated: Number(r.updated), deleted: r.deleted || undefined,
});

export async function fetchRemote(): Promise<CloudDeck[]> {
  const sb = await getClient();
  const { data, error } = await sb.from("decks").select("id,name,main,extra,side,updated,deleted");
  if (error) throw error;
  return (data as Row[]).map(fromRow);
}

export async function pushRemote(uid: string, decks: CloudDeck[]) {
  if (decks.length === 0) return;
  const sb = await getClient();
  const rows = decks.map((d) => ({
    user_id: uid, id: d.id, name: d.name, main: d.main, extra: d.extra, side: d.side, updated: d.updated, deleted: !!d.deleted,
  }));
  const { error } = await sb.from("decks").upsert(rows, { onConflict: "user_id,id" });
  if (error) throw error;
}

/** Messages d'erreur de Supabase traduits pour l'interface. */
export function frenchError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : String(e);
  if (/invalid login credentials/i.test(msg)) return "E-mail ou mot de passe incorrect.";
  if (/already registered|already exists/i.test(msg)) return "Un compte existe déjà avec cet e-mail.";
  if (/email not confirmed/i.test(msg)) return "Confirme d'abord ton adresse e-mail (lien reçu par mail).";
  if (/password.*(at least|least).*(\d+)/i.test(msg)) return `Mot de passe trop court (${msg.match(/(\d+)/)?.[1] ?? 6} caractères minimum).`;
  if (/weak|pwned/i.test(msg)) return "Mot de passe trop faible, choisis-en un autre.";
  if (/invalid.*email|unable to validate email/i.test(msg)) return "Adresse e-mail invalide.";
  if (/rate limit|too many/i.test(msg)) return "Trop de tentatives, réessaie dans quelques minutes.";
  if (/failed to fetch|network|load failed/i.test(msg)) return "Pas de connexion au serveur.";
  return msg;
}
