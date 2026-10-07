import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CLASSIC_MODEL_IDS, DEFAULT_PARAMETERS, initialData, insertRecords, newMatch, upgradeConfiguration, type Probabilities } from '../src/domain';
import { EloFeedback, eloExpected } from '../src/elo';
import { Engine, hasForecasts, replay, scoreRows } from '../src/models';
import { restoreCopy, validateBackup, validateParameters } from '../src/formats';
const matches=(labels:number[])=>labels.map((y,i)=>newMatch('test',{ordinal:i+1,outcome:y?'win':'loss'}));

describe('independent Elo rating and matchmaking feedback',()=>{
  it('uses logistic rating differences, symmetric probabilities and 400-point odds',()=>{
    expect(eloExpected(1500,1500)).toBe(.5);
    expect(eloExpected(1900,1500)).toBeCloseTo(10/11,14);
    expect(eloExpected(1500,1900)).toBeCloseTo(1/11,14);
    expect(eloExpected(25,125)).toBe(eloExpected(1500,1600));
    expect(eloExpected(1500,1700)+eloExpected(1700,1500)).toBeCloseTo(1,14);
  });
  it('separates Elo expected score from the fixed-ability next-match prediction',()=>{
    const engine=new EloFeedback();engine.update(0);const state=engine.state();
    expect(state.rating).toBe(1484);expect(state.opponent).toBe(1484);expect(state.ability).toBe(1500);
    expect(eloExpected(state.rating,1500)).toBeLessThan(.5);
    expect(state.expectedScore).toBe(.5);expect(state.probability).toBeCloseTo(.5230095872975623,14);
    engine.update(1);expect(engine.state().rating).toBe(1500);expect(engine.predict()).toBe(.5);
  });
  it('predicts 61.3% after five losses and the symmetric 38.7% after five wins under defaults',()=>{
    expect(replay(matches(Array(5).fill(0))).next.eloFeedback).toBeCloseTo(1/(1+10**(-80/400)),14);
    expect(replay(matches(Array(5).fill(1))).next.eloFeedback).toBeCloseTo(1/(1+10**(80/400)),14);
    expect(replay(matches(Array(5).fill(0))).elo.rating).toBe(1420);
  });
  it('does not invent a rebound when opponents do not follow rating changes',()=>{
    const result=replay(matches(Array(10).fill(0)),{...DEFAULT_PARAMETERS,eloResponse:0});
    expect(result.elo.rating).toBeLessThan(1500);expect(result.elo.opponent).toBe(1500);
    expect(result.next.eloFeedback).toBe(.5);expect(result.rows.every(row=>row.predictions.eloFeedback===.5)).toBe(true);
  });
  it('uses the full selected history, so a loss raises the default forecast without necessarily crossing 50%',()=>{
    const wins=matches(Array(10).fill(1)),after=replay([...wins,...matches(Array(5).fill(0))]);
    expect(after.next.eloFeedback).toBeGreaterThan(replay(wins).next.eloFeedback);
    expect(after.next.eloFeedback).toBeLessThan(.5);
    const limited=replay(matches([0,0,0]),{...DEFAULT_PARAMETERS,historyLimit:2});
    expect(limited.rows[0].predictions.eloFeedback).toBe(.5);expect(limited.elo.rating).toBe(1468);
  });
  it('updates ratings from actual minus expected score with lagged matchmaking',()=>{
    const engine=new EloFeedback(32,.5);engine.update(0);
    expect(engine.state().opponent).toBe(1492);
    const expected=eloExpected(1484,1492);engine.update(0);
    const rating=1484-32*expected;
    expect(engine.state().rating).toBeCloseTo(rating,14);
    expect(engine.state().opponent).toBeCloseTo(1492+.5*(rating-1492),14);
    expect(engine.predict()).toBeGreaterThan(.5);
    expect(engine.predict()).toBeLessThan(replay(matches([0,0])).next.eloFeedback);
  });
  it('treats draws as half scores without scoring them as binary wins or losses',()=>{
    const engine=new EloFeedback(32,.5);engine.update(0);const before=engine.state();
    engine.update(.5);expect(engine.state().rating).toBeCloseTo(before.rating+32*(.5-before.expectedScore),14);
    const rows=[...matches([0]),newMatch('test',{ordinal:2,outcome:'draw'})];
    const result=replay(rows,{...DEFAULT_PARAMETERS,eloResponse:.5});
    expect(result.rows).toHaveLength(1);expect(result.next.eloFeedback).toBeCloseTo(engine.predict(),14);
    expect(result.next.beta10).toBeCloseTo(5/11,14);expect(result.next.markov30).toBe(.5);
  });
  it('restarts Elo at gaps and unknown/cancelled outcomes without resetting classic estimates',()=>{
    const rows=matches([0,0,0]);rows[2].gapBefore=true;
    const result=replay(rows);expect(result.rows[2].predictions.eloFeedback).toBe(.5);
    expect(result.elo.rating).toBe(1484);expect(result.next.beta30).toBeCloseTo(5/13,14);
    for(const outcome of ['unknown','cancelled'] as const){
      const after=replay([...matches([0,0]),newMatch('test',{ordinal:3,outcome})]);
      expect(after.next.eloFeedback).toBe(.5);expect(after.next.beta30).toBeCloseTo(5/12,14);
    }
  });
  it('keeps classics and both ensemble weights independent of Elo settings',()=>{
    const rows=matches([1,1,0,1,0,0,0,1,0,0]),a=replay(rows),b=replay(rows,{...DEFAULT_PARAMETERS,eloK:100,eloResponse:.2});
    for(const id of CLASSIC_MODEL_IDS)expect(a.next[id]).toBe(b.next[id]);
    expect(a.weights).toEqual(b.weights);expect(a.next.eloFeedback).not.toBe(b.next.eloFeedback);
    expect(a.weights.hedge).toHaveLength(5);
  });
  it('reproduces every classic forecast and loss from the independent legacy v2 fixture',()=>{
    const reference=JSON.parse(readFileSync(new URL('./fixtures/model-reference-v2.json',import.meta.url),'utf8')).sample;
    const result=replay(matches(reference.rows.map((r:{outcome:number})=>r.outcome)),{...DEFAULT_PARAMETERS,fairness:.5});
    for(const id of CLASSIC_MODEL_IDS){
      for(const [i,row] of result.rows.entries())expect(row.predictions[id]).toBeCloseTo(reference.rows[i].predictions[id],12);
      expect(result.next[id]).toBeCloseTo(reference.nextPrediction[id],12);
      expect(result.scores[id].brier).toBeCloseTo(reference.scores[id].brier,12);
    }
  });
  it('has average rating drift toward the assumed ability, without making any outcome certain',()=>{
    for(const rating of [1300,1400,1600,1700]){
      const drift=32*(eloExpected(1500,rating)-.5);
      expect(Math.sign(drift)).toBe(Math.sign(1500-rating));
    }
    const engine=new EloFeedback(128,1);for(let i=0;i<10000;i++)engine.update(0);
    expect(Number.isFinite(engine.state().rating)).toBe(true);expect(Number.isFinite(engine.predict())).toBe(true);
  });
});

describe('Elo version migration and forecast provenance',()=>{
  function legacyData(){
    const data=initialData(),configuration=data.configurations[0];configuration.version='math-v2';configuration.parameters.fairness=.5;
    delete configuration.parameters.eloK;delete configuration.parameters.eloResponse;
    data.selectedModels=['markov30','bocpd','fixedShare'];
    insertRecords(data,data.activeDatasetId,[newMatch(data.activeDatasetId,{outcome:'loss'})]);
    const probabilities:Partial<Probabilities>=new Engine(configuration.parameters).predict();delete probabilities.eloFeedback;
    data.snapshots.push({id:'old-lock',datasetId:data.activeDatasetId,scope:'all',configurationId:configuration.id,createdAt:configuration.createdAt,historyRevision:1,boundaryRecordId:data.records[0].id,status:'pending',targetRecordId:null,probabilities});
    return data;
  }
  it('upgrades v2 to original classics plus Elo while preserving old parameters, records and frozen seven-model forecasts',()=>{
    const data=legacyData(),before=structuredClone(data),next=upgradeConfiguration(data)!;
    expect(data).toEqual(before);expect(next.records).toEqual(before.records);expect(next.snapshots).toEqual(before.snapshots);
    expect(next.configurations[0]).toEqual(before.configurations[0]);expect(next.configurations[1].version).toBe('math-v3');
    expect(next.configurations[1].parameters).toMatchObject({fairness:0,eloK:32,eloResponse:1});
    expect(next.selectedModels).toEqual(['eloFeedback','bocpd','fixedShare']);expect(upgradeConfiguration(next)).toBeNull();
    expect(next.snapshots[0].probabilities.eloFeedback).toBeUndefined();
  });
  it('preserves custom model selections during migration',()=>{
    const data=legacyData();data.selectedModels=['hedge','beta10','markov30'];
    expect(upgradeConfiguration(data)!.selectedModels).toEqual(data.selectedModels);
  });
  it('accepts and restores old backups without backfilling an Elo forecast',()=>{
    const data=legacyData(),backup=validateBackup({format:'ow-next-match',schemaVersion:1,data,attachments:[]});
    const restored=restoreCopy(initialData(),backup).data;
    expect(restored.snapshots[0].probabilities).toEqual(data.snapshots[0].probabilities);
    expect(restored.snapshots[0].probabilities.eloFeedback).toBeUndefined();
    expect(restored.configurations.find(c=>c.id===restored.datasets.at(-1)!.configurationId)!.version).toBe('math-v3');
    expect(()=>validateBackup({format:'ow-next-match',schemaVersion:1,data:restored,attachments:[]})).not.toThrow();
  });
  it('rejects missing or invalid Elo predictions for v3 snapshots and invalid parameters',()=>{
    const data=legacyData(),next=upgradeConfiguration(data)!;
    next.snapshots[0].configurationId=next.datasets[0].configurationId;
    const backup={format:'ow-next-match',schemaVersion:1,data:next,attachments:[]};
    expect(()=>validateBackup(backup)).toThrow();
    next.snapshots[0].probabilities.eloFeedback=.55;expect(()=>validateBackup(backup)).not.toThrow();
    next.snapshots[0].probabilities.eloFeedback=NaN;expect(()=>validateBackup(backup)).toThrow();
    for(const eloK of [0,129,NaN,Infinity])expect(()=>validateParameters({...DEFAULT_PARAMETERS,eloK})).toThrow();
    for(const eloResponse of [-.1,1.1,NaN,Infinity])expect(()=>validateParameters({...DEFAULT_PARAMETERS,eloResponse})).toThrow();
  });
  it('excludes missing historical model probabilities from metrics and common comparison groups',()=>{
    const row=replay(matches([0])).rows[0];delete row.predictions.eloFeedback;
    expect(hasForecasts(row,CLASSIC_MODEL_IDS)).toBe(true);expect(hasForecasts(row,['eloFeedback','fair50'])).toBe(false);
    expect(scoreRows([row]).eloFeedback).toMatchObject({n:0,brier:null,logLoss:null,direction:null,skill:null});
    expect(scoreRows([row]).fair50).toMatchObject({n:1,brier:.25});
  });
});
