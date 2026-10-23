# Design : Tuto d'accueil interactif du module Panoramax

> **Note (2026-10-23)** : ce design a été écrit pour Shepherd.js. L'implémentation livrée dans ce dépôt utilise
> **Driver.js** (licence MIT) ; ce qui concerne Shepherd (API, thème `shepherd-theme-geo`, `advanceOn`,
> `keyboardNavigation`…) décrit la première version. Le comportement attendu, lui, est inchangé : voir `GUIDE-DEV.md`.

Généré par /office-hours le 2026-10-14
Branche : implémentation sur `feat/tuto-accueil`, créée depuis `test/combo` (le tuto dépend du cône et du flux select, absents de `upstream/main`)
Repo : sit-pmo/geo-module-panoramax
Status : APPROVED
Mode : Startup (projet interne)

## Problème

Les agents et élus qui ouvrent le module Panoramax dans GEO doivent comprendre trois choses
que l'interface n'explique pas : où se trouve l'onglet, que **cliquer sur la carte GEO à côté**
change la photo, et comment naviguer dans la photo (rotation, flèches, cône sur la carte).
La visite Shepherd existante (`src/js/extension.js:652-700`) ne démarre qu'au clic sur « ? »,
décrit des boutons en 3 bulles statiques, et ne montre aucun geste.

## Ce qu'on sait (et ce qu'on ne sait pas)

- **Public** : agents et élus, appli interne ou pro. Une visite complète et interactive est
  acceptable une fois, à condition qu'on puisse la passer et ne plus la revoir.
- **Blocages** : selon Aurélien, « c'est un peu tout ça qu'il faut leur expliquer » (trouver
  l'onglet, clic sur la carte, navigation dans la photo). **Aucune observation directe pour
  l'instant** : le contenu des étapes est une hypothèse à valider (voir l'Assignment).
- **Existant réutilisable** :
  - Shepherd.js 15.3.0 déjà embarqué, avec son thème `shepherd-theme-oldschool`, ses z-index
    et `_btn()`.
  - Le pattern localStorage avec try/catch de la confirmation (`_isNeverAsk`/`_setNeverAsk`,
    `extension.js:122-128`).
  - Le code tourne dès le chargement de l'appli (`geoApplication.executeWhenInitialized`,
    `extension.js:49`).
  - Les événements déjà écoutés : `pointerClick` (carte GEO), `select` (viewer), `view-rotated`
    et `picture-loaded` (`viewerEl.psv`).
  - Le message d'aide `.geo-pnx-hint` est déjà affiché tant qu'aucune photo n'est sélectionnée.

## Contraintes

- Licence AGPL-3.0 (Shepherd) déjà assumée, fork public sit-pmo : aucun changement.
- **Aucune nouvelle dépendance.**
- Le DOM de GEO n'est pas sous notre contrôle : tout sélecteur hors du module doit avoir un
  repli (une étape sans ancrage plutôt qu'une erreur).
- `localStorage` peut être indisponible : on garde le try/catch. S'il est indisponible, la
  visite se réaffiche (comportement acceptable).
- La confirmation d'ouverture (`confirmBeforeOpen`) doit passer avant la visite : le viewer
  n'existe pas tant que l'utilisateur n'a pas répondu « Oui ».
- Distribution inchangée : ZIP importé à la main dans l'ancienne interface du Générateur.

## Prémisses (validées)

1. **Déclenchement en 2 temps** : une bulle d'accroche sur l'onglet au chargement de l'appli,
   puis la visite complète à la première ouverture du panneau, une fois le viewer `ready`.
2. **Visite interactive** : les étapes clés avancent sur le vrai geste ; chacune garde un
   bouton « Passer cette étape ».
3. **« Passer la visite »** sur chaque étape, et une case **« Ne plus afficher »** mémorisée
   dans localStorage avec une clé versionnée. Le bouton « ? » relance toujours la visite.
4. **Shepherd** conservé.
5. **Réglage Générateur** pour couper la visite automatique dans une appli donnée.

## Approches considérées

- **A. Visite actuelle en démarrage automatique** : écartée, elle reste un diaporama de
  bulles et ne répond pas à « quelque chose de dynamique ».
- **C. Conseils contextuels sans visite modale** : écartée comme approche principale (pas de
  visite structurée). L'idée des conseils qui disparaissent une fois le geste fait est reprise
  dans les étapes interactives de B.

## Approche retenue : B, accroche sur l'onglet + visite interactive pilotée par les événements

### 1. Accroche au chargement de l'appli

- Dans `executeWhenInitialized`, après `_registerWidget()`, si `showTourOnStart` est actif et
  si la visite n'est ni terminée ni désactivée, une visite Shepherd d'**une seule étape** :
  - attachée à l'onglet Panoramax de la barre de droite. Sélecteur à confirmer dans GEO, a
    priori l'élément launcher qui porte la classe `icon_panoramax` (posée par le module via
    `icon: 'icon_panoramax'`) ;
  - texte : « **Nouveau : vue immersive Panoramax.** Ouvrez cet onglet pour voir les photos
    à 360° de n'importe quel point de la carte. » ;
  - boutons : « Plus tard » (ferme, réapparaîtra à la prochaine ouverture de l'appli) et
    « Ne plus afficher » ;
  - `advanceOn` sur le clic de l'onglet : ouvrir l'onglet ferme l'accroche ;
  - **pas de modal overlay** : l'agent doit pouvoir ignorer la bulle et travailler.
- Si l'élément de l'onglet est introuvable après quelques tentatives (le DOM de GEO se rend
  après `executeWhenInitialized`, à prévoir comme `_requestPanelWidthSoon`), on n'affiche
  pas l'accroche plutôt qu'une bulle flottante au milieu de l'écran.

### 2. Visite interactive à la première ouverture du panneau

Elle démarre dans `_onReady` (viewer prêt, donc après la confirmation éventuelle) si la visite
n'a jamais été terminée, passée ou désactivée.

**Pas de `useModalOverlay`** pour cette visite : l'overlay bloquerait le clic sur la carte GEO,
qui est justement le geste à apprendre. On met plutôt la cible en valeur avec
`highlightClass` et une animation CSS (pulsation).

| # | Étape | Ancrage | Avance quand | Repli |
|---|-------|---------|--------------|-------|
| 1 | « Voici la vue immersive Panoramax. 1 min pour la prendre en main ? » | panneau | bouton « C'est parti » | « Passer la visite » + « Ne plus afficher » |
| 2 | « **Cliquez sur la carte**, à gauche, n'importe où sur une rue » | aucun ancrage ou zone carte (pulsation sur `.geo-pnx-hint`) | `select` reçu avec un nouveau `picId` | « Passer cette étape » ; si aucune photo n'est trouvée, le texte dit « Pas de photo ici, essayez une rue voisine » |
| 3 | « **Faites glisser la photo** pour regarder autour. Le cône bleu sur la carte suit votre regard » | `.geo-pnx-viewer` | `view-rotated` avec une rotation cumulée ≥ 30° | « Passer cette étape » |
| 4 | « **Avancez** : cliquez sur une flèche dans la photo pour passer à la suivante. Le marqueur vous suit sur la carte » | `.geo-pnx-viewer` | nouveau `select` (picId différent de celui de l'étape 2) | « Passer cette étape » |
| 5 | « Plein écran » et « Ouvrir dans Panoramax » | `.geo-pnx-fullscreen-btn`, puis `.geo-pnx-open-btn` (qui existe forcément à ce stade) | bouton Suivant | — |
| 6 | « Vous pouvez relancer cette visite avec **?** » | `.geo-pnx-help-btn` | « Terminer » | — |

**Mécanique** (pas d'abstraction : une fonction et un drapeau) :

- `var _tourWaiting = null;` contient le nom de l'événement attendu par l'étape active
  (`'select'`, `'rotate'`, `'next-pic'`). Il est posé dans le `when.show` de l'étape et remis à
  null dans `when.hide`.
- Les gestionnaires existants (`_onSelect`, `_onViewRotated`) appellent
  `_tourNotify('select' | 'rotate')`, qui fait `if (_tour && _tour.isActive() && _tourWaiting === nom) _tour.next();`.
  Le cumul des 30° et la comparaison des picId restent locaux à `_tourNotify`.
- En cas de `$destroy` (panneau fermé pendant la visite), on fait `_tour.cancel()` sans marquer
  la visite comme vue : elle reprendra à la prochaine ouverture. **À trancher** : reprendre au
  début, ou considérer qu'une fermeture vaut « Passer » ? Proposition : reprendre au début,
  avec une limite de 2 démarrages automatiques.
- Les étapes interactives montrent la réussite pendant ~600 ms (✓ « Bien joué » dans le
  texte) avant `next()`. C'est le côté « dynamique », en CSS uniquement.

### 3. Persistance

- Clé `geo-panoramax-tour` qui vaut `'v1:done'` ou `'v1:never'` (en ponytail : une seule clé,
  pas un objet JSON). Un changement de contenu majeur passe la constante à `v2` : la visite se
  réaffiche une fois pour tout le monde.
- Accroche : `'v1:done'` dès que l'onglet a été ouvert une fois, `'v1:never'` sur « Ne plus
  afficher ». Une seule clé gère les deux phases : ouvrir le panneau suffit à rendre
  l'accroche inutile.
- « Terminer » et « Passer la visite » → `done`. « Ne plus afficher » → `never`. Les deux
  coupent la visite automatique. La différence ne sert qu'à une éventuelle v2.
- Le bouton « ? » ignore la clé et lance toujours la visite complète (`_startTour` actuel,
  remplacé par la nouvelle visite).

### 4. Réglage Générateur

Dans `plugin.geoext.json`, groupe « Options du panneau » :

```json
{
  "@type": "com.bg.functionality.canvas.configuration.PropertyConfigurationElement",
  "name": "Afficher la visite guidée au premier lancement",
  "description": "Affiche une bulle sur l'onglet à l'ouverture de l'application, puis une visite guidée interactive à la première ouverture du panneau. L'utilisateur peut la passer ou choisir de ne plus la voir (mémorisé dans le navigateur). La visite reste accessible avec le bouton « ? ».",
  "key": "showTourOnStart",
  "required": false,
  "type": "BOOLEAN",
  "defaultValue": true
}
```

La lecture se fait comme `confirmBeforeOpen` : `props.showTourOnStart !== false && props.showTourOnStart !== 'false'`.

## Questions ouvertes

1. **Sélecteur de l'onglet** dans le DOM de GEO : à relever en console sur l'appli PETR
   (`document.querySelector('.icon_panoramax')` puis remonter au launcher cliquable).
2. **Fermeture du panneau pendant la visite** : reprendre au début (proposé) ou considérer la
   visite comme passée ?
3. **Navigation par flèches** : les flèches sont dans le shadow DOM de `pnx-viewer`. On ne les
   cible pas, on ancre sur le viewer entier. À vérifier : est-ce que `select` est bien émis
   quand on avance par flèche ? D'après GUIDE-DEV §6, oui (« l'utilisateur navigue dans le
   viewer »).
4. **Écran étroit / tablette d'élu** : la bulle à gauche du panneau à 50 % reste-t-elle
   lisible ? À tester sur la tablette utilisée en réunion, s'il y en a une.

## Critères de réussite

- Un collègue qui n'a jamais vu le module passe de l'ouverture de l'appli à « j'ai changé de
  photo en cliquant sur la carte et j'ai tourné la vue » **sans aide orale**, en moins de 2 min.
- « Passer » est accessible à chaque étape (une seule action), et après « Ne plus afficher »
  rien ne réapparaît, ni l'accroche ni la visite, au rechargement de l'appli.
- `showTourOnStart = false` → aucune accroche ni visite automatique ; « ? » fonctionne.
- Aucune régression : confirmation d'ouverture, marqueur, cône, recentrage `centerOn`,
  groupe de couches.
- Onglet introuvable ou localStorage indisponible → aucune erreur en console, le module
  fonctionne.

## Plan de distribution

Inchangé : `npm run package` → ZIP importé à la main dans l'ancienne interface du Générateur.
Version du manifeste à monter (nouveau réglage).

## Dépendances

- Accès à l'appli GEO PETR Marennes Oléron pour relever le sélecteur de l'onglet.
- Un collègue « cobaye » qui n'a jamais utilisé le module.

## The Assignment

**Avant d'écrire une ligne** : ouvre l'appli GEO avec un collègue (ou un élu) qui n'a jamais vu
le module, dis-lui seulement « regarde la rue devant la mairie de [commune] » et **tais-toi**
pendant 3 minutes. Note les endroits où il s'arrête. Si les 3 points d'arrêt sont onglet /
clic sur la carte / rotation, le tableau des étapes ci-dessus tient. Sinon, réécris-le avant
de coder. Profites-en pour relever en console le sélecteur de l'onglet (question ouverte 1).

## Ce que j'ai remarqué

- Tu as d'abord demandé l'affichage « lorsque les utilisateurs ouvrent l'application ». Quand
  il a fallu choisir, tu as validé la séparation accroche / visite sans hésiter : tu
  pensais au parcours complet, pas à un moment technique.
- À la question « où ont-ils bloqué ? », tu as répondu « c'est un peu tout ça qu'il faut leur
  expliquer ». C'est honnête, et c'est exactement pourquoi l'Assignment est une observation et
  pas du code.
- Tu as écrit « quelque chose de dynamique » et pas « une visite guidée » : ce mot a fait
  basculer la conception vers des étapes qui avancent sur le geste réel.

---

# Revue eng (/plan-eng-review, 2026-10-14)

Cible : ce document (`docs/designs/tuto-accueil.md`), branche `test/combo`, commit `8d426f0`.
Scope Challenge : 3 fichiers touchés (`src/js/extension.js`, `src/plugin.geoext.json`, `GUIDE-DEV.md`), 0 nouvelle classe. Aucun problème de périmètre. **Scope accepted as-is.**

## Decision ledger

### R1: condition d'avancement de l'étape 2 « Cliquez sur la carte »
Finding: F1, P1, confiance 9/10, `src/js/extension.js:252` (`_locateFromMapClick(center, extent.crs)` dans `_onReady`) → `:454` (`_viewerEl.select(seqId, picId, true)`), relevé par Claude (revue eng)
Plan baseline: étape 2 avance sur « `select` reçu avec un nouveau `picId` » (proposition d'origine, non tranchée)
Runtime evidence: `_onReady` sélectionne automatiquement la photo la plus proche du centre de la carte : un `select` arrive sans clic de l'utilisateur, juste après le démarrage prévu de la visite
Comparison grid:
| Choix | Actuel | A | B |
|---|---|---|---|
| R1 avancement étape 2 | `select` avec nouveau picId (saute tout seul) | `select` reçu après un `pointerClick` de l'utilisateur (drapeau posé par le clic) | `pointerClick` seul, même si aucune photo n'est trouvée |
Question D1:
D1 — Sur quoi l'étape 2 « Cliquez sur la carte » doit-elle avancer ?
Projet : module GEO Panoramax, branche test/combo, revue du design du tuto d'accueil.
ELI10 : à l'ouverture du panneau, le module affiche tout seul la photo la plus proche du centre de la carte (extension.js:252). Si l'étape 2 avance dès qu'une photo s'affiche, elle saute avant que l'agent ait cliqué : il ne fait jamais le geste qu'on veut lui apprendre. Il faut donc avancer sur le clic de l'agent. Reste à savoir s'il faut aussi attendre qu'une photo ait été trouvée à cet endroit.
Enjeu si on se trompe : l'étape la plus importante du tuto ne s'affiche qu'une fraction de seconde, ou elle avance alors que le clic est tombé à un endroit sans photo.
Recommandation : A, parce que l'étape ne valide le geste que s'il a vraiment montré une photo, pour deux lignes de plus.
Complétude : A=10/10, B=8/10
Pour / contre :
A) Clic suivi d'une photo trouvée (recommandé)
  ✅ L'étape avance seulement quand le geste a marché : clic sur la carte puis photo affichée
  ✅ Si le clic tombe loin des photos, le message existant « aucune photo » s'affiche et l'étape attend
  ❌ Un drapeau de plus, posé dans le gestionnaire pointerClick et lu dans _onSelect (humain : ~30 min / CC : ~5 min)
B) Clic seul
  ✅ Le plus simple : un seul appel à _tourNotify dans le gestionnaire pointerClick (extension.js:259)
  ✅ Aucun risque de rester bloqué si l'API Panoramax est lente
  ❌ L'étape 3 « faites glisser la photo » peut s'afficher alors que le clic n'a rien trouvé
Net : on choisit entre « le geste a réussi » et « le geste a été fait ».
Header: Étape 2
Options:
A) Clic + photo trouvée (recommandé)
Avance quand un select arrive après un pointerClick de l'agent (drapeau). Clic sans photo : le message existant s'affiche et l'étape attend. Maintenance : 1 drapeau.
B) Clic seul
Avance au pointerClick de l'agent, photo trouvée ou non. Un seul appel dans le gestionnaire existant.

State: approved
Actual answer: A) Clic + photo trouvée (D1, 2026-10-14)
Accepted scope: l'étape 2 avance quand un `select` (nouveau picId) arrive après un `pointerClick` de l'agent ; drapeau posé dans le gestionnaire `pointerClick` (`extension.js:259`), lu et remis à zéro dans `_onSelect` ; clic sans photo → message existant, l'étape attend (bouton « Passer cette étape » toujours là)
History: none

### R2: qui écrit l'état « visite vue » quand l'onglet est ouvert
Finding: F2, P1, confiance 9/10, ce document §3 Persistance (« Accroche : `'v1:done'` dès que l'onglet a été ouvert une fois ») vs §2 (« démarre dans `_onReady` si la visite n'a jamais été terminée »), relevé par Claude (revue eng)
Plan baseline: ouvrir l'onglet écrit `v1:done` (proposition d'origine, non tranchée)
Runtime evidence: non applicable (code futur) ; contradiction interne au plan : l'écriture à l'ouverture de l'onglet précède `_onReady`, la visite du panneau ne démarrerait jamais
Comparison grid:
| Choix | Actuel | A | B |
|---|---|---|---|
| R2 écriture à l'ouverture de l'onglet | écrit `v1:done` (bloque la visite) | rien n'est écrit ; l'accroche s'affiche tant que la clé est vide ; seuls les boutons de la visite du panneau écrivent `done`/`never`, plus « Ne plus afficher » de l'accroche (`never`) | deux clés séparées (accroche / visite), l'ouverture de l'onglet écrit seulement la clé accroche |
Question D2:
D2 — Que faut-il mémoriser quand l'agent ouvre l'onglet Panoramax ?
Projet : module GEO Panoramax, branche test/combo, revue du design du tuto d'accueil.
ELI10 : le plan se contredit. Il note « vu » dès que l'onglet est ouvert, puis il ne lance la visite du panneau que si rien n'est noté « vu ». Résultat : la visite ne démarrerait jamais. Le plus simple est de ne rien noter à l'ouverture. La bulle d'accroche s'affiche tant que la visite n'a été ni terminée ni passée, et seuls les boutons notent quelque chose.
Enjeu si on se trompe : la fonctionnalité principale, la visite interactive, ne s'affiche jamais pour personne.
Recommandation : A, parce qu'une seule clé écrite par les seuls boutons suffit, et que l'accroche disparaît d'elle-même une fois la visite terminée.
Complétude : A=10/10, B=9/10
Pour / contre :
A) Rien à l'ouverture, une seule clé (recommandé)
  ✅ Une seule clé geo-panoramax-tour, écrite uniquement par un clic sur Terminer, Passer ou Ne plus afficher
  ✅ L'accroche se tait d'elle-même dès que la visite du panneau est terminée ou passée
  ❌ Un agent qui ouvre l'onglet puis le ferme pendant la confirmation revoit l'accroche à la prochaine ouverture
B) Deux clés séparées
  ✅ L'accroche disparaît dès la première ouverture de l'onglet, même si la visite n'a pas été faite
  ✅ Chaque phase a son propre état, plus facile à réinitialiser séparément
  ❌ Deux clés à lire et à écrire, et une v2 doit penser à versionner les deux (humain : ~1 h / CC : ~10 min)
Net : une clé simple, ou une accroche qui se tait plus tôt au prix d'une deuxième clé.
Header: Persistance
Options:
A) Une clé, boutons seuls (recommandé)
Rien n'est écrit à l'ouverture de l'onglet. Accroche visible tant que la clé est vide. Terminer/Passer → done, Ne plus afficher → never.
B) Deux clés séparées
Clé accroche écrite à l'ouverture de l'onglet ; clé visite écrite par les boutons du panneau.

State: approved
Actual answer: A) Une clé, boutons seuls (D2, 2026-10-14)
Accepted scope: une seule clé `geo-panoramax-tour` ; rien n'est écrit à l'ouverture de l'onglet ; l'accroche s'affiche tant que la clé est vide ; écriture uniquement dans les actions des boutons : Terminer/Passer la visite → `v1:done`, Ne plus afficher (accroche ou visite) → `v1:never` ; §3 du plan corrigé en conséquence
History: none

### R3: fermeture du panneau pendant la visite
Finding: F3, P2, confiance 8/10, ce document §2 (« En cas de `$destroy` … `_tour.cancel()` … limite de 2 démarrages automatiques ») + question ouverte 2, relevé par Claude (revue eng)
Plan baseline: reprise au début, avec une limite de 2 démarrages automatiques (proposition, « À trancher »)
Runtime evidence: non applicable (code futur). Avec R2 (écriture par les boutons seuls), `_tour.cancel()` au `$destroy` n'écrit rien ; la limite de 2 exigerait un compteur stocké en plus de `done`/`never`
Comparison grid:
| Choix | Actuel | A | B | C |
|---|---|---|---|---|
| R3 panneau fermé en cours de visite | reprise + limite 2 (compteur) | rien n'est écrit, la visite reprend au début à la prochaine ouverture, sans limite | reprise, limite de 2 démarrages (valeur `v1:started1` dans la même clé) | la fermeture vaut « Passer » → `v1:done` |
| R2 (approuvé D2) | une clé, boutons seuls | inchangé | inchangé (ajoute une valeur intermédiaire) | inchangé, mais la fermeture écrit aussi |
Question D3:
D3 — Si l'agent ferme le panneau au milieu de la visite, que se passe-t-il ensuite ?
Projet : module GEO Panoramax, branche test/combo, revue du design du tuto d'accueil.
ELI10 : un agent peut fermer le panneau en pleine visite, par exemple parce qu'on l'appelle. Avec la règle choisie en D2, seuls les boutons notent quelque chose : rien n'est noté et la visite recommence à la prochaine ouverture. Le plan proposait d'arrêter après 2 démarrages, ce qui oblige à compter. Chaque étape a de toute façon un bouton « Passer la visite ».
Enjeu si on se trompe : sans limite, un agent qui ferme toujours le panneau sans cliquer revoit la visite à chaque fois ; avec une fermeture qui vaut « Passer », un agent interrompu ne la revoit jamais.
Recommandation : A, parce que « Passer » est à un clic à chaque étape et qu'un compteur ajoute un état pour un cas rare.
Complétude : A=8/10, B=9/10, C=7/10
Pour / contre :
A) Reprise au début, sans limite (recommandé)
  ✅ Aucune ligne de plus : découle directement de la règle « boutons seuls » de D2
  ✅ Un agent interrompu revoit la visite, ce qui est le bon comportement dans le cas fréquent
  ❌ Un agent qui ferme toujours le panneau sans cliquer revoit la visite à chaque ouverture
B) Reprise avec limite de 2
  ✅ Plafonne la gêne pour l'agent qui ignore la visite sans jamais cliquer « Passer »
  ❌ Un état de plus (v1:started1) et un test de plus (humain : ~1 h / CC : ~10 min)
  ❌ Un agent interrompu deux fois perd la visite sans l'avoir vue en entier
C) La fermeture vaut « Passer »
  ✅ La visite ne s'impose jamais deux fois, l'agent garde le bouton « ? »
  ❌ Un agent interrompu par un appel ne revoit jamais la visite automatique
Net : on choisit entre la simplicité (A), un plafond de gêne (B) et la discrétion (C).
Header: Fermeture
Options:
A) Reprise, sans limite (recommandé)
Rien n'est écrit au $destroy. La visite reprend au début à la prochaine ouverture du panneau. « Passer » reste sur chaque étape.
B) Reprise, limite 2
Valeur v1:started1 écrite au premier démarrage auto ; au 2e démarrage, v1:done. Un état et un test de plus.
C) Fermer = Passer
Le $destroy pendant la visite écrit v1:done. La visite auto ne revient plus, « ? » reste disponible.

State: approved
Actual answer: A) Reprise, sans limite (D3, 2026-10-14)
Accepted scope: au `$destroy` pendant la visite : `_tour.cancel()` sans aucune écriture ; la visite reprend au début à la prochaine ouverture ; pas de compteur, la « limite de 2 démarrages » du plan est retirée (question ouverte 2 close)
History: none

### R4: fermer la bulle d'accroche quand le panneau s'ouvre
Finding: F4, P2, confiance 7/10, ce document §1 (« `advanceOn` sur le clic de l'onglet ») ; le sélecteur de l'onglet est non vérifié (question ouverte 1) ; point d'entrée existant à l'ouverture du panneau : `_buildController` (`src/js/extension.js:215-219`, `_currentScope = $scope`), relevé par Claude (revue eng)
Plan baseline: la bulle se ferme uniquement par `advanceOn` sur le clic de l'onglet
Runtime evidence: inconnu. Le DOM de l'onglet GEO n'a pas été relevé ; si `advanceOn` vise un élément enfant ou parent de celui qui reçoit le clic, la bulle reste ouverte
Comparison grid:
| Choix | Actuel | A | B |
|---|---|---|---|
| R4 fermeture de l'accroche | `advanceOn` seul | `advanceOn` + `cancel()` de la visite d'accroche (sans écriture, cf. R2) au début du contrôleur du panneau | `advanceOn` seul |
Question D4:
D4 — Faut-il fermer la bulle d'accroche par le code à l'ouverture du panneau ?
Projet : module GEO Panoramax, branche test/combo, revue du design du tuto d'accueil.
ELI10 : la bulle « Nouveau : vue immersive » doit disparaître quand l'agent ouvre l'onglet. Le plan compte sur Shepherd pour la fermer au clic sur l'onglet, mais on ne connaît pas encore l'élément exact de GEO qui reçoit le clic. Si le sélecteur est un peu à côté, la bulle reste affichée par-dessus le panneau ouvert. Une ligne au démarrage du panneau la ferme à coup sûr.
Enjeu si on se trompe : une bulle orpheline reste collée à l'onglet pendant la confirmation et pendant la visite, ce qui donne deux bulles à l'écran.
Recommandation : A, parce qu'une ligne supprime la dépendance au sélecteur exact.
Complétude : A=10/10, B=7/10
Pour / contre :
A) Fermer aussi dans le contrôleur (recommandé)
  ✅ La bulle disparaît à l'ouverture du panneau, quel que soit l'élément de GEO cliqué
  ✅ Marche aussi si GEO ouvre l'onglet par un autre chemin (réouverture automatique, clavier)
  ❌ Une ligne de plus dans _buildController, et une variable pour garder la visite d'accroche (humain : ~15 min / CC : ~2 min)
B) advanceOn seul
  ✅ Aucun code de plus que ce que prévoit le plan
  ❌ Repose sur un sélecteur pas encore vérifié : bulle orpheline si le clic tombe sur un autre élément
Net : une ligne de code contre une dépendance au DOM de GEO.
Header: Accroche
Options:
A) Fermer dans le contrôleur (recommandé)
Garder advanceOn et appeler cancel() de la visite d'accroche (sans écriture) au début de _buildController.
B) advanceOn seul
La bulle se ferme uniquement par advanceOn sur le clic de l'onglet.

State: approved
Actual answer: A) Fermer dans le contrôleur (D4, 2026-10-14)
Accepted scope: garder `advanceOn` sur l'onglet ; la visite d'accroche est gardée dans sa propre variable ; au début de `_buildController`, `cancel()` de cette visite si elle est active, sans aucune écriture (R2)
History: none

Correction factuelle (Q2, P3, confiance 8/10, relevé par Claude) : le tableau de l'étape 5 dit « `.geo-pnx-open-btn` (qui existe forcément à ce stade) ». C'est faux si l'agent a passé les étapes 2 à 4 sans photo. On garde le repli existant `hasOpenBtn` (`src/js/extension.js:690-694` : étape non ancrée avec la mention « ce bouton apparaît une fois qu'une photo est affichée »). Le comportement actuel est conservé, aucune décision n'est nécessaire.

### R5: navigation au clavier dans les visites Shepherd
Finding: Q1, P2, confiance 8/10, `node_modules/shepherd.js/dist/js/shepherd.mjs` (`this.options=Object.assign({},{exitOnEsc:!0,keyboardNavigation:!0},t)` ; `case 39:e.options.keyboardNavigation&&(…e.next())` ; focus de la bulle à l'affichage `t.el.focus({preventScroll:!0})`) ; `src/js/extension.js:656-664` (`_tourOptions` ne fixe pas `keyboardNavigation`), relevé par Claude (revue eng)
Plan baseline: non spécifié (défaut Shepherd : flèches actives)
Runtime evidence: lecture du code de Shepherd 15.3.0 installé : ← et → reculent et avancent la visite quand la bulle a le focus, et la bulle prend le focus à chaque affichage. Non testé dans GEO
Comparison grid:
| Choix | Actuel | A | B |
|---|---|---|---|
| R5 flèches du clavier | actives (défaut) dans la visite existante et la future | `keyboardNavigation: false` dans `_tourOptions` (visite d'accroche, visite du panneau et « ? ») ; Échap garde sa fonction | inchangé : flèches actives |
Question D5:
D5 — Faut-il désactiver les flèches du clavier dans les visites ?
Projet : module GEO Panoramax, branche test/combo, revue du design du tuto d'accueil.
ELI10 : par défaut, Shepherd fait avancer la visite avec la flèche → du clavier, et la bulle prend le focus à chaque étape. Un agent qui appuie sur une flèche pour tourner dans la photo fait donc sauter l'étape « tournez la vue » sans avoir tourné. Une option à false coupe ce raccourci. Le bouton Suivant et la touche Échap continuent de marcher.
Enjeu si on se trompe : les étapes interactives sautent sans le geste, ce qui fait perdre l'intérêt principal du tuto.
Recommandation : A, parce que les étapes interactives ne doivent avancer que sur le geste ou sur un bouton.
Complétude : A=10/10, B=6/10
Pour / contre :
A) Désactiver les flèches (recommandé)
  ✅ Les étapes interactives avancent uniquement sur le vrai geste ou sur un bouton
  ✅ Une seule option dans _tourOptions, valable pour les trois visites (humain : ~5 min / CC : ~1 min)
  ❌ Les habitués du clavier perdent le raccourci flèche dans la visite « ? »
B) Garder le défaut
  ✅ Navigation au clavier possible dans la visite du bouton « ? »
  ❌ Une flèche appuyée par réflexe fait sauter l'étape « tournez la vue » ou « photo suivante »
Net : on perd un raccourci clavier rarement utilisé pour garantir que les étapes interactives attendent le geste.
Header: Clavier
Options:
A) Désactiver les flèches (recommandé)
keyboardNavigation: false dans _tourOptions, pour les trois visites. Échap et les boutons fonctionnent toujours.
B) Garder le défaut
Les flèches ← → reculent et avancent la visite.

State: approved
Actual answer: A) Désactiver les flèches (D5, 2026-10-14)
Accepted scope: `keyboardNavigation: false` dans `_tourOptions` (accroche, visite du panneau, « ? ») ; Échap et boutons inchangés
History: none

### R6: contrat de non-régression et méthode de vérification
Finding: T1, P1 (règle de non-régression), confiance 9/10, `package.json` (`"test": "echo \"Error: no test specified\" && exit 1"`, aucun fichier de test) ; hooks prévus dans `_onSelect` (`src/js/extension.js` ~l. 305-320), `_onViewRotated` (~l. 280), gestionnaire `pointerClick` (l. 259-261), `$destroy` (l. 361-375), relevé par Claude (revue eng)
Plan baseline: critères de réussite du plan (« Aucune régression : confirmation d'ouverture, marqueur, cône, recentrage `centerOn`, groupe de couches »), sans méthode de vérification
Runtime evidence: aucun test automatisé ; le comportement actuel n'a été validé qu'à la main sur GEO PETR (GUIDE-DEV)
Comparison grid:
| Choix | Actuel | A | B |
|---|---|---|---|
| R6 comportements à préserver | listés dans les critères, sans assertion | 1) confirmation Oui/Non/Ne plus demander inchangée, la visite ne démarre qu'après Oui ; 2) marqueur + recentrage `centerOn` sur `select`, dédoublonné sur picId (hook placé après la déduplication) ; 3) cône sur `picture-loaded`/`view-rotated`, filtre 3° inchangé ; 4) `$destroy` : désabonnements inchangés + `cancel()` de la visite ; 5) groupe de couches coché/décoché ; 6) plein écran et « Ouvrir dans Panoramax » | identique à A |
| R6 changements voulus | — | le contenu de la visite « ? » est remplacé par la nouvelle visite ; flèches du clavier désactivées (R5) | identique à A |
| R6 méthode | aucune | checklist manuelle dans `GUIDE-DEV.md` (§ « Tester la visite »), déroulée sur GEO PETR avant chaque ZIP, + artefact Test Plan pour /qa | A + harnais jsdom/jest (nouvelles devDependencies, la logique doit sortir du bloc `angular.run` pour être testable) |
Question D6:
D6 — Comment vérifier que la visite ne casse rien d'existant ?
Projet : module GEO Panoramax, branche test/combo, revue du design du tuto d'accueil.
ELI10 : la visite se branche dans des fonctions qui marchent déjà (marqueur, cône, clic sur la carte, fermeture du panneau). Le projet n'a aucun test automatique. Tout a été validé à la main sur GEO. Il faut fixer ce qui doit continuer à marcher (6 points) et la façon de le vérifier. Une checklist manuelle suffit, ou bien on monte un vrai banc de tests, ce qui oblige à restructurer le code.
Enjeu si on se trompe : sans contrat écrit, une régression du marqueur ou du cône passe inaperçue jusqu'à ce qu'un agent la remarque en production.
Recommandation : A, parce que tout le code dépend de GEO et du viewer : un test jsdom simulerait l'essentiel et demanderait de découper le module pour rien.
Complétude : A=8/10, B=9/10
Pour / contre :
A) Checklist manuelle écrite (recommandé)
  ✅ Les 6 comportements à préserver et les 2 changements voulus sont écrits noir sur blanc dans GUIDE-DEV
  ✅ Testé dans le vrai GEO, avec le vrai viewer : rien n'est simulé (humain : ~1 h / CC : ~10 min pour l'écrire)
  ❌ Repose sur la discipline de la dérouler avant chaque ZIP : aucune machine ne la lance
B) Checklist + banc jsdom/jest
  ✅ Une partie de la logique (avancement des étapes, clé localStorage) est vérifiée automatiquement
  ❌ Nouvelles dépendances et code sorti du bloc angular.run uniquement pour être testable (humain : ~2 jours / CC : ~1 h)
  ❌ GEO, pnx-viewer et Shepherd restent simulés : les vraies régressions (marqueur, cône) ne sont pas couvertes
Net : une checklist sur le vrai GEO contre un banc automatique qui simule l'essentiel.
Header: Tests
Options:
A) Checklist manuelle (recommandé)
Contrat de 6 comportements préservés + 2 changements voulus, écrit dans GUIDE-DEV (§ Tester la visite), déroulé sur GEO PETR avant chaque ZIP ; artefact Test Plan pour /qa.
B) Checklist + jsdom/jest
Même contrat, plus un banc jsdom/jest sur la logique extraite (nouvelles devDependencies, refactor du bloc run).

State: approved
Actual answer: A) Checklist manuelle (D6, 2026-10-14)
Accepted scope: contrat de non-régression (6 comportements préservés + 2 changements voulus, cf. grille) écrit dans `GUIDE-DEV.md` § « Tester la visite », déroulé sur GEO PETR avant chaque ZIP ; artefact Test Plan pour /qa ; aucun framework de test ajouté
History: none

Approval readiness: PASS (R1 ← D1 A ; R2 ← D2 A ; R3 ← D3 A ; R4 ← D4 A ; R5 ← D5 A ; R6 ← D6 A ; Q2 = correction factuelle sans changement de comportement)

## Résultats par section

- **Scope Challenge** : aucun problème trouvé. Scope accepted as-is (3 fichiers, 0 classe).
- **1. Architecture** : 4 constats (F1 étape 2 qui saute toute seule, F2 contradiction de persistance, F3 fermeture du panneau, F4 accroche orpheline), tranchés par R1 à R4.
- **2. Qualité du code** : 2 constats (Q1 flèches du clavier → R5 ; Q2 correction factuelle sur `.geo-pnx-open-btn`). Aucune mutualisation à faire : `_btn` et `_tourOptions` sont réutilisés, `_startTour` est remplacé.
- **3. Tests** : aucun framework dans le dépôt ; contrat de non-régression R6 (checklist manuelle). Plan de test : `~/.gstack/projects/sit-pmo-geo-module-panoramax/Aurélien-test-combo-eng-review-test-plan-20261014-132321.md`.
- **4. Performance** : aucun problème trouvé (hook `view-rotated` en O(1) derrière le filtre de 3° existant ; recherche de l'onglet bornée).
- **Second avis (Outside Voice)** : indisponible (Codex non installé ; le repli natif n'est pas disponible dans cette session). Aucune couverture extérieure.

### Flux retenu (après décisions)

```
Chargement appli (executeWhenInitialized)
  └─ showTourOnStart && clé vide ? ──non──▶ rien
        └─oui─▶ cherche l'onglet (N essais bornés) ──introuvable──▶ rien (pas de bulle flottante)
                  └─trouvé─▶ visite d'accroche (1 étape, sans overlay, keyboardNavigation:false)
                               ├─ « Plus tard »         ▶ ferme, n'écrit rien
                               ├─ « Ne plus afficher »  ▶ clé = v1:never
                               └─ clic onglet (advanceOn) / début _buildController (R4) ▶ cancel(), n'écrit rien

Ouverture du panneau (_buildController)
  └─ [confirmation Oui] ─▶ <pnx-viewer> ready ─▶ _onReady
        ├─ sélection auto de la photo du centre  (NE fait PAS avancer la visite, R1)
        └─ showTourOnStart && clé vide ? ─oui─▶ visite du panneau (sans overlay)
              1 Intro ──« C'est parti »──▶
              2 Clic carte : attend pointerClick (drapeau) PUIS select (nouveau picId)   [Passer cette étape]
              3 Glisser ≥30° cumulés (view-rotated)                                     [Passer cette étape]
              4 Flèche du viewer : select (picId ≠ étape 2)                              [Passer cette étape]
              5 Plein écran / Ouvrir dans Panoramax (repli hasOpenBtn)
              6 Bouton « ? » ──« Terminer »──▶ clé = v1:done
              « Passer la visite » (toutes étapes) ▶ v1:done ; « Ne plus afficher » ▶ v1:never
        $destroy pendant la visite ▶ cancel(), n'écrit rien → reprise au début (R3)
Bouton « ? » ▶ visite du panneau, quelle que soit la clé
```

### Couverture des tests

```
CHEMINS DE CODE                                        PARCOURS UTILISATEUR
[+] accroche (executeWhenInitialized)                  [+] Première ouverture complète
  ├── [GAP→MANUEL] clé vide / done / never               └── [GAP→MANUEL] accroche → onglet → Oui → 6 étapes → Terminer
  ├── [GAP→MANUEL] onglet introuvable                  [+] Abandon
  └── [GAP→MANUEL] showTourOnStart=false                 ├── [GAP→MANUEL] Passer / Ne plus afficher → rechargement
[+] _tourNotify                                          └── [GAP→MANUEL] fermeture du panneau en cours → reprise
  ├── [GAP→MANUEL] select auto du centre ignoré (R1)   [+] États d'erreur
  ├── [GAP→MANUEL] clic sans photo → attend              ├── [GAP→MANUEL] localStorage indisponible
  ├── [GAP→MANUEL] rotation ≥30° (passage 0/360°)        └── [GAP→MANUEL] psv absent → étape 3 passable
  └── [GAP→MANUEL] picId différent à l'étape 4
[+] non-régression R6 (6 comportements)  [GAP→MANUEL, CRITIQUE]

COUVERTURE AUTOMATISÉE : 0 sur 15 chemins (aucun framework, choix D6)
COUVERTURE MANUELLE : 15 sur 15 dans la checklist GUIDE-DEV et le plan de test
```

### Modes de défaillance

| Chemin | Défaillance réaliste | Gestion | Visible ? |
|---|---|---|---|
| Accroche | sélecteur de l'onglet faux après une mise à jour de GEO | essais bornés, puis rien | silencieux mais sans gêne (la visite du panneau reste) |
| Étape 2 | API Panoramax lente ou en erreur | message de statut existant + « Passer cette étape » | oui |
| Étape 3 | `viewer.psv` absent | `console.error` existant + « Passer cette étape » | oui |
| Persistance | localStorage bloqué | try/catch, la visite se réaffiche | oui (visite répétée) |
| Hooks | hook placé avant la déduplication de `_onSelect` | checklist R6, point 2 | à détecter à la main |

Aucun gap critique : chaque chemin a une gestion d'erreur ou reste visible pour l'agent.

### Ce qui existe déjà (réutilisé)
Shepherd 15.3.0, `_tourOptions`/`_btn`, thème oldschool et z-index, pattern localStorage avec try/catch (`_isNeverAsk`), gestionnaires `pointerClick`/`_onSelect`/`_onViewRotated`, repli `hasOpenBtn`, lecture booléenne de la config façon `confirmBeforeOpen`.

### Hors périmètre (NOT in scope)
- Banc de tests automatisé (jsdom/jest) : écarté en D6, la logique dépend de GEO et du viewer.
- Limite du nombre de démarrages automatiques : écartée en D3.
- Ciblage des flèches dans le shadow DOM de `pnx-viewer` : on ancre sur le viewer entier.

### TODOS.md
Aucun TODO proposé : les questions ouvertes 1, 3 et 4 du design sont des vérifications à faire avant de coder (tâches T1 et T7), pas du travail différé.

### Parallélisation
Implémentation séquentielle : un seul module (`src/js/extension.js`), pas de parallélisation possible.

## Implementation Tasks
Tirées des constats ci-dessus. À cocher au fil de l'eau.

- [ ] **T1 (P1, humain : ~30 min / CC : ~5 min)** — GEO — Relever le sélecteur cliquable de l'onglet Panoramax
  - Source : question ouverte 1 + F4
  - Fichiers : aucun (console sur GEO PETR : `document.querySelector('.icon_panoramax')`)
  - Vérif : le sélecteur retenu reçoit bien le clic qui ouvre l'onglet
- [x] **T2 (P1, humain : ~3 h / CC : ~20 min)** — extension.js — Visite du panneau en 6 étapes avec `_tourWaiting`/`_tourNotify`
  - Source : R1 (drapeau pointerClick puis select), R3 (`$destroy` → cancel sans écriture), Q2 (repli hasOpenBtn)
  - Fichiers : `src/js/extension.js`
  - Vérif : plan de test, parcours critique 1 et cas limites
- [x] **T3 (P1, humain : ~1 h / CC : ~10 min)** — extension.js — Persistance : une clé `geo-panoramax-tour`, écrite par les boutons seulement
  - Source : R2
  - Fichiers : `src/js/extension.js`
  - Vérif : Terminer / Passer / Ne plus afficher puis rechargement
- [x] **T4 (P1, humain : ~1,5 h / CC : ~10 min)** — extension.js — Visite d'accroche (essais bornés, advanceOn, cancel au début de `_buildController`)
  - Source : prémisse 1, R4
  - Fichiers : `src/js/extension.js`
  - Vérif : accroche visible puis fermée à l'ouverture de l'onglet ; onglet introuvable → rien
- [x] **T5 (P2, humain : ~5 min / CC : ~1 min)** — extension.js — `keyboardNavigation: false` dans `_tourOptions`
  - Source : R5
  - Fichiers : `src/js/extension.js`
  - Vérif : flèches du clavier sans effet sur la visite
- [x] **T6 (P2, humain : ~20 min / CC : ~3 min)** — manifeste — Réglage `showTourOnStart` + montée de version
  - Source : prémisse 5
  - Fichiers : `src/plugin.geoext.json`
  - Vérif : réglage visible dans le Générateur ; false → aucune visite auto
- [x] **T7 (P1, humain : ~1 h / CC : ~10 min)** — doc — Checklist « Tester la visite » (contrat R6) + description du comportement dans GUIDE-DEV
  - Source : R6
  - Fichiers : `GUIDE-DEV.md`
  - Vérif : checklist déroulée sur GEO PETR avant le ZIP

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is
- Architecture Review: 4 issues found
- Code Quality Review: 2 issues found
- Test Review: diagram produced, 1 gap identified (aucune couverture automatisée → contrat manuel R6)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI non installé ; repli natif indisponible dans cette session)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 4/6 (D1, D2, D4, D5 sur l'option complète ; D3 et D6 sur l'option recommandée plus simple)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (auto, plan-review) | Independent 2nd opinion | 1 | unavailable | aucune couverture |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 7 issues, 0 critical gaps (toutes tranchées, travail cartographié en T1-T7) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review, unavailable (CLI non installé), 0 constat. Aucune couverture extérieure.
- **VERDICT:** aucune revue CLEAR. Eng review terminée avec 7 constats tranchés (ISSUES OPEN = travail cartographié en T1-T7, pas un échec) ; eng review required

NO UNRESOLVED DECISIONS
