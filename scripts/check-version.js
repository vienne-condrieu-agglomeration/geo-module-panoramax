/**
 * Vérifie que la version du module est la même partout : package.json, src/plugin.geoext.json et le premier
 * en-tête publié de CHANGELOG.md (`## [x.y.z]`, hors « Non publié »).
 *
 * Usage : node scripts/check-version.js   (lancé par `npm test` et à écrire avant `npm run package`)
 */
const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const pkg      = JSON.parse(read("package.json")).version;
const manifest = JSON.parse(read("src/plugin.geoext.json")).version;
const match    = /^## \[(\d+\.\d+\.\d+[^\]]*)\]/m.exec(read("CHANGELOG.md"));
const changelog = match ? match[1] : null;

const versions = { "package.json": pkg, "src/plugin.geoext.json": manifest, "CHANGELOG.md": changelog };
const distinct = new Set(Object.values(versions));

if (distinct.size !== 1 || changelog === null) {
    console.error("Versions différentes (à aligner dans le même commit) :");
    Object.keys(versions).forEach((f) => console.error("  " + f.padEnd(24) + (versions[f] || "(aucune version publiée)")));
    process.exit(1);
}
console.log("Version " + pkg + " : package.json, plugin.geoext.json et CHANGELOG.md concordent.");
