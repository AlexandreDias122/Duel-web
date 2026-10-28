# DuelWeb

Yu-Gi-Oh! dans le navigateur, façon Master Duel / MDPro3 : toutes les cartes TCG et OCG,
un éditeur de decks, des duels contre une IA (avec des decks méta récents dont elle connaît les combos) ou contre soi-même. Rien à installer :
sur iPhone, ouvrez le site dans Safari puis **Partager › Sur l'écran d'accueil**.

## Comment ça marche

| Partie | Source |
| --- | --- |
| Règles et effets | [ygopro-core](https://github.com/edo9300/ygopro-core) (le moteur d'EDOPro) compilé en WebAssembly via [`ocgcore-wasm`](https://www.npmjs.com/package/ocgcore-wasm), exécuté dans un Web Worker |
| Cartes | [BabelCDB](https://github.com/ProjectIgnis/BabelCDB) (cards.cdb + pré-sorties), converti en JSON au build |
| Scripts d'effets | [CardScripts](https://github.com/ProjectIgnis/CardScripts), servis en fichiers statiques et chargés à la demande |
| Banlists | [LFLists](https://github.com/ProjectIgnis/LFLists) (TCG et OCG) |
| Textes de l'interface | `strings.conf` français de [Distribution](https://github.com/ProjectIgnis/Distribution) |
| Images | YGOPRODeck, avec repli sur le serveur d'images de Project Ignis |
| Comptes (facultatif) | [Supabase](https://supabase.com) pour retrouver ses decks sur plusieurs appareils, voir [`supabase/README.md`](supabase/README.md) |

Tout tourne côté client : le site est 100 % statique (GitHub Pages) et fonctionne hors ligne
une fois les données en cache (service worker). Seule la sauvegarde des decks dans un compte
passe par un serveur (Supabase) ; sans compte, tout reste sur l'appareil.

## Développement

```bash
npm install
npm run data      # télécharge les dépôts Project Ignis dans .data/ et génère public/data + public/scripts
npm run dev       # http://localhost:5173
npm run test:ai   # duels IA contre IA en Node, pour vérifier moteur + IA
npm run test:ai -- 21 meta    # decks méta entre eux ; « profil » : avec / sans profil de jeu
npm run build
```

Le déploiement se fait automatiquement sur GitHub Pages à chaque push sur `main`, et chaque
lundi pour récupérer les nouvelles cartes (`.github/workflows/deploy.yml`). Dans les réglages
du dépôt, choisir **Settings › Pages › Source : GitHub Actions**.

## Structure

- `src/engine/duel.ts` : pilotage du moteur (boucle, état du terrain, décodage des requêtes)
- `src/engine/ai.ts` : IA (hand traps, timing des chaînes, attaques rentables)
- `src/engine/aiDecks.ts` : decks méta joués par l'IA et leur plan de jeu (quoi activer, chercher, invoquer)
- `src/engine/cardKnowledge.ts` : hand traps et cartes de réponse connues
- `src/engine/duel.worker.ts` / `controller.ts` : worker et pont vers l'interface
- `src/screens/` : accueil, decks, éditeur, compte, préparation et écran de duel
- `src/lib/cloud.ts` / `useDeckStore.ts` : comptes et synchronisation des decks
- `scripts/build-data.mjs` : génération des données statiques

## Licences

Projet de fans non officiel, sans lien avec Konami. ygopro-core et les scripts de cartes sont
sous AGPL-3.0 (Project Ignis) ; ce dépôt est donc distribué sous la même licence.
