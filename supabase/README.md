# Activer les comptes (Supabase)

Les comptes permettent de retrouver ses decks sur plusieurs appareils. Tant que ce n'est pas
configuré, l'appli reste 100 % locale et le menu « COMPTE » n'apparaît pas.

1. Créer un compte gratuit sur <https://supabase.com> (bouton « Start your project », connexion
   avec GitHub possible), puis **New project** : nom `duelweb`, un mot de passe de base de données
   (à garder pour toi), région **West EU (Paris)**.
2. Dans le projet : **SQL Editor › New query**, coller le contenu de [`schema.sql`](schema.sql),
   puis **Run**. Cela crée la table des decks, protégée pour que chacun ne voie que les siens.
3. **Authentication › Sign In / Providers › Email** : désactiver **Confirm email** puis
   **Save**. (Recommandé : l'envoi d'e-mails de l'offre gratuite est limité à quelques-uns par
   heure. Si tu préfères garder la confirmation, c'est géré par l'appli.)
4. **Authentication › URL Configuration** : **Site URL** =
   `https://alexandredias122.github.io/Duel-web/` (sert aux liens « mot de passe oublié »).
5. **Project Settings › API Keys** (ou le bouton **Connect**) : récupérer
   - l'URL du projet (`https://xxxx.supabase.co`) ;
   - la clé **publishable** (`sb_publishable_…`, ou l'ancienne clé `anon public`).

   Ces deux valeurs sont publiques et vont dans `src/lib/cloudConfig.ts` (ou dans les variables
   `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` d'un fichier `.env.local` en développement).
   Ne jamais mettre la clé **secret** / `service_role` dans l'appli.

Remarque : un projet gratuit inactif pendant 7 jours est mis en pause par Supabase. Les decks
restent alors utilisables sur chaque appareil (copie locale) ; il suffit de cliquer sur
**Restore** dans le tableau de bord Supabase pour relancer la synchronisation.

## Fonctionnement

- Sans compte : decks dans le `localStorage` de l'appareil (comme avant).
- Connecté : les decks du compte sont copiés sur l'appareil (jeu hors ligne possible) et
  synchronisés à la connexion, au retour sur l'appli, au retour du réseau et après chaque
  modification. En cas de conflit, la version modifiée le plus récemment l'emporte.
- À la première connexion, l'appli propose d'importer les decks créés sur l'appareil sans compte.
