/**
 * Génère le fichier ZIP livrable pour import dans le générateur GEO.
 *
 * Structure du ZIP produit :
 *   geo-panoramax_AAAAMMJJ-HHMM.zip
 *   ├── plugin.geoext.json    (métadonnées du module)
 *   ├── main.js               (bundle webpack compilé)
 *   └── assets/
 *
 * Usage : node scripts/package.js
 * Prérequis : npm run build doit avoir été exécuté au préalable.
 */

const fs       = require("fs");
const path     = require("path");
const archiver = require("archiver");

const ROOT     = path.join(__dirname, "..");
const DIST     = path.join(ROOT, "dist");
// Nom daté (AAAAMMJJ-HHMM) : GEO refuse de réimporter un ZIP portant un nom déjà importé.
const STAMP    = new Date().toISOString().slice(0, 16).replace(/-|:/g, "").replace("T", "-");
const OUTPUT   = path.join(ROOT, `geo-panoramax_${STAMP}.zip`);

// Vérification que le build existe
if (!fs.existsSync(path.join(DIST, "main.js"))) {
    console.error("Erreur : dist/main.js introuvable. Lancez d'abord : npm run build");
    process.exit(1);
}

const output  = fs.createWriteStream(OUTPUT);
const archive = archiver("zip", { zlib: { level: 9 } });

output.on("close", function () {
    const sizeKB = (archive.pointer() / 1024).toFixed(1);
    console.log(`ZIP créé : ${OUTPUT} (${sizeKB} Ko)`);
    console.log("Prêt à importer dans le générateur GEO : Modules > + Module > glisser le ZIP.");
});

archive.on("error", function (err) {
    console.error("Erreur d'archivage :", err.message);
    process.exit(1);
});

archive.pipe(output);

// plugin.geoext.json à la racine du ZIP
archive.file(
    path.join(ROOT, "src", "plugin.geoext.json"),
    { name: "plugin.geoext.json" }
);

// main.js à la racine du ZIP
archive.file(
    path.join(DIST, "main.js"),
    { name: "main.js" }
);

// assets/ (CSS, images éventuelles)
const assetsDir = path.join(ROOT, "src", "assets");
if (fs.existsSync(assetsDir)) {
    archive.directory(assetsDir, "assets");
}

// preview image
const previewFile = path.join(ROOT, "src", "preview.png");
if (fs.existsSync(previewFile)) {
    archive.file(previewFile, { name: "src/preview.png" });
} else {
    console.warn("Avertissement : src/preview.png introuvable, le module n'aura pas de preview.");
}

archive.finalize();
