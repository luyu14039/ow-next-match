import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMETERS, CLASSIC_MODEL_IDS, initialData, insertRecords, newMatch, upgradeConfiguration } from '../src/domain';
import { Engine, fairAnchor, replay } from '../src/models';
import { restoreCopy, validateBackup, validateParameters } from '../src/formats';
import { chartScale } from '../src/chartScale';

describe('legacy math-v2 forecasting assumption',()=>{
  it('returns exactly 50% for every model and every past forecast under strict fairness',()=>{
    const labels=[...Array(25).fill(1),...Array(30).fill(0),1,0,1,0];
    const rows=labels.map((y,i)=>newMatch('test',{ordinal:i+1,outcome:y?'win':'loss'}));
    const result=replay(rows,{...DEFAULT_PARAMETERS,fairness:1});
    for(const row of result.rows)expect(CLASSIC_MODEL_IDS.map(id=>row.predictions[id])).toEqual(Array(7).fill(.5));
    expect(CLASSIC_MODEL_IDS.map(id=>result.next[id])).toEqual(Array(7).fill(.5));
    for(const id of CLASSIC_MODEL_IDS)expect(result.scores[id].brier).toBe(.25);
    expect(result.weights.hedge).toEqual(Array(5).fill(.2));
  });
  it('anchors base experts once, and updates ensemble weights with the reported probabilities',()=>{
    const raw=new Engine({...DEFAULT_PARAMETERS,fairness:0}),anchored=new Engine({...DEFAULT_PARAMETERS,fairness:.5});
    for(const y of [1,1,0,1,0,0,1,1,1]){raw.update(y);anchored.update(y);}
    const a=anchored.predict(),r=raw.predict(),weights=anchored.weights();
    for(const id of ['beta10','beta30','markov30','bocpd'] as const)expect(a[id]).toBeCloseTo(.5+(r[id]-.5)/2,14);
    const base=['fair50','beta10','beta30','markov30','bocpd'] as const;
    expect(a.hedge).toBeCloseTo(base.reduce((sum,id,i)=>sum+a[id]*weights.hedge[i],0),14);
    expect(a.fixedShare).toBeCloseTo(base.reduce((sum,id,i)=>sum+a[id]*weights.fixedShare[i],0),14);
    const expected=weights.hedge.map((w,i)=>w*Math.exp(-DEFAULT_PARAMETERS.eta*(a[base[i]]-1)**2));
    const total=expected.reduce((a,b)=>a+b,0);anchored.update(1,a);
    anchored.weights().hedge.forEach((w,i)=>expect(w).toBeCloseTo(expected[i]/total,14));
  });
  it('keeps legacy configurations reproducible and validates new strength limits',()=>{
    const {fairness:_,...legacy}=DEFAULT_PARAMETERS;
    const old=new Engine(legacy),unanchored=new Engine({...DEFAULT_PARAMETERS,fairness:0});
    for(const y of [1,0,1,1]){old.update(y);unanchored.update(y);}
    expect(old.predict()).toEqual(unanchored.predict());
    expect(validateParameters(legacy).fairness).toBe(0);
    for(const fairness of [-.1,1.1,NaN,Infinity])expect(()=>validateParameters({...DEFAULT_PARAMETERS,fairness})).toThrow();
  });
  it('reduces excess expected Brier error for a truly fair next outcome without claiming a universal gain',()=>{
    const expectedLoss=(p:number)=>(p**2+(1-p)**2)/2;
    for(const p of [.1,.3,.6,.9]){
      const originalExcess=expectedLoss(p)-.25;
      expect(expectedLoss(fairAnchor(p,.5))-.25).toBeCloseTo(originalExcess/4,14);
    }
    // A genuinely biased next outcome need not benefit from shrinking toward 50%.
    expect((fairAnchor(.9,.5)-1)**2).toBeGreaterThan((.9-1)**2);
  });
  it('upgrades active datasets without changing records, old configs, or frozen forecasts; upgrade is idempotent',()=>{
    const data=initialData(),configuration=data.configurations[0];configuration.version='math-v1';delete configuration.parameters.fairness;
    insertRecords(data,data.activeDatasetId,[newMatch(data.activeDatasetId,{outcome:'win'})]);
    data.snapshots.push({id:'frozen',datasetId:data.activeDatasetId,scope:'all',configurationId:configuration.id,createdAt:configuration.createdAt,historyRevision:1,boundaryRecordId:null,probabilities:new Engine(configuration.parameters).predict(),status:'pending',targetRecordId:null});
    const before=structuredClone(data),upgraded=upgradeConfiguration(data)!;
    expect(data).toEqual(before);expect(upgraded.records).toEqual(before.records);expect(upgraded.snapshots).toEqual(before.snapshots);
    expect(upgraded.configurations[0]).toEqual(configuration);expect(upgraded.datasets[0].configurationId).toBe(upgraded.configurations[1].id);
    expect(upgraded.configurations[1].parameters.fairness).toBe(0);expect(upgraded.revision).toBe(data.revision+1);
    expect(upgradeConfiguration(upgraded)).toBeNull();
    const backup=validateBackup({format:'ow-next-match',schemaVersion:1,data,attachments:[]});
    const restored=restoreCopy(initialData(),backup).data;
    expect(restored.configurations.find(c=>c.id===restored.datasets.at(-1)!.configurationId)!.version).toBe('math-v3');
    expect(restored.snapshots[0].probabilities).toEqual(before.snapshots[0].probabilities);
    expect(restored.configurations.find(c=>c.id===restored.snapshots[0].configurationId)!.version).toBe('math-v1');
  });
});

describe('readable automatic probability axis',()=>{
  it('zooms near 50%, includes all data and the reference, and keeps readable headroom',()=>{
    const axis=chartScale([.461,.477,.549,.534]);
    expect(axis.max-axis.min).toBeLessThan(.3);
    expect(axis.min).toBeLessThan(.461);expect(axis.max).toBeGreaterThan(.549);
    expect(axis.min).toBeLessThanOrEqual(.5);expect(axis.max).toBeGreaterThanOrEqual(.5);
    expect(axis.ticks[0]).toBe(axis.min);expect(axis.ticks.at(-1)).toBe(axis.max);
  });
  it('handles empty, identical, extreme, and invalid data without a zero or unbounded range',()=>{
    expect(chartScale([])).toEqual(chartScale([.5],true));
    for(const values of [[.5,.5],[0,1],[.95,.99],[.001,.01],[NaN,Infinity]]){
      const axis=chartScale(values);expect(axis.min).toBeGreaterThanOrEqual(0);expect(axis.max).toBeLessThanOrEqual(1);
      expect(axis.max-axis.min).toBeGreaterThanOrEqual(.1-1e-12);
      for(const p of values.filter(Number.isFinite))expect(p>=axis.min&&p<=axis.max).toBe(true);
    }
    expect(chartScale([0,1]).ticks).toEqual([0,.25,.5,.75,1]);
  });
});
