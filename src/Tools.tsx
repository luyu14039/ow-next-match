import { useEffect, useState, type FormEvent } from 'react';
import { DEFAULT_PARAMETERS, MODEL_IDS, MODE_NAMES, OUTCOME_NAMES, ROLE_NAMES, newMatch, now, removeRecords, sortedRecords, uid, type AppData, type Configuration, type Match, type ModelId, type Parameters, type Role } from './domain';
import { MODELS } from './models';
import { blobBase64, download, formatDuration, parseDuration, recordCSV, restoreCopy, validateBackup, validateParameters, type Backup } from './formats';
import { readImage } from './storage';
import { ErrorText, Icon, Modal } from './components';
import type { Persist } from './App';
const nil = (text:string) => text.trim() || null;
export function DataDrawer({data,db,busy,persist,onClose}:{data:AppData;db:IDBDatabase;busy:boolean;persist:Persist;onClose:()=>void}){
  const dataset=data.datasets.find(d=>d.id===data.activeDatasetId)!;
  const [name,setName]=useState(dataset.name),[newName,setNewName]=useState(''),[includeImages,setIncludeImages]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState('');
  const [backup,setBackup]=useState<Backup|null>(null);
  useEffect(()=>setName(dataset.name),[dataset.id,dataset.name]);
  const exportBackup=async()=>{
    setWorking(true);setError('');
    try{
      const snapshot=structuredClone(data),attachments:Backup['attachments']=[];
      if(includeImages)for(const image of data.images.filter(i=>i.retained)){
        const blob=await readImage(db,image.id);
        if(!blob)throw new Error('部分原图已不存在，请取消包含原图后导出，或先检查浏览器存储。');
        attachments.push({id:image.id,type:blob.type,base64:await blobBase64(blob)});
      }
      download(JSON.stringify({format:'ow-next-match',schemaVersion:1,exportedAt:now(),data:snapshot,attachments},null,2),'next-match-backup-'+new Date().toISOString().slice(0,10)+'.json');
    }catch(e){setError((e as Error).message);}finally{setWorking(false);}
  };
  const readBackup=async(file:File)=>{
    setError('');setBackup(null);if(file.size>150*1024*1024){setError('备份超过 150 MB，请使用不含图片的备份。');return;}
    try{setBackup(validateBackup(JSON.parse(await file.text())));}catch(e){setError('备份校验失败：'+(e as Error).message);}
  };
  const restore=async()=>{if(!backup)return;setWorking(true);setError('');
    try{const restored=restoreCopy(data,backup);const ok=await persist(next=>{Object.assign(next,restored.data);},'备份已恢复为新数据集',undefined,restored.blobs);if(ok)setBackup(null);else setError('恢复写入失败。当前记录和备份草稿均保留。');}
    catch(e){setError((e as Error).message);}finally{setWorking(false);}
  };
  const create=async()=>{if(!newName.trim()){setError('请给数据集一个名称。');return;}const id=uid();
    const ok=await persist(next=>{next.datasets.push({id,name:newName.trim().slice(0,80),sourceKind:'personal',chronology:'confirmed',completeness:'unknown',createdAt:now(),revision:0,configurationId:dataset.configurationId});next.activeDatasetId=id;next.scope='all';},'已创建空数据集');
    if(ok)setNewName('');
  };
  return <Modal title="数据与备份" onClose={onClose} wide>
    <p className="subtle-note">每个数据集独立计算。记录按当前站点地址保存在本机浏览器，换浏览器或地址时请用备份迁移。</p>
    <div className="tool-columns"><section><h3>对局手记</h3><div className="dataset-list">{data.datasets.map(ds=><button key={ds.id} className={dataset.id===ds.id?'selected':''} disabled={busy} aria-pressed={dataset.id===ds.id} onClick={()=>void persist(next=>{next.activeDatasetId=ds.id;})}><Icon name={ds.sourceKind==='synthetic'?'chart':'storage'}/><span><strong>{ds.name}</strong><small>{data.records.filter(r=>r.datasetId===ds.id).length} 条 · {ds.sourceKind==='synthetic'?'模拟':ds.sourceKind==='shared-log'?'他人日志':'个人记录'}</small></span>{dataset.id===ds.id&&<Icon name="check"/>}</button>)}</div>
      <div className="inline-form"><input aria-label="新数据集名称" placeholder="新数据集名称" maxLength={80} value={newName} onChange={e=>setNewName(e.target.value)}/><button className="secondary-button" disabled={busy} onClick={()=>void create()}>新建</button></div>
      <label className="field">当前名称<input value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></label><button className="text-button" disabled={busy||!name.trim()} onClick={()=>void persist(next=>{next.datasets.find(d=>d.id===dataset.id)!.name=name.trim();},'名称已保存')}>保存名称</button>
      <div className="field-grid"><label className="field">顺序确认<select value={dataset.chronology} disabled={busy} onChange={e=>void persist(next=>{next.datasets.find(d=>d.id===dataset.id)!.chronology=e.target.value as typeof dataset.chronology;})}><option value="confirmed">已由我确认</option><option value="assumed-unconfirmed">暂定，尚未确认</option></select></label><label className="field">记录完整性<select value={dataset.completeness} disabled={busy} onChange={e=>void persist(next=>{next.datasets.find(d=>d.id===dataset.id)!.completeness=e.target.value as typeof dataset.completeness;})}><option value="unknown">未知</option><option value="partial">部分记录</option><option value="complete">我确认完整</option></select></label></div>
      <label className="check-field"><input type="checkbox" checked={data.reducedMotion} disabled={busy} onChange={e=>void persist(next=>{next.reducedMotion=e.target.checked;})}/>减少动态（也尊重系统设置）</label>
      <details className="snapshot-ledger"><summary>赛前快照记录（含历史配置）</summary>{data.snapshots.filter(s=>s.datasetId===dataset.id).slice().reverse().map(s=><div key={s.id}><strong>{ROLE_NAMES[s.scope]} · {new Date(s.createdAt).toLocaleString('zh-CN')}</strong><p>{s.status==='pending'?'待关联':s.status==='linked'?'已关联':'已取消'} · 配置 {s.configurationId.slice(0,8)} · 历史修订 {s.historyRevision}</p><div>{MODEL_IDS.map(id=><span key={id}>{MODELS[id].name} {(s.probabilities[id]*100).toFixed(1)}% </span>)}</div></div>)}</details>
    </section><section><h3>把记录带走</h3><p className="subtle-note">完整 JSON 保存全部数据集、批次、配置和赛前快照。CSV 只导出当前数据集的记录。</p><label className="check-field"><input type="checkbox" checked={includeImages} onChange={e=>setIncludeImages(e.target.checked)}/>备份包含保留的原图</label><p className="microcopy">{includeImages?'将附带原图，文件会较大。':'记录完整；原图不在备份内。'}</p><div className="button-row"><button className="primary-button" disabled={working} onClick={()=>void exportBackup()}>{working?'处理中…':'导出完整备份'}</button><button className="secondary-button" onClick={()=>download(recordCSV(sortedRecords(data,dataset.id)),'next-match-records.csv','text/csv;charset=utf-8')}>导出 CSV</button></div>
      <hr/><h3>从备份恢复</h3><p className="subtle-note">恢复为新的数据集，保留当前记录。版本与引用校验通过后才写入。</p><label className="file-picker">选择 JSON 备份<input aria-label="选择完整备份" type="file" accept=".json,application/json" onChange={e=>{const file=e.target.files?.[0];if(file)void readBackup(file);e.target.value='';}}/></label>
      {backup&&<div className="restore-summary"><strong>{backup.data.datasets.length} 个数据集 · {backup.data.records.length} 条记录</strong><p>{backup.data.snapshots.length} 份赛前快照 · {backup.attachments.length} 张原图附件</p><button className="primary-button" disabled={working||busy} onClick={()=>void restore()}>确认恢复为新数据集</button></div>}
    </section></div><ErrorText text={error}/>
  </Modal>;
}
export function ModelSettings({data,configuration,busy,persist,onClose}:{data:AppData;configuration:Configuration;busy:boolean;persist:Persist;onClose:()=>void}){
  const [selected,setSelected]=useState([...data.selectedModels]),[parameters,setParameters]=useState({...configuration.parameters}),[error,setError]=useState('');
  const save=async(e:FormEvent)=>{e.preventDefault();setError('');
    try{
      validateParameters(parameters);if(new Set(selected).size!==3)throw new Error('请选择三个不同的展示模型。');
      const changed=JSON.stringify(parameters)!==JSON.stringify(configuration.parameters),id=uid();
      if(await persist(next=>{
        next.selectedModels=selected;
        if(changed){next.configurations.push({id,version:'math-v2',createdAt:now(),parameters});next.datasets.find(d=>d.id===data.activeDatasetId)!.configurationId=id;}
      },changed?'已建立新的参数配置；历史锁定概率保留。':'展示模型已更新'))onClose();else setError('保存失败，设置草稿保留。');
    }catch(e){setError((e as Error).message);}
  };
  const fields:{key:keyof Parameters;label:string;min:number;max:number;step:number}[]=[
    {key:'prior',label:'Beta 对称先验 α',min:.1,max:100,step:.1},{key:'shortWindow',label:'短窗口',min:1,max:1000,step:1},
    {key:'window',label:'长窗口 / Markov 窗口',min:2,max:1000,step:1},{key:'hazard',label:'新段概率 h',min:.00001,max:.99999,step:.00001},
    {key:'eta',label:'专家学习率 η',min:.01,max:100,step:.01},{key:'share',label:'回流比例 γ',min:0,max:1,step:.01},
  ];
  return <Modal title="模型设置" onClose={onClose}><form onSubmit={e=>void save(e)}>
    <p className="subtle-note">只改变首页展示时，其他模型的预测与评分不变。固定 50% 始终参与比较。</p>
    {selected.map((id,i)=><label className="field" key={i}>展示位置 {i+1}<select aria-label={'展示模型 '+(i+1)} value={id} onChange={e=>setSelected(selected.map((old,index)=>index===i?e.target.value as ModelId:old))}>{MODEL_IDS.map(model=><option key={model} value={model} disabled={model!==id&&selected.includes(model)}>{MODELS[model].name}</option>)}</select></label>)}
    <section className="fairness-setting"><div className="fairness-heading"><h3>向 50% 回归</h3><output htmlFor="fairness-strength">{Math.round((parameters.fairness??0)*100)}%</output></div><p>假设下一局的公平匹配会削弱历史信号。默认减半：历史模型估计 60%，这里显示 55%。这不是游戏官方的参数。</p><label className="field" htmlFor="fairness-strength">回归强度<input id="fairness-strength" type="range" min="0" max="1" step="0.05" value={parameters.fairness??0} onChange={e=>setParameters({...parameters,fairness:Number(e.target.value)})}/></label><div className="range-labels"><span>0% · 保留历史估计</span><span>100% · 完全公平</span></div><p className="microcopy">100% 时，所有模型都预测 50%。这不代表连胜后必输，也不会按你的累计胜率“补回”输赢。修改后重算历史回放，已锁定的赛前概率保留。</p></section>
    <details className="parameter-details"><summary>数学参数 · 修改会新建配置</summary><p className="subtle-note">已锁定的赛前概率不改写。依据同一历史调参后的回放，不是独立样本外评价。Beta 名称中的 10/30 是默认窗口，修改后的参数见此处。</p><div className="field-grid">{fields.map(f=><label className="field" key={f.key}>{f.label}<input type="number" required min={f.min} max={f.max} step={f.step===1?1:'any'} value={parameters[f.key]??''} onChange={e=>setParameters({...parameters,[f.key]:Number(e.target.value)})}/></label>)}</div><label className="field">用于所有模型的历史范围<select value={parameters.historyLimit??'all'} onChange={e=>setParameters({...parameters,historyLimit:e.target.value==='all'?null:Number(e.target.value)})}><option value="all">全部历史（精确递推）</option>{[500,1000,5000].map(n=><option key={n} value={n}>最近 {n} 条（重新冷启动回放）</option>)}</select></label><button className="text-button" type="button" onClick={()=>setParameters({...DEFAULT_PARAMETERS})}>恢复教科书默认参数</button></details>
    <ErrorText text={error}/><button className="primary-button full" disabled={busy} type="submit">保存设置</button></form>
  </Modal>;
}
export function RecordEditor({record,data,db,busy,persist,onClose,onMove}:{record:Match;data:AppData;db:IDBDatabase;busy:boolean;persist:Persist;onClose:()=>void;onMove:(direction:number)=>void}){
  const [draft,setDraft]=useState({...record}),[duration,setDuration]=useState(formatDuration(record.durationSeconds)),[error,setError]=useState(''),[imageUrl,setImageUrl]=useState<string|null>(null),[confirmDelete,setConfirmDelete]=useState(false);
  const original=data.records.find(r=>r.id===record.id);
  useEffect(()=>{if(!record.sourceImageId)return;let url:string|undefined,stopped=false;
    readImage(db,record.sourceImageId).then(blob=>{if(blob&&!stopped){url=URL.createObjectURL(blob);setImageUrl(url);}}).catch(e=>setError(e.message));
    return()=>{stopped=true;if(url)URL.revokeObjectURL(url);};
  },[record.id,db]);
  const save=async(e:FormEvent)=>{e.preventDefault();setError('');
    try{
      const seconds=parseDuration(duration),previous={...original!};
      const ok=await persist(next=>{
        const found=next.records.find(r=>r.id===record.id);if(!found||found.revision!==record.revision)throw new Error('这条记录已改变，请重新打开再编辑。');
        Object.assign(found,draft,{id:record.id,datasetId:record.datasetId,ordinal:found.ordinal,revision:found.revision+1,durationSeconds:seconds,fieldOrigin:'user-entered'});
        next.datasets.find(d=>d.id===record.datasetId)!.revision++;
      },'记录已修正；回放重算，赛前概率保留。',next=>{
        const found=next.records.find(r=>r.id===record.id);if(!found||found.revision!==previous.revision+1)throw new Error('记录已再次修改，无法覆盖撤销。');
        Object.assign(found,previous,{ordinal:found.ordinal,revision:found.revision+1});next.datasets.find(d=>d.id===record.datasetId)!.revision++;
      });
      if(ok)onClose();else setError('保存失败。草稿保留，请重新检查记录或浏览器存储。');
    }catch(e){setError((e as Error).message);}
  };
  const remove=async()=>{
    const previous={...original!},nextRecord=sortedRecords(data,record.datasetId).find(r=>r.ordinal===previous.ordinal+1);
    const previousSnapshots=data.snapshots.filter(s=>s.targetRecordId===record.id).map(s=>structuredClone(s));
    if(await persist(next=>removeRecords(next,[record.id]),'已移除记录',next=>{
      const list=sortedRecords(next,record.datasetId);let index=nextRecord?list.findIndex(r=>r.id===nextRecord.id):list.length;if(index<0)index=list.length;
      list.splice(index,0,previous);next.records=[...next.records.filter(r=>r.datasetId!==record.datasetId),...list.map((r,i)=>({...r,ordinal:i+1}))];next.datasets.find(d=>d.id===record.datasetId)!.revision++;
      for(const snapshot of previousSnapshots){const index=next.snapshots.findIndex(s=>s.id===snapshot.id);if(index>=0&&next.snapshots[index].status==='cancelled'&&next.snapshots[index].targetRecordId===null)next.snapshots[index]=snapshot;}
      const batch=next.batches.find(b=>b.id===previous.sourceBatchId);if(batch&&!batch.recordIds.includes(previous.id))batch.recordIds.push(previous.id);
    }))onClose();else setError('移除失败，记录保持不变。');
  };
  const textField=(key:'map'|'scoreDisplay'|'relativeTimeText'|'rank'|'queueType',label:string)=><label className="field">{label}<input value={draft[key]??''} maxLength={500} onChange={e=>setDraft({...draft,[key]:nil(e.target.value)})}/></label>;
  return <Modal title={'第 '+(original?.ordinal??record.ordinal)+' 条记录'} onClose={onClose} wide>
    <div className="tool-columns"><section>{imageUrl?<div className="source-review"><img src={imageUrl} alt="此记录的原始截图"/><p>图片中的第 {record.rowFromTop} 行{record.partialRow?' · 裁切行':''}</p></div>:<div className="source-placeholder"><Icon name="history"/><p>{record.sourceImageId?'未保留原图或备份未包含图片。':'这条记录没有原始截图。'}</p></div>}
      <p className="microcopy">来源：{record.entryKind} · {record.fieldOrigin}<br/>{record.rawFields}</p><div className="button-row"><button className="secondary-button" disabled={busy||!original||original.ordinal<=1} onClick={()=>{onMove(-1);onClose();}}>向较早移动</button><button className="secondary-button" disabled={busy||!original||original.ordinal>=sortedRecords(data,record.datasetId).length} onClick={()=>{onMove(1);onClose();}}>向较晚移动</button></div>
      <p className="microcopy">移动调整此数据集的全局顺序；分位置序号可能有间隔。</p>
    </section><form onSubmit={e=>void save(e)}><div className="field-grid"><label className="field">结果<select value={draft.outcome} onChange={e=>setDraft({...draft,outcome:e.target.value as Match['outcome']})}>{Object.entries(OUTCOME_NAMES).map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label><label className="field">位置<select value={draft.role??'unknown'} onChange={e=>setDraft({...draft,role:e.target.value==='unknown'?null:e.target.value as Role})}>{['unknown','tank','damage','support'].map(role=><option key={role} value={role}>{ROLE_NAMES[role as keyof typeof ROLE_NAMES]}</option>)}</select></label>
      <label className="field">模式<select value={draft.mode??''} onChange={e=>setDraft({...draft,mode:nil(e.target.value)})}><option value="">未指定</option>{Object.entries(MODE_NAMES).map(([value,name])=><option key={value} value={value}>{name}</option>)}{draft.mode&&!MODE_NAMES[draft.mode]&&<option>{draft.mode}</option>}</select></label><label className="field">持续时间<input value={duration} placeholder="15:36" onChange={e=>setDuration(e.target.value)}/></label>{textField('map','地图')}{textField('scoreDisplay','比分原文')}{textField('relativeTimeText','相对时间原文')}{textField('rank','段位')}{textField('queueType','队列')}</div>
      <label className="field">确认过的具体时间（可留空）<input type="datetime-local" value={draft.occurredAt?new Date(Date.parse(draft.occurredAt)-new Date(draft.occurredAt).getTimezoneOffset()*60000).toISOString().slice(0,16):''} onChange={e=>setDraft({...draft,occurredAt:e.target.value?new Date(e.target.value).toISOString():null})}/></label>
      <label className="check-field"><input type="checkbox" checked={draft.gapBefore} onChange={e=>setDraft({...draft,gapBefore:e.target.checked})}/>这条之前可能缺了对局（断开 Markov 转移）</label><p className="microcopy">时长不是时刻；比分不用于判断胜负。修改结果会更新快照的评分，但保留原始预测概率。</p><ErrorText text={error}/><button className="primary-button full" type="submit" disabled={busy||!original}>保存修改</button>
      {record.sourceImageId&&<label className="check-field"><input type="checkbox" checked={draft.partialRow} onChange={e=>setDraft({...draft,partialRow:e.target.checked})}/>原图中这一行被裁切（仅标记来源，不改变胜负）</label>}
      <div className="delete-row">{confirmDelete?<><span>移除此条，稍后可撤销。</span><button type="button" className="danger-text" disabled={busy} onClick={()=>void remove()}>确认移除</button></>:<button type="button" className="text-button" onClick={()=>setConfirmDelete(true)}>移除此记录</button>}</div>
    </form></div>
  </Modal>;
}
