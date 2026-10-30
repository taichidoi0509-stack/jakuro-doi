const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/../app.js', 'utf8');
function extract(name) {
  const match = source.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^}', 'm'));
  if (!match) throw new Error('Missing ' + name);
  return match[0];
}
// Execute the real creation renderer with minimal DOM doubles. No network or DB writes.
const context = {
  MODE_PRESETS: {sanma:{label:'三人打ち',playerCount:3,startingPoints:35000,uma:[20,0,-20]}},
  RATE_PRESETS:[{label:'テンサン',multiplier:30}],
  sessionDraft:{gameMode:'sanma',memberIds:[],defaultUma:[20,0,-20],sessionDate:'2026-10-30',rateLabel:'テンサン',startingPoints:35000,chipValue:4,rateMultiplier:30,tobiEnabled:true,notes:''},
  activeGroupMembers:[], sessionList:[], page:{innerHTML:''},
  document:{querySelectorAll:()=>[],getElementById:()=>({addEventListener(){}})},
  getPageWorkspace:()=>context.page, getModePreset:()=>context.MODE_PRESETS.sanma,
  escapeHtml: value=>String(value), createMatchSession(){},
};
vm.createContext(context);
vm.runInContext(extract('renderCreateSessionView'),context);
vm.runInContext('renderCreateSessionView()',context);
assert.match(context.page.innerHTML,/createSessionForm/);
assert.equal((context.page.innerHTML.match(/data-session-uma-index/g)||[]).length,3);
assert.doesNotMatch(context.page.innerHTML,/undefined|\$\{uma\}/);
assert.doesNotMatch(source,/nanikiru/);
const cacheSource = fs.readFileSync(__dirname + '/../sw.js','utf8');
for(const [,asset] of cacheSource.matchAll(/"(\.\/[^"\n]*)"/g)) assert.ok(fs.existsSync(__dirname+'/../'+asset.split('?')[0]),asset);
console.log('PASS: creation renderer, 3 uma fields, quiz removal, cache assets');
