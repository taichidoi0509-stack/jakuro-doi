/* Rule helpers shared by creation, input preview and regression tests.
 * Persisted legacy sessions keep their existing calculation path.
 */
(function (root) {
  'use strict';
  function number(value, label) {
    if (value === '' || value === null || value === undefined || !Number.isFinite(Number(value))) {
      throw new Error(`${label}を入力してください。`);
    }
    return Number(value);
  }
  function round(value) { return Math.round((value + Number.EPSILON) * 1e8) / 1e8; }
  function normalize(input, {allowUnbalanced = false} = {}) {
    const count = number(input.playerCount, '人数');
    if (![3, 4].includes(count)) throw new Error('人数は3人または4人です。');
    const startingPoints = number(input.startingPoints, '持ち点');
    const returnPoints = number(input.returnPoints, '返し点');
    if (![startingPoints, returnPoints].every(v => Number.isInteger(v) && v > 0 && v <= 1000000 && v % 100 === 0)) {
      throw new Error('持ち点・返し点は100点単位、100〜1,000,000点で指定してください。');
    }
    if (!Array.isArray(input.uma) || input.uma.length !== count) throw new Error('全順位のウマを入力してください。');
    const uma = input.uma.map(v => number(v, 'ウマ'));
    if (uma.some(v => Math.abs(v) > 10000 || Math.abs(v * 10 - Math.round(v * 10)) > 1e-7)) throw new Error('ウマは0.1単位、±10,000以内で指定してください。');
    const oka = input.oka === undefined ? round((returnPoints-startingPoints)*count/1000) : number(input.oka,'オカ');
    if (Math.abs(oka)>10000 || Math.abs(oka*10-Math.round(oka*10))>1e-7) throw new Error('オカは0.1単位、±10,000以内で指定してください。');
    if (!allowUnbalanced && Math.abs(uma.reduce((sum,v)=>sum+v,0)+oka+(startingPoints-returnPoints)*count/1000)>1e-7) throw new Error('持ち点・返し点・ウマ・オカの収支合計を0にしてください。');
    if (!['split', 'seat', 'manual'].includes(input.tiePolicy)) throw new Error('同点時の処理を選択してください。');
    return {playerCount:count, startingPoints, returnPoints, uma, oka, tiePolicy:input.tiePolicy, chipEnabled:input.chipEnabled !== false};
  }
  function oka(input) {
    const rule = normalize(input);
    return rule.oka;
  }
  // Equivalent bonuses on a starting-point baseline, useful for compatibility
  // comparisons. New sessions store rankBonuses and score from return_points.
  function effectiveUma(input) {
    const rule = normalize(input);
    const deduction = (rule.returnPoints - rule.startingPoints) / 1000;
    const topBonus = rule.oka;
    return rule.uma.map((value, index) => round(value - deduction + (index === 0 ? topBonus : 0)));
  }
  function rankBonuses(input) {
    const rule=normalize(input);
    return rule.uma.map((value,index)=>round(value+(index===0?rule.oka:0)));
  }
  const api = Object.freeze({normalize, oka, effectiveUma, rankBonuses});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MorikenRules = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
