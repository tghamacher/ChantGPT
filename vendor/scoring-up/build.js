// Builds scoring-up.js: Martha Thomae's JS_ScUp (the mensural scoring-up tool of the Measuring Polyphony editor, MIT;
// https://github.com/martha-thomae/JS_ScUp) and Robert Eisele's fraction.js (MIT), their CommonJS modules wrapped for
// the browser, unchanged, under a minimal require. Their debugging output (console.log) is kept quiet.
//   node vendor/scoring-up/build.js <JS_ScUp folder> <fraction.js package folder>
const fs = require('fs'), path = require('path');
const [scup, frac] = process.argv.slice(2);
const mods = {
  'fraction.js': path.join(frac, 'fraction.cjs'),
  './Merge.js': path.join(scup, 'Merge.js'),
  './ArsNova_and_WhiteMensural.js': path.join(scup, 'ArsNova_and_WhiteMensural.js'),
  './ArsAntiqua.js': path.join(scup, 'ArsAntiqua.js'),
  './postprocessing.js': path.join(scup, 'postprocessing.js'),
};
let out = `// Scoring-up of mensural notation: JS_ScUp by Martha Thomae (MIT; LICENSE-JS_ScUp) and fraction.js by Robert Eisele
// (MIT; LICENSE-fraction.js), bundled unchanged by build.js. global.ScoringUp = { merge, ArsNova, ArsAntiqua, PostProcessing }.
(function (global) {
  'use strict';
  const quiet = { log() { }, info() { }, debug() { }, warn: (...a) => global.console && global.console.warn(...a), error: (...a) => global.console && global.console.error(...a) };
  const defs = {}, cache = {};
  const require = name => { if (!(name in cache)) { const module = { exports: {} }; cache[name] = module.exports; defs[name](module, module.exports, require); cache[name] = module.exports; } return cache[name]; };
`;
for (const [name, file] of Object.entries(mods)) {
  out += `  defs[${JSON.stringify(name)}] = function (module, exports, require) { const console = quiet;\n${fs.readFileSync(file, 'utf8')}\n  };\n`;
}
out += `  const Merge = require('./Merge.js'), ArsNova = require('./ArsNova_and_WhiteMensural.js'), ArsAntiqua = require('./ArsAntiqua.js'), PostProcessing = require('./postprocessing.js');
  global.ScoringUp = { merge: Merge.merge, ArsNova, ArsAntiqua, PostProcessing };
})(typeof window !== 'undefined' ? window : globalThis);
`;
fs.writeFileSync(path.join(__dirname, 'scoring-up.js'), out);
console.log(`scoring-up.js: ${(out.length / 1024).toFixed(0)} KB`);
