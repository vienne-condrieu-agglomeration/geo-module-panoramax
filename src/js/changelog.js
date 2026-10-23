/**
 * Journal des nouveautés d'un module GEO : lit CHANGELOG.md (format Keep a Changelog, importé en texte brut par
 * webpack) et l'affiche dans une modale au-dessus de GEO, avec un repère « nouveau » tant que la version courante
 * n'a pas été vue (mémorisé dans le navigateur seulement).
 *
 * Fichier AUTONOME, sans dépendance : il est copié tel quel dans chaque module (source : le gabarit
 * templates/template_extension_angular). Ne rien importer hors du dossier du module, pour qu'il reste
 * publiable seul. Ne pas le modifier dans un module : corriger le gabarit, puis recopier.
 *
 * Usage dans extension.js :
 *   import changelogMd from '../../CHANGELOG.md';
 *   import { createChangelog } from './changelog.js';
 *   var changelog = createChangelog({ name: pluginConf.name, title: pluginConf.displayName,
 *                                     version: pluginConf.version, markdown: changelogMd, prefix: 'geo-mon-module' });
 *   // dans un gabarit HTML : changelog.linkHtml() ; sur le clic du lien : changelog.open()
 */

// ------------------------------------------------------------------
// Lecture du Markdown
// ------------------------------------------------------------------
var SECTION_TYPES = {
    'ajouté': 'added', 'modifié': 'changed', 'corrigé': 'fixed',
    'retiré': 'removed', 'déprécié': 'deprecated', 'sécurité': 'security'
};

// Renvoie [{ version, date, unreleased, summary, sections: [{ type, title, body }] }], la plus récente en premier
// (ordre du fichier). Un titre de niveau 2 qui n'est ni « Non publié » ni une version SemVer n'est pas une version.
export function parseChangelog(markdown) {
    var releases = [], cur = null, sec = null;
    String(markdown || '').split(/\r?\n/).forEach(function (line) {
        var m = /^## \[([^\]]+)\](?:\s*[—–-]\s*(\d{4}-\d{2}-\d{2}))?/.exec(line);
        if (m) {
            var unreleased = /^(non publié|unreleased)$/i.test(m[1]);
            cur = unreleased || /^\d+\.\d+\.\d+/.test(m[1])
                ? { version: m[1], date: m[2] || null, unreleased: unreleased, summary: [], sections: [] } : null;
            sec = null;
            if (cur) { releases.push(cur); }
            return;
        }
        if (/^## /.test(line)) { cur = null; sec = null; return; }
        if (!cur) { return; }
        var h = /^### (.+?)\s*$/.exec(line);
        if (h) {
            sec = { type: SECTION_TYPES[h[1].toLowerCase()] || 'other', title: h[1], body: [] };
            cur.sections.push(sec);
            return;
        }
        (sec ? sec.body : cur.summary).push(line);
    });
    return releases.map(function (r) {
        return {
            version: r.version, date: r.date, unreleased: r.unreleased,
            summary: r.summary.join('\n').trim(),
            sections: r.sections.map(function (s) { return { type: s.type, title: s.title, body: s.body.join('\n').trim() }; })
                .filter(function (s) { return s.body; })
        };
    });
}

// Version courante : la plus récente publiée (hors « Non publié »), null sans aucune version.
export function currentVersion(releases) {
    for (var i = 0; i < releases.length; i++) { if (!releases[i].unreleased) { return releases[i].version; } }
    return null;
}

// ------------------------------------------------------------------
// Rendu Markdown minimal et sûr : paragraphes, listes à puces, **gras**, `code`, [liens](https://…).
// Le texte est échappé AVANT tout balisage : aucun HTML du fichier n'est repris tel quel.
// ------------------------------------------------------------------
function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]; });
}

function inline(text) {
    return esc(text)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function renderMarkdown(text) {
    var out = [], para = [], items = null;
    function flushPara() { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } }
    function flushList() { if (items) { out.push('<ul>' + items.map(function (i) { return '<li>' + inline(i) + '</li>'; }).join('') + '</ul>'); items = null; } }
    String(text || '').split(/\r?\n/).forEach(function (line) {
        var li = /^\s*[-*] +(.*)$/.exec(line);
        if (li) { flushPara(); (items = items || []).push(li[1]); return; }
        if (!line.trim()) { flushPara(); flushList(); return; }
        if (items && /^\s+\S/.test(line)) { items[items.length - 1] += ' ' + line.trim(); return; }   // suite d'une puce
        flushList();
        para.push(line.trim());
    });
    flushPara();
    flushList();
    return out.join('');
}

// ------------------------------------------------------------------
// Modale
// ------------------------------------------------------------------
var TYPE_LABELS = { added: 'Ajouté', changed: 'Modifié', fixed: 'Corrigé', removed: 'Retiré', deprecated: 'Déprécié', security: 'Sécurité', other: '' };

function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) { return ''; }
    var months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    return parseInt(m[3], 10) + (m[3] === '01' ? 'er ' : ' ') + months[parseInt(m[2], 10) - 1] + ' ' + m[1];
}

// opts : { name (clé du module, sert au stockage), title, version, markdown, prefix (préfixe des classes CSS),
//          zIndex (facultatif, 10001 par défaut : à relever si la modale doit passer devant une autre fenêtre du module) }
export function createChangelog(opts) {
    var releases = parseChangelog(opts.markdown), current = currentVersion(releases) || opts.version || null;
    var P = opts.prefix, storeKey = opts.name + '.changelog.seen';
    var overlay = null, keyHandler = null, previousFocus = null;

    function seenVersion() { try { return window.localStorage.getItem(storeKey); } catch (e) { return null; } }
    function hasNew() { return !!current && seenVersion() !== current; }
    function markSeen() { try { window.localStorage.setItem(storeKey, current); } catch (e) { /* stockage indisponible : le repère reste pour la session */ } }

    // Éteint (ou rallume) les repères « nouveau » déjà affichés.
    function refresh() {
        var dots = document.querySelectorAll('.' + P + '-changelog-dot');
        for (var i = 0; i < dots.length; i++) { dots[i].hidden = !hasNew(); }
    }

    function injectStyles() {
        var id = P + '-changelog-styles';
        if (document.getElementById(id)) { return; }
        var c = '.' + P + '-changelog-';
        var style = document.createElement('style');
        style.id = id;
        style.textContent = [
            c + 'link{display:inline-flex;align-items:center;gap:6px;background:none;border:0;padding:2px 0;cursor:pointer;color:#4e7f24;font:600 12px/16px "Open Sans",Helvetica,Arial,sans-serif;}',
            c + 'link:hover{text-decoration:underline;}',
            c + 'dot{width:8px;height:8px;border-radius:50%;background:#d93025;display:inline-block;}',
            c + 'dot[hidden]{display:none;}',
            c + 'overlay{position:fixed;inset:0;z-index:' + (opts.zIndex || 10001) + ';display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);}',
            c + 'dialog{box-sizing:border-box;width:calc(100% - 32px);max-width:640px;max-height:85vh;display:flex;flex-direction:column;background:#fff;color:#333;',
            '  border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.4);font:14px/20px "Open Sans",Helvetica,Arial,sans-serif;}',
            c + 'head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #e3e6e0;}',
            c + 'title{flex:1;margin:0;font-size:17px;font-weight:700;}',
            c + 'badge{padding:1px 9px;border-radius:10px;background:#e4ecdd;color:#3d6b1c;font-size:12px;font-weight:700;}',
            c + 'close{background:none;border:0;font-size:24px;line-height:1;cursor:pointer;color:#666;padding:0 4px;}',
            c + 'close:hover{color:#000;}',
            c + 'body{overflow:auto;padding:6px 18px 18px;}',
            c + 'empty{padding:24px 0;text-align:center;color:#666;}',
            c + 'release{position:relative;margin-top:18px;padding-left:18px;border-left:2px solid #d5dbd0;}',
            c + 'release:before{content:"";position:absolute;left:-6px;top:6px;width:10px;height:10px;border-radius:50%;background:#74b03e;border:2px solid #fff;}',
            c + 'release--next:before{background:#a5a5a5;}',
            c + 'version{margin:0;font-size:16px;font-weight:700;}',
            c + 'date{margin-left:8px;font-size:12px;font-weight:400;color:#777;}',
            c + 'summary{margin:4px 0 0;color:#555;}',
            c + 'section{margin-top:10px;}',
            c + 'tag{display:inline-block;margin-bottom:4px;padding:0 8px;border-radius:9px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:#fff;background:#777;}',
            c + 'tag--added{background:#2e8b3d;}', c + 'tag--changed{background:#2f6fd6;}', c + 'tag--fixed{background:#d9822b;}',
            c + 'tag--removed{background:#c0392b;}', c + 'tag--deprecated{background:#8a6d1d;}', c + 'tag--security{background:#7b3fb8;}',
            c + 'section ul{margin:0;padding-left:20px;}',
            c + 'section li{margin:2px 0;}',
            c + 'body p{margin:4px 0;}',
            c + 'body code{padding:0 4px;border-radius:4px;background:#f0f1ee;font-size:12px;}',
            c + 'body a{color:#2f6fd6;}'
        ].join('\n');
        document.head.appendChild(style);
    }

    function build() {
        var h = ['<div class="' + P + '-changelog-dialog" role="dialog" aria-modal="true" aria-labelledby="' + P + '-changelog-title">',
            '<div class="' + P + '-changelog-head"><h2 class="' + P + '-changelog-title" id="' + P + '-changelog-title">Nouveautés · ' + esc(opts.title || opts.name) + '</h2>',
            current ? '<span class="' + P + '-changelog-badge">v' + esc(current) + '</span>' : '',
            '<button type="button" class="' + P + '-changelog-close" data-close aria-label="Fermer">×</button></div>',
            '<div class="' + P + '-changelog-body">'];
        // « Non publié » n'apparaît que s'il contient quelque chose.
        var shown = releases.filter(function (r) { return !r.unreleased || r.summary || r.sections.length; });
        if (!shown.length) { h.push('<div class="' + P + '-changelog-empty">Aucune nouveauté enregistrée pour ce module.</div>'); }
        shown.forEach(function (r) {
            var date = formatDate(r.date);
            h.push('<section class="' + P + '-changelog-release' + (r.unreleased ? ' ' + P + '-changelog-release--next' : '') + '">',
                '<h3 class="' + P + '-changelog-version">' + (r.unreleased ? 'À venir' : 'Version ' + esc(r.version)) +
                (date ? '<span class="' + P + '-changelog-date">' + esc(date) + '</span>' : '') + '</h3>');
            if (r.summary) { h.push('<div class="' + P + '-changelog-summary">' + renderMarkdown(r.summary) + '</div>'); }
            r.sections.forEach(function (s) {
                h.push('<div class="' + P + '-changelog-section"><span class="' + P + '-changelog-tag ' + P + '-changelog-tag--' + s.type + '">' + esc(s.title) + '</span>' + renderMarkdown(s.body) + '</div>');
            });
            h.push('</section>');
        });
        h.push('</div></div>');
        return h.join('');
    }

    function close() {
        if (!overlay) { return; }
        document.removeEventListener('keydown', keyHandler, true);
        if (overlay.parentNode) { overlay.parentNode.removeChild(overlay); }
        overlay = keyHandler = null;
        if (previousFocus && previousFocus.focus) { try { previousFocus.focus(); } catch (e) { /* élément disparu */ } }
    }

    function open() {
        if (overlay) { return; }
        injectStyles();
        previousFocus = document.activeElement;
        overlay = document.createElement('div');
        overlay.className = P + '-changelog-overlay';
        overlay.innerHTML = build();
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay || (e.target.closest && e.target.closest('[data-close]'))) { close(); }
        });
        // Échap ferme ; Tab reste dans la modale (son seul élément focalisable est le bouton de fermeture).
        // Phase de capture + stopPropagation : une fenêtre du module ouverte dessous ne réagit pas à ces touches.
        keyHandler = function (e) {
            if (e.key === 'Escape') { e.stopPropagation(); close(); }
            else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); }
        };
        document.addEventListener('keydown', keyHandler, true);
        document.body.appendChild(overlay);
        var btn = overlay.querySelector('[data-close]');
        if (btn) { btn.focus(); }
        markSeen();
        refresh();
    }

    return {
        releases: releases,
        current: current,
        hasNew: hasNew,
        open: open,
        close: close,
        refresh: refresh,
        // Même lien, en élément DOM déjà branché (interface construite sans gabarit HTML).
        linkElement: function (extraClass) {
            injectStyles();
            var b = document.createElement('button');
            b.type = 'button';
            b.className = P + '-changelog-link' + (extraClass ? ' ' + extraClass : '');
            b.title = 'Voir les nouveautés de ce module';
            b.appendChild(document.createTextNode((current ? 'v' + current + ' · ' : '') + 'Nouveautés'));
            var dot = document.createElement('span');
            dot.className = P + '-changelog-dot';
            dot.hidden = !hasNew();
            b.appendChild(dot);
            b.addEventListener('click', open);
            return b;
        },
        // Lien « v1.2.3 · Nouveautés » à placer dans un gabarit HTML ; data-changelog sert à brancher le clic.
        linkHtml: function () {
            injectStyles();
            return '<button type="button" class="' + P + '-changelog-link" data-changelog title="Voir les nouveautés de ce module">' +
                (current ? 'v' + esc(current) + ' · ' : '') + 'Nouveautés<span class="' + P + '-changelog-dot" aria-label="Nouveauté non lue"' + (hasNew() ? '' : ' hidden') + '></span></button>';
        }
    };
}
