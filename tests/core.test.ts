import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_PARAMETERS, MODEL_IDS, ROLES, initialData, insertRecords, newMatch, removeRecords, restoreRecords, sortedRecords } from '../src/domain';
import { Engine, replay, scoreRows } from '../src/models';
import { externalMatch, parseCSV, parseDuration, parseManual, parseRecordFile, recordCSV, restoreCopy, validateBackup, validateParameters } from '../src/formats';
import { detectBands, parseOCRFields } from '../src/ocr';
import { syntheticRecords } from '../src/synthetic';
const json=(path:string)=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const matches=(labels:number[])=>labels.map((y,i)=>newMatch('test',{id:'r'+i,ordinal:i+1,outcome:y?'win':'loss'}));
describe('exact mathematics and fair comparison',()=>{
  it('has fair cold start and smooths ten wins',()=>{
    expect(Object.values(new Engine().predict())).toEqual(Array(7).fill(.5));
    const result=replay(matches(Array(10).fill(1)));
    expect(result.next.beta30).toBeCloseTo(.75,14);
    expect(result.next.markov30).toBeCloseTo(14/19,14);
  });
  it('agrees with every Python prediction for the deterministic 60-row synthetic fixture',()=>{
    const fixture=json('tests/fixtures/synthetic-history.json'),byId=new Map(fixture.records.map((r:any)=>[r.id,r]));
    const rows=fixture.chronology.recordIdsOldestToNewest.map((id:string)=>externalMatch(byId.get(id),'test'));
    rows.forEach((r:ReturnType<typeof newMatch>,i:number)=>r.ordinal=i+1);
    const result=replay(rows),reference=json('tests/fixtures/model-reference.json').sample;
    expect(result.rows).toHaveLength(fixture.records.length);
    for(const [i,row] of result.rows.entries())for(const id of MODEL_IDS)expect(row.predictions[id]).toBeCloseTo(reference.rows[i].predictions[id],12);
    for(const id of MODEL_IDS){expect(result.next[id]).toBeCloseTo(reference.nextPrediction[id],12);expect(result.scores[id].brier).toBeCloseTo(reference.scores[id].brier,12);}
    expect(rows.every((r:ReturnType<typeof newMatch>)=>r.role===null)).toBe(true);
  });
  it('matches all four scopes and eight append branches',()=>{
    const reference=json('tests/fixtures/scope-reference.json'),rows=reference.syntheticRecords.map((r:any)=>externalMatch(r,'test'));
    rows.forEach((r:ReturnType<typeof newMatch>,i:number)=>r.ordinal=i+1);
    for(const scope of ROLES){
      const flow=rows.filter((r:ReturnType<typeof newMatch>)=>scope==='all'||r.role===scope);
      const result=replay(flow);
      for(const id of MODEL_IDS)expect(result.next[id]).toBeCloseTo(reference.preview.views[scope].base[id],12);
      for(const outcome of ['win','loss'] as const){
        const appended=[...rows,newMatch('test',{ordinal:65,role:scope==='all'?null:scope,outcome})];
        for(const view of ROLES){
          const branch=replay(appended.filter(r=>view==='all'||r.role===view));
          for(const id of MODEL_IDS)expect(branch.next[id]).toBeCloseTo(reference.preview.branches[scope][outcome][view].base[id],12);
        }
      }
    }
  });
  it('does not use future labels or change old forecasts',()=>{
    const base=matches([1,0,1,1,0,1]),changed=structuredClone(base);changed.at(-1)!.outcome='loss';
    expect(replay(base).rows.map(r=>r.predictions)).toEqual(replay(changed).rows.map(r=>r.predictions));
    expect(replay([...base,...matches([1]).map(r=>({...r,id:'new',ordinal:7}))]).rows.slice(0,6)).toEqual(replay(base).rows);
  });
  it('breaks Markov transitions on gaps and nonbinary events',()=>{
    const rows=matches([1,1,1,1]);rows[2].gapBefore=true;
    const result=replay(rows);expect(result.rows[2].predictions.markov30).toBe(.5);expect(result.next.markov30).toBeCloseTo(7/12,12);
    const invalid=newMatch('test',{ordinal:5,outcome:'draw'});
    const after=replay([...rows,invalid]);expect(after.rows.length).toBe(4);expect(after.next.markov30).toBe(.5);
    expect(after.next.bocpd).toEqual(result.next.bocpd);
  });
  it('isolates datasets and roles and pools all modes',()=>{
    const data=initialData(),id=data.activeDatasetId;
    insertRecords(data,id,[newMatch(id,{outcome:'win',role:'support',mode:'quick-play'}),newMatch(id,{outcome:'loss',role:'tank'}),newMatch(id,{outcome:'loss',role:'support',mode:'competitive'}),newMatch(id,{outcome:'win',role:null})]);
    data.records.push(newMatch('other',{outcome:'loss',role:'support',ordinal:1}));
    expect(sortedRecords(data,id,'support').map(r=>r.outcome)).toEqual(['win','loss']);
    expect(sortedRecords(data,id,'all')).toHaveLength(4);
    const base=replay(sortedRecords(data,id,'support'));data.records.forEach(r=>r.mode='arcade');
    expect(replay(sortedRecords(data,id,'support')).next).toEqual(base.next);
  });
  it('uses shared report subsets without retraining',()=>{
    const rows=matches([1,0,1,1,0]);rows.forEach((r,i)=>r.mode=i%2?'competitive':'quick-play');
    const result=replay(rows),subset=result.rows.filter(r=>r.mode==='competitive');
    expect(scoreRows(subset).fair50.brier).toBe(.25);
    expect(scoreRows([]).fair50.brier).toBeNull();
    expect(subset.map(r=>r.predictions)).toEqual([result.rows[1].predictions,result.rows[3].predictions]);
  });
  it('keeps probabilities finite in long loss and changed states',()=>{
    const result=replay(matches([...Array(500).fill(1),...Array(500).fill(0)]));
    for(const row of result.rows)for(const p of Object.values(row.predictions))expect(Number.isFinite(p)&&p>=0&&p<=1).toBe(true);
    expect(new Engine().weights().fixedShare.reduce((s,w)=>s+w,0)).toBeCloseTo(1,14);
    expect(replay(matches([1,1,0,0]),{...DEFAULT_PARAMETERS,historyLimit:2}).rows).toHaveLength(2);
  });
  it('has deterministic public simulations',()=>{
    expect(syntheticRecords('x','fair').map(r=>r.outcome)).toEqual(syntheticRecords('y','fair').map(r=>r.outcome));
    const result=replay(syntheticRecords('x','alternating'));
    expect(result.scores.markov30.brier!).toBeLessThan(result.scores.fair50.brier!);
  });
});
describe('import and persistence payloads',()=>{
  it('treats duration as elapsed time and validates seconds',()=>{
    expect(parseDuration('15:36')).toBe(936);expect(parseDuration('１：０２')).toBe(62);expect(parseDuration('1:02:03')).toBe(3723);expect(parseDuration('')).toBeNull();
    expect(()=>parseDuration('6:99')).toThrow();expect(()=>parseDuration('6:O2')).toThrow();
  });
  it('uses outcome text, never score magnitude',()=>{
    const fields=parseOCRFields({map:'萨 摩 亚',mode:'休闲比赛 快速比赛',time:'50 分钟之前 - 15:36',result:'胜 利 | 0-2'});
    expect(fields).toMatchObject({outcome:'win',scoreDisplay:'0-2',durationText:'15:36',relativeTimeText:'50分钟之前',mode:'quick-play'});
    expect(parseOCRFields({map:'',mode:'',time:'',result:'2-0'}).outcome).toBe('unknown');
    expect(parseOCRFields({map:'',mode:'',time:'',result:'战败 | 2-0'}).outcome).toBe('loss');
  });
  it('detects row bands including partial final rows at different scales',()=>{
    for(const scale of [1,2]){
      const w=200*scale,h=190*scale,pixels=new Uint8ClampedArray(w*h*4).fill(255);
      for(const [top,bottom] of [[20,60],[110,150],[185,190]])for(let y=top*scale;y<bottom*scale;y++)for(let x=174*scale;x<195*scale;x++){const i=(y*w+x)*4;pixels[i]=0;pixels[i+1]=180;pixels[i+2]=0;}
      const rows=detectBands(pixels,w,h);expect(rows).toHaveLength(3);expect(rows.at(-1)!.partial).toBe(true);
    }
  });
  it('round trips CSV quotes, unicode and blank fields',()=>{
    const rows=[newMatch('test',{outcome:'win',role:'support',map:'地图,"甲"\n乙',durationSeconds:null}),newMatch('test',{outcome:'loss',scoreDisplay:'2-0',durationSeconds:62})];
    const parsed=parseRecordFile(recordCSV(rows),'record.csv','test');
    expect(parsed.map(r=>r.map)).toEqual(rows.map(r=>r.map));expect(parsed[1].scoreDisplay).toBe('2-0');expect(parsed[1].durationSeconds).toBe(62);
    expect(()=>parseCSV('outcome\n"win')).toThrow();
    expect(recordCSV([newMatch('test',{map:'=cmd',outcome:'win'})])).toContain("'=cmd");
  });
  it('keeps duplicate imports as distinct appended records',()=>{
    const data=initialData(),id=data.activeDatasetId;
    const first=parseManual('胜负胜',id,null),second=parseManual('胜负胜',id,null);
    insertRecords(data,id,first);insertRecords(data,id,second);
    expect(sortedRecords(data,id)).toHaveLength(6);expect(new Set(data.records.map(r=>r.id)).size).toBe(6);
    insertRecords(data,id,[newMatch(id,{outcome:'loss'})],'start');
    expect(sortedRecords(data,id)[0].outcome).toBe('loss');removeRecords(data,first.map(r=>r.id));
    expect(sortedRecords(data,id).map(r=>r.ordinal)).toEqual([1,2,3,4]);
  });
  it('rejects malformed fields, unknown versions and invalid parameters',()=>{
    expect(()=>externalMatch({outcome:'win',role:'healer'},'test')).toThrow();
    expect(()=>externalMatch({outcome:'win',durationSeconds:'x'},'test')).toThrow();
    expect(()=>parseRecordFile('{"schemaVersion":99,"records":[]}','x.json','test')).toThrow();
    expect(()=>validateParameters({...DEFAULT_PARAMETERS,hazard:0})).toThrow();
    expect(()=>parseManual('胜x负','test',null)).toThrow();
  });
  it('restores complete structure with remapped ids and frozen snapshot probabilities',()=>{
    const data=initialData(),id=data.activeDatasetId,r=newMatch(id,{outcome:'win'});
    data.scope='support';data.reducedMotion=true;data.selectedModels=['beta10','hedge','bocpd'];
    insertRecords(data,id,[r]);data.snapshots.push({id:'snapshot',datasetId:id,scope:'all',configurationId:data.configurations[0].id,createdAt:new Date().toISOString(),historyRevision:0,boundaryRecordId:null,status:'linked',targetRecordId:r.id,probabilities:new Engine().predict()});
    const backup=validateBackup({format:'ow-next-match',schemaVersion:1,exportedAt:new Date().toISOString(),data,attachments:[]});
    const restored=restoreCopy(initialData(),backup).data;
    expect(restored.datasets).toHaveLength(2);expect(restored.records).toHaveLength(1);expect(restored.records[0].id).not.toBe(r.id);
    expect(restored.snapshots[0].targetRecordId).toBe(restored.records[0].id);expect(restored.snapshots[0].probabilities).toEqual(data.snapshots[0].probabilities);
    expect(restored.scope).toBe('support');expect(restored.reducedMotion).toBe(true);expect(restored.selectedModels).toEqual(data.selectedModels);
    const bad=structuredClone(backup);bad.data.snapshots[0].probabilities.bocpd=2;expect(()=>validateBackup(bad)).toThrow();
  });
  it('rejects backup states that could break preferences or revision checks',()=>{
    const data=initialData(),backup={format:'ow-next-match',schemaVersion:1,exportedAt:new Date().toISOString(),data,attachments:[]};
    for(const mutate of [(d:typeof data)=>{d.selectedModels=['bocpd','bocpd','hedge'];},(d:typeof data)=>{d.revision=NaN;},(d:typeof data)=>{d.datasets[0].createdAt='bad';},(d:typeof data)=>{d.datasets[0].id=d.configurations[0].id;d.activeDatasetId=d.datasets[0].id;}]){
      const bad=structuredClone(backup);mutate(bad.data);expect(()=>validateBackup(bad)).toThrow();
    }
  });
  it('restores a removed batch in place without deleting later additions or frozen probabilities',()=>{
    const data=initialData(),id=data.activeDatasetId,rows=parseManual('WLWL',id,null);rows[1].sourceBatchId='batch';rows[2].sourceBatchId='batch';
    data.batches.push({id:'batch',datasetId:id,createdAt:new Date().toISOString(),name:'test',recordIds:[rows[1].id,rows[2].id],imageIds:[]});insertRecords(data,id,rows);
    const saved=data.records.filter(r=>r.sourceBatchId==='batch').map(r=>({...r})),order=data.records.map(r=>r.id),probabilities=new Engine().predict();
    data.snapshots.push({id:'frozen',datasetId:id,scope:'all',configurationId:data.configurations[0].id,createdAt:new Date().toISOString(),historyRevision:0,boundaryRecordId:null,status:'linked',targetRecordId:rows[2].id,probabilities});
    const snapshots=structuredClone(data.snapshots);removeRecords(data,saved.map(r=>r.id));const later=newMatch(id,{outcome:'win'});insertRecords(data,id,[later]);restoreRecords(data,saved,order,snapshots);
    expect(sortedRecords(data,id).map(r=>r.id)).toEqual([...order,later.id]);expect(data.batches[0].recordIds).toEqual(saved.map(r=>r.id));expect(data.snapshots[0]).toEqual(snapshots[0]);
    expect(()=>restoreRecords(data,saved,order,snapshots)).toThrow();
  });
});
