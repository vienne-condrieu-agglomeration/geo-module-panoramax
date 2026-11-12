// Cookie de session sur les tuiles de la mini-carte du visualiseur (instance privée).
//
// Le visualiseur charge les tuiles de sa mini-carte par un protocole maison, « panora:// » (utils/PanoraMapProtocol.js
// de @panoramax/web-viewer 5.2.0), dont l'appel `fetch(url, { signal })` n'envoie jamais `credentials`, quelles que
// soient les options données au visualiseur (`fetch-options`) : sur une instance privée, le serveur répond par des
// tuiles vides (aucune séquence réservée) et le linéaire manque dans la mini-carte. Constaté le 12/11/2026 (onglet
// Réseau : requêtes `…/api/map/{z}/{x}/{y}.mvt` sans cookie, réponse de 0 octet).
//
// Le visualiseur n'expose pas ce protocole et MapLibre ne permet pas de relire un protocole enregistré : on enveloppe
// donc `fetch` pour les seules URL de l'instance configurée, et seulement si le réglage « Instance privée » est actif
// (même contrat que ce réglage : l'instance autorise le domaine de GEO en CORS avec les cookies).
// ponytail: contournement d'un défaut du visualiseur. À retirer si une version du visualiseur envoie les
// credentials de lui-même (vérifier la tuile de la mini-carte, onglet Réseau, colonne Cookies).

var _wantsCredentials = function () { return false; };
var _installed = false;

// Installe l'enveloppe (une seule fois) et fixe la règle : reçoit l'URL demandée, renvoie true pour joindre le cookie.
export function installInstanceCredentials(rule) {
    _wantsCredentials = rule;
    if (_installed || typeof window.fetch !== 'function') { return; }
    _installed = true;

    var realFetch = window.fetch;
    window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || String(input);
        if (!(init && init.credentials) && _wantsCredentials(url)) {
            init = Object.assign({}, init, { credentials: 'include' });
        }
        return realFetch.call(this, input, init);
    };
}
