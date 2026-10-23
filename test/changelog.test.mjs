// Tests du journal des nouveautés : node test/changelog.test.mjs (copié tel quel dans chaque module)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseChangelog, currentVersion, renderMarkdown } from '../src/js/changelog.js';

const md = `# Journal

Texte d'introduction ignoré.

## [Non publié]

### Ajouté

- Une idée en cours

## [1.2.0] — 2026-10-23

Une accroche sur **deux** lignes
qui se suit.

### Ajouté

- Premier point avec \`code\` et un [lien](https://exemple.fr/a?x=1&y=2)
  qui continue sur la ligne suivante
- Second point

### Corrigé

- Un bogue

## Autre rubrique

### Ajouté

- Ne fait pas partie d'une version

## [1.1.0] — 2026-10-01

### Modifié

- Un changement

### Vide
`;

const r = parseChangelog(md);
assert.deepEqual(r.map((x) => x.version), ['Non publié', '1.2.0', '1.1.0']);
assert.ok(r[0].unreleased && !r[1].unreleased);
assert.equal(currentVersion(r), '1.2.0');
assert.equal(r[1].date, '2026-10-23');
assert.equal(r[1].summary, 'Une accroche sur **deux** lignes\nqui se suit.');
assert.deepEqual(r[1].sections.map((s) => s.type), ['added', 'fixed']);
assert.deepEqual(r[2].sections.map((s) => s.type), ['changed']);   // section vide retirée
assert.equal(r.length, 3);                                          // « Autre rubrique » n'est pas une version
assert.deepEqual(parseChangelog(''), []);
assert.equal(currentVersion(parseChangelog('## [Non publié]\n')), null);

// Rendu : puces avec suite, gras, code, lien http(s) ; tout HTML est échappé.
const html = renderMarkdown(r[1].sections[0].body);
assert.ok(html.startsWith('<ul><li>') && (html.match(/<li>/g) || []).length === 2);
assert.ok(html.includes('<code>code</code>'));
assert.ok(html.includes('<a href="https://exemple.fr/a?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">lien</a>'));
assert.ok(html.includes('qui continue sur la ligne suivante'));
assert.equal(renderMarkdown('a **b** c'), '<p>a <strong>b</strong> c</p>');
const evil = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=1>');
assert.ok(!evil.includes('<script') && !evil.includes('<img') && !evil.includes('href="javascript'));

// Le CHANGELOG.md réel du module se lit et a au moins une version publiée.
const real = parseChangelog(fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'));
assert.ok(currentVersion(real), 'CHANGELOG.md sans version publiée');

console.log('changelog : OK');
