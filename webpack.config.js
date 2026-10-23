const path = require("path");

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
        // @panoramax/web-viewer utilise une syntaxe JS récente (??=, ?., class static blocks)
        // que le parseur de webpack 4 (acorn ancien) ne comprend pas nativement.
        // On transpile UNIQUEMENT ces constructions précises — pas de preset-env généraliste
        // vers ES5, qui a provoqué un "deopt" du code generator sur ce fichier de 3 Mo et des
        // bugs runtime dans le viewer (TypeError/ReferenceError après transpilation complète).
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
    // Force la résolution du build CJS (pas d'"export * as" ES2020 à parser).
    mainFields: ["browser", "main"]
  },
  optimization: {
    minimize: true
  }
};
