import angular from "angular";
import pluginConf from '../plugin.geoext.json';
import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';

// Enregistre les web components <pnx-viewer>, <pnx-photo-viewer>, etc.
import '@panoramax/web-viewer';

angular
    .module(pluginConf.code.moduleName, pluginConf.code.dependencies)
    .run(['geoApplication', 'acfExtensionService', '$rootScope', '$timeout',
          function (geoApplication, acfExtensionService, $rootScope, $timeout) {

        // ============================================================
        // Configuration (remplie depuis le générateur GEO)
        // ============================================================
        var _instanceUrl       = 'https://api.panoramax.xyz/api';
        var _siteUrl           = null; // site web public ; si vide, déduit de _instanceUrl
        var _searchRadius      = 0.0005;
        var _preferredUser          = null; // nom d'utilisateur ou UUID, insensible à la casse
        var _preferredUserCandidates = 20;
        var _toolName           = 'Panoramax';
        var _confirmBeforeOpen  = true;
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

        // Scope actif (widget) et référence à l'élément <pnx-viewer> courant
        var _currentScope  = null;
        var _viewerEl       = null;

        // ============================================================
        // Lecture config GEO Generator + enregistrement
        // ============================================================
        geoApplication.executeWhenInitialized(function () {
            var config = geoApplication.getConfigurationByExtensionKey(pluginConf.name);

            if (config && config.length > 0) {
                var props = config[0].properties;

                _instanceUrl      = (props.panoramaxInstanceUrl || _instanceUrl).replace(/\/+$/, '');
                _siteUrl          = (props.panoramaxSiteUrl || '').trim().replace(/\/+$/, '') || null;
                _searchRadius     = parseFloat(props.searchRadius) || _searchRadius;
                _preferredUser    = (props.preferredUser || '').trim() || null;
                _preferredUserCandidates = parseInt(props.preferredUserCandidates, 10) || _preferredUserCandidates;
                _toolName         = props.toolName       || _toolName;
                _confirmBeforeOpen = props.confirmBeforeOpen !== false && props.confirmBeforeOpen !== 'false';
                _cameraHeight     = parseFloat(props.cameraHeight) || _cameraHeight;
            }

            if (!_registered) {
                _registered = true;
                _injectStyles();
                _registerWidget();
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
                '  <div class="geo-pnx-viewer-wrap" ng-if="confirmed">',
                // focus="pic" est déjà la valeur par défaut du composant : le poser en
                // attribut statique déclenche attributeChangedCallback avant que le
                // sous-composant carte interne du viewer soit prêt (Uncaught Error:
                // Map is not enabled) — on laisse le défaut faire son travail.
                '    <pnx-viewer class="geo-pnx-viewer"></pnx-viewer>',
                '    <button class="geo-pnx-open-btn" ng-if="currentPicId" ng-click="openExternally()"',
                '            title="Ouvrir dans Panoramax">',
                '      ' + _LUCIDE.link,
                '    </button>',
                '    <button class="geo-pnx-fullscreen-btn" ng-class="{\'geo-pnx-fullscreen-btn--active\': isFullscreen}"',
                '            ng-click="toggleFullscreen()"',
                '            title="{{ isFullscreen ? \'Réduire\' : \'Agrandir en plein écran\' }}">',
                '      <span ng-if="!isFullscreen">' + _LUCIDE.maximize + '</span>',
                '      <span ng-if="isFullscreen">' + _LUCIDE.minimize + '</span>',
                '    </button>',
                '    <button class="geo-pnx-help-btn" ng-click="startTour()" title="Aide — visite guidée">',
                '      ' + _LUCIDE.help,
                '    </button>',
                '    <button class="geo-pnx-point-btn" ng-class="{\'geo-pnx-fullscreen-btn--active\': pointing}"',
                '            ng-click="togglePointing()" ng-disabled="!currentPicId"',
                '            title="Pointer un objet sur la photo">',
                '      ' + _LUCIDE.crosshair,
                '    </button>',
                '    <div class="geo-pnx-hint" ng-if="pointing">',
                '      Cliquez sur le <strong>pied</strong> de l\'objet, au sol, pour le placer sur la carte.',
                '    </div>',
                '    <div class="geo-pnx-hint" ng-if="!currentPicId && !statusMessage">',
                '      Cliquez sur la carte pour afficher la photo Panoramax la plus proche.',
                '    </div>',
                '  </div>',
                '  <div class="geo-pnx-points" ng-if="confirmed && (pointing || points.length)">',
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
                '        <span>{{ pt.index }}. {{ pt.type }} — ±{{ pt.accuracy }} m</span>',
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
                _panelWidthPct = 50; // état par défaut à chaque (re)ouverture du panneau

                $scope.currentPicId    = null;
                $scope.currentSeqId    = null;
                $scope.statusMessage   = null;
                $scope.isFullscreen    = false;
                // Le viewer n'est créé (et Panoramax interrogé) qu'après confirmation éventuelle.
                $scope.confirmed       = !_confirmBeforeOpen || _isNeverAsk();
                $scope.declined        = false;
                $scope.pointing        = false;
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
                    window.open(url, '_blank');
                };

                $scope.startTour = function () { _startTour(); };

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
                // de navigation (objets 3D) et marqueurs du viewer.
                function _onPhotoClick(event) {
                    var d = event.data;
                    console.debug('[geo-panoramax] clic photo', { pointing: $scope.pointing, data: d });
                    if (!$scope.pointing || !d || d.rightclick || d.marker ||
                        (d.objects && d.objects.length)) { return; }
                    var meta = _psvEl && _psvEl.getPictureMetadata && _psvEl.getPictureMetadata();
                    console.debug('[geo-panoramax] métadonnées photo', meta);
                    var res = _projectToGround(meta, d.yaw, d.pitch);
                    console.debug('[geo-panoramax] projection', res);
                    if (res.error) { _setStatus(res.error); return; }
                    _setStatus(null);
                    var pt = _addPoint(res, meta, $scope.pointInput.type);
                    $timeout(function () { $scope.points = _points; });
                    _addPointMarker(pt);
                }

                function _onReady() {
                    if (_readyHandled) { return; }
                    _readyHandled = true;
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
                            _locateFromMapClick(event.coordinates, event.crs);
                        });
                    }

                    // Cône de vision : "view-rotated" est émis par le sous-composant photo
                    // (psv) sans bubbling, donc écouté sur lui et pas sur <pnx-viewer>.
                    if (_viewerEl && _viewerEl.psv) {
                        _psvEl = _viewerEl.psv;
                        _psvEl.addEventListener('view-rotated', _onViewRotated);
                        _psvEl.addEventListener('picture-loaded', _onPictureLoaded);
                        _psvEl.addEventListener('click', _onPhotoClick);
                        console.debug('[geo-panoramax] écoute du clic photo activée');
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
                    });
                    // "select" se déclenche parfois deux fois d'affilée pour une même photo
                    // (une fois pour la séquence, une fois pour la photo) : ne replacer le
                    // marqueur (et donc ne recentrer/décaler la carte) qu'une seule fois.
                    if (detail.picId && detail.seqId && detail.picId !== _lastProcessedPicId) {
                        _lastProcessedPicId = detail.picId;
                        _placeMarkerForPicture(detail.seqId, detail.picId);
                    }
                }

                $scope.accept = function (neverAsk) {
                    if (neverAsk) { _setNeverAsk(); }
                    $scope.confirmed = true;
                    _initViewer();
                };

                $scope.decline = function () { $scope.declined = true; };

                function _initViewer() { $timeout(function () {
                    _viewerEl = $element[0].querySelector('pnx-viewer');
                    if (!_viewerEl) { return; }
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
                    _viewerEl = null;
                    _currentScope = null;
                    _removeMarker();
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

            api.getPicturesAroundCoordinates(lonLat[1], lonLat[0], _searchRadius, limit)
                .then(function (fc) {
                    var features = (fc && fc.features) || [];
                    var feature = _pickPreferredFeature(features);
                    if (!feature) {
                        _setStatus('Aucune photo Panoramax trouvée à cet endroit.');
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

        // Récupère les coordonnées de la photo courante via l'API STAC (item du catalogue)
        // pour repositionner le marqueur quand l'utilisateur navigue dans le viewer.
        function _placeMarkerForPicture(seqId, picId) {
            if (!_viewerEl || !_viewerEl.getAPI) { return; }
            var api = _viewerEl.getAPI();
            if (!api) { return; }

            fetch(_instanceUrl + '/collections/' + seqId + '/items/' + picId)
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (item) {
                    if (item && item.geometry && item.geometry.coordinates) {
                        _placeMarkerAtCoordinates(item.geometry.coordinates);
                    }
                })
                .catch(function () { /* la position du marqueur n'est qu'indicative */ });
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
            var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">' +
                '<circle cx="14" cy="14" r="9" fill="#d93025" fill-opacity="0.85" stroke="#fff" stroke-width="3"/>' +
                '<circle cx="14" cy="14" r="2.5" fill="#fff"/></svg>';
            geoApplication.map.addMarkers([{
                id:          pt.id,
                position:    { coordinates: [pt.lon, pt.lat], crs: 'EPSG:4326' },
                imageUrl:    'data:image/svg+xml;utf8,' + encodeURIComponent(svg),
                size:        { w: 28, h: 28 },
                positioning: 'center-center',
                tooltip:     { title: pt.index + '. ' + pt.type + ' (±' + pt.accuracy + ' m)' }
            }]).subscribe(function () {}, function (err) {
                console.error('[geo-panoramax] addMarkers (point) a échoué :', err);
            });
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
                                sequence: pt.seqId, date_pointage: pt.date
                            }
                        };
                    })
                }, null, 2));
                return;
            }
            // CSV séparé par des points-virgules (ouverture directe dans Excel en français),
            // avec BOM UTF-8 pour les accents.
            var rows = [['type', 'lon', 'lat', 'incertitude_m', 'distance_camera_m', 'cap',
                         'hauteur_camera_m', 'photo', 'sequence', 'date_pointage']];
            _points.forEach(function (pt) {
                rows.push([pt.type, pt.lon.toFixed(7), pt.lat.toFixed(7), pt.accuracy, pt.distance,
                           pt.heading, _cameraHeight, pt.picId || '', pt.seqId || '', pt.date]);
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
                '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">' +
                cone +
                '<circle cx="30" cy="30" r="11" fill="#1a73e8" stroke="#fff" stroke-width="3"/>' +
                '<circle cx="30" cy="30" r="4" fill="#fff"/></svg>'
            );
        }

        // ============================================================
        // Tour guidé (Shepherd.js)
        // ============================================================
        var _tour = null;

        function _tourOptions() {
            return {
                useModalOverlay: true,
                defaultStepOptions: {
                    cancelIcon: { enabled: true },
                    scrollTo: { behavior: 'smooth', block: 'center' },
                    classes: 'shepherd-theme-oldschool'
                }
            };
        }

        function _btn(label, action, secondary) {
            return { text: label, action: action, classes: secondary ? 'shepherd-button-secondary' : '' };
        }

        function _startTour() {
            if (_tour && _tour.isActive()) { _tour.cancel(); return; }

            _tour = new Shepherd.Tour(_tourOptions());

            _tour.addStep({
                id:       'fullscreen',
                text:     '<strong>Plein écran</strong><br>Agrandit le panneau pour mieux voir les photos immersives.',
                attachTo: { element: '.geo-pnx-fullscreen-btn', on: 'left' },
                buttons:  [_btn('Fermer', _tour.cancel.bind(_tour), true), _btn('Suivant ›', _tour.next.bind(_tour))]
            });

            _tour.addStep({
                id:       'map-click',
                text:     '<strong>Cliquez sur la carte</strong><br>Cliquez n\'importe où sur la carte GEO, à côté de ce panneau, pour afficher la photo Panoramax la plus proche de ce point.',
                attachTo: { element: '.geo-pnx-viewer-wrap', on: 'left' },
                buttons:  [_btn('‹ Précédent', _tour.back.bind(_tour), true), _btn('Suivant ›', _tour.next.bind(_tour))]
            });

            var hasOpenBtn = !!document.querySelector('.geo-pnx-open-btn');
            _tour.addStep({
                id:       'open-externally',
                text:     '<strong>Ouvrir dans Panoramax</strong><br>Ouvre la photo actuellement affichée dans une nouvelle fenêtre, sur le site Panoramax.' +
                          (hasOpenBtn ? '' : ' (Ce bouton apparaît une fois qu\'une photo est affichée.)'),
                attachTo: hasOpenBtn ? { element: '.geo-pnx-open-btn', on: 'left' } : undefined,
                buttons:  [_btn('‹ Précédent', _tour.back.bind(_tour), true), _btn('Terminer', _tour.complete.bind(_tour))]
            });

            _tour.start();
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
                '.geo-pnx-viewer-wrap{position:relative;flex:1;min-height:0;}',
                '.geo-pnx-viewer{position:absolute;inset:0;width:100%;height:100%;}',

                // Bouton rond "ouvrir dans Panoramax", sous le bouton d'aide. Pas en bas à
                // gauche : le viewer y place son propre bouton photo/carte, qui le recouvrait.
                '.geo-pnx-open-btn{position:absolute;right:12px;top:160px;z-index:5;',
                '  border-radius:50%;width:42px;height:42px;border:1px solid rgb(137,137,137);',
                '  background:rgb(255,255,255);cursor:pointer;display:flex;',
                '  align-items:center;justify-content:center;font-size:18px;}',
                '.geo-pnx-open-btn:hover{background:rgba(255,255,255,.95);}',
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
                '.geo-pnx-point-btn{position:absolute;right:12px;top:210px;z-index:5;',
                '  border-radius:50%;width:42px;height:42px;border:1px solid rgb(137,137,137);',
                '  background:rgb(255,255,255);cursor:pointer;display:flex;color:#444;padding:0;',
                '  align-items:center;justify-content:center;}',
                '.geo-pnx-point-btn:disabled{opacity:.5;cursor:default;}',
                '.geo-pnx-point-btn.geo-pnx-fullscreen-btn--active{background:#1a73e8;color:#fff;',
                '  border-color:#1a73e8;}',
                '.geo-pnx-points{flex-shrink:0;border-top:1px solid #ddd;background:#f7f7f7;',
                '  font-size:12px;}',
                '.geo-pnx-points-bar{display:flex;align-items:center;gap:6px;padding:6px 12px;flex-wrap:wrap;}',
                '.geo-pnx-points-spacer{flex:1;}',
                '.geo-pnx-points-list{list-style:none;margin:0;padding:0 12px 6px;max-height:110px;',
                '  overflow-y:auto;}',
                '.geo-pnx-points-list li{display:flex;justify-content:space-between;align-items:center;',
                '  padding:2px 0;}',
                '.geo-pnx-points-del{border:none;background:none;cursor:pointer;font-size:16px;color:#666;}',

                // Bouton d'aide, sous le bouton plein écran
                '.geo-pnx-help-btn{position:absolute;right:12px;top:110px;z-index:5;',
                '  border-radius:50%;width:42px;height:42px;border:1px solid rgb(137,137,137);',
                '  background:rgb(255,255,255);cursor:pointer;display:flex;',
                '  align-items:center;justify-content:center;font-size:16px;font-weight:700;',
                '  color:#444;}',
                '.geo-pnx-help-btn:hover{background:rgba(255,255,255,.95);}',

                // En plein écran, la carte GEO n'a (presque) plus de place visible : le
                // toolbar de dessin/sélection (topright) se replie et chevauche le toolbar
                // zoom/géoloc/permalien (topleft). On le masque tant que c'est le cas.
                'body.' + _FULLSCREEN_BODY_CLASS + ' .acf-map-controls-topright{display:none!important;}',

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

                // Shepherd : z-index au-dessus du reste de l'UI GEO
                '.shepherd-element{z-index:10000!important;}',
                '.shepherd-modal-overlay-container{z-index:9999!important;}',

                // Thème oldschool — bordure noire, coins carrés, boutons uppercase
                // (repris de geo-garbage-collector pour une identité visuelle cohérente)
                '.shepherd-theme-oldschool.shepherd-element{border:3px solid #1a1a1a;border-radius:0;',
                '  box-shadow:4px 4px 0 rgba(0,0,0,.18);background:#fff;max-width:380px;}',
                '.shepherd-theme-oldschool .shepherd-content{border-radius:0;}',
                '.shepherd-theme-oldschool .shepherd-header{border-radius:0;padding:.75rem 1rem 0;}',
                '.shepherd-theme-oldschool .shepherd-text{font-size:1.8rem;line-height:1.55;',
                '  color:#1a1a1a;padding:1.25rem 1.5rem;}',
                '.shepherd-theme-oldschool .shepherd-footer{border-top:2px solid #1a1a1a;',
                '  border-radius:0;padding:0;display:flex;justify-content:stretch;}',
                '.shepherd-theme-oldschool .shepherd-button{flex:1;border:none;',
                '  border-radius:0;font-size:1.5rem;font-weight:700;',
                '  text-transform:uppercase;letter-spacing:.06em;padding:1rem;margin:0;',
                '  transition:filter .15s;}',
                '.shepherd-theme-oldschool .shepherd-button:not(:disabled):hover{filter:brightness(.92);}',
                '.shepherd-theme-oldschool .shepherd-button.shepherd-button-secondary{',
                '  background:#cfd8dc;color:#1a1a1a;}',
                '.shepherd-theme-oldschool .shepherd-button:not(.shepherd-button-secondary){',
                '  background:#00c853;color:#fff;}',
                '.shepherd-theme-oldschool .shepherd-button+.shepherd-button{border-left:2px solid #1a1a1a;}',
                '.shepherd-theme-oldschool .shepherd-cancel-icon{color:#333;font-size:1.6em;}',
                '.shepherd-theme-oldschool[data-popper-placement^=bottom]>.shepherd-arrow:before{box-shadow:-2px -2px 0 #1a1a1a;}',
                '.shepherd-theme-oldschool[data-popper-placement^=top]>.shepherd-arrow:before{box-shadow:2px 2px 0 #1a1a1a;}',
                '.shepherd-theme-oldschool[data-popper-placement^=left]>.shepherd-arrow:before{box-shadow:2px -2px 0 #1a1a1a;}',
                '.shepherd-theme-oldschool[data-popper-placement^=right]>.shepherd-arrow:before{box-shadow:-2px 2px 0 #1a1a1a;}'
            ].join('');

            document.head.appendChild(style);
        }
    }]);
