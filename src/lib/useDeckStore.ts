// Decks de l'appli : en local (invité) ou dans un compte, synchronisés entre appareils.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Deck } from "./deck";
import { loadDecks, saveDecks } from "./deck";
import type { CloudDeck, CloudUser } from "./cloud";
import {
  clearCache, cloudEnabled, fetchRemote, frenchError, getClient, loadCache, loadDismissed, loadLastUser, mergeDecks,
  pushRemote, saveCache, saveDismissed, saveLastUser,
} from "./cloud";

export type SyncStatus = "local" | "syncing" | "synced" | "offline" | "error";

const appUrl = () => location.origin + location.pathname;

export function useDeckStore() {
  const [user, setUser] = useState<CloudUser | null>(() => (cloudEnabled ? loadLastUser() : null));
  const [records, setRecords] = useState<CloudDeck[]>(() => {
    const u = cloudEnabled ? loadLastUser() : null;
    return u ? loadCache(u.id) : loadDecks();
  });
  const [status, setStatus] = useState<SyncStatus>(user ? "offline" : "local");
  const [error, setError] = useState("");
  const [lastSync, setLastSync] = useState(0);
  const [dismissed, setDismissed] = useState<string[]>(() => (user ? loadDismissed(user.id) : []));
  const [recovery, setRecovery] = useState(false);

  const userRef = useRef(user);
  const recRef = useRef(records);
  const syncing = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const timer = useRef(0);

  const commit = useCallback((uid: string | null, next: CloudDeck[]) => {
    recRef.current = next;
    setRecords(next);
    if (uid) saveCache(uid, next);
    else saveDecks(next);
  }, []);

  const sync = useCallback((): Promise<void> => {
    if (syncing.current) {
      again.current = true;
      return syncing.current;
    }
    const run = async () => {
      do {
        again.current = false;
        const u = userRef.current;
        if (!u) return;
        setStatus("syncing");
        try {
          const remote = await fetchRemote();
          if (userRef.current?.id !== u.id) return;
          const { merged, toPush } = mergeDecks(recRef.current, remote);
          await pushRemote(u.id, toPush);
          if (userRef.current?.id !== u.id) return;
          // Les modifications faites pendant l'échange restent prioritaires et repartiront au tour suivant.
          const after = mergeDecks(recRef.current, merged);
          commit(u.id, after.merged);
          if (after.toPush.length) again.current = true;
          setStatus("synced");
          setLastSync(Date.now());
          setError("");
        } catch (e) {
          setStatus(navigator.onLine ? "error" : "offline");
          setError(frenchError(e));
          return;
        }
      } while (again.current);
    };
    syncing.current = run().finally(() => {
      syncing.current = null;
    });
    return syncing.current;
  }, [commit]);

  const scheduleSync = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void sync(), 1200);
  }, [sync]);

  const switchUser = useCallback((u: CloudUser | null) => {
    userRef.current = u;
    setUser(u);
    saveLastUser(u);
    setDismissed(u ? loadDismissed(u.id) : []);
    setStatus(u ? "syncing" : "local");
    setError("");
    commit(u?.id ?? null, u ? loadCache(u.id) : loadDecks());
    if (u) void sync();
  }, [commit, sync]);

  // Session Supabase : connexion, déconnexion, lien de réinitialisation du mot de passe.
  useEffect(() => {
    if (!cloudEnabled) return;
    let alive = true;
    let unsubscribe = () => {};
    getClient()
      .then((sb) => {
        if (!alive) return;
        const { data } = sb.auth.onAuthStateChange((event, session) => {
          // Pas d'appel Supabase directement dans ce rappel (verrou interne) : on diffère.
          setTimeout(() => {
            if (event === "PASSWORD_RECOVERY") setRecovery(true);
            const su = session?.user;
            if (!su) {
              const loggedOut = event === "SIGNED_OUT" || (event === "INITIAL_SESSION" && navigator.onLine);
              if (loggedOut && userRef.current) switchUser(null);
              return;
            }
            const next = { id: su.id, email: su.email ?? "" };
            if (userRef.current?.id !== next.id) switchUser(next);
            else if (event === "INITIAL_SESSION" || event === "SIGNED_IN") void sync();
          }, 0);
        });
        unsubscribe = () => data.subscription.unsubscribe();
      })
      .catch((e) => {
        setStatus(userRef.current ? "offline" : "local");
        setError(frenchError(e));
      });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [switchUser, sync]);

  // Retour sur l'appli ou retour du réseau : on récupère ce qui a changé ailleurs.
  useEffect(() => {
    const refresh = () => {
      if (userRef.current && document.visibilityState === "visible") void sync();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [sync]);

  const saveDeck = useCallback((d: Deck) => {
    const cur = recRef.current;
    const next = cur.some((x) => x.id === d.id) ? cur.map((x) => (x.id === d.id ? d : x)) : [...cur, d];
    commit(userRef.current?.id ?? null, next);
    if (userRef.current) scheduleSync();
  }, [commit, scheduleSync]);

  const deleteDeck = useCallback((id: string) => {
    const u = userRef.current;
    const cur = recRef.current;
    // Dans un compte, la suppression est gardée pour être propagée aux autres appareils.
    const next = u ? cur.map((x) => (x.id === id ? { ...x, deleted: true, updated: Date.now() } : x)) : cur.filter((x) => x.id !== id);
    commit(u?.id ?? null, next);
    if (u) scheduleSync();
  }, [commit, scheduleSync]);

  const decks = useMemo(() => records.filter((d) => !d.deleted) as Deck[], [records]);

  // Decks créés sur cet appareil sans compte, proposés à l'import une fois connecté.
  const localDecks = useMemo(() => {
    if (!user) return [];
    const known = new Set(records.map((d) => d.id));
    return loadDecks().filter((d) => !known.has(d.id) && !dismissed.includes(d.id));
  }, [user, records, dismissed]);

  const importLocal = useCallback(() => {
    const u = userRef.current;
    if (!u || localDecks.length === 0) return;
    commit(u.id, [...recRef.current, ...localDecks]);
    void sync();
  }, [commit, sync, localDecks]);

  const dismissImport = useCallback(() => {
    const u = userRef.current;
    if (!u) return;
    const next = [...dismissed, ...localDecks.map((d) => d.id)];
    saveDismissed(u.id, next);
    setDismissed(next);
  }, [dismissed, localDecks]);

  const signIn = useCallback(async (email: string, password: string) => {
    const sb = await getClient();
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(frenchError(error));
  }, []);

  /** Renvoie true si un e-mail de confirmation doit d'abord être validé. */
  const signUp = useCallback(async (email: string, password: string) => {
    const sb = await getClient();
    const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: appUrl() } });
    if (error) throw new Error(frenchError(error));
    // Supabase ne signale pas un e-mail déjà inscrit quand la confirmation est activée : identités vides.
    if (data.user && data.user.identities?.length === 0) throw new Error("Un compte existe déjà avec cet e-mail.");
    return !data.session;
  }, []);

  const signOut = useCallback(async () => {
    const u = userRef.current;
    if (!u) return;
    clearTimeout(timer.current);
    // On envoie d'abord les dernières modifications (si le réseau le permet).
    await sync().catch(() => {});
    const sb = await getClient();
    await sb.auth.signOut({ scope: "local" }).catch(() => {});
    clearCache(u.id);
    switchUser(null);
  }, [sync, switchUser]);

  const resetPassword = useCallback(async (email: string) => {
    const sb = await getClient();
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl() });
    if (error) throw new Error(frenchError(error));
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const sb = await getClient();
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw new Error(frenchError(error));
    setRecovery(false);
  }, []);

  return {
    decks, saveDeck, deleteDeck,
    account: {
      enabled: cloudEnabled, user, status, error, lastSync, recovery, localDecks,
      sync, importLocal, dismissImport, signIn, signUp, signOut, resetPassword, updatePassword,
    },
  };
}

export type Account = ReturnType<typeof useDeckStore>["account"];
