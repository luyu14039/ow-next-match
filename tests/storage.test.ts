import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialData, insertImportedRecords, insertRecords, newMatch, sortedRecords, type Scope } from '../src/domain';
import { parseRecordFile } from '../src/formats';
import { loadData, openDatabase, readImage, saveData } from '../src/storage';
let db:IDBDatabase;
beforeEach(async()=>{await new Promise<void>((resolve,reject)=>{const r=indexedDB.deleteDatabase('ow-next-match');r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});db=await openDatabase();});
afterEach(()=>db.close());
describe('atomic local database',()=>{
  it.each(['tank','damage','support'] as Scope[])('reveals a screenshot import from the %s view and keeps it visible after reopening',async(scope)=>{
    const data=initialData(),id=data.activeDatasetId;
    insertRecords(data,id,[newMatch(id,{outcome:'loss',role:'support'})]);data.scope=scope;data.revision=1;
    await saveData(db,data,0);
    const next=structuredClone(data),rows=['win','loss'].map(outcome=>newMatch(id,{outcome:outcome as 'win'|'loss',entryKind:'screenshot',sourceBatchId:'batch',sourceImageId:'image'}));
    const image={id:'image',name:'history.png',width:1913,height:768,size:6,retained:true};
    insertImportedRecords(next,{id:'batch',datasetId:id,name:'1 张截图',createdAt:new Date().toISOString(),recordIds:rows.map(r=>r.id),imageIds:['image']},rows,[image]);
    next.revision=2;await saveData(db,next,1,new Map([['image',new File(['pixels'],'history.png',{type:'image/png'})]]));
    db.close();db=await openDatabase();const saved=await loadData(db);
    expect(saved.scope).toBe('all');expect(sortedRecords(saved,saved.activeDatasetId,saved.scope).map(r=>r.outcome)).toEqual(['loss','win','loss']);
    expect(sortedRecords(saved,id,'support')).toHaveLength(1);expect(saved.records.slice(1).every(r=>r.role===null)).toBe(true);
    expect(saved.datasets[0].revision).toBe(2);expect(saved.batches[0].recordIds).toEqual(rows.map(r=>r.id));expect(saved.images).toEqual([image]);
    expect(await (await readImage(db,'image'))!.text()).toBe('pixels');
  });
  it('opens the imported target dataset and preserves mixed file roles and insertion order',async()=>{
    const data=initialData(),originalId=data.activeDatasetId,id='other';data.scope='support';
    data.datasets.push({...data.datasets[0],id,name:'另一组对局'});
    const existing=newMatch(id,{outcome:'win',role:'damage'});insertRecords(data,id,[existing]);
    const rows=parseRecordFile('outcome,role,mode\nloss,tank,quick-play\nwin,,competitive','records.csv',id);
    insertImportedRecords(data,{id:'batch',datasetId:id,name:'records.csv',createdAt:new Date().toISOString(),recordIds:rows.map(r=>r.id),imageIds:[]},rows,[],'start');
    data.revision=1;await saveData(db,data,0);const saved=await loadData(db);
    expect(saved.activeDatasetId).toBe(id);expect(saved.scope).toBe('all');expect(sortedRecords(saved,id).map(r=>r.role)).toEqual(['tank',null,'damage']);
    expect(sortedRecords(saved,id).map(r=>r.ordinal)).toEqual([1,2,3]);expect(sortedRecords(saved,originalId)).toEqual([]);
  });
  it('saves records and original blobs and survives connection restart',async()=>{
    const data=initialData(),id=data.activeDatasetId;insertRecords(data,id,[newMatch(id,{outcome:'win',role:'support'})]);data.revision=1;
    await saveData(db,data,0,new Map([['image',new Blob(['original pixels'],{type:'image/png'})]]));
    db.close();db=await openDatabase();expect((await loadData(db)).records[0].role).toBe('support');
    expect(await (await readImage(db,'image'))!.text()).toBe('original pixels');
  });
  it('rejects stale concurrent writes without overwriting the first tab',async()=>{
    const data=initialData();data.revision=1;await saveData(db,data,0);
    const first=structuredClone(data),stale=structuredClone(data);first.revision=2;first.datasets[0].name='first';
    await saveData(db,first,1);stale.revision=2;stale.datasets[0].name='stale';
    await expect(saveData(db,stale,1)).rejects.toThrow('另一窗口');
    expect((await loadData(db)).datasets[0].name).toBe('first');
  });
  it('aborts the whole record and image batch on a clone failure',async()=>{
    const data=initialData();data.revision=1;await saveData(db,data,0);
    const changed=structuredClone(data);insertRecords(changed,changed.activeDatasetId,[newMatch(changed.activeDatasetId,{outcome:'loss'})]);changed.revision=2;
    const invalid=new Map([['broken',(()=>{}) as unknown as Blob]]);
    await expect(saveData(db,changed,1,invalid)).rejects.toThrow();
    expect((await loadData(db)).records).toHaveLength(0);expect(await readImage(db,'broken')).toBeUndefined();
  });
});
