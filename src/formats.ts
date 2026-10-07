import { DEFAULT_PARAMETERS, MODEL_IDS, ROLES, newMatch, uid, type AppData, type Match, type Parameters, type Role, type Outcome } from './domain';
export function parseDuration(text:string):number|null {
  const normalized=text.normalize('NFKC').replace(/\s/g,'');
  if(!normalized) return null;
  if(!/^\d{1,3}:\d{2}(:\d{2})?$/.test(normalized)) throw new Error('时长请填写 m:ss 或 h:mm:ss，例如 15:36。');
  const parts=normalized.split(':').map(Number);
  if(parts[parts.length-1]>59 || (parts.length===3 && parts[1]>59)) throw new Error('时长的秒和小时格式中的分钟须小于 60。');
  return parts.length===2?parts[0]*60+parts[1]:parts[0]*3600+parts[1]*60+parts[2];
}
export function formatDuration(seconds:number|null) { if(seconds===null)return ''; const s=seconds%60,m=Math.floor(seconds/60); return m+':'+String(s).padStart(2,'0'); }
const textOrNull=(value:unknown,max=500) => {if(value===null || value===undefined || value==='')return null;if(typeof value!=='string' || value.length>max)throw new Error('文字字段格式或长度不正确。');return value;};
const roleValues: Record<string,Role>={tank:'tank',damage:'damage',support:'support',unknown:null,'坦克':'tank','输出':'damage','辅助':'support','未指定':null};
const outcomeValues:Record<string,Outcome>={win:'win',loss:'loss',draw:'draw',cancelled:'cancelled',unknown:'unknown','胜':'win','负':'loss','赢':'win','输':'loss','胜利':'win','战败':'loss','平局':'draw','取消':'cancelled','待确认':'unknown'};
export function externalMatch(value:unknown,datasetId:string):Match {
  if(!value || typeof value!=='object')throw new Error('记录应是一个对象。');
  const v=value as Record<string,unknown>;
  const outcome=outcomeValues[String(v.outcome)];
  if(!outcome)throw new Error('结果只能是 win、loss、draw、cancelled 或 unknown。');
  const role=v.role==null || v.role===''?null:roleValues[String(v.role)];
  if(role===undefined)throw new Error('位置必须是 tank、damage、support 或 unknown。');
  let duration:number|null=null;
  if(v.durationSeconds!==null && v.durationSeconds!==undefined && v.durationSeconds!=='') {
    duration=Number(v.durationSeconds); if(!Number.isInteger(duration)||duration<0||duration>86400)throw new Error('durationSeconds 应是 0–86400 的整数。');
  }
  const occurredAt=textOrNull(v.occurredAt);
  if(occurredAt && !Number.isFinite(Date.parse(occurredAt)))throw new Error('具体时间格式无效。');
  return newMatch(datasetId,{outcome,role,durationSeconds:duration,occurredAt,
    map:textOrNull(v.map),mode:textOrNull(v.mode),scoreDisplay:textOrNull(v.scoreDisplay),
    relativeTimeText:textOrNull(v.relativeTimeText),rank:textOrNull(v.rank),queueType:textOrNull(v.queueType),
    gapBefore:v.gapBefore===true || v.gapBefore==='true',partialRow:v.partialRow===true,
    rawFields:typeof v.rawFields==='string'?v.rawFields.slice(0,10000):'',entryKind:'file'});
}
export function parseCSV(text:string):string[][] {
  const rows:string[][]=[];let row:string[]=[],field='',quoted=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted && text[i+1]==='"'){field+='"';i++;}else if(quoted || field==='')quoted=!quoted;else throw new Error('CSV 引号位置不正确。');}
    else if(!quoted && (c===',' || c==='\n' || c==='\r')) {
      row.push(field);field='';
      if(c!==','){if(c==='\r' && text[i+1]==='\n')i++;if(row.some(Boolean))rows.push(row);row=[];}
    }else field+=c;
  }
  if(quoted)throw new Error('CSV 有未闭合引号。');
  row.push(field);if(row.some(Boolean))rows.push(row);
  return rows;
}
export function parseRecordFile(text:string,name:string,datasetId:string):Match[] {
  let entries:unknown[];
  if(name.toLowerCase().endsWith('.csv')){
    const rows=parseCSV(text),header=rows.shift();
    if(!header?.includes('outcome'))throw new Error('CSV 首行必须含 outcome 列。');
    entries=rows.map(row=>Object.fromEntries(header.map((key,i)=>[key.trim(),row[i] ?? ''])));
  }else{
    const value=JSON.parse(text);
    if(value?.format==='ow-next-match')throw new Error('这是完整备份，请在“数据与备份”中恢复。');
    if(value?.schemaVersion && value.schemaVersion!==1)throw new Error('不支持这个记录版本。');
    entries=Array.isArray(value)?value:value.records;
    if(value?.chronology?.recordIdsOldestToNewest){
      const byId=new Map((entries as {id:string}[]).map(r=>[r.id,r]));
      entries=value.chronology.recordIdsOldestToNewest.map((id:string)=>byId.get(id));
    }
  }
  if(!Array.isArray(entries)||!entries.length||entries.length>20000)throw new Error('文件须包含 1–20000 条记录。');
  return entries.map((entry,i)=>{try{return externalMatch(entry,datasetId);}catch(error){throw new Error('第 '+(i+1)+' 条：'+(error as Error).message);}});
}
export function parseManual(text:string,datasetId:string,role:Role):Match[] {
  const tokens=text.trim().toUpperCase().replace(/胜利/g,'胜').replace(/战败/g,'负').replace(/赢/g,'胜').replace(/输/g,'负').replace(/[\s,，;；|/]/g,'');
  if(!tokens || !/^[胜负WL10]+$/.test(tokens))throw new Error('请输入从旧到新的胜负序列，如 胜负胜胜负 或 WLWWL。');
  if(tokens.length>5000)throw new Error('一次最多补录 5000 条。');
  return [...tokens].map(t=>newMatch(datasetId,{outcome:'胜W1'.includes(t)?'win':'loss',role,entryKind:'manual-history'}));
}
const CSV_COLUMNS=['outcome','role','mode','map','relativeTimeText','durationSeconds','scoreDisplay','occurredAt','rank','queueType','gapBefore'] as const;
export function recordCSV(records:Match[]):string {
  const escape=(value:unknown)=>{let s=String(value??'');if(typeof value==='string' && /^[=+@-]/.test(s))s="'"+s;return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
  return '\uFEFF'+[CSV_COLUMNS.join(','),...records.map(r=>CSV_COLUMNS.map(k=>escape(r[k])).join(','))].join('\r\n');
}
export function validateParameters(value:unknown):Parameters {
  const p=value as Parameters;
  if(!p || ![p.prior,p.shortWindow,p.window,p.hazard,p.eta,p.share].every(Number.isFinite))throw new Error('模型参数无效。');
  if(p.prior<.1||p.prior>100||!Number.isInteger(p.window)||p.window<2||p.window>1000||!Number.isInteger(p.shortWindow)||p.shortWindow<1||p.shortWindow>1000||p.hazard<=0||p.hazard>=1||p.eta<=0||p.eta>100||p.share<0||p.share>1)throw new Error('模型参数超出范围。');
  if(p.historyLimit!=null&&(!Number.isInteger(p.historyLimit)||p.historyLimit<2||p.historyLimit>20000))throw new Error('历史窗口无效。');
  return {...DEFAULT_PARAMETERS,...p,historyLimit:p.historyLimit??null};
}
export interface Backup { format:'ow-next-match'; schemaVersion:1; exportedAt:string; data:AppData; attachments:{id:string;type:string;base64:string}[] }
export function validateBackup(input:unknown):Backup {
  const b=input as Backup;
  if(!b || b.format!=='ow-next-match'||b.schemaVersion!==1||b.data?.schemaVersion!==1)throw new Error('不支持的备份版本。');
  const d=b.data;
  for(const list of [d.datasets,d.records,d.configurations,d.batches,d.images,d.snapshots,b.attachments])if(!Array.isArray(list))throw new Error('备份结构不完整。');
  if(!d.datasets.length||d.records.length>20000||d.datasets.length>200||d.snapshots.length>20000)throw new Error('备份超出记录范围。');
  const ids=(rows:{id:string}[])=>{const set=new Set(rows.map(r=>r.id));if(set.size!==rows.length||rows.some(r=>typeof r.id!=='string'))throw new Error('备份有无效或重复 ID。');return set;};
  const datasetIds=ids(d.datasets),recordIds=ids(d.records),configIds=ids(d.configurations),batchIds=ids(d.batches),imageIds=ids(d.images);ids(d.snapshots);
  const revision=(n:number)=>Number.isInteger(n)&&n>=0;
  const date=(s:string)=>typeof s==='string'&&Number.isFinite(Date.parse(s));
  if(!revision(d.revision)||!ROLES.includes(d.scope)||typeof d.reducedMotion!=='boolean'||!Array.isArray(d.selectedModels)||d.selectedModels.length!==3||new Set(d.selectedModels).size!==3||d.selectedModels.some(id=>!MODEL_IDS.includes(id)))throw new Error('备份偏好或修订无效。');
  if(new Set([...datasetIds,...recordIds,...configIds,...batchIds,...imageIds,...d.snapshots.map(s=>s.id)]).size!==d.datasets.length+d.records.length+d.configurations.length+d.batches.length+d.images.length+d.snapshots.length)throw new Error('不同实体之间的 ID 发生冲突。');
  if(!datasetIds.has(d.activeDatasetId))throw new Error('备份的当前数据集不存在。');
  for(const c of d.configurations){if(c.version!=='math-v1'||!date(c.createdAt))throw new Error('不支持该模型版本或创建时间。');validateParameters(c.parameters);}
  for(const ds of d.datasets){
    if(!configIds.has(ds.configurationId)||!textOrNull(ds.name)||!['personal','synthetic','shared-log'].includes(ds.sourceKind)||!['confirmed','assumed-unconfirmed'].includes(ds.chronology)||!['unknown','complete','partial'].includes(ds.completeness)||!revision(ds.revision)||!date(ds.createdAt))throw new Error('数据集信息无效。');
    const rows=d.records.filter(r=>r.datasetId===ds.id);const ordinals=new Set(rows.map(r=>r.ordinal));
    if(ordinals.size!==rows.length||rows.some(r=>!Number.isInteger(r.ordinal)||r.ordinal<1))throw new Error('记录顺序无效。');
  }
  for(const r of d.records){externalMatch(r,r.datasetId);if(!datasetIds.has(r.datasetId)||!revision(r.revision)||!date(r.createdAt)||!['win','loss','draw','cancelled','unknown'].includes(r.outcome)||![null,'tank','damage','support'].includes(r.role)||(r.durationSeconds!==null&&(!Number.isInteger(r.durationSeconds)||r.durationSeconds<0))||!['quick-result','manual-history','screenshot','file','synthetic'].includes(r.entryKind)||!['user-entered','ocr-reviewed','synthetic'].includes(r.fieldOrigin)||typeof r.gapBefore!=='boolean'||typeof r.partialRow!=='boolean'||typeof r.rawFields!=='string'||(r.sourceBatchId&&!batchIds.has(r.sourceBatchId))||(r.sourceImageId&&!imageIds.has(r.sourceImageId)))throw new Error('记录来源引用或字段无效。');}
  for(const batch of d.batches)if(!datasetIds.has(batch.datasetId)||!Array.isArray(batch.recordIds)||!Array.isArray(batch.imageIds)||batch.recordIds.some(id=>!recordIds.has(id))||batch.imageIds.some(id=>!imageIds.has(id)))throw new Error('批次引用无效。');
  for(const image of d.images)if(!textOrNull(image.name)||!Number.isFinite(image.width)||!Number.isFinite(image.height)||image.width<1||image.height<1||!Number.isFinite(image.size)||image.size<0||typeof image.retained!=='boolean')throw new Error('图片元数据无效。');
  for(const s of d.snapshots)if(!datasetIds.has(s.datasetId)||!configIds.has(s.configurationId)||!ROLES.includes(s.scope)||!['pending','linked','cancelled'].includes(s.status)||!date(s.createdAt)||!revision(s.historyRevision)||(s.targetRecordId&&!d.records.some(r=>r.id===s.targetRecordId&&r.datasetId===s.datasetId))||(s.status==='linked'&&!s.targetRecordId)||!MODEL_IDS.every(id=>Number.isFinite(s.probabilities?.[id])&&s.probabilities[id]>=0&&s.probabilities[id]<=1))throw new Error('赛前快照无效。');
  const attachmentIds=new Set<string>();
  for(const a of b.attachments){if(!imageIds.has(a.id)||attachmentIds.has(a.id)||!/^image\/(png|jpeg)$/.test(a.type)||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.base64))throw new Error('图片附件无效。');attachmentIds.add(a.id);}
  return b;
}
export function restoreCopy(current:AppData,backup:Backup):{data:AppData;blobs:Map<string,Blob>} {
  const data=structuredClone(current),from=backup.data;
  const mapping=new Map<string,string>();for(const list of [from.datasets,from.records,from.configurations,from.images,from.batches,from.snapshots])for(const item of list)mapping.set(item.id,uid());
  const id=(value:string)=>mapping.get(value)!;
  const blobs=new Map(backup.attachments.map(a=>[id(a.id),new Blob([Uint8Array.from(atob(a.base64),c=>c.charCodeAt(0))],{type:a.type})]));
  data.configurations.push(...from.configurations.map(c=>({...c,id:id(c.id)})));
  data.datasets.push(...from.datasets.map(d=>({...d,id:id(d.id),name:d.name+' · 恢复',configurationId:id(d.configurationId)})));
  data.images.push(...from.images.map(i=>({...i,id:id(i.id),retained:blobs.has(id(i.id))})));
  data.batches.push(...from.batches.map(b=>({...b,id:id(b.id),datasetId:id(b.datasetId),recordIds:b.recordIds.map(id),imageIds:b.imageIds.map(id)})));
  data.records.push(...from.records.map(r=>({...r,id:id(r.id),datasetId:id(r.datasetId),sourceBatchId:r.sourceBatchId?id(r.sourceBatchId):null,sourceImageId:r.sourceImageId?id(r.sourceImageId):null})));
  data.snapshots.push(...from.snapshots.map(s=>({...s,id:id(s.id),datasetId:id(s.datasetId),configurationId:id(s.configurationId),targetRecordId:s.targetRecordId?id(s.targetRecordId):null,boundaryRecordId:s.boundaryRecordId&&mapping.has(s.boundaryRecordId)?id(s.boundaryRecordId):null})));
  data.activeDatasetId=id(from.activeDatasetId);data.scope=from.scope;data.selectedModels=[...from.selectedModels];data.reducedMotion=from.reducedMotion;return {data,blobs};
}
export function download(text:string,name:string,type='application/json') { const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
export function blobBase64(blob:Blob):Promise<string> {return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});}
