export type Role = 'tank' | 'damage' | 'support' | null;
export type Scope = Exclude<Role, null> | 'all';
export type Outcome = 'win' | 'loss' | 'draw' | 'cancelled' | 'unknown';
export type ClassicModelId = 'fair50' | 'beta10' | 'beta30' | 'markov30' | 'bocpd' | 'hedge' | 'fixedShare';
export type ModelId = ClassicModelId | 'eloFeedback';
export type Probabilities = Record<ModelId, number>;
export interface Parameters { prior: number; shortWindow: number; window: number; hazard: number; eta: number; share: number; historyLimit: number | null; fairness?: number; eloK?:number; eloResponse?:number }
export interface Configuration { id: string; version: 'math-v1' | 'math-v2' | 'math-v3'; createdAt: string; parameters: Parameters }
export interface Dataset {
  id: string; name: string; sourceKind: 'personal' | 'synthetic' | 'shared-log';
  chronology: 'confirmed' | 'assumed-unconfirmed'; completeness: 'unknown' | 'complete' | 'partial';
  createdAt: string; revision: number; configurationId: string;
}
export interface Match {
  id: string; datasetId: string; ordinal: number; revision: number; outcome: Outcome;
  role: Role; mode: string | null; map: string | null; durationSeconds: number | null;
  scoreDisplay: string | null; relativeTimeText: string | null; occurredAt: string | null;
  rank: string | null; queueType: string | null; gapBefore: boolean;
  entryKind: 'quick-result' | 'manual-history' | 'screenshot' | 'file' | 'synthetic';
  sourceBatchId: string | null; sourceImageId: string | null; rowFromTop: number | null;
  partialRow: boolean; rawFields: string; fieldOrigin: 'user-entered' | 'ocr-reviewed' | 'synthetic';
  createdAt: string;
}
export interface SourceImage { id: string; name: string; width: number; height: number; size: number; retained: boolean }
export interface Batch { id: string; datasetId: string; createdAt: string; name: string; recordIds: string[]; imageIds: string[] }
export interface Snapshot {
  id: string; datasetId: string; scope: Scope; configurationId: string; createdAt: string;
  historyRevision: number; boundaryRecordId: string | null; probabilities: Partial<Probabilities>;
  status: 'pending' | 'linked' | 'cancelled'; targetRecordId: string | null;
}
export interface AppData {
  schemaVersion: 1; revision: number; datasets: Dataset[]; records: Match[];
  configurations: Configuration[]; batches: Batch[]; images: SourceImage[]; snapshots: Snapshot[];
  activeDatasetId: string; selectedModels: ModelId[]; scope: Scope; reducedMotion: boolean;
}
export const DEFAULT_PARAMETERS: Parameters = { prior: 5, shortWindow: 10, window: 30, hazard: 1 / 30, eta: 2, share: .04, historyLimit:null, fairness:0, eloK:32, eloResponse:1 };
export const CLASSIC_MODEL_IDS: ClassicModelId[] = ['fair50','beta10','beta30','markov30','bocpd','hedge','fixedShare'];
export const MODEL_IDS: ModelId[] = [...CLASSIC_MODEL_IDS,'eloFeedback'];
export const DEFAULT_MODELS: ModelId[] = ['eloFeedback','bocpd','fixedShare'];
export const ROLES: Scope[] = ['all','tank','damage','support'];
export const ROLE_NAMES: Record<Scope | 'unknown', string> = { all:'全部位置', tank:'坦克', damage:'输出', support:'辅助', unknown:'未指定' };
export const OUTCOME_NAMES: Record<Outcome, string> = { win:'胜利', loss:'战败', draw:'平局', cancelled:'取消', unknown:'待确认' };
export const MODE_NAMES: Record<string, string> = { 'quick-play':'快速比赛', competitive:'竞技比赛', arcade:'街机模式', custom:'自定义' };
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const inScope = (record: Match, scope: Scope) => scope === 'all' || record.role === scope;
export const validOutcome = (outcome: Outcome) => outcome === 'win' || outcome === 'loss';
export const sortedRecords = (data: AppData, datasetId: string, scope: Scope = 'all') =>
  data.records.filter(r => r.datasetId === datasetId && inScope(r,scope)).sort((a,b)=>a.ordinal-b.ordinal);
export function newMatch(datasetId: string, values: Partial<Match> = {}): Match {
  return { id:uid(), datasetId, ordinal:0, revision:0, outcome:'unknown', role:null, mode:null,
    map:null, durationSeconds:null, scoreDisplay:null, relativeTimeText:null, occurredAt:null,
    rank:null, queueType:null, gapBefore:false, entryKind:'manual-history', sourceBatchId:null,
    sourceImageId:null, rowFromTop:null, partialRow:false, rawFields:'', fieldOrigin:'user-entered', createdAt:now(), ...values };
}
export function initialData(): AppData {
  const configuration: Configuration = { id:uid(), version:'math-v3', createdAt:now(), parameters:{...DEFAULT_PARAMETERS} };
  const dataset: Dataset = { id:uid(), name:'我的对局', sourceKind:'personal', chronology:'confirmed', completeness:'unknown', createdAt:now(), revision:0, configurationId:configuration.id };
  return { schemaVersion:1, revision:0, datasets:[dataset], records:[], configurations:[configuration],
    batches:[], images:[], snapshots:[], activeDatasetId:dataset.id, selectedModels:[...DEFAULT_MODELS], scope:'all', reducedMotion:false };
}
// Preserve old configurations and forecasts; future/replayed forecasts use original classics + Elo.
export function upgradeConfiguration(data:AppData):AppData|null {
  const old=data.configurations.filter(c=>(c.version==='math-v1'||c.version==='math-v2')&&data.datasets.some(d=>d.configurationId===c.id));
  if(!old.length)return null;
  const next=structuredClone(data), replacements=new Map<string,string>();
  for(const configuration of old){
    const id=uid();replacements.set(configuration.id,id);
    next.configurations.push({id,version:'math-v3',createdAt:now(),parameters:{...configuration.parameters,fairness:0,eloK:DEFAULT_PARAMETERS.eloK,eloResponse:DEFAULT_PARAMETERS.eloResponse}});
  }
  for(const dataset of next.datasets)dataset.configurationId=replacements.get(dataset.configurationId)??dataset.configurationId;
  if(data.selectedModels.join(',')==='markov30,bocpd,fixedShare')next.selectedModels=[...DEFAULT_MODELS];
  next.revision=data.revision+1;
  return next;
}
export function insertRecords(data: AppData, datasetId: string, records: Match[], beforeId: string | null = null) {
  const list = sortedRecords(data,datasetId);
  const index = beforeId === 'start' ? 0 : beforeId ? list.findIndex(r=>r.id===beforeId) : list.length;
  if(index<0) throw new Error('插入位置已经改变，请重新选择。');
  list.splice(index,0,...records);
  const others = data.records.filter(r=>r.datasetId!==datasetId);
  data.records = [...others,...list.map((r,i)=>({...r,ordinal:i+1}))];
  const dataset = data.datasets.find(d=>d.id===datasetId);
  if(!dataset) throw new Error('目标数据集不存在。');
  dataset.revision++;
}
export function insertImportedRecords(data:AppData,batch:Batch,records:Match[],images:SourceImage[],beforeId:string|null=null){
  insertRecords(data,batch.datasetId,records,beforeId);
  data.images.push(...images);data.batches.push(batch);
  data.activeDatasetId=batch.datasetId;
  // Screenshots cannot identify the played role. Show the complete saved batch.
  data.scope='all';
}
export function removeRecords(data: AppData, ids: string[]) {
  const removed = new Set(ids), affected = new Set(data.records.filter(r=>removed.has(r.id)).map(r=>r.datasetId));
  data.records = data.records.filter(r=>!removed.has(r.id));
  data.snapshots = data.snapshots.map(s=>s.targetRecordId && removed.has(s.targetRecordId) ? {...s,status:'cancelled',targetRecordId:null} : s);
  data.batches = data.batches.map(b=>({...b,recordIds:b.recordIds.filter(id=>!removed.has(id))}));
  for(const datasetId of affected) {
    const rows = sortedRecords(data,datasetId);
    rows.forEach((r,i)=>{r.ordinal=i+1;});
    const dataset = data.datasets.find(d=>d.id===datasetId)!; dataset.revision++;
  }
}
export function restoreRecords(data:AppData,records:Match[],originalOrder:string[],snapshots:Snapshot[]=[]){
  if(!records.length)return;
  if(records.some(r=>data.records.some(v=>v.id===r.id)))throw new Error('记录已恢复，无法重复撤销。');
  const datasetId=records[0].datasetId,list=sortedRecords(data,datasetId);
  for(const r of records.slice().sort((a,b)=>a.ordinal-b.ordinal)){
    const anchor=originalOrder.slice(originalOrder.indexOf(r.id)+1).find(id=>list.some(v=>v.id===id));
    const later=list.findIndex(v=>!originalOrder.includes(v.id));
    const index=anchor?list.findIndex(v=>v.id===anchor):later>=0?later:list.length;
    list.splice(index,0,{...r});
    const batch=data.batches.find(b=>b.id===r.sourceBatchId);if(batch&&!batch.recordIds.includes(r.id))batch.recordIds.push(r.id);
  }
  data.records=[...data.records.filter(r=>r.datasetId!==datasetId),...list.map((r,i)=>({...r,ordinal:i+1}))];
  data.datasets.find(d=>d.id===datasetId)!.revision++;
  for(const snapshot of snapshots){const i=data.snapshots.findIndex(s=>s.id===snapshot.id);if(i>=0&&data.snapshots[i].status==='cancelled'&&data.snapshots[i].targetRecordId===null)data.snapshots[i]=structuredClone(snapshot);}
}
