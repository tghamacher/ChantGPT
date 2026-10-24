// Runs the unit tests in cases.js with Node: node test/node.js [part of a case's name]
'use strict';
require('../js/chant.js');
require('../js/staves.js');
require('../js/greciliae.js');
require('../js/neumes.js');
require('./cases.js');
const only = process.argv[2];
let failed = 0, run = 0;
for (const c of globalThis.CASES) {
  if (c.browser || (only && !c.name.includes(only))) continue;
  run++;
  let bad;
  try { bad = c.unit(); } catch (e) { bad = ['Threw: ' + (e.stack || e)]; }
  if (bad.length) { failed++; console.log(`FAIL ${c.name}\n  ${bad.join('\n  ')}`); }
  else console.log(`ok   ${c.name}`);
}
console.log(failed ? `FAIL ${failed}/${run}` : `PASS ${run}/${run}`);
process.exitCode = failed ? 1 : 0;
