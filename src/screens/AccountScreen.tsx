import type { FormEvent } from "react";
import { useState } from "react";
import type { Account } from "../lib/useDeckStore";

interface Props {
  account: Account;
  deckCount: number;
  onBack: () => void;
}

const STATUS: Record<Account["status"], string> = {
  local: "Decks enregistrés sur cet appareil uniquement",
  syncing: "Synchronisation…",
  synced: "Decks synchronisés",
  offline: "Hors ligne : les changements seront envoyés au retour du réseau",
  error: "Échec de la synchronisation",
};

export function AccountScreen({ account, deckCount, onBack }: Props) {
  const { user } = account;
  return (
    <div className="screen account">
      <header className="screen-head">
        <button className="ghost" onClick={onBack}>‹</button>
        <h2>Compte</h2>
      </header>
      {!account.enabled ? (
        <p className="muted">Les comptes ne sont pas encore activés sur ce site. Tes decks restent enregistrés sur cet appareil.</p>
      ) : account.recovery && user ? (
        <NewPassword account={account} />
      ) : user ? (
        <>
          <div className="account-card">
            <span className="muted small">Connecté avec</span>
            <b>{user.email}</b>
            <span className={`sync-status ${account.status}`}>{STATUS[account.status]}</span>
            {account.error && account.status !== "synced" && <span className="error">{account.error}</span>}
            <span className="muted small">{deckCount} deck(s) dans ton compte</span>
          </div>
          <ImportBanner account={account} />
          <div className="account-actions">
            <button onClick={() => void account.sync()} disabled={account.status === "syncing"}>Synchroniser maintenant</button>
            <button onClick={() => confirm("Se déconnecter ? Tes decks restent dans ton compte.") && void account.signOut()}>Se déconnecter</button>
          </div>
        </>
      ) : (
        <LoginForm account={account} />
      )}
    </div>
  );
}

/** Proposition d'importer dans le compte les decks créés sur cet appareil sans être connecté. */
export function ImportBanner({ account }: { account: Account }) {
  const n = account.localDecks.length;
  if (!account.user || n === 0) return null;
  return (
    <div className="import-banner">
      <span>{n} deck(s) créé(s) sur cet appareil ne sont pas dans ton compte.</span>
      <div className="row-actions">
        <button className="primary" onClick={account.importLocal}>Importer dans mon compte</button>
        <button className="ghost" onClick={account.dismissImport}>Plus tard</button>
      </div>
    </div>
  );
}

function LoginForm({ account }: { account: Account }) {
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    try {
      if (mode === "login") await account.signIn(email, password);
      else if (mode === "signup") {
        if (await account.signUp(email, password))
          setInfo("Compte créé ! Ouvre le lien reçu par e-mail pour le confirmer, puis connecte-toi ici.");
      } else {
        await account.resetPassword(email);
        setInfo("Si un compte existe avec cet e-mail, un lien pour choisir un nouveau mot de passe vient d'être envoyé.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (m: typeof mode) => {
    setMode(m);
    setError("");
    setInfo("");
  };

  return (
    <form className="account-form" onSubmit={submit}>
      <p className="muted">Connecte-toi pour retrouver tes decks sur tous tes appareils. Sans compte, ils restent sur cet appareil.</p>
      {mode !== "reset" && (
        <div className="segmented">
          <button type="button" className={mode === "login" ? "on" : ""} onClick={() => switchMode("login")}>Connexion</button>
          <button type="button" className={mode === "signup" ? "on" : ""} onClick={() => switchMode("signup")}>Créer un compte</button>
        </div>
      )}
      <label className="field-label" htmlFor="acc-email">E-mail</label>
      <input id="acc-email" className="search" type="email" autoComplete="email" inputMode="email" required
        value={email} onChange={(e) => setEmail(e.target.value)} />
      {mode !== "reset" && (
        <>
          <label className="field-label" htmlFor="acc-pass">Mot de passe</label>
          <input id="acc-pass" className="search" type="password" required minLength={6}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </>
      )}
      {error && <p className="error">{error}</p>}
      {info && <p className="warn">{info}</p>}
      <button className="primary big" disabled={busy}>
        {busy ? "…" : mode === "login" ? "Se connecter" : mode === "signup" ? "Créer mon compte" : "Envoyer le lien"}
      </button>
      {mode === "login" && <button type="button" className="ghost" onClick={() => switchMode("reset")}>Mot de passe oublié ?</button>}
      {mode === "reset" && <button type="button" className="ghost" onClick={() => switchMode("login")}>‹ Retour à la connexion</button>}
    </form>
  );
}

function NewPassword({ account }: { account: Account }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await account.updatePassword(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="account-form" onSubmit={submit}>
      <p className="muted">Choisis un nouveau mot de passe pour {account.user?.email}.</p>
      <label className="field-label" htmlFor="acc-new">Nouveau mot de passe</label>
      <input id="acc-new" className="search" type="password" autoComplete="new-password" required minLength={6}
        value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p className="error">{error}</p>}
      <button className="primary big" disabled={busy}>{busy ? "…" : "Enregistrer"}</button>
    </form>
  );
}
