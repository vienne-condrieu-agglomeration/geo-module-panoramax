# geo-panoramax — Guide de développement

Module GEO d'intégration des vues immersives **Panoramax** (photos géolocalisées à 360°,
solution open-source alternative à Google Street View). Il ne gère **que Panoramax** (pas de
bascule Google Street View). Pour une introduction générale au fonctionnement d'un module GEO,
voir [`README.md`](README.md).

## Approche retenue

Le module s'appuie sur l'**API publique documentée** du composant `<pnx-viewer>`
(<https://docs.panoramax.fr/web-viewer/>, paquet npm `@panoramax/web-viewer`, installé en
`^5.2.0`) plutôt que sur des appels internes non documentés, susceptibles de changer d'une
version à l'autre :

- attribut `endpoint` → URL de l'API STAC de l'instance Panoramax
- attribut `metacatalog="false"` → n'interroge que l'instance configurée (pas de fédération avec
  d'autres instances, qui provoquerait des requêtes CORS parasites)
- méthode `viewerEl.getAPI().getPicturesAroundCoordinates(lat, lon, radius, limit)` → photos les
  plus proches (Promise résolvant une FeatureCollection GeoJSON)
- méthode `viewerEl.select(seqId, picId, force)` → affiche une photo donnée
- événement `select` (detail : `{ seqId, picId, prevSeqId, prevPicId }`) → l'utilisateur navigue
  dans le viewer
- événement `ready` → le viewer est chargé et prêt

## Comportement

1. **Onglet dans la barre latérale droite** (libellé configurable, `toolName`). Il n'y a **pas de
   bouton flottant** sur la carte : il ouvrait le même panneau que l'onglet, qui restait de toute
   façon affiché, et le masquer demanderait de manipuler le DOM de GEO. Une **confirmation intégrée
   au panneau** est possible (config `confirmBeforeOpen`, « Ne plus demander » mémorisé dans
   `localStorage`) : le viewer n'est créé qu'après « Oui ». Elle est dans le panneau car GEO ouvre
   l'onglet sans passer par le code du module. « Non » laisse le panneau ouvert sur un message :
   aucune API GEO de fermeture du panneau n'est connue.
2. **Panneau élargi à 50 %** de l'écran (message `EXTENSION_WIDGET_ACTION` / `setPanelSize`, avec
   l'identifiant du widget), car le viewer a besoin de place. Un bouton **plein écran** le passe à
   100 % et masque la toolbar `topright` de la carte GEO, qui sinon chevauche la toolbar `topleft`.
3. **Pas d'attribut `focus`** sur `<pnx-viewer>` : le poser en statique déclenche
   `Uncaught Error: Map is not enabled` (le composant réagit avant que sa carte interne soit
   prête). La valeur par défaut du composant s'applique, et **la mini-carte interne de Panoramax
   est affichée**. L'explication causale est une hypothèse, la correction a été validée en test.
4. **À l'ouverture** (`ready`), recherche la photo la plus proche du centre de la carte GEO.
5. **Tant que le panneau est ouvert, un clic sur la carte GEO**
   (`geoApplication.map.on('pointerClick', …)`) recherche et affiche la photo la plus proche du
   point cliqué. Les coordonnées sont **transformées en EPSG:4326** via `geoApplication.transform`
   si le CRS de la carte est différent. Un message d'aide s'affiche tant qu'aucune photo n'est
   sélectionnée.
6. **Marqueur sur la carte GEO** à la position de la photo affichée. Quand l'utilisateur navigue
   dans le viewer (`select`), le marqueur suit (position lue via l'endpoint STAC
   `/collections/{seqId}/items/{picId}`) et la carte est recentrée de façon que le marqueur tombe
   au milieu de la zone visible (hors panneau), **sans changer le zoom** (`map.centerOn`, voir
   « Points à vérifier »). L'événement `select` pouvant arriver deux fois pour une même photo,
   il est dédoublonné sur `picId`.
7. **Utilisateur privilégié** (config `preferredUser`, `preferredUserCandidates`) :
   `getPicturesAroundCoordinates` ne filtrant pas par utilisateur, le module examine N candidats
   proches et retient le premier dont `providers[].name/id` ou `properties["geovisio:producer"]`
   correspond (insensible à la casse). Sinon, il retombe sur le plus proche. Laisser vide pour
   désactiver. **Aucune valeur par défaut** (manifeste et code) : par défaut, la photo la plus proche
   est retenue, tous utilisateurs confondus.
8. **Bouton rond « ouvrir dans Panoramax »** superposé au viewer, visible quand une photo est
   affichée : ouvre `{siteUrl}/?pic={picId}` dans un nouvel onglet (voir « Points à vérifier »).
9. **Bouton d'aide** : visite guidée (Shepherd.js, AGPL-3.0).
10. **Cône de vision** sur le marqueur de la carte GEO, orienté selon la direction regardée dans
    le viewer. Le cap vient des événements du sous-composant photo `viewerEl.psv` (ils ne
    remontent pas jusqu'à `<pnx-viewer>`) :
    - `picture-loaded` (detail : `{ x, y, z, picId, lon, lat, first }`) donne le cap de
      référence à chaque nouvelle photo. `view-rotated` n'est pas garanti au chargement, et
      s'il arrive avant les métadonnées il est calculé avec l'azimut de la photo précédente ;
    - `view-rotated` (detail : `{ x, y, z }`) suit ensuite les rotations, en ignorant les
      variations de moins de 3° (l'événement est émis en continu pendant un glisser).

    `detail.x` est le cap en degrés (0° = Nord), déjà corrigé de `view:azimuth` par le viewer
    (cf. `Photo.js`, v5.2.0). GEO n'exposant pas de rotation de marqueur, le marqueur est
    supprimé puis recréé avec un SVG déjà tourné ; un seul cycle `removeMarkers`/`addMarkers`
    est en vol à la fois, les demandes intermédiaires étant fusionnées. La carte n'est recentrée
    qu'au changement de photo, pas à la rotation. Limites : ouverture fixe de 60° (ne suit pas
    le zoom du viewer), carte GEO supposée orientée Nord en haut, et une photo sans
    `view:azimuth` est traitée comme orientée au Nord. Testé sur GEO (PETR Marennes Oléron).

11. **Pointage d'un objet depuis la photo** (issue #9, **première version, non testée sur de
    vraies photos ni dans GEO**). Bouton « cible » sous le bouton « ouvrir dans Panoramax » : en
    mode pointage, un clic sur le **pied** d'un objet au sol (grille, regard…) pose un point
    sur la carte GEO. Méthode A seule (projection sur le sol) :
    - le clic vient de l'événement `click` de `viewerEl.psv` (Photo Sphere Viewer 5.15, `e.data` :
      `yaw`/`pitch` en radians, `objects`, `marker`, `rightclick`) ; on ignore les clics sur les
      flèches de navigation et les marqueurs ;
    - cap = `yaw` + `view:azimuth` (comme `getXY()`), distance = hauteur de caméra /
      tan(angle sous l'horizon), position par approximation locale (m/° constants) ;
    - hauteur de caméra = réglage `cameraHeight` (2,5 m par défaut), **supposée**, pas lue dans
      la photo ; visée refusée à moins de 2° sous l'horizon ou au-delà de 40 m ;
    - incertitude = `quality:horizontal_accuracy` (5 m si absent) combinée à ±0,3 m sur la
      hauteur, affichée en ± m dans la liste et l'infobulle (pas de cercle sur la carte) ;
    - points gardés en mémoire (perdus au rechargement de la page), exportables en GeoJSON et
      CSV (`;`, BOM UTF-8). Pas de couche GEO éditable, pas de triangulation, pas de rayon de
      visée : voir l'issue. Photos plates : `sphereCorrection` (inclinaison de la caméra)
      ignorée, à vérifier.

## Points à vérifier avant mise en production

- **Lien « ouvrir dans Panoramax »** : l'URL de l'instance se termine par `/api` (voir ci-dessous),
  elle ne convient donc pas pour ouvrir le site. Le lien utilise le réglage `panoramaxSiteUrl`
  ; s'il est vide, l'URL de l'API sans son suffixe `/api`. Le lien est de la forme
  `{siteUrl}/?focus=pic&pic=…&seq=…`. **Le site doit être celui de la même instance que l'API** :
  `https://api.panoramax.xyz/api` est un méta-catalogue qui agrège plusieurs instances, donc
  mettre `https://panoramax.ign.fr` donne « La photo n'a pas pu être chargée » pour une photo
  hébergée ailleurs (constaté). Pour ce méta-catalogue, laisser vide ou mettre
  `https://api.panoramax.xyz`. Vérifier le lien obtenu avec chaque instance utilisée.
- **Format de `feature.properties.sequences`** : le code lit `properties.sequences[0]` pour
  obtenir l'ID de séquence. Utilisé en pratique, mais non confirmé par une trace. En cas de doute,
  logguer `fc.features[0]` en développement.
- **CORS** : les `fetch()` vers l'API Panoramax (item STAC) doivent être autorisés en CORS par
  l'instance. Affirmé pour `https://api.panoramax.xyz/api`, non retesté.
- **Version du composant** : n'utiliser que la version installée (`npm ls @panoramax/web-viewer`)
  comme référence pour les attributs et événements ci-dessus.
- **URL de l'instance = URL de l'API, avec `/api`** : `panoramaxInstanceUrl` doit pointer vers
  la racine de l'**API STAC** (ex. `https://panoramax.ign.fr/api`, PAS `https://panoramax.ign.fr`
  tout court) — sinon le viewer échoue à charger le catalogue (`Viewer failed to communicate
  with API`, `Map is not enabled`) et/ou déclenche des requêtes CORS parasites vers le domaine
  racine. Testé et confirmé fonctionnel avec une instance IGN (`GeoVisio 2.15.1`).
- **`endpoint` doit être posé en JS, pas en `{{interpolation}}`** : le custom element lit ses
  attributs dans `connectedCallback`, avant que le digest Angular n'ait interpolé le template
  (voir `_buildController`).
- **Dépôt du module dans une zone du gabarit** : le Générateur compare `compatibleZoneTags` aux
  `tags` des zones de type `ExtensionZone` du gabarit Pro. Avec seulement `global.pro`, le module
  n'apparaît que dans la liste globale des modules de l'application. Tags relevés dans
  l'éditeur (Générateur 4.5.0, via la console : `angular.element(e).scope().zone.tags`) :
  - En-tête : `widget.header`, `widget.header.pro` ; `widget.print`, `widget.print.pro`
  - Carte : `map.pro`, `map`
  - Bandeau de droite (zone « Accueil ») : `widget.side`, `widget.side.pro`

  Le manifeste déclare `widget.side.pro` et `widget.side` : le module peut être glissé dans le
  bandeau de droite (testé). Il s'enregistre de toute façon par le code comme onglet de la barre
  latérale droite, comme le plugin streetview natif.
- **`widgets="false"` à éviter** : il supprime aussi les flèches précédent/suivant. On garde les
  widgets par défaut malgré la barre de recherche redondante avec la carte GEO.
- **Recentrer la carte GEO sans dézoomer : `centerOn`, ni `setExtent` ni `panTo`**. Mesuré en
  console sur GEO (PETR Marennes Oléron) :
  - `map.setExtent(emprise courante, crs, { disablePadding: true })` ne restitue pas le zoom :
    largeur ×1.333 panneau fermé, ×1.5 panneau ouvert. Appelé à chaque photo, il provoquait un
    dézoom cumulatif (échelle doublée à chaque déplacement dans le viewer) ;
  - `map.panTo(direction)` décale la carte d'un cran (nord, est…) : passé des coordonnées, il ne
    fait rien et ne signale aucune erreur ;
  - `map.centerOn({ coordinates, crs })` déplace le centre exactement, zoom inchangé (ratio de
    largeur 1.000). Le centre visé est décalé vers l'est de `(0.5 - f) × largeur`, avec
    `f = (100 - panelWidthPct) / 200`, pour que le marqueur tombe au milieu de la zone visible.

  Pour inspecter l'API carte en console : `angular.element(document.body).injector().get('geoApplication').map`
  (les signatures minifiées s'obtiennent avec `.toString()` sur chaque méthode).

## Piège webpack 4 : ne PAS utiliser `@babel/preset-env` sans réglage fin

`@panoramax/web-viewer` (3 Mo minifié) utilise de la syntaxe JS récente (`??=`, `?.`, champs de
classe, blocs statiques) que l'acorn embarqué dans webpack 4 ne parse pas. Un premier essai avec
`presets: ["@babel/preset-env"]` (aucune target → compile vers ES5 complet) a **fonctionné à la
compilation mais cassé le viewer à l'exécution** (`TypeError: n is not a function`,
`ReferenceError: Pi is not defined`, `PhotoSphereViewer: Unknown option shouldGoFast`) — Babel a
signalé un « code generator deoptimised » sur ce fichier de 3 Mo, symptôme d'une transpilation
peu fiable sur un aussi gros fichier.

**Solution retenue** : transpiler uniquement les constructions syntaxiques précises que webpack 4
ne parse pas, via des plugins Babel ciblés (pas de preset généraliste) :

```js
plugins: [
  "@babel/plugin-transform-optional-chaining",
  "@babel/plugin-transform-nullish-coalescing-operator",
  "@babel/plugin-transform-logical-assignment-operators",
  "@babel/plugin-transform-class-static-block",
  "@babel/plugin-transform-class-properties",
  "@babel/plugin-transform-private-methods",
  "@babel/plugin-transform-private-property-in-object"
]
```

Bundle plus petit (2.77 Mo vs 3.03 Mo) et pas de régression runtime constatée. Si une future
version de `@panoramax/web-viewer` utilise une autre construction syntaxique non supportée,
`npm run build` échouera avec `Module parse failed: Unexpected token` — ajouter le plugin
`@babel/plugin-transform-*` correspondant à cette liste plutôt que de revenir à un preset
généraliste.

## Commandes

```bash
npm install
npm run watch      # build webpack en continu
npm run build      # build production → dist/main.js
npm run package     # build + création du ZIP distribuable
# publication directe sur le serveur GEO : nécessite le plugin Business Geografic (voir lib/README.md)
GEO_ACCESS_TOKEN=xxx npm run publish
```

> ⚠️ `npm run publish` renvoie une **erreur 500 du serveur GEO** avec ce module (constatée lors d'un test ; cause probable non confirmée : le bundle fait ~2,9 Mo, contre quelques Ko pour un module classique, et le plugin l'envoie en un seul champ de formulaire). **Importer le ZIP à la main** dans le Générateur est la méthode recommandée.
> Le plugin n'affiche l'échec que par un `console.log("Error while publishing to GEO", …)` : le build se termine en succès même si la publication échoue.

## Annexe : réassigner l'auteur des photos d'un compte Panoramax

Question hors périmètre du module (administration de l'instance Panoramax, pas de l'extension
GEO), mais utile à garder ici pour référence.

- **Pas d'endpoint API dédié** : la spec OpenAPI complète de l'instance publique
  (`https://api.panoramax.xyz/openapi.json`) ne contient aucune route pour réassigner
  `providers[].id`/`.name` ou `properties["geovisio:producer"]` sur des items existants, ni de
  fusion/transfert de compte.
- **La CLI officielle (`panoramax`, package `panoramax_cli`, dépôt
  https://gitlab.com/panoramax/clients/cli) le permet indirectement**, via la commande
  `migration` (`transfer` existe encore mais est **dépréciée** — elle affiche juste
  `"This command is deprecated. Please use panoramax migration instead."` et sort en erreur ;
  voir `panoramax_cli/main.py`).
  - `migration` **copie** des collections (séquences) d'une API source vers une API destination
    en s'authentifiant côté destination avec `--to-token` (`POST {to_api.url}/api/transfers`,
    voir `panoramax_cli/transfer.py`) — c'est donc **le compte authentifié en destination qui
    devient propriétaire des copies créées**.
  - Rien n'empêche `--from-api-url` et `--to-api-url` d'être la **même instance** avec des
    comptes différents, ce qui permet de facto de réassigner l'auteur d'un compte A vers un
    compte B :
    ```bash
    panoramax login --api-url https://ton-instance/api   # authentifie le compte B (destination)
    panoramax migration \
      --from-api-url https://ton-instance/api \
      --from-user <UUID_du_compte_A> \
      --to-api-url https://ton-instance/api \
      --to-token <token_du_compte_B> \
      --wait
    ```
  - **Attention** : ce n'est ni testé ni documenté officiellement pour ce cas d'usage précis
    (même instance, comptes différents) — les tests d'intégration du dépôt couvrent
    vraisemblablement le cas inter-instances. Tester d'abord sur une seule séquence
    (`--from-collection` plutôt que `--from-user`) avant de lancer sur l'ensemble d'un compte.
  - C'est une **copie**, pas un déplacement : les originaux restent sous le compte A. Pour un
    vrai transfert, supprimer ensuite côté source
    (`panoramax delete --api-url <src> --all-collections-of-user <A>`) une fois le transfert
    vérifié.
  - Les items recréés ont de **nouveaux UUID** : tout ce qui référence les anciens identifiants
    (permaliens, `?pic=` dans les liens Panoramax) casse après la bascule.
