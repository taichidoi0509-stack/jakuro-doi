const assert = require('node:assert/strict');
const rules = require('../scoring-rules.js');
const rule = {playerCount:4,startingPoints:25000,returnPoints:30000,uma:[20,10,-10,-20],tiePolicy:'split',chipEnabled:true};
assert.equal(rules.oka(rule),20);
assert.deepEqual(rules.effectiveUma(rule),[35,5,-15,-25]);
// 25k start / 30k return / 20 oka / 10-20 uma, with 40k-30k-20k-10k finish.
assert.deepEqual([40000,30000,20000,10000].map((v,i)=>(v-25000)/1000+rules.effectiveUma(rule)[i]),[50,10,-20,-40]);
const sanma = {...rule,playerCount:3,startingPoints:35000,returnPoints:40000,uma:[20,0,-20]};
assert.equal(rules.oka(sanma),15);
assert.deepEqual(rules.effectiveUma(sanma),[30,-5,-25]);
assert.deepEqual(rules.effectiveUma({...sanma,returnPoints:35000}),sanma.uma);
assert.throws(()=>rules.normalize({...rule,startingPoints:''}));
assert.throws(()=>rules.normalize({...rule,returnPoints:NaN}));
assert.throws(()=>rules.normalize({...rule,uma:[20,10,-10,-10]}));
assert.throws(()=>rules.normalize({...rule,tiePolicy:'unknown'}));
for(const preset of [rule,sanma]) assert.ok(Math.abs(rules.effectiveUma(preset).reduce((a,b)=>a+b,0)) < 1e-7);
console.log('PASS: return points, oka, sanma/yonma, legacy baseline, zero sum, invalid input');
assert.deepEqual(rules.rankBonuses(rule),[40,10,-10,-20]);
assert.equal(rules.oka({...rule,oka:10,uma:[30,10,-10,-20]}),10);
assert.throws(()=>rules.normalize({...rule,oka:10}));
// Exercise the actual app ranking, per-hand bonus encoding and return-point preview.
const fs=require('node:fs'), vm=require('node:vm'), source=fs.readFileSync(__dirname+'/../app.js','utf8');
const names=['num','roundTo','roundOne','hasEnteredFinalPoints','getAutoRanksFromFinalPoints','getManualRanksFromDraft','getDraftRankState','syncAutoRanks','calculateDraftHanchanResult','getEffectiveUmaForSave'];
function extract(name) {
 const start=source.indexOf('function '+name+'('); assert.ok(start>=0,name);
 const end=source.indexOf('\n}',start);
 // Single line utility functions have their closing brace on the same line.
 return source.slice(start,source.indexOf('\n',start)<source.indexOf('{',start)?end+2:(source.slice(start,source.indexOf('\n',start)).endsWith('}')?source.indexOf('\n',start):end+2));
}
const c={activeMatchSession:{starting_points:25000,rule_settings:{return_points:30000,tie_policy:'split',seat_order:['d','c','b','a']}},activeMatchMembers:['a','b','c','d'].map(member_id=>({member_id})),hanchanDraft:{uma:[40,10,-10,-20],rankMode:'auto',tobiTransfers:[],results:{}}};
for(const [i,id] of ['a','b','c','d'].entries()) c.hanchanDraft.results[id]={rank:i+1,finalPoints:[40000,40000,10000,10000][i]};
vm.createContext(c);for(const n of names) vm.runInContext(extract(n),c);
const run=s=>vm.runInContext(s,c);
assert.equal(run('calculateDraftHanchanResult("a").totalPoints'),35);
assert.equal(run('calculateDraftHanchanResult("b").totalPoints'),35);
assert.equal(run('calculateDraftHanchanResult("c").totalPoints'),-35);
assert.equal(run('calculateDraftHanchanResult("d").totalPoints'),-35);
assert.equal(run('getEffectiveUmaForSave(syncAutoRanks())[0]'),25);
c.activeMatchSession.rule_settings.tie_policy='seat';
assert.equal(run('getDraftRankState().ranks.b'),1);
assert.equal(run('calculateDraftHanchanResult("b").totalPoints'),50);
assert.equal(run('calculateDraftHanchanResult("a").totalPoints'),20);
c.hanchanDraft.rankMode='manual';
for(const [i,id] of ['a','b','c','d'].entries())c.hanchanDraft.results[id].rank=i+1;
assert.equal(run('getDraftRankState().ranks.a'),1);
assert.equal(run('getEffectiveUmaForSave(getDraftRankState())[0]'),40);
c.activeMatchSession.rule_settings=null;
c.hanchanDraft.rankMode='auto';c.hanchanDraft.uma=[20,10,-10,-20];
assert.equal(run('calculateDraftHanchanResult("a").totalPoints'),30);
console.log('PASS: real preview, top tie + oka split, priority tie, manual tie, legacy scoring');
c.activeMatchSession.rule_settings={return_points:30000,tie_policy:'split'};
c.hanchanDraft.uma=[40,10,-10,-20];
for(const [i,id] of ['a','b','c','d'].entries())c.hanchanDraft.results[id].finalPoints=[30000,30000,30000,10000][i];
assert.equal(run('activeMatchMembers.reduce((sum,m)=>sum+calculateDraftHanchanResult(m.member_id).totalPoints,0)'),0);
assert.equal(run('getEffectiveUmaForSave(syncAutoRanks())[2]'),13.4);
console.log('PASS: new-rule three-way tie keeps total exactly zero');
