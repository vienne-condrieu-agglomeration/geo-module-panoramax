# Journal des nouveautés

Toutes les évolutions notables du module « Vue immersive Panoramax ». Le format suit
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le versionnement
[SemVer](https://semver.org/lang/fr/).

Ce fichier est affiché dans GEO, dans la fenêtre « Nouveautés » du panneau : il s'écrit pour les
**utilisateurs**, en français, pas pour les développeurs (la liste des commits est dans git). La version
la plus récente publiée doit être celle de `package.json` et de `src/plugin.geoext.json`
(`npm test` le vérifie).

## [Non publié]

## [1.8.1] — 2026-10-23

### Ajouté

- Infobulle immédiate au survol de chaque bouton flottant du viewer (plein écran, ouvrir dans Panoramax, pointage,
  nouveautés, visite guidée), à la place de l'info-bulle du navigateur qui n'apparaissait pas
- La visite guidée présente maintenant aussi le bouton de pointage et le bouton « Nouveautés » (9 étapes)

### Modifié

- Boutons flottants réordonnés : plein écran, ouvrir dans Panoramax, pointage, nouveautés, puis le « ? » de la
  visite guidée tout en bas, dans l'ordre où la visite les présente

## [1.8.0] — 2026-10-23

### Modifié

- Le journal des nouveautés s'ouvre avec un bouton flottant (étincelles, sous le bouton de pointage) au lieu d'un
  bandeau en bas du panneau : la photo à 360° reprend toute la hauteur
- Visite guidée : une croix en haut à droite ferme la visite (elle ne revient plus d'elle-même), et deux boutons
  « Précédent » et « Suivant » permettent d'avancer ou de revenir d'une étape ; « Passer la visite » et
  « Passer cette étape » disparaissent

## [1.7.0] — 2026-10-23

Le module garde la trace de ses évolutions.

### Ajouté

- Fenêtre « Nouveautés » : le lien « v1.7.0 · Nouveautés » en bas du panneau ouvre ce journal, avec un point
  rouge tant que la dernière version n'a pas été lue

## [1.6.0] — 2026-10-23

### Ajouté

- Pointer un objet depuis la photo (première version, à éprouver sur de vraies photos) : le bouton « cible »
  active le mode pointage, un clic sur le pied d'un objet au sol (grille, regard, candélabre…) pose un point
  sur la carte GEO, avec son incertitude en mètres
- Les points sont listés dans le panneau, supprimables un à un, et exportables en GeoJSON et en CSV ; ils sont
  perdus au rechargement de la page
- Réglage du Générateur « Hauteur de la caméra » (2,5 m par défaut), qui sert au calcul de la distance

## [1.5.0] — 2026-10-14

### Ajouté

- Tuto d'accueil : une bulle sur l'onglet Panoramax au chargement de l'application, puis une visite en 7 étapes
  à la première ouverture du panneau. Trois étapes avancent quand on fait le geste (cliquer sur la carte, faire
  tourner la photo, passer à la photo suivante) ; on peut passer une étape, passer la visite ou ne plus l'afficher
- Le bouton « ? » relance la visite à tout moment
- Réglage du Générateur « Afficher la visite guidée au premier lancement »

### Modifié

- La visite guidée n'utilise plus Shepherd.js mais Driver.js (licence MIT)

## [1.4.0] — 2026-10-14

### Ajouté

- Le groupe de couches « Panoramax » de la légende se coche à l'ouverture du panneau et se décoche à sa
  fermeture (réglage du Générateur « Groupe de couches à afficher », vide pour désactiver)

## [1.3.0] — 2026-10-14

### Modifié

- À l'ouverture du panneau, la photo s'affiche en grand plutôt que la mini-carte du viewer ; le choix
  carte/photo de l'utilisateur est ensuite respecté

## [1.2.1] — 2026-10-09

### Corrigé

- La carte GEO ne se dézoome plus à chaque changement de photo

## [1.2.0] — 2026-10-09

### Ajouté

- Cône de vision sur le marqueur de la carte : il montre la direction regardée dans la photo et tourne avec elle

## [1.1.1] — 2026-10-06

### Modifié

- Module allégé : plus de dossier d'assets inutile dans le ZIP

## [1.1.0] — 2026-10-06

### Ajouté

- Le module se dépose dans le bandeau de droite, comme les autres panneaux de GEO ; le bouton flottant disparaît
- Confirmation avant d'afficher la vue immersive (réglage « Demander confirmation avant ouverture », avec « Ne plus demander »)
- Bouton « Ouvrir dans Panoramax » : la photo s'ouvre sur le site Panoramax
- Icônes des boutons du viewer remplacées par des icônes Lucide

## [1.0.0] — 2026-08-24

Première version : les photos à 360° de Panoramax dans un panneau de GEO.

### Ajouté

- Un clic sur la carte GEO affiche la photo Panoramax la plus proche ; la carte se recentre sur la photo affichée
  et un marqueur la suit
- Navigation dans la séquence de photos et bouton plein écran
- Bouton d'aide : visite guidée du panneau
- Possibilité de privilégier les photos d'un utilisateur Panoramax donné
- Réglages du Générateur : URL de l'instance et du site Panoramax, rayon de recherche, libellé de l'onglet
