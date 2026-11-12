import angular from "angular";
import pluginConf from '../plugin.geoext.json';
import { driver } from 'driver.js';
import { createChangelog } from './changelog.js';
import changelogMd from '../../CHANGELOG.md';
import 'driver.js/dist/driver.css';

// Cookie de session sur les tuiles de la mini-carte du visualiseur, instance privée (voir le fichier).
import { installInstanceCredentials } from './panora-credentials.js';

// Enregistre les web components <pnx-viewer>, <pnx-photo-viewer>, etc.
import '@panoramax/web-viewer';

angular
    .module(pluginConf.code.moduleName, pluginConf.code.dependencies)
    .run(['geoApplication', 'acfExtensionService', '$rootScope', '$timeout', '$injector',
          function (geoApplication, acfExtensionService, $rootScope, $timeout, $injector) {

        // ============================================================
        // Configuration (remplie depuis le générateur GEO)
        // ============================================================
        var _instanceUrl       = 'https://api.panoramax.xyz/api';
        var _privateInstance   = false; // true : envoie le cookie de session à l'instance (photos réservées aux connectés)
        var _siteUrl           = null; // site web public ; si vide, déduit de _instanceUrl
        var _searchRadius      = 0.0005;
        var _preferredUser          = null; // nom d'utilisateur ou UUID, insensible à la casse
        var _preferredUserCandidates = 20;
        // Journal des nouveautés : lien en bas du panneau, point rouge tant que la version n'a pas été lue
        var changelog = createChangelog({
            name: pluginConf.name, title: pluginConf.displayName, version: pluginConf.version,
            markdown: changelogMd, prefix: 'geo-pnx', zIndex: 1000000001
        });

        var _toolName           = 'Panoramax';
        var _confirmBeforeOpen  = true;
        var _layerGroupName     = 'Panoramax'; // groupe de couches GEO affiché tant que le panneau est ouvert
        var _showTourOnStart    = true;        // accroche + visite guidée automatiques au premier lancement
        var _pictureTypeDefault = null;        // réglage : null (toutes) | 'equirectangular' (360°) | 'flat' (plates)
        var _pictureType        = null;        // filtre en cours : réglage à l'ouverture, puis choix de l'utilisateur dans le viewer
        var _filterComposer     = null;        // gestionnaire de filtres du viewer (écouté pour suivre ses changements)
        var _showCoverageLayer  = false;       // séquences et photos dessinées sur la carte GEO tant que le panneau est ouvert
        var _registered         = false;
        var _widgetId           = null;
        var _panelWidthPct      = 50;
        var _cameraHeight       = 2.5;  // m, hauteur de la caméra au-dessus du sol (pointage)

        // Pointage d'objets : points posés depuis la photo, conservés tant que la page vit
        // (le panneau peut être fermé/rouvert), perdus au rechargement : à exporter.
        var _POINT_MARKER_PREFIX = 'geo-panoramax-point-';
        var _POINT_TYPES    = ['Grille', 'Regard', 'Candélabre', 'Autre'];
        var _POINT_MAX_DIST = 40;   // m, au-delà l'erreur sur la hauteur de caméra dépasse le mètre
        var _POINT_MIN_PITCH = 2;   // ° sous l'horizon, en deçà la visée est quasi parallèle au sol
        var _POINT_GPS_DEFAULT = 5; // m, si la photo ne déclare pas quality:horizontal_accuracy
        var _POINT_HEIGHT_SIGMA = 0.3; // m, incertitude supposée sur la hauteur de caméra
        var _points         = [];
        var _pointSeq       = 0;

        var _NEVER_ASK_KEY = 'geo-panoramax-neverConfirm';
        var _MARKER_ID     = 'geo-panoramax-marker';
        var _markerPlaced  = false;
        // Cône de vision : cap courant de la vue (degrés, 0 = Nord), dernière position du
        // marqueur, et file d'attente minimale (un seul remove/add GEO en vol à la fois).
        var _heading        = null;
        var _lastLonLat     = null;
        var _markerBusy     = false;
        var _markerPending  = false;
        var _pendingRecenter = false;
        var _FULLSCREEN_BODY_CLASS = 'geo-panoramax-fullscreen-active';
        var _PANEL_BODY_CLASS = 'geo-pnx-panel-open'; // panneau ouvert : sert à décaler la barre d'annotation de GEO

        // Scope actif (widget) et référence à l'élément <pnx-viewer> courant
        var _currentScope  = null;
        var _viewerEl       = null;

        // ============================================================
        // Lecture config GEO Generator + enregistrement
        // ============================================================
        // Instance privée : cookie joint aux tuiles de la mini-carte du visualiseur (de l'instance configurée seulement).
        installInstanceCredentials(function (url) { return _privateInstance && _sameOrigin(url, _instanceUrl); });

        geoApplication.executeWhenInitialized(function () {
            var config = geoApplication.getConfigurationByExtensionKey(pluginConf.name);

            if (config && config.length > 0) {
                var props = config[0].properties;

                _instanceUrl      = _httpUrlOr(props.panoramaxInstanceUrl, _instanceUrl, 'URL de l\'instance Panoramax').replace(/\/+$/, '');
                _siteUrl          = _httpUrlOr(props.panoramaxSiteUrl, null, 'URL du site Panoramax');
                if (_siteUrl) { _siteUrl = _siteUrl.replace(/\/+$/, '') || null; }
                _searchRadius     = parseFloat(props.searchRadius) || _searchRadius;
                _preferredUser    = (props.preferredUser || '').trim() || null;
                _preferredUserCandidates = parseInt(props.preferredUserCandidates, 10) || _preferredUserCandidates;
                _toolName         = props.toolName       || _toolName;
                _confirmBeforeOpen = props.confirmBeforeOpen !== false && props.confirmBeforeOpen !== 'false';
                // Vide = désactivé ; absent (config antérieure au réglage) = valeur par défaut.
                _layerGroupName   = (props.layerGroupName == null ? _layerGroupName : String(props.layerGroupName)).trim() || null;
                _showTourOnStart  = props.showTourOnStart !== false && props.showTourOnStart !== 'false';
                _cameraHeight     = parseFloat(props.cameraHeight) || _cameraHeight;
                _showCoverageLayer = props.showCoverageLayer === true || props.showCoverageLayer === 'true';
                _pictureTypeDefault = _pictureType = _parsePictureType(props.pictureType);
                _privateInstance  = props.privateInstance === true || props.privateInstance === 'true';
            }

            if (!_registered) {
                _registered = true;
                _injectStyles();
                _registerWidget();
                _startTeaser(0);
            }
        });

        // ============================================================
        // Panneau natif GEO (registerWidgetExtension)
        // ============================================================
        function _registerWidget() {
            acfExtensionService.registerWidgetExtension({
                type:         'rightPanel',
                key:          pluginConf.name,
                extensionKey: pluginConf.name,
                name:         _toolName,
                // Icône native GEO : .launcher-icon fournit déjà la police "icons", pas besoin
                // de notre SVG custom ici (qui, lui, doit forcer sa propre taille et écrasait
                // le dimensionnement piloté par .launcher-icon dans la sidebar).
                icon:         'icon_panoramax',
                active:       false,
                widthPolicy:  'custom',
                enable:       function () { return true; },
                template:     _buildTemplate(),
                controller:   _buildController(),
                configure:    function (ext) {
                    _widgetId = ext && ext.id ? ext.id : pluginConf.name;
                    _requestPanelWidthSoon();
                }
            });

            $rootScope.$on('activeRightTabChanged', function (event, tabId) {
                if (tabId === pluginConf.name || tabId === _widgetId) {
                    _requestPanelWidthSoon();
                }
            });
        }

        // Le panneau natif GEO est étroit par défaut : le viewer Panoramax (carte + photo
        // 360°) a besoin de place pour rester utilisable. On l'élargit à moitié écran.
        function _requestPanelWidth() {
            $rootScope.$broadcast('EXTENSION_WIDGET_ACTION', {
                action:   'setPanelSize',
                widgetId: _widgetId || pluginConf.name,
                width:    _panelWidthPct
            });
            window.dispatchEvent(new Event('resize'));
        }

        function _requestPanelWidthSoon() {
            [0, 100, 300].forEach(function (delay) {
                setTimeout(_requestPanelWidth, delay);
            });
        }

        // La confirmation éventuelle est demandée dans le panneau lui-même (cf. template) :
        // GEO ouvre le panneau sans passer par le code du module.
        // "Ne plus demander" est mémorisé dans le navigateur (localStorage peut être indisponible).
        function _isNeverAsk() {
            try { return window.localStorage.getItem(_NEVER_ASK_KEY) === '1'; } catch (e) { return false; }
        }
        function _setNeverAsk() {
            try { window.localStorage.setItem(_NEVER_ASK_KEY, '1'); } catch (e) { /* ignoré */ }
        }

        // ============================================================
        // Icônes Lucide (https://lucide.dev, licence ISC), SVG copiés tels quels plutôt
        // que d'embarquer la bibliothèque : trait en currentColor, donc la couleur suit le CSS.
        // ============================================================
        function _lucideSvg(inner) {
            return '<svg class="geo-pnx-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ' +
                   'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
                   'stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
        }

        var _LUCIDE = {
            link: _lucideSvg(
                '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
                '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
            maximize: _lucideSvg(
                '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/>' +
                '<path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>'),
            minimize: _lucideSvg(
                '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/>' +
                '<path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>'),
            crosshair: _lucideSvg(
                '<circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/>' +
                '<line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/>' +
                '<line x1="12" x2="12" y1="22" y2="18"/>'),
            sparkles: _lucideSvg(
                '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>' +
                '<path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>'),
            help: _lucideSvg(
                '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>' +
                '<path d="M12 17h.01"/>')
        };

        // ============================================================
        // Template Angular du widget
        // ============================================================
        function _buildTemplate() {
            return [
                '<div class="geo-pnx-widget">',
                // Confirmation avant de charger le viewer (réglage « Demander confirmation »).
                '  <div class="geo-pnx-confirm" ng-if="!confirmed">',
                '    <h3>Panoramax</h3>',
                '    <p ng-if="!declined">Vous êtes sur le point d\'afficher une vue immersive Panoramax. Souhaitez-vous continuer ?</p>',
                '    <p ng-if="declined">La vue immersive n\'est pas chargée. Vous pouvez refermer ce panneau.</p>',
                '    <div class="geo-pnx-confirm-actions">',
                '      <button class="geo-pnx-btn geo-pnx-btn--ghost" ng-if="!declined" ng-click="decline()">Non</button>',
                '      <button class="geo-pnx-btn geo-pnx-btn--ghost" ng-click="accept(true)">Ne plus demander</button>',
                '      <button class="geo-pnx-btn geo-pnx-btn--primary" ng-click="accept(false)">Oui</button>',
                '    </div>',
                '  </div>',
                // Instance privée, utilisateur non connecté : bandeau de connexion (fenêtre qui se referme seule).
                '  <div class="geo-pnx-login" ng-if="loginNeeded" role="note">',
                '    <span>Cette instance Panoramax est réservée aux utilisateurs connectés.</span>',
                '    <button class="geo-pnx-btn geo-pnx-btn--primary" ng-click="login()" ng-disabled="loginPending">',
                '      {{ loginPending ? \'Connexion en cours…\' : \'Se connecter à Panoramax\' }}',
                '    </button>',
                '  </div>',
                '  <div class="geo-pnx-viewer-wrap" ng-if="confirmed">',
                // focus="pic" est déjà la valeur par défaut du composant : le poser en
                // attribut statique déclenche attributeChangedCallback avant que le
                // sous-composant carte interne du viewer soit prêt (Uncaught Error:
                // Map is not enabled) — on laisse le défaut faire son travail.
                // url-parameters="false" : le viewer ne réécrit plus l'adresse de la page GEO
                // (?focus=…&pic=…&seq=…, pushState à chaque photo). Dans GEO, ce changement
                // d'adresse fait recharger l'application, et les paramètres laissés dans l'adresse
                // rouvraient une ancienne photo au chargement suivant. Lu dans connectedCallback :
                // il doit donc être présent dès l'insertion (attribut statique, pas une valeur par défaut).
                '    <pnx-viewer class="geo-pnx-viewer" url-parameters="false"></pnx-viewer>',
                // Colonne de boutons flottants, de haut en bas : plein écran, ouvrir dans Panoramax, pointage,
                // nouveautés, aide (visite guidée). L'infobulle (data-tip, CSS) apparaît dès le survol : le title
                // natif tardait ou n'apparaissait pas dans GEO.
                '    <button class="geo-pnx-fullscreen-btn" ng-class="{\'geo-pnx-fullscreen-btn--active\': isFullscreen}"',
                '            ng-click="toggleFullscreen()" data-tip="{{ isFullscreen ? \'Quitter le plein écran\' : \'Plein écran\' }}"',
                '            aria-label="{{ isFullscreen ? \'Quitter le plein écran\' : \'Plein écran\' }}">',
                '      <span ng-if="!isFullscreen">' + _LUCIDE.maximize + '</span>',
                '      <span ng-if="isFullscreen">' + _LUCIDE.minimize + '</span>',
                '    </button>',
                '    <button class="geo-pnx-open-btn" ng-click="openExternally()" ng-disabled="!currentPicId"',
                '            data-tip="{{ currentPicId ? \'Ouvrir dans Panoramax\' : \'Ouvrir dans Panoramax (aucune photo affichée)\' }}" aria-label="Ouvrir dans Panoramax">',
                '      ' + _LUCIDE.link,
                '    </button>',
                '    <button class="geo-pnx-point-btn" ng-class="{\'geo-pnx-fullscreen-btn--active\': pointing}"',
                '            ng-click="togglePointing()" ng-disabled="!currentPicId"',
                '            data-tip="Pointer un objet sur la photo (expérimental)" aria-label="Pointer un objet sur la photo (fonctionnalité expérimentale)">',
                '      ' + _LUCIDE.crosshair,
                '    </button>',
                '    <button class="geo-pnx-changelog-btn" ng-click="openChangelog()" data-tip="{{ changelogTitle }}" aria-label="Nouveautés du module">',
                '      ' + _LUCIDE.sparkles,
                '      <i class="geo-pnx-dot-new" ng-if="changelogNew()"></i>',
                '    </button>',
                '    <button class="geo-pnx-help-btn" ng-click="startTour()" data-tip="Visite guidée" aria-label="Visite guidée">',
                '      ' + _LUCIDE.help,
                '    </button>',
                '    <div class="geo-pnx-hint" ng-if="pointing">',
                '      Cliquez sur le <strong>pied</strong> de l\'objet, au sol, pour le placer sur la carte.',
                '    </div>',
                '    <div class="geo-pnx-hint" ng-if="!currentPicId && !statusMessage">',
                '      Cliquez sur la carte pour afficher la photo Panoramax la plus proche.',
                '    </div>',
                '  </div>',
                '  <div class="geo-pnx-points" ng-if="confirmed && (pointing || points.length)">',
                // Avertissement permanent tant que le panneau de pointage est affiché : aucune mesure
                // ne permet aujourd'hui de garantir la précision des positions calculées.
                '    <div class="geo-pnx-warning" role="note">',
                '      <strong>Fonctionnalité expérimentale.</strong> La précision des points n\'est pas garantie :',
                '      ne vous y fiez pas, vérifiez toujours sur le terrain ou sur une source fiable.',
                '    </div>',
                '    <div class="geo-pnx-points-bar">',
                '      <label>Type :',
                '        <select ng-model="pointInput.type" ng-options="t for t in pointTypes"></select>',
                '      </label>',
                '      <span class="geo-pnx-points-spacer"></span>',
                '      <button class="geo-pnx-btn geo-pnx-btn--ghost" ng-disabled="!points.length" ng-click="exportPoints(\'geojson\')">GeoJSON</button>',
                '      <button class="geo-pnx-btn geo-pnx-btn--ghost" ng-disabled="!points.length" ng-click="exportPoints(\'csv\')">CSV</button>',
                '      <button class="geo-pnx-btn geo-pnx-btn--ghost" ng-disabled="!points.length" ng-click="clearPoints()">Tout effacer</button>',
                '    </div>',
                '    <ul class="geo-pnx-points-list">',
                '      <li ng-repeat="pt in points">',
                '        <span>{{ pt.index }}. {{ pt.type }} — incertitude estimée ±{{ pt.accuracy }} m</span>',
                '        <button class="geo-pnx-points-del" ng-click="removePoint(pt)" title="Supprimer ce point">×</button>',
                '      </li>',
                '    </ul>',
                '  </div>',
                '  <div class="geo-pnx-status" ng-if="statusMessage">{{ statusMessage }}</div>',
                '</div>'
            ].join('\n');
        }

        // ============================================================
        // Contrôleur Angular du widget
        // ============================================================
        function _buildController() {
            return ['$scope', '$element', function ($scope, $element) {
                _currentScope = $scope;
                // Le panneau est ouvert : l'accroche sur l'onglet n'a plus lieu d'être, quel
                // que soit l'élément GEO cliqué pour l'ouvrir (rien n'est mémorisé).
                _cancelTeaser();
                _setLayerGroupVisible(true);
                _setCoverageVisible(true);
                _panelWidthPct = 50; // état par défaut à chaque (re)ouverture du panneau

                $scope.currentPicId    = null;
                $scope.currentSeqId    = null;
                $scope.statusMessage   = null;
                $scope.isFullscreen    = false;
                // Le viewer n'est créé (et Panoramax interrogé) qu'après confirmation éventuelle.
                $scope.confirmed       = !_confirmBeforeOpen || _isNeverAsk();
                $scope.declined        = false;
                $scope.pointing        = false;
                $scope.loginNeeded     = false;
                $scope.loginPending    = false;
                $scope.points          = _points;
                $scope.pointTypes      = _POINT_TYPES;
                // Objet (et non primitive) : le select est dans un ng-if, donc un scope enfant.
                $scope.pointInput      = { type: _POINT_TYPES[0] };

                var _selectHandler   = null;
                var _readyHandled    = false;
                var _pointerClickSub = null;

                $scope.toggleFullscreen = function () {
                    $scope.isFullscreen = !$scope.isFullscreen;
                    _panelWidthPct = $scope.isFullscreen ? 100 : 50;
                    _requestPanelWidthSoon();
                    // En plein écran, la carte n'a (presque) plus de place visible : le
                    // toolbar topright (dessin, sélection...) se replie et chevauche le
                    // toolbar topleft (zoom, géoloc). On le masque tant qu'on est plein écran.
                    document.body.classList.toggle(_FULLSCREEN_BODY_CLASS, $scope.isFullscreen);
                };

                // Barre d'annotation de GEO (.acf-feature-tools-bar, left/right 64px) : centrée sur
                // toute la fenêtre, elle passe sous le panneau. On publie la distance entre le
                // bord droit de la fenêtre et le bord gauche du panneau (variable CSS, cf. règle
                // dans _injectStyles) pour la recentrer sur la partie visible de la carte.
                var _panelResizeObs = null;
                function _publishPanelOffset() {
                    var el = _viewerEl || $element[0];
                    var rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
                    if (!rect || rect.width < 50 || rect.left < 0 || rect.left > window.innerWidth) { return; }
                    document.documentElement.style.setProperty('--geo-pnx-panel-right', (window.innerWidth - rect.left) + 'px');
                    document.body.classList.add(_PANEL_BODY_CLASS);
                }
                // « resize » est aussi émis par _requestPanelWidth après chaque changement de largeur.
                window.addEventListener('resize', _publishPanelOffset);
                if (typeof ResizeObserver === 'function') {
                    _panelResizeObs = new ResizeObserver(_publishPanelOffset);
                    _panelResizeObs.observe($element[0]);
                }
                $timeout(_publishPanelOffset, 0, false);

                $scope.openExternally = function () {
                    if (!$scope.currentPicId) { return; }
                    // Le lien vise le site web public, pas l'API : URL du site configurée, sinon
                    // URL de l'API sans son suffixe /api (vrai quand site et API partagent le domaine).
                    var siteUrl = _siteUrl || _instanceUrl.replace(/\/api$/, '');
                    // Même forme que les liens de partage Panoramax : focus sur la photo, avec sa
                    // séquence. Indispensable avec un méta-catalogue (ex. api.panoramax.xyz) : la
                    // photo peut venir d'une autre instance que celle du site ouvert.
                    var url = siteUrl + '/?focus=pic&pic=' + encodeURIComponent($scope.currentPicId);
                    if ($scope.currentSeqId) { url += '&seq=' + encodeURIComponent($scope.currentSeqId); }
                    // noopener,noreferrer : la page ouverte n'a pas accès à window.opener (reverse tabnabbing)
                    window.open(url, '_blank', 'noopener,noreferrer');
                };

                $scope.startTour = function () { _startTour(); };

                // Bouton « Nouveautés » : le point rouge disparaît une fois le journal ouvert.
                $scope.changelogTitle = 'Nouveautés du module' + (changelog.current ? ' (v' + changelog.current + ')' : '');
                $scope.changelogNew   = function () { return changelog.hasNew(); };
                $scope.openChangelog  = function () { changelog.open(); };

                $scope.togglePointing = function () { $scope.pointing = !$scope.pointing; };

                $scope.removePoint = function (pt) {
                    var i = _points.indexOf(pt);
                    if (i >= 0) { _points.splice(i, 1); }
                    _removePointMarkers([pt]);
                };

                $scope.clearPoints = function () {
                    _removePointMarkers(_points.splice(0, _points.length));
                };

                $scope.exportPoints = function (format) { _exportPoints(format); };

                // Clic sur la photo en mode pointage : le clic donne une direction (cap +
                // inclinaison sous l'horizon), complétée par la hauteur de la caméra pour
                // retomber sur le sol (méthode A de l'issue #9). Ignorés : clic droit, flèches
                // de navigation et marqueurs du viewer.
                function _onPhotoClick(event) {
                    var d = event.data;
                    // Seules les flèches de navigation (userData.tourLink, plugin virtual-tour)
                    // sont ignorées : d.objects contient d'autres maillages sur un clic au sol.
                    var onLink = d && (d.objects || []).some(function (o) {
                        return o.userData && o.userData.tourLink;
                    });
                    if (!$scope.pointing || !d || d.rightclick || d.marker || onLink) {
                        return;
                    }
                    var meta = _psvEl && _psvEl.getPictureMetadata && _psvEl.getPictureMetadata();
                    var res = _projectToGround(meta, d.yaw, d.pitch);
                    if (res.error) { _setStatus(res.error); return; }
                    _setStatus(null);
                    var pt = _addPoint(res, meta, $scope.pointInput.type);
                    $timeout(function () { $scope.points = _points; });
                    _addPointMarker(pt);
                }

                function _onReady() {
                    if (_readyHandled) { return; }
                    _readyHandled = true;
                    _applyViewerPictureFilter();
                    var extent = geoApplication.map && geoApplication.map.extent;
                    if (extent) {
                        var center = [(extent.minX + extent.maxX) / 2, (extent.minY + extent.maxY) / 2];
                        _locateFromMapClick(center, extent.crs);
                    }

                    // Tant que le panneau est ouvert, un clic sur la carte GEO recherche et
                    // affiche la photo Panoramax la plus proche du point cliqué — c'est le
                    // vrai lien avec la carte GEO (le viewer suit la carte, pas l'inverse).
                    if (geoApplication.map && geoApplication.map.on) {
                        _pointerClickSub = geoApplication.map.on('pointerClick', function (event) {
                            _tourNotify('click');
                            _locateFromMapClick(event.coordinates, event.crs);
                        });
                    }

                    // Visite guidée automatique tant qu'elle n'a été ni terminée, ni passée, ni
                    // désactivée. Léger délai : laisser le viewer poser ses boutons.
                    if (_tourPending()) {
                        $timeout(function () { if (_currentScope === $scope) { _startTour(); } }, 500);
                    }

                    // Cône de vision : "view-rotated" est émis par le sous-composant photo
                    // (psv) sans bubbling, donc écouté sur lui et pas sur <pnx-viewer>.
                    if (_viewerEl && _viewerEl.psv) {
                        _psvEl = _viewerEl.psv;
                        _psvEl.addEventListener('view-rotated', _onViewRotated);
                        _psvEl.addEventListener('picture-loaded', _onPictureLoaded);
                        _psvEl.addEventListener('click', _onPhotoClick);
                    } else {
                        console.error('[geo-panoramax] viewer.psv absent : cône de vision et pointage désactivés.');
                    }
                    // Points posés avant une fermeture du panneau : on les redessine.
                    _points.forEach(_addPointMarker);
                }

                var _psvEl = null;

                // detail.x = cap de la vue en degrés (0 = Nord, 90 = Est), cf. Photo.js du viewer.
                // Émis en continu pendant un glisser : on ignore les variations < 3° pour ne
                // pas saturer la carte GEO de remove/add de marqueur.
                function _onViewRotated(event) {
                    var x = event.detail && event.detail.x;
                    if (typeof x !== 'number' || isNaN(x)) { return; }
                    x = ((x % 360) + 360) % 360;
                    if (_heading !== null) {
                        var delta = Math.abs(x - _heading) % 360;
                        if (Math.min(delta, 360 - delta) < 3) { return; }
                    }
                    _heading = x;
                    if (_lastLonLat) { _drawMarker(_lastLonLat, false); }
                    _tourNotify('rotate', x);
                }

                // Cap de référence à chaque nouvelle photo : "view-rotated" n'est pas garanti
                // au chargement, et s'il arrive avant les métadonnées il est calculé avec
                // l'azimut de la photo précédente (ou 0). "picture-loaded" est émis une fois
                // les métadonnées chargées, avec le cap corrigé (detail.x) et la position
                // (detail.lon/lat) : on l'applique sans le filtre des 3°.
                function _onPictureLoaded(event) {
                    var d = event.detail || {};
                    if (typeof d.x !== 'number' || isNaN(d.x)) { return; }
                    _heading = ((d.x % 360) + 360) % 360;
                    if (typeof d.lon === 'number' && typeof d.lat === 'number') {
                        _lastLonLat = [d.lon, d.lat];
                    }
                    // Sans recentrage : il est fait par _placeMarkerForPicture (événement select).
                    if (_lastLonLat) { _drawMarker(_lastLonLat, false); }
                }

                var _lastProcessedPicId = null;

                function _onSelect(event) {
                    var detail = event.detail || {};
                    $timeout(function () {
                        $scope.currentPicId = detail.picId || null;
                        $scope.currentSeqId = detail.seqId || null;
                        // Une photo est affichée : un message « Aucune photo… » laissé par une
                        // recherche précédente (ouverture, clic carte) ne serait plus vrai.
                        if (detail.picId) { $scope.statusMessage = null; }
                    });
                    // "select" se déclenche parfois deux fois d'affilée pour une même photo
                    // (une fois pour la séquence, une fois pour la photo) : ne replacer le
                    // marqueur (et donc ne recentrer/décaler la carte) qu'une seule fois.
                    if (detail.picId && detail.seqId && detail.picId !== _lastProcessedPicId) {
                        // Sans photo au démarrage, le viewer affiche la carte en grand et ne
                        // repasse pas sur la photo à la première sélection : on le fait ici,
                        // une seule fois (ensuite, le choix carte/photo de l'utilisateur prime).
                        if (_lastProcessedPicId === null) { _viewerEl.setAttribute('focus', 'pic'); }
                        _lastProcessedPicId = detail.picId;
                        _placeMarkerForPicture(detail.seqId, detail.picId);
                        _tourNotify('select', detail.picId);
                    }
                }

                $scope.accept = function (neverAsk) {
                    if (neverAsk) { _setNeverAsk(); }
                    $scope.confirmed = true;
                    _initViewer();
                };

                $scope.decline = function () { $scope.declined = true; };

                // ---- Connexion automatique (instance privée) ----
                // La connexion passe par une fenêtre vers /auth/login : avec le SSO déjà ouvert (Entra ID via
                // Keycloak), la chaîne de redirections aboutit sans saisie. GEO ne peut pas lire l'adresse de la
                // fenêtre (autre site) : il sonde /users/me (toutes les 250 ms) jusqu'à ce que la session existe, puis la ferme.
                var _loginTimer = null;
                var _loginWin = null;

                // true : connecté ; false : non connecté ; null : indéterminé (réseau, CORS).
                // redirect:'manual' : sans session, l'API répond 302 vers Keycloak, qu'un fetch suivrait
                // jusqu'à un échec CORS ; la redirection non suivie (opaqueredirect) signifie « non connecté ».
                function _checkLogin() {
                    return fetch(_instanceUrl + '/users/me', { credentials: 'include', redirect: 'manual' })
                        .then(function (r) { return r.type === 'opaqueredirect' ? false : (r.ok ? true : (r.status === 401 ? false : null)); })
                        .catch(function () { return null; });
                }

                function _stopLoginPolling() {
                    if (_loginTimer) { clearInterval(_loginTimer); _loginTimer = null; }
                    if (_loginWin) { try { _loginWin.close(); } catch (e) { /* déjà fermée */ } _loginWin = null; }
                    $scope.loginPending = false;
                }

                // Recrée le visualiseur : ses requêtes déjà faites sans session (recherche, tuiles) sont vides.
                function _reloadViewerAfterLogin() {
                    _stopFollowingViewerFilters();
                    if (_psvEl) {
                        _psvEl.removeEventListener('view-rotated', _onViewRotated);
                        _psvEl.removeEventListener('picture-loaded', _onPictureLoaded);
                        _psvEl.removeEventListener('click', _onPhotoClick);
                        _psvEl = null;
                    }
                    _readyHandled = false;
                    if (!$scope.confirmed) { return; }
                    $scope.confirmed = false;
                    $timeout(function () { $scope.confirmed = true; _initViewer(); });
                }

                $scope.login = function () {
                    if ($scope.loginPending) { return; }
                    var url = _instanceUrl + '/auth/login?next_url=' + encodeURIComponent(_instanceUrl + '/configuration');
                    _loginWin = window.open(url, 'geo-pnx-login', 'width=520,height=640');
                    if (!_loginWin) {
                        $scope.statusMessage = 'Le navigateur a bloqué la fenêtre de connexion : autorisez les fenêtres surgissantes pour ce site.';
                        return;
                    }
                    $scope.loginPending = true;
                    var started = Date.now();
                    var busy = false;
                    // 250 ms : la page d'arrivée de la fenêtre (JSON de /configuration) n'est visible qu'un instant.
                    _loginTimer = setInterval(function () {
                        if (busy) { return; }
                        busy = true;
                        var closedByUser = _loginWin && _loginWin.closed;
                        _checkLogin().then(function (state) {
                            busy = false;
                            if (!_loginTimer) { return; }
                            if (state === true) {
                                _stopLoginPolling();
                                $scope.$evalAsync(function () { $scope.loginNeeded = false; $scope.statusMessage = null; _reloadViewerAfterLogin(); });
                            } else if (closedByUser || Date.now() - started > 120000) {
                                _stopLoginPolling();
                                $scope.$evalAsync(function () {});
                            }
                        });
                    }, 250);
                };

                if (_privateInstance) {
                    // Le bandeau n'apparaît que si l'instance a une authentification et que l'utilisateur n'est pas connecté.
                    fetch(_instanceUrl + '/configuration')
                        .then(function (r) { return r.ok ? r.json() : null; })
                        .then(function (conf) { return conf && conf.auth && conf.auth.enabled ? _checkLogin() : null; })
                        .then(function (state) { if (state === false) { $scope.$evalAsync(function () { $scope.loginNeeded = true; }); } })
                        .catch(function () { /* état inconnu : pas de bandeau */ });
                }

                function _initViewer() { $timeout(function () {
                    _viewerEl = $element[0].querySelector('pnx-viewer');
                    if (!_viewerEl) { return; }
                    // Instance privée : le visualiseur joint lui aussi le cookie (API, tuiles, images 360°).
                    // ATTENTION À L'ORDRE : poser « endpoint » crée l'API du viewer sur-le-champ
                    // (attributeChangedCallback → _setupAPI) avec la valeur de « fetch-options » à cet
                    // instant ; l'attribut posé après n'a plus d'effet (recherche et tuiles anonymes).
                    if (_privateInstance) {
                        _viewerEl.setAttribute('fetch-options', JSON.stringify({ credentials: 'include' }));
                    }
                    // L'attribut endpoint doit être posé en JS (pas via {{}}) : le custom
                    // element lit ses attributs dans connectedCallback, avant que le digest
                    // Angular n'ait eu la chance d'interpoler le template (cf. démo officielle
                    // qui fait pareil : setAttribute('endpoint', ...) après insertion DOM).
                    _viewerEl.setAttribute('endpoint', _instanceUrl);
                    // Désactive la fédération multi-instances (recherche/photos d'autres
                    // instances Panoramax connues) : on ne veut interroger que _instanceUrl,
                    // et ça évite des requêtes CORS parasites vers ces autres instances.
                    _viewerEl.setAttribute('metacatalog', 'false');
                    // NB : widgets="false" supprimait aussi les flèches précédent/suivant et le
                    // lecteur de séquence (tout ou rien côté composant, pas de sélection fine
                    // possible) — on garde donc le jeu de widgets par défaut malgré la barre de
                    // recherche/géoloc redondante avec la carte GEO. Le panneau élargi à 50%
                    // (cf. _requestPanelWidth) limite la gêne visuelle.
                    _viewerEl.addEventListener('ready', _onReady);
                    _selectHandler = _onSelect;
                    _viewerEl.addEventListener('select', _selectHandler);
                }); }

                if ($scope.confirmed) { _initViewer(); }

                $scope.$on('$destroy', function () {
                    // Panneau fermé en pleine visite : on l'arrête sans rien mémoriser, elle
                    // reprendra au début à la prochaine ouverture.
                    if (_tour && _tour.isActive()) { _tour.destroy(); }
                    _tourWaiting = null;
                    _hideMapAnchor();
                    _stopFollowingViewerFilters();
                    _stopLoginPolling();
                    if (_viewerEl && _selectHandler) {
                        _viewerEl.removeEventListener('select', _selectHandler);
                    }
                    if (_psvEl) {
                        _psvEl.removeEventListener('view-rotated', _onViewRotated);
                        _psvEl.removeEventListener('picture-loaded', _onPictureLoaded);
                        _psvEl.removeEventListener('click', _onPhotoClick);
                        _psvEl = null;
                    }
                    _heading = null;
                    _lastLonLat = null;
                    // Un cycle remove/add en vol ne doit pas rejouer un dessin après la fermeture.
                    _markerBusy = false;
                    _markerPending = false;
                    _pendingRecenter = false;
                    if (_pointerClickSub) {
                        _pointerClickSub.unsubscribe();
                        _pointerClickSub = null;
                    }
                    document.body.classList.remove(_FULLSCREEN_BODY_CLASS);
                    window.removeEventListener('resize', _publishPanelOffset);
                    if (_panelResizeObs) { _panelResizeObs.disconnect(); _panelResizeObs = null; }
                    document.body.classList.remove(_PANEL_BODY_CLASS);
                    document.documentElement.style.removeProperty('--geo-pnx-panel-right');
                    _viewerEl = null;
                    _currentScope = null;
                    _removeMarker();
                    _setLayerGroupVisible(false);
                    _setCoverageVisible(false);
                    _removePointMarkers(_points);
                });
            }];
        }

        // Point cliqué sur la carte GEO → transformation en EPSG:4326 (si nécessaire)
        // puis recherche de la photo la plus proche.
        function _locateFromMapClick(coordinates, crs) {
            if (!coordinates) { return; }
            if (!crs || crs === 'EPSG:4326') {
                _locateNearestPicture(coordinates);
                return;
            }
            geoApplication.transform(coordinates, crs, 'EPSG:4326').subscribe(
                function (lonLat) { _locateNearestPicture(lonLat); },
                function (err) { console.error('[geo-panoramax] transform a échoué :', err); }
            );
        }

        // Parmi les candidats (déjà triés par proximité par l'API), retient le premier de
        // l'utilisateur privilégié (par nom ou UUID, insensible à la casse) s'il y en a un,
        // sinon retombe sur le tout premier (le plus proche, tous utilisateurs confondus).
        function _pickPreferredFeature(features) {
            if (!features.length) { return null; }
            if (!_preferredUser) { return features[0]; }

            var wanted = _preferredUser.toLowerCase();
            for (var i = 0; i < features.length; i++) {
                var providers = features[i].providers || [];
                for (var j = 0; j < providers.length; j++) {
                    var p = providers[j];
                    if ((p.name && p.name.toLowerCase() === wanted) ||
                        (p.id && p.id.toLowerCase() === wanted)) {
                        return features[i];
                    }
                }
                var producer = features[i].properties && features[i].properties['geovisio:producer'];
                if (producer && producer.toLowerCase() === wanted) {
                    return features[i];
                }
            }
            return features[0];
        }

        // Réglage « type de photos » : le texte lisible du Générateur (ENUMERATED, les `labels` sont
        // ignorés) est converti en valeur `pic_type` de Panoramax ; vide ou inconnu = toutes.
        function _parsePictureType(value) {
            var v = String(value == null ? '' : value).toLowerCase();
            if (v.indexOf('360') !== -1) { return 'equirectangular'; }
            if (v.indexOf('plate') !== -1) { return 'flat'; }
            return null;
        }

        // Une photo à 360° annonce un champ de vision de 360 ; une photo plate n'en a pas (constaté
        // sur api.panoramax.xyz).
        function _matchesPictureType(feature) {
            if (!_pictureType) { return true; }
            var orient = feature && feature.properties && feature.properties['pers:interior_orientation'];
            var is360 = !!orient && Number(orient.field_of_view) === 360;
            return _pictureType === 'equirectangular' ? is360 : !is360;
        }

        // Recherche des photos autour d'un point. Avec un type de photos choisi, le filtre est demandé au
        // serveur (`filter=field_of_view…`, STAC) ; si l'instance le refuse (ancienne version), repli sur
        // une recherche sans filtre triée côté navigateur. Dans tous les cas le résultat est revérifié,
        // car une instance peut aussi ignorer le filtre sans erreur.
        function _searchPictures(api, lat, lon, limit) {
            if (!_pictureType) {
                return api.getPicturesAroundCoordinates(lat, lon, _searchRadius, limit);
            }
            var lim = Math.max(limit, 20);
            var url = api.getPicturesAroundCoordinatesUrl(lat, lon, _searchRadius, lim) + '&filter=' +
                encodeURIComponent(_pictureType === 'flat' ? 'field_of_view<360' : 'field_of_view=360');
            return fetch(url, _fetchOpts())
                .then(function (r) { if (!r.ok) { throw new Error('HTTP ' + r.status); } return r.json(); })
                .catch(function (err) {
                    console.warn('[geo-panoramax] filtre serveur refusé, tri côté navigateur :', err);
                    return api.getPicturesAroundCoordinates(lat, lon, _searchRadius, lim);
                })
                .then(function (fc) {
                    var features = ((fc && fc.features) || []).filter(_matchesPictureType);
                    return { features: features };
                });
        }

        // Filtre de départ de la mini-carte du viewer (url-parameters="false" : pas de paramètre d'URL).
        // L'utilisateur peut ensuite le changer dans le menu des filtres du viewer : le module suit ce
        // choix (tracé sur la carte GEO, recherche au clic) via l'événement « filters-changed ».
        function _applyViewerPictureFilter() {
            _pictureType = _pictureTypeDefault; // chaque ouverture repart du réglage
            if (_viewerEl && _viewerEl.mapStyleComposer && !_filterComposer) {
                _filterComposer = _viewerEl.mapStyleComposer;
                _filterComposer.addEventListener('filters-changed', _onViewerFiltersChanged);
            }
            if (!_pictureType) { return; }
            if (!_viewerEl || !_viewerEl.map || typeof _viewerEl.map.setFilters !== 'function') {
                console.error('[geo-panoramax] filtre de type de photos non appliqué à la mini-carte (viewer.map.setFilters absent).');
                return;
            }
            try {
                _viewerEl.map.setFilters({ pic_type: _pictureType });
            } catch (e) {
                console.error('[geo-panoramax] filtre de type de photos refusé par la mini-carte :', e);
            }
        }

        function _onViewerFiltersChanged(event) {
            var t = event && event.detail && event.detail.pic_type;
            _pictureType = t === 'flat' || t === 'equirectangular' ? t : null;
            if (_covLayer) { _covLayer.changed(); } // redessine le tracé avec le nouveau filtre
        }

        function _stopFollowingViewerFilters() {
            if (_filterComposer) { _filterComposer.removeEventListener('filters-changed', _onViewerFiltersChanged); }
            _filterComposer = null;
            _pictureType = _pictureTypeDefault;
        }

        // ============================================================
        // Recherche de la photo la plus proche + sélection dans le viewer
        // ============================================================
        function _locateNearestPicture(lonLat) {
            if (!_viewerEl || !lonLat) { return; }

            var api = _viewerEl.getAPI && _viewerEl.getAPI();
            if (!api || typeof api.getPicturesAroundCoordinates !== 'function') { return; }

            // Sans utilisateur privilégié, un seul candidat suffit (le plus proche).
            // Avec un utilisateur privilégié, on examine plusieurs candidats proches pour
            // essayer d'en trouver un de cet utilisateur (l'API ne permet pas de filtrer
            // par utilisateur directement dans getPicturesAroundCoordinates).
            var limit = _preferredUser ? _preferredUserCandidates : 1;

            _searchPictures(api, lonLat[1], lonLat[0], limit)
                .then(function (fc) {
                    var features = (fc && fc.features) || [];
                    var feature = _pickPreferredFeature(features);
                    if (!feature) {
                        _setStatus(_pictureType === 'equirectangular' ? 'Aucune photo Panoramax à 360° trouvée à cet endroit.' :
                                   _pictureType === 'flat' ? 'Aucune photo Panoramax plate trouvée à cet endroit.' :
                                   'Aucune photo Panoramax trouvée à cet endroit.');
                        _centerViewerMap(lonLat);
                        return;
                    }
                    _setStatus(null);
                    var seqId = feature.properties && (feature.properties.sequences || [])[0];
                    var picId = feature.id || (feature.properties && feature.properties.id);
                    // Le marqueur + recentrage sont posés depuis l'événement "select" déclenché
                    // par ce .select() (cf. _onSelect/_placeMarkerForPicture) — pas ici, pour
                    // éviter de poser/recentrer deux fois de suite (jitter visuel).
                    if (picId) {
                        _viewerEl.select(seqId, picId, true);
                    } else if (feature.geometry && feature.geometry.coordinates) {
                        _placeMarkerAtCoordinates(feature.geometry.coordinates);
                    }
                })
                .catch(function (err) {
                    console.error('[geo-panoramax] getPicturesAroundCoordinates a échoué :', err);
                    _setStatus('Erreur lors de la recherche de photos Panoramax (voir console).');
                });
        }

        // Sans photo à l'endroit cherché, la carte interne du viewer garde sa vue par défaut
        // (parfois le monde ou une autre commune) : on la centre sur le point cherché pour
        // qu'elle reste alignée avec la carte GEO, en gardant le zoom s'il est déjà détaillé.
        function _centerViewerMap(lonLat) {
            var map = _viewerEl && _viewerEl.map;
            if (!map || typeof map.jumpTo !== 'function') { return; }
            try {
                var opts = { center: lonLat };
                if (typeof map.getZoom === 'function' && map.getZoom() < 14) { opts.zoom = 16; }
                map.jumpTo(opts);
            } catch (e) {
                console.error('[geo-panoramax] centrage de la carte du viewer impossible :', e);
            }
        }

        // Récupère les coordonnées de la photo courante via l'API STAC (item du catalogue)
        // pour repositionner le marqueur quand l'utilisateur navigue dans le viewer.
        // Options de requête vers l'instance : avec une instance privée, le navigateur joint le cookie de session
        // (l'instance doit autoriser le domaine de GEO en CORS avec Access-Control-Allow-Credentials).
        function _fetchOpts() {
            return _privateInstance ? { credentials: 'include' } : undefined;
        }

        function _placeMarkerForPicture(seqId, picId) {
            if (!_viewerEl || !_viewerEl.getAPI) { return; }
            var api = _viewerEl.getAPI();
            if (!api) { return; }

            fetch(_instanceUrl + '/collections/' + encodeURIComponent(seqId) + '/items/' + encodeURIComponent(picId), _fetchOpts())
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (item) {
                    if (item && item.geometry && item.geometry.coordinates) {
                        _placeMarkerAtCoordinates(item.geometry.coordinates);
                    }
                })
                .catch(function () { /* la position du marqueur n'est qu'indicative */ });
        }

        // Coche/décoche le groupe de couches _layerGroupName dans la légende GEO, en cliquant
        // sa case « œil » (ng-click GEO) seulement si son état diffère de celui voulu.
        // setTimeout et pas $timeout : le clic déclenche un $apply GEO, interdit pendant un digest.
        // Un clic unique à l'ouverture restait sans effet (constaté sur GEO, alors que le même
        // clic lancé à la main en console fonctionne) : on vérifie donc l'état et on réessaie
        // jusqu'à ce que la case soit dans l'état voulu, pendant quelques secondes au plus.
        // ponytail: passe par le DOM de la légende, faute d'API GEO de couches connue ; sans
        // effet si la légende n'est pas rendue. Remplacer par l'API si GEO en expose une.
        var _layerTimer = null;
        function _setLayerGroupVisible(visible) {
            if (!_layerGroupName) { return; }
            var wanted = _layerGroupName.toLowerCase();
            var tries  = 20; // 20 × 300 ms = 6 s
            clearTimeout(_layerTimer); // une demande plus récente (fermeture) remplace l'ancienne
            function attempt() {
                var done   = false;
                var labels = document.querySelectorAll('[id^="id-thematic-group-item-label-"]');
                for (var i = 0; i < labels.length; i++) {
                    if (labels[i].textContent.trim().toLowerCase() !== wanted) { continue; }
                    var box = document.querySelector('.acf-thematic-layer-visibility-checkbox-label' +
                                                     '[aria-labelledby="' + labels[i].id + '"]');
                    if (!box) { continue; }
                    if ((box.getAttribute('aria-checked') === 'true') === visible) { done = true; }
                    else { box.click(); }
                }
                if (!done && --tries > 0) { _layerTimer = setTimeout(attempt, 300); }
            }
            _layerTimer = setTimeout(attempt, 0);
        }

        // ============================================================
        // Séquences et photos Panoramax sur la carte GEO (réglage showCoverageLayer)
        // ============================================================
        // Couche OpenLayers ajoutée par le module tant que le panneau est ouvert, à partir des
        // tuiles vectorielles (MVT) de l'instance : couches internes « sequences » (lignes) et
        // « pictures » (points, présentes dans les tuiles de zoom 15).
        // ponytail: l'API GEO ne permet pas d'ajouter une couche : on passe par la carte
        // OpenLayers que donne acfMapService (service interne, non documenté) et par window.ol
        // (celui de GEO, seul compatible avec sa carte). Sans effet (message en console) si l'un
        // des deux manque. Remplacer par l'API GEO si elle permet un jour d'ajouter une couche MVT.
        var _COVERAGE_COLOR   = '#54278f';  // violet des séquences dans le viewer Panoramax
        var _COVERAGE_ZINDEX  = 1000;
        var _COVERAGE_MAX_Z   = 15;         // zoom maximal servi par les tuiles Panoramax
        var _PICTURES_MAX_RES = 2.4;        // m/px (~zoom 16) : en deçà, points des photos illisibles
        var _covWanted   = false;
        var _covLayer    = null;
        var _covMap      = null;
        var _covMoveKey  = null;
        var _covUrl      = null;            // Promise de l'URL des tuiles
        var _covTimer    = null;

        function _setCoverageVisible(visible) {
            if (!_showCoverageLayer) { return; }
            _covWanted = visible;
            clearTimeout(_covTimer);
            if (!visible) {
                if (_covMap && _covLayer) {
                    _covMap.removeLayer(_covLayer);
                    if (_covMoveKey) { window.ol.Observable.unByKey(_covMoveKey); _covMoveKey = null; }
                }
                return;
            }
            var ol = window.ol;
            if (!ol || !ol.layer || !ol.source || !ol.format || !ol.format.MVT) {
                console.error('[geo-panoramax] window.ol (OpenLayers de GEO) absent ou incomplet : ' +
                              'séquences non affichées sur la carte.');
                return;
            }
            _coverageTilesUrl().then(function (url) {
                // La carte OpenLayers peut ne pas être prête dès l'ouverture : quelques essais.
                var tries = 10; // 10 × 500 ms
                (function attempt() {
                    if (!_covWanted) { return; }
                    var map = _findOlMap();
                    if (!map) {
                        if (--tries > 0) { _covTimer = setTimeout(attempt, 500); }
                        else { console.error('[geo-panoramax] carte OpenLayers de GEO introuvable : séquences non affichées.'); }
                        return;
                    }
                    _addCoverageLayer(map, url);
                })();
            });
        }

        // URL des tuiles annoncée par l'instance (lien rel="xyz" de la page d'accueil de l'API),
        // sinon la route habituelle de Géovisio. Le lien n'est retenu que s'il pointe vers
        // l'instance configurée : la réponse ne doit pas pouvoir envoyer le navigateur ailleurs.
        function _coverageTilesUrl() {
            if (!_covUrl) {
                var fallback = _instanceUrl + '/map/{z}/{x}/{y}.mvt';
                _covUrl = fetch(_instanceUrl, _fetchOpts())
                    .then(function (r) { return r.ok ? r.json() : null; })
                    .then(function (landing) {
                        var links = (landing && landing.links) || [];
                        for (var i = 0; i < links.length; i++) {
                            if (links[i].rel === 'xyz' && typeof links[i].href === 'string') {
                                var href = links[i].href.replace(/%7B/gi, '{').replace(/%7D/gi, '}');
                                if (_sameOrigin(href, _instanceUrl)) { return href; }
                            }
                        }
                        return fallback;
                    })
                    .catch(function () { return fallback; });
            }
            return _covUrl;
        }

        // URL de réglage acceptée seulement en http(s) (refuse javascript:, data:, etc., qui s'exécuteraient
        // dans window.open) ; sinon valeur de repli, avec un message dans la console.
        function _httpUrlOr(value, fallback, label) {
            var v = (value == null ? '' : String(value)).trim();
            if (!v) { return fallback; }
            try {
                var u = new URL(v);
                if (u.protocol === 'https:' || u.protocol === 'http:') { return v; }
            } catch (e) { /* URL invalide : repli ci-dessous */ }
            console.error('[geo-panoramax] ' + label + ' ignorée (http ou https attendu) : ' + v);
            return fallback;
        }

        // URL absolue de même origine que base (une URL relative est refusée : repli).
        function _sameOrigin(url, base) {
            try { return new URL(url).origin === new URL(base).origin; } catch (e) { return false; }
        }

        // Carte OpenLayers principale de GEO, par le service acfMapService (même accès que les
        // modules cartographiques du dépôt) ; null tant que la carte n'est pas prête.
        function _findOlMap() {
            try {
                var mapView = $injector.get('acfMapService').getMapViewImmediate();
                return (mapView && mapView.getNativeMap()) || null;
            } catch (e) {
                return null;
            }
        }

        function _addCoverageLayer(map, url) {
            if (_covMap !== map) { _covLayer = null; }
            _covMap = map;
            if (!_covLayer) {
                var projection = map.getView().getProjection().getCode();
                // Instance privée : la couche de tuiles vectorielles native charge ses tuiles sans le
                // cookie de session (séquences réservées absentes de la carte). On passe alors par le
                // chargement manuel (fetch avec credentials), qui sert aussi aux autres projections.
                _covLayer = projection === 'EPSG:3857' && !_privateInstance
                    ? _buildVectorTileLayer(url)
                    : _buildReprojectedLayer(url, map);
                _covLayer.setZIndex(_COVERAGE_ZINDEX);
            }
            if (map.getLayers().getArray().indexOf(_covLayer) === -1) { map.addLayer(_covLayer); }
            var onMoveEnd = _covLayer.get('pnxOnMoveEnd');
            if (onMoveEnd && !_covMoveKey) {
                _covMoveKey = map.on('moveend', onMoveEnd);
                onMoveEnd(); // réouverture du panneau à un autre zoom : tuiles à recharger
            }
        }

        function _coverageStyle() {
            var ol = window.ol;
            var seq = new ol.style.Style({
                stroke: new ol.style.Stroke({ color: _COVERAGE_COLOR, width: 3 })
            });
            var pic = new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 4,
                    fill:   new ol.style.Fill({ color: _COVERAGE_COLOR }),
                    stroke: new ol.style.Stroke({ color: '#fff', width: 1 })
                })
            });
            // « layer » : nom de la couche interne de la tuile, posé par ol.format.MVT.
            return function (feature, resolution) {
                var layer = feature.get('layer');
                // Type de photos choisi : propriété « type » (equirectangular / flat), comme le viewer.
                if (_pictureType && (layer === 'sequences' || layer === 'pictures') &&
                    feature.get('type') !== _pictureType) { return null; }
                if (layer === 'sequences') { return seq; }
                if (layer === 'pictures' && resolution <= _PICTURES_MAX_RES) { return pic; }
                return null; // « grid » (statistiques des petits zooms) : non dessinée
            };
        }

        // Carte en Web Mercator : couche de tuiles vectorielles native.
        function _buildVectorTileLayer(url) {
            var ol = window.ol;
            return new ol.layer.VectorTile({
                source: new ol.source.VectorTile({
                    format:       new ol.format.MVT(),
                    url:          url,
                    maxZoom:      _COVERAGE_MAX_Z,
                    attributions: '© contributeurs Panoramax'
                }),
                style: _coverageStyle()
            });
        }

        // Autre projection (ex. Lambert 93), ou instance privée : OpenLayers ne reprojette pas les tuiles
        // vectorielles, et sa couche de tuiles native n'envoie pas le cookie de session. Le module charge
        // donc lui-même (fetch, avec credentials si instance privée) les tuiles Web Mercator de l'emprise
        // affichée et reprojette leurs objets dans une couche vectorielle simple.
        // Le chargement est piloté par le module à chaque fin de déplacement (moveend), et non par la
        // stratégie de chargement d'OpenLayers : avec la version d'OpenLayers de GEO, vider la source au
        // changement de niveau ne relançait pas le chargement (tracé perdu au premier zoom, constaté le 09/11).
        function _buildReprojectedLayer(url, map) {
            var ol      = window.ol;
            var grid    = ol.tilegrid.createXYZ({ tileSize: 512, maxZoom: _COVERAGE_MAX_Z });
            var format  = new ol.format.MVT({ featureClass: ol.Feature });
            var world   = ol.proj.get('EPSG:3857').getExtent();
            var source  = new ol.source.Vector({ attributions: '© contributeurs Panoramax' });
            var tiles   = {};   // clé z/x/y → { features: objets ajoutés (null tant que la tuile charge),
                                //              loading: compte encore dans « pending » }
            var stale   = [];   // objets du niveau précédent, retirés quand le nouveau niveau est complet
            var pending = 0;    // tuiles du niveau courant encore en cours de chargement
            var gen     = 0;    // incrémenté à chaque changement de niveau : réponses périmées ignorées
            var tileZ   = null;

            function removeFeatures(features) {
                features.forEach(function (f) { source.removeFeature(f); });
            }

            // Retire l'ancien niveau une fois toutes les tuiles du nouveau arrivées : pas de carte vide
            // (scintillement) entre deux niveaux.
            function flushStale() {
                if (pending === 0 && stale.length) {
                    removeFeatures(stale);
                    stale = [];
                }
            }

            function refresh() {
                var size = map.getSize();
                if (!size || !size[0] || !size[1]) { return; }
                var view       = map.getView();
                var projection = view.getProjection();
                var ext = ol.proj.transformExtent(view.calculateExtent(size), projection, 'EPSG:3857');
                // Résolution Web Mercator équivalente à l'affichage (m/px), quelle que soit la projection.
                var z = grid.getZForResolution((ext[2] - ext[0]) / size[0], 0);
                // Changement de niveau : les objets affichés deviennent « anciens » (gardés jusqu'à
                // l'arrivée du nouveau niveau), les chargements en cours sont abandonnés.
                if (z !== tileZ) {
                    gen++;
                    tileZ = z;
                    pending = 0;
                    Object.keys(tiles).forEach(function (k) {
                        if (tiles[k].features) { stale = stale.concat(tiles[k].features); }
                    });
                    tiles = {};
                }
                // Tuiles à garder : l'emprise affichée élargie d'une demi-largeur de chaque côté (un petit
                // déplacement ne recharge rien), bornée au monde Web Mercator.
                var dx = (ext[2] - ext[0]) / 2, dy = (ext[3] - ext[1]) / 2;
                var keep = [Math.max(ext[0] - dx, world[0]), Math.max(ext[1] - dy, world[1]),
                            Math.min(ext[2] + dx, world[2]), Math.min(ext[3] + dy, world[3])];
                ext = [Math.max(ext[0], world[0]), Math.max(ext[1], world[1]),
                       Math.min(ext[2], world[2]), Math.min(ext[3], world[3])];
                if (ext[0] >= ext[2] || ext[1] >= ext[3]) { return; }

                var wanted = {};
                function keyOf(tc) {
                    var y = tc[2] < 0 ? -tc[2] - 1 : tc[2]; // OpenLayers < 6 : y négatif
                    return { key: tc[0] + '/' + tc[1] + '/' + y, y: y };
                }
                grid.forEachTileCoord(keep, z, function (tc) { wanted[keyOf(tc).key] = true; });

                // Même niveau : on retire les tuiles sorties de la zone gardée (la couche ne grossit pas
                // indéfiniment au fil d'un déplacement).
                Object.keys(tiles).forEach(function (k) {
                    if (!wanted[k]) {
                        if (tiles[k].features) { removeFeatures(tiles[k].features); }
                        if (tiles[k].loading) { tiles[k].loading = false; pending--; } // chargement abandonné
                        delete tiles[k];
                    }
                });

                var myGen = gen;
                grid.forEachTileCoord(ext, z, function (tc) {
                    var k = keyOf(tc);
                    if (tiles[k.key]) { return; }
                    var entry = { features: null, loading: true };
                    tiles[k.key] = entry;
                    pending++;
                    fetch(url.replace('{z}', tc[0]).replace('{x}', tc[1]).replace('{y}', k.y), _fetchOpts())
                        .then(function (r) { return r.ok ? r.arrayBuffer() : null; })
                        .then(function (buf) {
                            if (myGen !== gen || tiles[k.key] !== entry) { return; }
                            var features = [];
                            if (buf && buf.byteLength) {
                                features = format.readFeatures(buf, {
                                    extent: grid.getTileCoordExtent(tc), featureProjection: 'EPSG:3857'
                                });
                                features.forEach(function (f) {
                                    var g = f.getGeometry();
                                    if (g) { g.transform('EPSG:3857', projection); }
                                });
                                source.addFeatures(features);
                            }
                            entry.features = features;
                        })
                        .catch(function (err) {
                            if (myGen === gen && tiles[k.key] === entry) { delete tiles[k.key]; }
                            console.error('[geo-panoramax] tuile Panoramax ' + k.key + ' non chargée :', err);
                        })
                        .then(function () {
                            if (myGen !== gen || !entry.loading) { return; }
                            entry.loading = false;
                            pending--;
                            flushStale();
                        });
                });
                flushStale();
            }

            var layer = new ol.layer.Vector({ source: source, style: _coverageStyle() });
            // Appelée par _addCoverageLayer à chaque moveend et une fois à l'ajout de la couche.
            layer.set('pnxOnMoveEnd', refresh);
            return layer;
        }

        function _setStatus(message) {
            if (_currentScope) {
                $timeout(function () { _currentScope.statusMessage = message; });
            }
        }

        // ============================================================
        // Marqueur sur la carte GEO principale (position de la photo affichée)
        // + recentrage de la carte GEO dessus : lien dynamique dans les deux sens —
        // que la photo change suite à un clic sur la carte GEO, à la navigation dans
        // la séquence (précédent/suivant) ou à un clic sur la carte interne Panoramax.
        // ============================================================
        function _placeMarkerAtCoordinates(lonLat) {
            _lastLonLat = lonLat;
            _drawMarker(lonLat, true);
        }

        // (Re)dessine le marqueur (point + cône orienté selon _heading). GEO n'expose pas
        // de rotation de marqueur : on le supprime et le recrée avec un SVG déjà tourné.
        // Un seul cycle remove/add à la fois ; les demandes arrivées entre-temps sont
        // fusionnées et rejouées à la fin avec la dernière position et le dernier cap.
        function _drawMarker(lonLat, recenter) {
            if (!geoApplication.map || !lonLat) { return; }
            if (_markerBusy) {
                _markerPending = true;
                _pendingRecenter = _pendingRecenter || recenter;
                return;
            }
            _markerBusy = true;

            var marker = {
                id:          _MARKER_ID,
                position:    { coordinates: lonLat, crs: 'EPSG:4326' },
                imageUrl:    _markerSvg(_heading),
                size:        { w: 60, h: 60 },
                positioning: 'center-center',
                tooltip:     { title: 'Photo Panoramax' }
            };

            var _done = function () {
                _markerBusy = false;
                _bringPointsToFront();
                if (_markerPending) {
                    var again = _pendingRecenter;
                    _markerPending = false;
                    _pendingRecenter = false;
                    _drawMarker(_lastLonLat, again);
                }
            };

            var _doAdd = function () {
                geoApplication.map.addMarkers([marker]).subscribe(function () {
                    _markerPlaced = true;
                    if (recenter) { _recenterOnMarker(lonLat); }
                    _done();
                }, function (err) {
                    console.error('[geo-panoramax] addMarkers a échoué :', err);
                    _done();
                });
            };

            if (_markerPlaced) {
                geoApplication.map.removeMarkers([_MARKER_ID]).subscribe(_doAdd, _doAdd);
            } else {
                _doAdd();
            }
        }

        // Recentre la carte GEO sur le marqueur en une seule étape, directement décalée
        // pour que le marqueur tombe au centre de la zone visible (hors panneau, à droite) —
        // pas de centerOnMarker() "plein centre" suivi d'un rattrapage (ça provoquait un
        // flash visible). Conserve le niveau de zoom courant : on déplace seulement le
        // centre via centerOn() (cf. _applyRecenteredExtent).
        function _recenterOnMarker(lonLat) {
            if (!geoApplication.map) { return; }
            var extent = geoApplication.map.extent;
            if (!extent) { return; }

            if (!extent.crs || extent.crs === 'EPSG:4326') {
                _applyRecenteredExtent(extent, lonLat);
                return;
            }
            geoApplication.transform(lonLat, 'EPSG:4326', extent.crs).subscribe(
                function (markerXY) { _applyRecenteredExtent(extent, markerXY); },
                function (err) { console.error('[geo-panoramax] transform (recentrage) a échoué :', err); }
            );
        }

        function _applyRecenteredExtent(currentExtent, markerXY) {
            var width = currentExtent.maxX - currentExtent.minX;
            if (width <= 0) { return; }

            // Zone visible = tout sauf le panneau (à droite) ; le marqueur doit tomber au
            // centre de cette zone, soit à la fraction f = (100% - panelWidthPct) / 2 de la
            // largeur depuis la gauche. Le centre de la carte est donc décalé vers l'est de
            // (0.5 - f) × largeur par rapport au marqueur.
            var f = (100 - _panelWidthPct) / 200;
            var center = [markerXY[0] + (0.5 - f) * width, markerXY[1]];

            // centerOn et non setExtent : setExtent ne restitue pas le zoom à l'identique
            // (même en renvoyant l'emprise courante telle quelle, la largeur ressort ×1.333
            // panneau fermé, ×1.5 panneau ouvert, malgré disablePadding — mesuré sur GEO),
            // d'où un dézoom cumulatif à chaque photo. centerOn({coordinates, crs}) déplace
            // le centre sans toucher au zoom (mesuré : déplacement exact, ratio 1.000).
            // NB : panTo(direction) ne convient pas, il décale d'un cran (nord, est…) et
            // ignore silencieusement des coordonnées.
            var r = geoApplication.map.centerOn({ coordinates: center, crs: currentExtent.crs });
            // Abonnement au cas où centerOn renvoie un observable froid (comme addMarkers).
            if (r && typeof r.subscribe === 'function') {
                r.subscribe(function () {}, function (err) {
                    console.error('[geo-panoramax] centerOn (recentrage) a échoué :', err);
                });
            }
        }

        function _removeMarker() {
            if (_markerPlaced && geoApplication.map) {
                geoApplication.map.removeMarkers([_MARKER_ID]).subscribe(function () {
                    _markerPlaced = false;
                }, function () { _markerPlaced = false; });
            }
        }

        // ============================================================
        // Pointage d'objets depuis la photo (issue #9, méthode A : projection sur le sol)
        // ============================================================
        var _EARTH_M_PER_DEG = 111320;

        // Direction cliquée (yaw/pitch en radians, repère de la sphère) → position au sol.
        // Cap absolu = yaw + view:azimuth, comme getXY() du viewer. Distance = hauteur de
        // caméra / tan(angle sous l'horizon). Incertitude = GPS de la photo combiné à l'erreur
        // induite sur la distance par l'incertitude de hauteur ; elle croît avec la distance.
        function _projectToGround(meta, yaw, pitch) {
            if (!meta || !meta.gps || typeof yaw !== 'number' || typeof pitch !== 'number') {
                return { error: 'Photo non chargée : pointage impossible.' };
            }
            var below = -pitch * 180 / Math.PI;
            if (below < _POINT_MIN_PITCH) {
                return { error: 'Visée trop proche de l\'horizon : cliquez sur le sol, plus bas dans la photo.' };
            }
            var distance = _cameraHeight / Math.tan(below * Math.PI / 180);
            if (distance > _POINT_MAX_DIST) {
                return { error: 'Objet trop loin (' + Math.round(distance) + ' m) : zoomez ou avancez dans la séquence.' };
            }
            var props = meta.properties || {};
            var heading = ((yaw * 180 / Math.PI + (props['view:azimuth'] || 0)) % 360 + 360) % 360;
            var rad = heading * Math.PI / 180;
            var camLon = meta.gps[0], camLat = meta.gps[1];
            var lat = camLat + distance * Math.cos(rad) / _EARTH_M_PER_DEG;
            var lon = camLon + distance * Math.sin(rad) / (_EARTH_M_PER_DEG * Math.cos(camLat * Math.PI / 180));
            var gps = props['quality:horizontal_accuracy'];
            gps = typeof gps === 'number' && gps > 0 ? gps : _POINT_GPS_DEFAULT;
            var fromHeight = distance * _POINT_HEIGHT_SIGMA / _cameraHeight;
            return {
                lon: lon, lat: lat, distance: distance, heading: heading,
                accuracy: Math.sqrt(gps * gps + fromHeight * fromHeight),
                camLon: camLon, camLat: camLat
            };
        }

        function _addPoint(res, meta, type) {
            var pt = {
                id:       _POINT_MARKER_PREFIX + (++_pointSeq),
                index:    _pointSeq,
                type:     type,
                lon:      res.lon,
                lat:      res.lat,
                accuracy: Math.round(res.accuracy * 10) / 10,
                distance: Math.round(res.distance * 10) / 10,
                heading:  Math.round(res.heading),
                camLon:   res.camLon,
                camLat:   res.camLat,
                picId:    meta.id || null,
                seqId:    (meta.sequence && meta.sequence.id) || null,
                date:     new Date().toISOString()
            };
            _points.push(pt);
            return pt;
        }

        function _addPointMarker(pt) {
            if (!geoApplication.map) { return; }
            var svg = '<svg xmlns="http://www.w3.org/2000/svg" id="geo-pnx-marker" width="28" height="28" viewBox="0 0 28 28">' +
                '<circle cx="14" cy="14" r="9" fill="#d93025" fill-opacity="0.85" stroke="#fff" stroke-width="3"/>' +
                '<circle cx="14" cy="14" r="2.5" fill="#fff"/></svg>';
            geoApplication.map.addMarkers([{
                id:          pt.id,
                position:    { coordinates: [pt.lon, pt.lat], crs: 'EPSG:4326' },
                imageUrl:    'data:image/svg+xml;utf8,' + encodeURIComponent(svg),
                size:        { w: 28, h: 28 },
                positioning: 'center-center',
                tooltip:     { title: pt.index + '. ' + pt.type + ' (incertitude estimée ±' + pt.accuracy + ' m)' }
            }]).subscribe(function () {}, function (err) {
                console.error('[geo-panoramax] addMarkers (point) a échoué :', err);
            });
        }

        // Le cône est supprimé puis recréé à chaque rotation, donc dessiné au-dessus des points
        // posés tout près de la caméra (quelques mètres : quelques pixels sous un zoom large).
        // On redessine les points juste après lui pour qu'ils restent visibles.
        var _pointsBusy = false;
        function _bringPointsToFront() {
            if (!_points.length || _pointsBusy || !geoApplication.map || !_currentScope) { return; }
            _pointsBusy = true;
            var _readd = function () {
                _pointsBusy = false;
                if (_currentScope) { _points.forEach(_addPointMarker); }
            };
            geoApplication.map.removeMarkers(_points.map(function (pt) { return pt.id; }))
                .subscribe(_readd, _readd);
        }

        function _removePointMarkers(points) {
            if (!points.length || !geoApplication.map) { return; }
            geoApplication.map.removeMarkers(points.map(function (pt) { return pt.id; }))
                .subscribe(function () {}, function () {});
        }

        function _download(filename, mime, content) {
            var blob = new Blob([content], { type: mime });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        }

        // Mention portée par chaque point exporté : le fichier est lu hors du module, sans le bandeau.
        var _EXPORT_WARNING = 'expérimental, précision non garantie';

        function _exportPoints(format) {
            if (!_points.length) { return; }
            var stamp = new Date().toISOString().slice(0, 10);
            if (format === 'geojson') {
                _download('panoramax-points-' + stamp + '.geojson', 'application/geo+json', JSON.stringify({
                    type: 'FeatureCollection',
                    features: _points.map(function (pt) {
                        return {
                            type: 'Feature',
                            geometry: { type: 'Point', coordinates: [pt.lon, pt.lat] },
                            properties: {
                                type: pt.type, incertitude_m: pt.accuracy, distance_camera_m: pt.distance,
                                cap: pt.heading, hauteur_camera_m: _cameraHeight, photo: pt.picId,
                                sequence: pt.seqId, date_pointage: pt.date, avertissement: _EXPORT_WARNING
                            }
                        };
                    })
                }, null, 2));
                return;
            }
            // CSV séparé par des points-virgules (ouverture directe dans Excel en français),
            // avec BOM UTF-8 pour les accents.
            var rows = [['type', 'lon', 'lat', 'incertitude_m', 'distance_camera_m', 'cap',
                         'hauteur_camera_m', 'photo', 'sequence', 'date_pointage', 'avertissement']];
            _points.forEach(function (pt) {
                rows.push([pt.type, pt.lon.toFixed(7), pt.lat.toFixed(7), pt.accuracy, pt.distance,
                           pt.heading, _cameraHeight, pt.picId || '', pt.seqId || '', pt.date, _EXPORT_WARNING]);
            });
            _download('panoramax-points-' + stamp + '.csv', 'text/csv;charset=utf-8',
                '\ufeff' + rows.map(function (r) { return r.join(';'); }).join('\r\n'));
        }

        // Marqueur 60x60 centré sur la photo : point bleu + cône de vision (ouverture fixe
        // de 60°, pointant vers le Nord puis tourné de `heading` degrés autour du centre).
        // Pas de cône tant que le cap n'est pas connu.
        // NB : ouverture fixe, et carte GEO supposée orientée Nord en haut ; lier
        // l'ouverture au zoom du viewer (detail.z) ou à la rotation de carte si besoin.
        function _markerSvg(heading) {
            var cone = heading === null ? '' :
                '<path d="M30 30 L15 4.02 A30 30 0 0 1 45 4.02 Z" fill="#1a73e8" fill-opacity="0.35" ' +
                'stroke="#1a73e8" stroke-width="1.5" transform="rotate(' + heading.toFixed(1) + ' 30 30)"/>';
            return 'data:image/svg+xml;utf8,' + encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" id="geo-pnx-marker" width="60" height="60" viewBox="0 0 60 60">' +
                cone +
                '<circle cx="30" cy="30" r="11" fill="#1a73e8" stroke="#fff" stroke-width="3"/>' +
                '<circle cx="30" cy="30" r="4" fill="#fff"/></svg>'
            );
        }

        // ============================================================
        // Tuto d'accueil et visite guidée (Driver.js, MIT)
        // ============================================================
        var _tour   = null; // visite du panneau (auto au 1er lancement, ou bouton « ? »)
        var _teaser = null; // accroche d'une étape sur l'onglet, au chargement de l'appli

        // État mémorisé dans le navigateur : '' (jamais vue), 'v1:done' (terminée ou passée),
        // 'v1:never' (ne plus afficher). Seuls les boutons l'écrivent : fermer le panneau
        // ou la bulle n'enregistre rien. Changer _TOUR_VERSION réaffiche la visite une fois
        // pour tout le monde (nouveau contenu).
        var _TOUR_KEY     = 'geo-panoramax-tour';
        var _TOUR_VERSION = 'v1';

        function _tourPending() {
            if (!_showTourOnStart) { return false; }
            var v = '';
            try { v = window.localStorage.getItem(_TOUR_KEY) || ''; } catch (e) { /* indisponible : visite réaffichée */ }
            return v.indexOf(_TOUR_VERSION + ':') !== 0;
        }

        function _setTourState(state) {
            try { window.localStorage.setItem(_TOUR_KEY, _TOUR_VERSION + ':' + state); } catch (e) { /* ignoré */ }
        }

        // Driver.js voile la page et bloque tout clic hors de l'élément visé : il bloquerait la
        // carte GEO, justement le geste à apprendre. On le rend non modal : pas de voile
        // (overlayOpacity 0, et le SVG est masqué en CSS) et la classe driver-active, dont la règle
        // « * { pointer-events: none } » bloque la page, est retirée de <body> après le démarrage
        // (voir _driveTour). Les touches ← → sont ignorées parce que les étapes ne déclarent pas
        // le bouton « next » (showButtons), la bulle prenant le focus ; Échap ferme (allowClose)
        // sans rien mémoriser. Les boutons natifs de Driver sont masqués : les nôtres disent ce
        // qui est mémorisé (_renderPopover).
        function _tourOptions(extra) {
            var o = {
                animate:        false,
                overlayOpacity: 0,
                stagePadding:   4,
                stageRadius:    4,
                allowClose:     true,
                smoothScroll:   false,
                popoverClass:   'geo-pnx-tour',
                popoverOffset:  12,
                closeBtnLabel:  'Fermer la visite',
                onPopoverRender: _renderPopover
            };
            for (var k in (extra || {})) { o[k] = extra[k]; }
            return o;
        }

        function _driveTour(instance) {
            instance.drive();
            document.body.classList.remove('driver-active');
        }

        // Boutons (step.data.buttons : { label, secondary, action }) et compteur « Étape N sur M »
        // (step.data.count) de la bulle ; les boutons natifs de Driver sont masqués.
        function _renderPopover(popover, opts) {
            var step = opts.state.activeStep;
            var data = (step && step.data) || {};
            // Croix de fermeture seulement sur la visite (data.closable) ; boutons précédent / suivant natifs masqués.
            [popover.previousButton, popover.nextButton, popover.progress].forEach(function (el) {
                if (el) { el.style.display = 'none'; }
            });
            if (popover.closeButton) { popover.closeButton.style.display = data.closable ? 'block' : 'none'; }
            if (data.count) {
                var count = document.createElement('div');
                count.className = 'geo-pnx-tour-count';
                count.textContent = data.count;
                popover.title.insertAdjacentElement('beforebegin', count);
            }
            popover.footer.style.display = 'flex';
            popover.footerButtons.style.display = 'flex';
            (data.buttons || []).forEach(function (spec) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'geo-pnx-tour-btn' + (spec.secondary ? ' geo-pnx-tour-btn--secondary' : '');
                b.textContent = spec.label;
                b.addEventListener('click', spec.action);
                popover.footerButtons.appendChild(b);
            });
        }

        function _btn(label, action, secondary) {
            return { label: label, action: action, secondary: !!secondary };
        }

        // ---------- Accroche sur l'onglet (chargement de l'appli) ----------

        // L'onglet est rendu par GEO après executeWhenInitialized : quelques essais espacés,
        // puis on renonce (jamais de bulle flottante au milieu de l'écran).
        // ponytail: sélecteur déduit de l'icône posée par le module (icon: 'icon_panoramax'),
        // à confirmer dans le DOM de GEO (tâche T1 du design) ; repli = pas d'accroche.
        function _startTeaser(attempt) {
            if (!_tourPending() || _currentScope) { return; } // déjà vue, ou panneau déjà ouvert
            // GEO peut rendre plusieurs .icon_panoramax (dont des masqués) : on garde le plus à
            // droite parmi les visibles, c'est-à-dire l'onglet de la barre latérale droite. La
            // bulle est ancrée sur l'icône elle-même : son ancêtre cliquable peut être un
            // élément large, qui décalait la bulle vers le milieu de l'écran (constaté sur GEO PETR).
            var icon = null;
            Array.prototype.forEach.call(document.querySelectorAll('.icon_panoramax'), function (el) {
                var r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0 && (!icon || r.left > icon.getBoundingClientRect().left)) { icon = el; }
            });
            if (!icon) {
                if (attempt < 10) { setTimeout(function () { _startTeaser(attempt + 1); }, 500); }
                return;
            }
            var tab = icon.closest('button, a, [role="button"], [ng-click], li') || icon;

            var teaser = _teaser = driver(_tourOptions({
                onDestroyed: function () { if (_teaser === teaser) { _teaser = null; } }
            }));
            teaser.setSteps([{
                element: icon,
                popover: {
                    title:       'Nouveau : vue immersive Panoramax',
                    description: 'Ouvrez cet onglet pour voir les photos à 360° de n\'importe quel point de la carte.',
                    side: 'left', align: 'center', showButtons: ['close']
                },
                data: { buttons: [
                    _btn('Ne plus afficher', function () { _setTourState('never'); teaser.destroy(); }, true),
                    _btn('Plus tard', function () { teaser.destroy(); })
                ] }
            }]);
            // Ouvrir l'onglet ferme la bulle (le contrôleur du panneau la ferme aussi, au cas
            // où GEO reçoit le clic sur un autre élément).
            tab.addEventListener('click', _cancelTeaser, { once: true });
            _driveTour(teaser);
        }

        function _cancelTeaser() {
            if (_teaser && _teaser.isActive()) { _teaser.destroy(); }
            _teaser = null;
        }

        // ---------- Étapes interactives : avancent quand l'agent fait le geste ----------

        var _tourWaiting     = null;  // geste attendu par l'étape affichée : 'map-pic' | 'rotate' | 'next-pic'
        var _tourClicked     = false; // un clic de l'agent sur la carte précède le select attendu
        var _tourPicId       = null;  // photo affichée au début de l'étape
        var _tourRotation    = 0;     // degrés cumulés pendant l'étape « regardez autour »
        var _tourLastHeading = null;

        // Appelé par les gestionnaires existants (pointerClick, _onSelect, _onViewRotated).
        // La photo du centre, sélectionnée automatiquement à l'ouverture, ne fait pas avancer
        // l'étape « cliquez sur la carte » : seul un select qui suit un clic de l'agent compte.
        function _tourNotify(kind, value) {
            if (!_tourWaiting || !_tour || !_tour.isActive()) { return; }
            if (kind === 'click') {
                if (_tourWaiting === 'map-pic') { _tourClicked = true; }
            } else if (kind === 'select') {
                if (value === _tourPicId) { return; }
                if (_tourWaiting === 'next-pic' || (_tourWaiting === 'map-pic' && _tourClicked)) {
                    _tourSuccess();
                }
            } else if (kind === 'rotate' && _tourWaiting === 'rotate') {
                if (_tourLastHeading !== null) {
                    var delta = Math.abs(value - _tourLastHeading) % 360;
                    _tourRotation += Math.min(delta, 360 - delta); // passage 359° → 0° compté 1°
                }
                _tourLastHeading = value;
                if (_tourRotation >= 30) { _tourSuccess(); }
            }
        }

        // Geste réussi : « ✓ Bien joué » affiché un court instant, puis étape suivante.
        function _tourSuccess() {
            var tour = _tour;
            var step = tour.getActiveStep();
            var popover = tour.getState('popover');
            _tourWaiting = null;
            if (popover && popover.wrapper) { popover.wrapper.classList.add('geo-pnx-tour-success'); }
            setTimeout(function () {
                if (tour.isActive() && tour.getActiveStep() === step) { tour.moveNext(); }
            }, 700);
        }

        // Point d'ancrage pour « Cliquez sur la carte » : la carte GEO n'offre pas d'élément
        // fiable à viser, on pose un point rouge pulsant au milieu de sa partie visible (à
        // gauche du panneau) ; la bulle se place à sa droite et sa flèche pointe la carte.
        // Panneau en plein écran (carte invisible) : ancrage sur le viewer, comme avant.
        var _MAP_ANCHOR_CLASS = 'geo-pnx-tour-map-anchor';

        function _showMapAnchor() {
            _hideMapAnchor();
            var panel = document.querySelector('.geo-pnx-widget');
            var r = panel && panel.getBoundingClientRect();
            if (!r || r.left < 200) { return null; }
            var dot = document.createElement('div');
            dot.className = _MAP_ANCHOR_CLASS;
            dot.style.left = Math.round(r.left * 0.4) + 'px';
            dot.style.top  = Math.round(r.top + r.height / 2) + 'px';
            document.body.appendChild(dot);
            return dot;
        }

        function _hideMapAnchor() {
            var dot = document.querySelector('.' + _MAP_ANCHOR_CLASS);
            if (dot) { dot.parentNode.removeChild(dot); }
        }

        // ---------- Visite du panneau ----------

        function _startTour() {
            if (_tour && _tour.isActive()) {
                var active = _tour.getActiveStep();
                // Dernière étape (elle désigne le « ? ») : cliquer dessus termine la visite.
                if (active && active.data && active.data.id === 'help') { _setTourState('done'); }
                _tour.destroy(); // « ? » rappuyé en cours de visite = fermer
                return;
            }
            _cancelTeaser();

            var tour = _tour = driver(_tourOptions({
                // Croix : l'agent écarte la visite, elle ne revient plus d'elle-même (le « ? » la relance).
                onCloseClick: function () { _setTourState('done'); tour.destroy(); },
                onDestroyed: function () {
                    _tourWaiting = null;
                    _hideMapAnchor();
                    if (_tour === tour) { _tour = null; }
                }
            }));
            var prev = _btn('‹ Précédent', function () { tour.movePrevious(); }, true);
            var next = _btn('Suivant ›', function () { tour.moveNext(); });

            // Étape qui attend un geste ; « Suivant » la passe si le geste n'aboutit pas.
            // element : sélecteur ou fonction (résolue à l'affichage) ; side : côté de la bulle.
            function gestureStep(id, gesture, title, description, element, side) {
                return {
                    element: element,
                    popover: { title: title, description: description, side: side || 'left', align: 'center', showButtons: ['close'] },
                    data: { id: id, closable: true, buttons: [prev, next] },
                    onHighlightStarted: function () {
                        _tourWaiting     = gesture;
                        _tourClicked     = false;
                        _tourPicId       = _currentScope ? _currentScope.currentPicId : null;
                        _tourRotation    = 0;
                        _tourLastHeading = _heading;
                    },
                    // Le point d'ancrage n'appartient qu'à l'étape de la carte : Driver résout l'élément de l'étape
                    // d'arrivée AVANT de désélectionner l'étape de départ, un retrait systématique le supprimerait
                    // en revenant (Précédent) sur cette étape.
                    onDeselected: function () { _tourWaiting = null; if (id === 'map-click') { _hideMapAnchor(); } }
                };
            }

            var steps = [
                {
                    popover: { title: 'Voici la vue immersive Panoramax',
                               description: 'Une minute pour la prendre en main ? On va le faire ensemble.',
                               showButtons: ['close'] },
                    data: { id: 'intro', closable: true, buttons: [
                        _btn('Ne plus afficher', function () { _setTourState('never'); tour.destroy(); }, true),
                        _btn('C\'est parti', function () { tour.moveNext(); })
                    ] }
                },
                gestureStep('map-click', 'map-pic', 'Cliquez sur la carte',
                    'Cliquez sur une rue de la carte GEO : la photo Panoramax la plus proche s\'affiche dans le panneau. ' +
                    'S\'il n\'y en a pas, essayez une rue voisine.',
                    function () { return _showMapAnchor() || document.querySelector('.geo-pnx-viewer-wrap'); },
                    'right'),
                gestureStep('rotate', 'rotate', 'Regardez autour',
                    'Faites glisser la photo avec la souris. Le cône bleu sur la carte suit votre regard.',
                    '.geo-pnx-viewer'),
                gestureStep('next-pic', 'next-pic', 'Avancez',
                    'Cliquez sur une flèche dans la photo pour passer à la suivante. Le marqueur vous suit sur la carte.',
                    '.geo-pnx-viewer'),
                {
                    element: '.geo-pnx-fullscreen-btn',
                    // Cliquer sur le bouton désigné fait aussi avancer la visite.
                    advanceOnClick: true,
                    popover: { title: 'Plein écran', description: 'Agrandit le panneau pour mieux voir les photos.',
                               side: 'left', align: 'center', showButtons: ['close'] },
                    data: { id: 'fullscreen', closable: true, buttons: [prev, next] }
                },
                {
                    // Bouton grisé tant qu'aucune photo n'est affichée : le texte le précise.
                    element: function () { return document.querySelector('.geo-pnx-open-btn'); },
                    advanceOnClick: true,
                    popover: { title: 'Ouvrir dans Panoramax',
                               description: 'Ouvre la photo affichée dans une nouvelle fenêtre, sur le site Panoramax.',
                               side: 'left', align: 'center', showButtons: ['close'] },
                    onHighlightStarted: function (element, step) {
                        step.popover.description = 'Ouvre la photo affichée dans une nouvelle fenêtre, sur le site Panoramax.' +
                            (element && element.disabled ? ' (Disponible une fois une photo affichée.)' : '');
                    },
                    data: { id: 'open-externally', closable: true, buttons: [prev, next] }
                },
                {
                    // Bouton grisé tant qu'aucune photo n'est affichée : pas d'avance au clic, « Suivant » seulement.
                    element: '.geo-pnx-point-btn',
                    popover: { title: 'Pointer un objet',
                               description: 'Fonctionnalité expérimentale, précision non garantie. Activez ce bouton puis cliquez sur le pied d\'un objet au sol (grille, regard, candélabre…) : un point est posé sur la carte, avec son incertitude. Les points s\'exportent en GeoJSON ou en CSV.',
                               side: 'left', align: 'center', showButtons: ['close'] },
                    onHighlightStarted: function (element, step) {
                        var base = 'Fonctionnalité expérimentale, précision non garantie. Activez ce bouton puis cliquez sur le pied d\'un objet au sol (grille, regard, candélabre…) : un point est posé sur la carte, avec son incertitude. Les points s\'exportent en GeoJSON ou en CSV.';
                        step.popover.description = base + (element && element.disabled ? ' (Disponible une fois une photo affichée.)' : '');
                    },
                    data: { id: 'point', closable: true, buttons: [prev, next] }
                },
                {
                    element: '.geo-pnx-changelog-btn',
                    popover: { title: 'Nouveautés du module',
                               description: 'Ce bouton ouvre le journal des évolutions du module ; le point rouge signale une version que vous n\'avez pas encore lue.',
                               side: 'left', align: 'center', showButtons: ['close'] },
                    data: { id: 'changelog', closable: true, buttons: [prev, next] }
                },
                {
                    element: '.geo-pnx-help-btn',
                    popover: { title: 'C\'est tout !', description: 'Vous pouvez relancer cette visite à tout moment avec ce bouton.',
                               side: 'left', align: 'center', showButtons: ['close'] },
                    data: { id: 'help', closable: true, buttons: [prev, _btn('Terminer', function () { _setTourState('done'); tour.destroy(); })] }
                }
            ];

            // « Étape N sur M » en tête de chaque bulle.
            steps.forEach(function (step, i) { step.data.count = 'Étape ' + (i + 1) + ' sur ' + steps.length; });

            tour.setSteps(steps);
            _driveTour(tour);
        }

        // ============================================================
        // Styles CSS (injectés une seule fois)
        // ============================================================
        function _injectStyles() {
            if (document.getElementById('geo-panoramax-styles')) { return; }

            var style = document.createElement('style');
            style.id  = 'geo-panoramax-styles';
            style.textContent = [
                '.geo-pnx-widget{display:flex;flex-direction:column;height:100%;background:#fff;}',

                // Marqueurs du module (cône, points pointés) : GEO les pose en overlay HTML qui
                // capte la molette, la carte ne zoomait plus sous le pointeur. On les rend
                // transparents à la souris (repérés par l'id glissé dans leur SVG) ; contrepartie :
                // plus d'infobulle au survol, et un clic dessus part à la carte.
                '.ol-overlay-container:has([src*="geo-pnx-marker"]),.ol-overlay-container:has([src*="geo-pnx-marker"]) *,' +
                '[src*="geo-pnx-marker"]{pointer-events:none!important;}',
                // Sous 576 px de large, le viewer passe en mise en page mobile : le détail de la photo
                // devient un tiroir <pnx-bottom-drawer> en position:fixed, calé sur la fenêtre et non sur
                // le panneau, qui recouvrait le bas de toute l'application. Le transform fait du conteneur
                // le repère des éléments fixed du viewer ; overflow:hidden coupe ce qui dépasse.
                '.geo-pnx-viewer-wrap{position:relative;flex:1;min-height:0;overflow:hidden;transform:translateZ(0);}',
                '.geo-pnx-viewer{position:absolute;inset:0;width:100%;height:100%;}',

                // Bouton rond "ouvrir dans Panoramax", sous le bouton plein écran. Pas en bas à
                // gauche : le viewer y place son propre bouton photo/carte, qui le recouvrait.
                '.geo-pnx-open-btn{position:absolute;right:12px;top:110px;z-index:5;',
                '  border-radius:50%;width:42px;height:42px;border:1px solid rgb(137,137,137);',
                '  background:rgb(255,255,255);cursor:pointer;display:flex;',
                '  align-items:center;justify-content:center;font-size:18px;}',
                '.geo-pnx-open-btn:hover:not(:disabled){background:rgba(255,255,255,.95);}',
                '.geo-pnx-open-btn:disabled{opacity:.5;cursor:default;}',
                '.geo-pnx-icon{width:20px;height:20px;display:block;}',
                '.geo-pnx-open-btn,.geo-pnx-fullscreen-btn,.geo-pnx-help-btn{color:#444;padding:0;}',
                '.geo-pnx-open-btn span,.geo-pnx-fullscreen-btn span,.geo-pnx-help-btn span{',
                '  display:flex;}',

                // Bouton plein écran, en haut à droite du viewer
                '.geo-pnx-fullscreen-btn{position:absolute;right:12px;top:60px;z-index:5;',
                '  border-radius:50%;width:42px;height:42px;border:1px solid rgb(137,137,137);',
                '  background:rgb(255,255,255);cursor:pointer;display:flex;',
                '  align-items:center;justify-content:center;font-size:16px;}',
                '.geo-pnx-fullscreen-btn:hover{background:rgba(255,255,255,.95);}',
                '.geo-pnx-fullscreen-btn--active{background:#1a73e8;color:#fff;',
                '  border-color:#1a73e8;}',
                '.geo-pnx-fullscreen-btn--active:hover{background:#1558b0;}',

                // Bouton de pointage, sous le bouton « ouvrir dans Panoramax »
                '.geo-pnx-point-btn{position:absolute;right:12px;top:160px;z-index:5;',
                '  border-radius:50%;width:42px;height:42px;border:1px solid rgb(137,137,137);',
                '  background:rgb(255,255,255);cursor:pointer;display:flex;color:#444;padding:0;',
                '  align-items:center;justify-content:center;}',
                '.geo-pnx-point-btn:disabled{opacity:.5;cursor:default;}',
                // Infobulle instantanée à gauche des boutons flottants (data-tip) ; masquée sur la cible de la
                // visite guidée, dont la bulle occupe la même place.
                '.geo-pnx-viewer-wrap [data-tip]::after{content:attr(data-tip);position:absolute;right:calc(100% + 8px);',
                '  top:50%;transform:translateY(-50%);white-space:nowrap;padding:5px 9px;border-radius:4px;',
                '  background:#263238;color:#fff;font:12px/1.3 Arial,Helvetica,sans-serif;pointer-events:none;',
                '  opacity:0;transition:opacity .12s;z-index:6;}',
                '.geo-pnx-viewer-wrap [data-tip]:hover::after,.geo-pnx-viewer-wrap [data-tip]:focus-visible::after{opacity:1;}',
                '.geo-pnx-viewer-wrap [data-tip].driver-active-element::after{display:none;}',
                // Bouton « Nouveautés », sous le bouton de pointage ; point rouge tant que la version n'a pas été lue
                '.geo-pnx-changelog-btn{position:absolute;right:12px;top:210px;z-index:5;',
                '  border-radius:50%;width:42px;height:42px;border:1px solid rgb(137,137,137);',
                '  background:rgb(255,255,255);cursor:pointer;display:flex;color:#444;padding:0;',
                '  align-items:center;justify-content:center;}',
                '.geo-pnx-changelog-btn:hover{background:rgba(255,255,255,.95);}',
                '.geo-pnx-dot-new{position:absolute;top:1px;right:1px;width:10px;height:10px;border-radius:50%;',
                '  background:#d93025;border:2px solid #fff;}',
                '.geo-pnx-point-btn.geo-pnx-fullscreen-btn--active{background:#1a73e8;color:#fff;',
                '  border-color:#1a73e8;}',
                '.geo-pnx-points{flex-shrink:0;border-top:1px solid #ddd;background:#f7f7f7;',
                '  font-size:12px;}',
                '.geo-pnx-login{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:10px;',
                '  padding:8px 12px;background:#e8f0fe;color:#174ea6;border-bottom:1px solid #aecbfa;',
                '  font-size:12px;line-height:1.4;}',
                '.geo-pnx-warning{margin:0;padding:7px 12px;background:#fff4e5;color:#7a4100;',
                '  border-bottom:1px solid #f0c78a;font-size:12px;line-height:1.4;}',
                '.geo-pnx-points-bar{display:flex;align-items:center;gap:6px;padding:6px 12px;flex-wrap:wrap;}',
                '.geo-pnx-points-spacer{flex:1;}',
                '.geo-pnx-points-list{list-style:none;margin:0;padding:0 12px 6px;max-height:110px;',
                '  overflow-y:auto;}',
                '.geo-pnx-points-list li{display:flex;justify-content:space-between;align-items:center;',
                '  padding:2px 0;}',
                '.geo-pnx-points-del{border:none;background:none;cursor:pointer;font-size:16px;color:#666;}',

                // Bouton d'aide (visite guidée), en bas de la colonne, sous le bouton « Nouveautés »
                '.geo-pnx-help-btn{position:absolute;right:12px;top:260px;z-index:5;',
                '  border-radius:50%;width:42px;height:42px;border:1px solid rgb(137,137,137);',
                '  background:rgb(255,255,255);cursor:pointer;display:flex;',
                '  align-items:center;justify-content:center;font-size:16px;font-weight:700;',
                '  color:#444;}',
                '.geo-pnx-help-btn:hover{background:rgba(255,255,255,.95);}',

                // En plein écran, la carte GEO n'a (presque) plus de place visible : le
                // toolbar de dessin/sélection (topright) se replie et chevauche le toolbar
                // zoom/géoloc/permalien (topleft). On le masque tant que c'est le cas.
                'body.' + _FULLSCREEN_BODY_CLASS + ' .acf-map-controls-topright{display:none!important;}',
                // Barre d'annotation de GEO recentrée à gauche du panneau (hors plein écran, où la carte est masquée).
                'body.' + _PANEL_BODY_CLASS + ':not(.' + _FULLSCREEN_BODY_CLASS + ') .acf-feature-tools-bar{right:var(--geo-pnx-panel-right,64px);}',

                '.geo-pnx-status{padding:8px 12px;font-size:12px;color:#666;background:#f7f7f7;',
                '  border-top:1px solid #ddd;flex-shrink:0;}',
                // En bas (pas en haut : Panoramax y affiche ses propres contrôles/messages
                // de statut de connexion tant que le viewer démarre).
                '.geo-pnx-hint{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);',
                '  z-index:5;max-width:80%;padding:8px 16px;background:rgba(0,0,0,.65);color:#fff;',
                '  font-size:12px;border-radius:14px;text-align:center;pointer-events:none;}',

                // Confirmation avant chargement du viewer (affichée dans le panneau)
                '.geo-pnx-confirm{flex:1;display:flex;flex-direction:column;align-items:center;',
                '  justify-content:center;padding:24px;text-align:center;font-family:sans-serif;}',
                '.geo-pnx-confirm h3{margin:0 0 10px;font-size:16px;}',
                '.geo-pnx-confirm p{margin:0 0 18px;max-width:380px;font-size:13px;line-height:1.5;color:#333;}',
                '.geo-pnx-confirm-actions{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;}',
                '.geo-pnx-btn{padding:7px 14px;border-radius:4px;border:none;cursor:pointer;',
                '  font-size:12px;font-weight:600;}',
                '.geo-pnx-btn--ghost{background:#eee;color:#333;}',
                '.geo-pnx-btn--ghost:hover{background:#e0e0e0;}',
                '.geo-pnx-btn--primary{background:#1a73e8;color:#fff;}',
                '.geo-pnx-btn--primary:hover{background:#1558b0;}',

                // Visite (Driver.js) : la cible de l'étape pulse, sans voile (cf. _tourOptions), et une
                // étape réussie affiche « ✓ Bien joué » avant de passer à la suivante. La bulle de
                // Driver est déjà au-dessus de l'UI de GEO (z-index 1000000000).
                '.driver-overlay{display:none!important;}',
                '@keyframes geo-pnx-pulse{0%,100%{box-shadow:0 0 0 0 rgba(240,74,74,.55);}',
                '  50%{box-shadow:0 0 0 8px rgba(240,74,74,0);}}',
                '.driver-active-element{animation:geo-pnx-pulse 1.4s ease-in-out infinite;}',
                // Point « cliquez ici » sur la carte GEO (étape Cliquez sur la carte) : ne
                // capte pas le clic, qui doit atteindre la carte.
                '.geo-pnx-tour-map-anchor{position:fixed;width:14px;height:14px;margin:-7px 0 0 -7px;',
                '  border-radius:50%;background:#f04a4a;border:2px solid #fff;z-index:9998;',
                '  pointer-events:none;animation:geo-pnx-pulse 1.4s ease-in-out infinite;}',
                '.geo-pnx-tour-success .driver-popover-description::before{content:"✓ Bien joué !";display:block;',
                '  color:#00a844;font-weight:700;margin-bottom:.4em;}',
                '@media (prefers-reduced-motion:reduce){.driver-active-element{animation:none;',
                '  outline:3px solid #f04a4a;}}',

                // Thème « intégré GEO » : blanc, liseré et bouton principal rouge GEO, coins 4px,
                // ombre douce ; boutons secondaires en texte simple. Tailles en px : la taille
                // de base de GEO ne doit pas changer le rendu des bulles.
                '.driver-popover.geo-pnx-tour{background:#fff;border-radius:4px;min-width:260px;max-width:340px;padding:0;',
                '  border-top:3px solid #f04a4a;box-shadow:0 4px 16px rgba(0,0,0,.18);color:#263238;}',
                '.geo-pnx-tour .driver-popover-title{font-size:14px;font-weight:700;line-height:1.45;color:#263238;',
                '  padding:0 14px;display:block;}',
                '.geo-pnx-tour .driver-popover-description{font-size:14px;line-height:1.45;color:#263238;',
                '  margin:0;padding:2px 14px 12px;}',
                '.geo-pnx-tour .driver-popover-close-btn{width:30px;height:30px;font-size:20px;line-height:30px;color:#90a4ae;}',
                '.geo-pnx-tour .driver-popover-close-btn:hover,.geo-pnx-tour .driver-popover-close-btn:focus-visible{color:#263238;}',
                '.geo-pnx-tour-count{font-size:11px;font-weight:700;letter-spacing:.04em;',
                '  text-transform:uppercase;color:#f04a4a;padding:12px 14px 4px;}',
                '.geo-pnx-tour .driver-popover-footer{margin:0;padding:0 12px 12px;}',
                '.geo-pnx-tour .driver-popover-navigation-btns{flex-wrap:wrap;justify-content:flex-end;gap:6px;}',
                '.geo-pnx-tour-btn{all:unset;box-sizing:border-box;margin:0;font-size:13px;line-height:1.3;cursor:pointer;',
                '  border-radius:3px;padding:6px 14px;font-weight:600;background:#f04a4a;color:#fff;}',
                '.geo-pnx-tour-btn:hover{background:#d93b3b;}',
                '.geo-pnx-tour-btn--secondary{background:none;color:#607d8b;font-weight:400;padding:6px 8px;}',
                '.geo-pnx-tour-btn--secondary:hover{background:#eceff1;color:#263238;}',
                '.geo-pnx-tour-btn:focus-visible{outline:2px solid #263238;outline-offset:2px;}',
            ].join('');

            document.head.appendChild(style);
        }
    }]);
