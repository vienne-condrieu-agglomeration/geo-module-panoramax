/**
 * Configuration webpack pour publication directe sur le serveur GEO.
 *
 * Prérequis : générer un accessToken depuis
 *   https://[votre_serveur]/account > "Crédits et licences" > "Token d'accès"
 *   Cocher "geo:aas" puis "Générer un token avec ces scopes".
 *
 * Usage :
 *   GEO_ACCESS_TOKEN=xxx npm run publish          → build + publie une fois
 *   GEO_ACCESS_TOKEN=xxx npm run publish:watch     → build + publie à chaque modification (dev)
 */

const path = require("path");
const GeoExtensionPublish = require("@bg/publish-js-extension");

// Le jeton ne doit jamais être écrit dans le code : on le lit uniquement dans l'environnement.
const accessToken = process.env.GEO_ACCESS_TOKEN;
if (!accessToken) {
  throw new Error(
    "GEO_ACCESS_TOKEN manquant. Générez un jeton (scope geo:aas) sur " +
    "https://[votre_serveur]/account > \"Crédits et licences\" > \"Tokens GEO API\", " +
    "puis lancez : GEO_ACCESS_TOKEN=... npm run publish"
  );
}

module.exports = {

  entry: { main: path.join(__dirname, "/src/js/extension.js") },
  mode: "production",
  output: {
    path: path.join(__dirname, "/dist"),
    filename: "[name].js"
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"]
      },
      {
        // CHANGELOG.md embarqué en texte brut (journal des nouveautés, voir src/js/changelog.js)
        test: /\.md$/,
        use: "raw-loader"
      },
      {
        // driver.js (visite guidée, MIT) est publié en syntaxe récente (?., ??) que le parseur de
        // webpack 4 ne comprend pas : on ne transpile que ces deux constructions.
        test: /\.c?js$/,
        include: /node_modules[\\/]driver\.js/,
        use: {
          loader: "babel-loader",
          options: {
            plugins: [
              "@babel/plugin-transform-optional-chaining",
              "@babel/plugin-transform-nullish-coalescing-operator"
            ]
          }
        }
      },
      {
        test: /\.js$/,
        include: /node_modules[\\/]@panoramax/,
        use: {
          loader: "babel-loader",
          options: {
            plugins: [
              "@babel/plugin-transform-optional-chaining",
              "@babel/plugin-transform-nullish-coalescing-operator",
              "@babel/plugin-transform-logical-assignment-operators",
              "@babel/plugin-transform-class-static-block",
              "@babel/plugin-transform-class-properties",
              "@babel/plugin-transform-private-methods",
              "@babel/plugin-transform-private-property-in-object"
            ]
          }
        }
      }
    ]
  },
  externals: {
    angular: "angular"
  },
  resolve: {
    extensions: [".js"],
    mainFields: ["browser", "main"]
  },
  optimization: {
    minimize: true
  },
  plugins: [
    new GeoExtensionPublish({
      server:        process.env.GEO_SERVER || "https://geoservices.business-geografic.com",
      insecureServer: false,
      publish:       true,
      definition:    "src/plugin.geoext.json",
      accessToken:   accessToken
      // Alternative : authentification OAuth client credentials
      // clientId: process.env.GEO_CLIENT_ID,
      // secret:   process.env.GEO_SECRET
    })
  ]
};
