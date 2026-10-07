import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { DEFAULT_MODELS, MODEL_IDS, MODE_NAMES, OUTCOME_NAMES, ROLES, ROLE_NAMES, initialData, insertRecords, newMatch, now, removeRecords, restoreRecords, sortedRecords, uid, type AppData, type Configuration, type Match, type ModelId, type Scope, type Snapshot, type Role } from './domain';
import { MODELS, replay, scoreRows, hasForecasts, type ReplayResult, type PredictionRow } from './models';
import { loadData, openDatabase, saveData } from './storage';
import { ErrorText, Icon, Modal, NumberTransition, Result, SectionTitle, Symbols, TraceChart } from './components';
import { ImportDrawer } from './ImportDrawer';
import { DataDrawer, ModelSettings, RecordEditor } from './Tools';
import { SCENARIO_NAMES, syntheticRecords, type Scenario } from './synthetic';
import { ModelExplanation } from './ModelExplanation';
import { MatchForecast } from './MatchForecast';

export type Mutation = (next:AppData)=>void;
export type Persist = (mutation:Mutation, message?:string, undo?:Mutation, blobs?:Map<string,Blob>)=>Promise<boolean>;
type Drawer = 'import' | 'data' | 'models' | 'simulation' | null;
function useReplay(records:Match[],configuration:Configuration) {
  const [asyncState,setAsyncState]=useState<{records:Match[];configuration:Configuration;result:ReplayResult|null;error:string}|null>(null);
  const small=useMemo(()=>records.length<=200?replay(records,configuration.parameters):null,[records,configuration]);
  useEffect(()=>{
    if(records.length<=200)return;
    const worker=new Worker(new URL('./replay.worker.ts',import.meta.url),{type:'module'});
    worker.onmessage=e=>setAsyncState({records,configuration,result:e.data.result??null,error:e.data.error??''});
    worker.onerror=()=>setAsyncState({records,configuration,result:null,error:'模型计算失败，请重试或减少本次历史范围。'});
    worker.postMessage({records,parameters:configuration.parameters});
    return()=>worker.terminate();
  },[records,configuration]);
  const current=asyncState?.records===records&&asyncState.configuration===configuration?asyncState:null;
  const result=small??current?.result??null,error=current?.error??'';
  return {result,error,calculating:!result&&!error};
}
export function App() {
  const [data,setData]=useState<AppData|null>(null),[db,setDb]=useState<IDBDatabase|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const current=useRef<AppData|null>(null),busyRef=useRef(false);
  const [toast,setToast]=useState<{message:string;undo?:Mutation}|null>(null);
  const [panel,setPanel]=useState<'analysis'|'history'>('analysis'),[drawer,setDrawer]=useState<Drawer>(null);
  const [menu,setMenu]=useState(false),[explain,setExplain]=useState<ModelId|null>(null),[editing,setEditing]=useState<Match|null>(null);
  const [page,setPage]=useState(0),[historyMode,setHistoryMode]=useState('all'),[scoreMode,setScoreMode]=useState('all'),[scoreKind,setScoreKind]=useState<'replay'|'live'>('replay'),[allScores,setAllScores]=useState(false);
  const [scenario,setScenario]=useState<Scenario>('fair'),[sampleCount,setSampleCount]=useState(100);
  const moreRef=useRef<HTMLButtonElement>(null), channel=useRef<BroadcastChannel|null>(null);
  useEffect(()=>{
    let stopped=false,connection:IDBDatabase|null=null;
    openDatabase().then(async opened=>{
      connection=opened;let loaded=await loadData(opened);
      if(loaded.revision===0){loaded={...loaded,revision:1};try{await saveData(opened,loaded,0);}catch{loaded=await loadData(opened);}}
      if(!stopped){current.current=loaded;setData(loaded);setDb(opened);}
    }).catch(e=>!stopped&&setError(e.message));
    return()=>{stopped=true;connection?.close();};
  },[]);
  useEffect(()=>{
    if(!db)return;channel.current=new BroadcastChannel('ow-next-match-changes');
    const refresh=async()=>{if(busyRef.current)return;const loaded=await loadData(db);if(loaded.revision>(current.current?.revision??0)){current.current=loaded;setData(loaded);}};
    channel.current.onmessage=()=>{void refresh().catch(e=>setError(e.message));};
    const onFocus=()=>{void refresh().catch(e=>setError(e.message));};window.addEventListener('focus',onFocus);
    return()=>{channel.current?.close();window.removeEventListener('focus',onFocus);};
  },[db]);
  useEffect(()=>{if(!data)return;document.body.dataset.role=data.scope;document.body.dataset.reduce=String(data.reducedMotion);},[data?.scope,data?.reducedMotion]);
  useEffect(()=>{setPage(0);setHistoryMode('all');setScoreMode('all');},[data?.activeDatasetId,data?.scope]);
  useEffect(()=>{if(!toast)return;const timeout=setTimeout(()=>setToast(null),10000);return()=>clearTimeout(timeout);},[toast]);
  useEffect(()=>{
    if(!menu)return;
    const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){setMenu(false);moreRef.current?.focus();}};
    const outside=(e:PointerEvent)=>{if(!(e.target as Element).closest('.menu-anchor'))setMenu(false);};
    window.addEventListener('keydown',close);window.addEventListener('pointerdown',outside);
    return()=>{window.removeEventListener('keydown',close);window.removeEventListener('pointerdown',outside);};
  },[menu]);
  const persist:Persist=async(mutation,message,undo,blobs)=>{
    if(!current.current||!db||busyRef.current)return false;
    busyRef.current=true;setBusy(true);setError('');
    try{
      const old=current.current,next=structuredClone(old);
      mutation(next);next.revision=old.revision+1;await saveData(db,next,old.revision,blobs);
      current.current=next;setData(next);channel.current?.postMessage({revision:next.revision});
      if(message)setToast({message,undo});return true;
    }catch(e){setError(e instanceof Error?e.message:'保存失败，记录没有改变。');return false;}
    finally{busyRef.current=false;setBusy(false);}
  };
  if(!data||!db)return <div className="startup"><Symbols/><div className="brand-mark"><Icon name="next"/></div><h1>下一局</h1><p>{error || '正在打开本地对局手记…'}</p>{error&&<button className="primary-button" onClick={()=>location.reload()}>重试</button>}</div>;
  return <Workspace key="workspace" data={data} db={db} busy={busy} error={error} clearError={()=>setError('')} persist={persist} toast={toast} setToast={setToast}
    panel={panel} setPanel={setPanel} drawer={drawer} setDrawer={setDrawer} menu={menu} setMenu={setMenu} moreRef={moreRef}
    explain={explain} setExplain={setExplain} editing={editing} setEditing={setEditing}
    page={page} setPage={setPage} historyMode={historyMode} setHistoryMode={setHistoryMode} scoreMode={scoreMode} setScoreMode={setScoreMode}
    scoreKind={scoreKind} setScoreKind={setScoreKind} allScores={allScores} setAllScores={setAllScores}
    scenario={scenario} setScenario={setScenario} sampleCount={sampleCount} setSampleCount={setSampleCount}/>;
}
interface WorkspaceProps {
  data:AppData;db:IDBDatabase;busy:boolean;error:string;clearError:()=>void;persist:Persist;
  toast:{message:string;undo?:Mutation}|null;setToast:(value:{message:string;undo?:Mutation}|null)=>void;
  panel:'analysis'|'history';setPanel:(p:'analysis'|'history')=>void;drawer:Drawer;setDrawer:(d:Drawer)=>void;
  menu:boolean;setMenu:(v:boolean)=>void;moreRef:React.RefObject<HTMLButtonElement|null>;
  explain:ModelId|null;setExplain:(v:ModelId|null)=>void;editing:Match|null;setEditing:(v:Match|null)=>void;
  page:number;setPage:(v:number)=>void;historyMode:string;setHistoryMode:(v:string)=>void;
  scoreMode:string;setScoreMode:(v:string)=>void;scoreKind:'replay'|'live';setScoreKind:(v:'replay'|'live')=>void;allScores:boolean;setAllScores:(v:boolean)=>void;
  scenario:Scenario;setScenario:(v:Scenario)=>void;sampleCount:number;setSampleCount:(v:number)=>void;
}
function Workspace(p:WorkspaceProps){
  const [bulkOpen,setBulkOpen]=useState(false),[bulkRole,setBulkRole]=useState<Role>(null),[bulkConfirmed,setBulkConfirmed]=useState(false),[bulkError,setBulkError]=useState('');
  const {data,db,busy,persist}=p,dataset=data.datasets.find(d=>d.id===data.activeDatasetId)!,scope=data.scope;
  const configuration=useMemo(()=>data.configurations.find(c=>c.id===dataset.configurationId)!,[dataset.configurationId]);
  const records=useMemo(()=>sortedRecords(data,dataset.id,scope),[dataset.id,dataset.revision,scope]);
  const analysis=useReplay(records,configuration),result=analysis.result;
  const title=ROLE_NAMES[scope], scopeText=scope==='all'?'所有位置 · 所有模式':'本位置 · 所有模式';
  const recent=records.slice(-5), selected=data.selectedModels, count=result?.rows.length??0;
  const history=records.filter(r=>p.historyMode==='all'||(r.mode??'unknown')===p.historyMode).slice().reverse();
  const historyPage=Math.min(p.page,Math.max(0,Math.ceil(history.length/6)-1)),visible=history.slice(historyPage*6,historyPage*6+6);
  const modes=Array.from(new Set(records.map(r=>r.mode??'unknown')));
  const replayRows=result?.rows ?? [];
  const liveRows:PredictionRow[]=data.snapshots.filter(s=>s.datasetId===dataset.id&&s.scope===scope&&s.configurationId===configuration.id&&s.status==='linked').flatMap(s=>{
    const r=records.find(r=>r.id===s.targetRecordId);return r&&(r.outcome==='win'||r.outcome==='loss')?[{recordId:r.id,ordinal:r.ordinal,sequence:r.ordinal,y:Number(r.outcome==='win'),mode:r.mode,predictions:s.probabilities}]:[];
  }).sort((a,b)=>a.ordinal-b.ordinal);
  const scoreIds=p.allScores?MODEL_IDS:Array.from(new Set([...selected,'fair50' as const]));
  const reportRows=(p.scoreKind==='replay'?replayRows:liveRows).filter(r=>(p.scoreMode==='all'||(r.mode??'unknown')===p.scoreMode)&&hasForecasts(r,scoreIds)),scores=scoreRows(reportRows);
  const best=scoreIds.reduce<ModelId|null>((best,id)=>scores[id].brier!==null && (best===null||scores[id].brier!<scores[best].brier!)?id:best,null);
  const bestIds=best?scoreIds.filter(id=>scores[id].brier!==null&&Math.abs(scores[id].brier!-scores[best].brier!)<1e-12):[];
  const pending=data.snapshots.find(s=>s.datasetId===dataset.id&&s.scope===scope&&s.status==='pending');
  const quick=async(outcome:'win'|'loss')=>{
    if(!result)return;const capturedDatasetId=dataset.id,capturedScope=scope;
    const record=newMatch(capturedDatasetId,{outcome,role:scope==='all'?null:scope,entryKind:'quick-result'});
    const oldSnapshots=data.snapshots.filter(s=>s.datasetId===capturedDatasetId&&s.status==='pending'&&s.historyRevision===dataset.revision&&(s.scope==='all'||s.scope===capturedScope)).map(s=>({...s}));
    const ok=await persist(next=>{
      insertRecords(next,capturedDatasetId,[record]);
      for(const s of next.snapshots)if(oldSnapshots.some(old=>old.id===s.id)){s.status='linked';s.targetRecordId=record.id;}
    },'已记录'+OUTCOME_NAMES[outcome]+' · '+(scope==='all'?'位置未指定':ROLE_NAMES[scope]),next=>{
      removeRecords(next,[record.id]);
      for(const s of oldSnapshots){const i=next.snapshots.findIndex(v=>v.id===s.id);if(i>=0)next.snapshots[i]=s;}
    });
    if(ok)p.setPage(0);
  };
  const lock=async()=>{
    if(!result||pending)return;
    const snapshot:Snapshot={id:uid(),datasetId:dataset.id,scope,configurationId:configuration.id,createdAt:now(),historyRevision:dataset.revision,boundaryRecordId:records.at(-1)?.id??null,probabilities:{...result.next},status:'pending',targetRecordId:null};
    await persist(next=>{next.snapshots.push(snapshot);},'已锁定赛前预测。下一次对应范围的快速记录将关联这份快照。',next=>{next.snapshots=next.snapshots.filter(s=>s.id!==snapshot.id);});
  };
  const cancelSnapshot=async()=>{if(pending)await persist(next=>{next.snapshots.find(s=>s.id===pending.id)!.status='cancelled';},'已取消本次赛前锁定');};
  const selectPanel=(next:'analysis'|'history',focus=false)=>{p.setPanel(next);if(focus)requestAnimationFrame(()=>document.getElementById(next+'-tab')?.focus());};
  const createSimulation=async()=>{
    const id=uid(),sample=syntheticRecords(id,p.scenario,p.sampleCount);
    const ds={...dataset,id,name:SCENARIO_NAMES[p.scenario]+' · '+p.sampleCount+'局',sourceKind:'synthetic' as const,revision:0,createdAt:now(),chronology:'confirmed' as const,completeness:'complete' as const};
    if(await persist(next=>{next.datasets.push(ds);insertRecords(next,id,sample);next.activeDatasetId=id;next.scope='all';},'已创建独立模拟数据集'))p.setDrawer(null);
  };
  const move=(record:Match,direction:number)=>void persist(next=>{
    const list=sortedRecords(next,dataset.id),i=list.findIndex(r=>r.id===record.id),j=i+direction;
    if(j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]];list.forEach((r,index)=>{r.ordinal=index+1;r.revision++;});
    next.datasets.find(d=>d.id===dataset.id)!.revision++;
  },'已调整全局记录顺序；历史回放已重算，赛前概率保留。');
  const showDrawer=(value:Drawer)=>{p.setMenu(false);p.setDrawer(value);};
  const undoBatch=(ids:string[])=>{
    const removed=data.records.filter(r=>ids.includes(r.id)).map(r=>({...r})),order=sortedRecords(data,dataset.id).map(r=>r.id),snapshots=data.snapshots.filter(s=>s.targetRecordId&&ids.includes(s.targetRecordId));
    void persist(next=>removeRecords(next,ids),'已撤销批次，其他记录保留',next=>restoreRecords(next,removed,order,snapshots));
  };
  const assignRoles=async()=>{
    setBulkError('');const affected=history.map(r=>({id:r.id,role:r.role,revision:r.revision,fieldOrigin:r.fieldOrigin}));
    const ok=await persist(next=>{
      for(const old of affected){const r=next.records.find(r=>r.id===old.id);if(!r||r.revision!==old.revision)throw new Error('范围内有记录已变更，请关闭后重新选择。');r.role=bulkRole;r.revision++;r.fieldOrigin='user-entered';}
      next.datasets.find(d=>d.id===dataset.id)!.revision++;
    },'已修改 '+affected.length+' 条的位置',next=>{
      for(const old of affected){const r=next.records.find(r=>r.id===old.id);if(!r||r.revision!==old.revision+1)throw new Error('其中有记录再次修改，不能覆盖撤销。');r.role=old.role;r.fieldOrigin=old.fieldOrigin;r.revision++;}
      next.datasets.find(d=>d.id===dataset.id)!.revision++;
    });
    if(ok)setBulkOpen(false);else setBulkError('保存失败，位置尚未改变。');
  };
  return <>
    <Symbols/>
    <header className="topbar"><div className="chrome"><div className="brand"><span className="brand-mark"><Icon name="next"/></span><div className="brand-name">下一局<span className="brand-label">OW LAB</span></div></div>
      <button className="header-context dataset-button" onClick={()=>p.setDrawer('data')} aria-label="切换数据集与备份"><span className="source-dot"/><Icon name="storage"/><span>{dataset.name}</span><span className="dataset-count">{sortedRecords(data,dataset.id).length} 局</span></button>
      <div className="menu-anchor"><button ref={p.moreRef} className="more" id="more-button" aria-label="更多" aria-expanded={p.menu} aria-controls="more-menu" onClick={()=>p.setMenu(!p.menu)}><Icon name="more"/></button>{p.menu&&<div className="menu" id="more-menu"><button onClick={()=>showDrawer('data')}>数据与备份</button><button onClick={()=>showDrawer('import')}>导入与补录</button><button onClick={()=>showDrawer('models')}>模型与显示</button><button onClick={()=>showDrawer('simulation')}>数学模拟</button><button aria-pressed={data.reducedMotion} onClick={()=>void persist(next=>{next.reducedMotion=!next.reducedMotion;})}>{data.reducedMotion?'恢复动态':'减少动态'}</button><div className="fine">记录与图片只保存在本机浏览器</div></div>}</div>
    </div></header>
    <main>
      <section className="masthead" aria-labelledby="page-title"><div className="masthead-copy"><p className="masthead-kicker"><Icon name="next"/>对局手记</p><h1 id="page-title"><span>下一局，</span><span className="question">会怎样？</span></h1><p className="masthead-description">记录胜负，比较数学模型的赛前预测。</p></div><div className="masthead-art" aria-hidden="true"><img src={import.meta.env.BASE_URL+'artwork/match-journal-masthead.png'} alt="" width="1536" height="1024"/></div></section>
      {(p.error||analysis.error)&&<div className="global-error" role="alert"><span>{p.error||analysis.error}</span><button onClick={p.clearError}>收起</button></div>}
      <div className="workspace-grid"><div className="primary-column"><div className="page-heading"><div className="role-identity"><div className="role-emblem" key={scope}><span className="emblem-notch"/><Icon name={scope}/></div><div><div className="eyebrow">预测范围</div><h2 className="role-title">{title}</h2><div className="role-subtitle">{scopeText}</div></div></div><div className="role-control" role="group" aria-label="选择预测范围"><span className="role-indicator" style={{transform:'translateX('+ROLES.indexOf(scope)*100+'%)'}}/>{ROLES.map(role=><button key={role} data-role={role} aria-pressed={scope===role} disabled={busy} onClick={()=>void persist(next=>{next.scope=role;})}><Icon name={role}/>{role==='all'?'全部':ROLE_NAMES[role]}</button>)}</div></div>
        <div className="content"><section><SectionTitle icon="history" caption={<>从旧到新 <Icon name="arrow"/></>}>近五局</SectionTitle><ol className="recent">
          {Array.from({length:5},(_,i)=>recent[i-(5-recent.length)]??null).map((r,i)=><li key={r?.id??'empty'+i}><button className={'recent-item '+(r?.outcome==='loss'?'loss':r?.outcome==='win'?'win':'empty-result')} disabled={!r} aria-label={r?'第 '+r.ordinal+' 条 '+OUTCOME_NAMES[r.outcome]+'，查看详情':'尚无记录'} onClick={()=>r&&p.setEditing(r)}>
            <span className="recent-meta"><span>{r?String(r.ordinal).padStart(2,'0'):'—'}</span>{r && i===4 && <span className="latest-label">• 最新</span>}</span><span className="result-line"><span className="result-seal"><Icon name={r?.outcome==='win'?'check':r?.outcome==='loss'?'close':'history'}/></span>{r?(r.outcome==='win'?'胜':r.outcome==='loss'?'负':OUTCOME_NAMES[r.outcome]):'—'}</span>
          </button></li>)}
        </ol><div className="recent-connector" aria-hidden="true">{Array.from({length:5},(_,i)=><span key={i}/>)}</div></section><div className="section-rule"/>
          <MatchForecast model={selected[0]} probability={result?.next[selected[0]]} count={count} reduced={data.reducedMotion} onExplain={()=>p.setExplain(selected[0])}/>
          <section className="prediction-section"><SectionTitle icon="chart" caption={<span className="scope-pill">{scopeText}</span>}>下一局胜率</SectionTitle><div className="model-row">{selected.map(id=><button className="model" key={id} data-model={id} style={{'--model':MODELS[id].color,'--model-soft':MODELS[id].color+'12'} as CSSProperties} aria-label={MODELS[id].name+'，下一条胜率 '+(result?(result.next[id]*100).toFixed(1)+'%':'计算中')+'，查看解释'} onClick={()=>p.setExplain(id)}>
            <span className="model-name"><span className="model-glyph"><Icon name={MODELS[id].icon}/></span>{MODELS[id].name}<Icon name="arrow" className="chevron"/></span><div className="probability">{result?<NumberTransition value={result.next[id]} reduced={data.reducedMotion}/>:<span className="number">…</span>}<span className="unit" aria-hidden="true">%</span></div><div className="probability-rail" aria-hidden="true"><div className="rail-fill" style={{width:(result?result.next[id]*100:50)+'%'}}/><span className="rail-mid"/></div><span className="model-summary">{MODELS[id].summary}</span>
          </button>)}</div><div className="scope-line"><p className="scope-caption"><Icon name="storage"/>{analysis.calculating?'正在计算完整历史…':count?'基于 '+count+' 条有效记录'+(scope==='all'?' · 含 '+records.filter(r=>r.role===null).length+' 条位置未指定':''):'50% 冷启动 · 记录第一局开始估计'}</p><span className="scale-caption">0–100% · 中点 50%</span></div><button className="fairness-link" onClick={()=>p.setExplain('eloFeedback')}><Icon name="next"/>Elo 反馈 · K {configuration.parameters.eloK??32} · 匹配响应 {Math.round((configuration.parameters.eloResponse??1)*100)}%<Icon name="arrow"/></button>
          {configuration.parameters.historyLimit&&<p className="subtle-note">当前配置只回放最近 {configuration.parameters.historyLimit} 条记录，从窗口起点冷启动；近五局仍显示完整历史的末尾。</p>}
          {records.length>5000&&!configuration.parameters.historyLimit&&<p className="subtle-note">完整历史超过 5000 条，精确回放可能耗时。可在模型参数里明确选择窗口；切换范围可取消计算。</p>}</section><div className="section-rule"/>
          <section><SectionTitle icon="pencil" caption={'记录位置：'+(scope==='all'?'未指定':title)}>这局赢了吗？</SectionTitle><div className="record-actions"><button className="win-action" id="record-win" disabled={busy||!result} onClick={()=>void quick('win')}><Icon name="cup"/>{busy?'保存中…':'赢了'}<Icon name="arrow" className="action-corner icon"/></button><button className="loss-action" id="record-loss" disabled={busy||!result} onClick={()=>void quick('loss')}><Icon name="close"/>输了<Icon name="arrow" className="action-corner icon"/></button></div>{pending&&<p className="lock-note"><Icon name="check"/>{pending.historyRevision===dataset.revision?'此范围已锁定赛前预测，快速记录将关联原快照。':'历史已经修改，此锁定不再自动关联。请取消后重新锁定。'}</p>}</section>
        </div></div>
        <section className="explorer" aria-label="对局资料"><div className="explorer-top"><div className="explorer-tabs" role="tablist" aria-label="选择资料栏目"><span className="explorer-indicator" style={{transform:p.panel==='history'?'translateX(100%)':'translateX(0)'}}/>{(['analysis','history'] as const).map(panel=><button key={panel} role="tab" id={panel+'-tab'} aria-controls={panel+'-panel'} aria-selected={p.panel===panel} tabIndex={p.panel===panel?0:-1} onClick={()=>selectPanel(panel)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();selectPanel(e.key==='Home'?'analysis':e.key==='End'?'history':panel==='analysis'?'history':'analysis',true);}}}><Icon name={panel==='analysis'?'chart':'history'}/>{panel==='analysis'?'分析':'历史'}</button>)}</div><span className="explorer-context">{scopeText}</span></div>
          <div className="explorer-body"><div className="explorer-panel" role="tabpanel" id="analysis-panel" aria-labelledby="analysis-tab" tabIndex={p.panel==='analysis'?0:-1} hidden={p.panel!=='analysis'} inert={p.panel!=='analysis'}>
            <div className="explorer-title"><div><h2>预测走势</h2><p>查看逐局概率，比较预测误差。</p></div><button className="small-label" onClick={()=>p.setDrawer('models')}>模型设置</button></div>
            <TraceChart rows={p.scoreKind==='live'?liveRows:replayRows} models={selected} emptyMessage={p.scoreKind==='live'?'先锁定赛前预测，再记录结果。旧快照不补算新模型。':undefined}/>
            <div className="score-area"><div className="score-heading"><h3>{p.scoreKind==='live'?'赛前预测误差':'回放误差'}</h3><span>同组 {reportRows.length} 条 · 越小越好</span></div><div className="report-controls"><select aria-label="评分类型" value={p.scoreKind} onChange={e=>p.setScoreKind(e.target.value as 'replay'|'live')}><option value="replay">历史回放</option><option value="live">赛前锁定</option></select><select aria-label="评分模式筛选" value={p.scoreMode} onChange={e=>p.setScoreMode(e.target.value)}><option value="all">所有模式</option>{modes.map(mode=><option key={mode} value={mode}>{MODE_NAMES[mode]??(mode==='unknown'?'模式未指定':mode)}</option>)}</select><button className="text-button" onClick={()=>p.setAllScores(!p.allScores)}>{p.allScores?'展示组':'全部模型'}</button></div>
              <table className="scores-table" aria-label="同组 Brier 分数"><thead><tr><th scope="col">模型</th><th scope="col">Brier</th><th scope="col">本组比较</th></tr></thead><tbody>{scoreIds.map(id=><tr key={id}><td><button className="score-model text-button" onClick={()=>p.setExplain(id)}><i className="model-dot" style={{'--trace':MODELS[id].color} as CSSProperties}/>{MODELS[id].name}</button></td><td>{scores[id].brier?.toFixed(4)??'—'}</td><td>{bestIds.includes(id)?<span className="score-best">{bestIds.length>1?'并列最低':'本表最低'}</span>:scores[id].brier!==null&&best?<span className="score-difference">+{(scores[id].brier!-scores[best].brier!).toFixed(4)}</span>:'—'}</td></tr>)}</tbody></table>
              <details className="metric-details"><summary>更多指标与校准</summary><p>方向在 50% 时计半分；校准分箱描述这一段记录，不代表概率可靠性保证。</p><div className="metric-grid">{scoreIds.map(id=><div key={id}><strong>{MODELS[id].name}</strong><span>Log Loss {scores[id].logLoss?.toFixed(4)??'—'}</span><span>方向得分 {scores[id].direction===null?'—':(scores[id].direction!*100).toFixed(1)+'%'}</span><span>相对 50% {scores[id].skill===null?'—':(scores[id].skill!*100).toFixed(1)+'%'}</span></div>)}</div><table className="calibration-table"><caption>概率分箱 · {reportRows.length<100?'不足 100 条，请谨慎解读':'显示每箱样本数'}</caption><thead><tr><th>模型</th><th>概率段</th><th>n</th><th>平均 p</th><th>实际胜率</th></tr></thead><tbody>{scoreIds.flatMap(id=>Array.from({length:5},(_,i)=>{const bin=reportRows.filter(r=>Math.min(4,Math.floor(r.predictions[id]!*5))===i);return bin.length?<tr key={id+i}><td>{MODELS[id].name}</td><td>{i*20}–{(i+1)*20}%</td><td>{bin.length}</td><td>{(bin.reduce((s,r)=>s+r.predictions[id]!, 0)/bin.length*100).toFixed(1)}%</td><td>{(bin.reduce((s,r)=>s+r.y,0)/bin.length*100).toFixed(1)}%</td></tr>:null;}))}</tbody></table></details>
            </div>
            <div className="live-tools">{pending?<><span>已锁定 · {new Date(pending.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}{pending.configurationId!==configuration.id?' · 历史配置':''}</span><button className="text-button" disabled={busy} onClick={()=>void cancelSnapshot()}>取消锁定</button></>:<><span>赛前锁定后，下一局结果可用于评分。</span><button className="inline-action" disabled={busy||!result} onClick={()=>void lock()}><Icon name="check"/>锁定赛前预测</button></>}</div>
            <div className="analysis-note"><Icon name="layers"/><p>{reportRows.length?best?bestIds.map(id=>MODELS[id].name).join('、')+' 在当前展示组、这 '+reportRows.length+' 条记录中的误差'+(bestIds.length>1?'并列最低':'最低')+'。这段比较不保证下一条更准。':'暂无比较':'尚无可评分记录。'} {p.scoreKind==='live'?'只比较当前配置下明确锁定并关联的快照；历史配置仍保留。':'赛后补录属于历史回放。'} {p.scoreMode!=='all'?'模式筛选只过滤评分，不改变默认跨模式预测。':''}{dataset.chronology==='assumed-unconfirmed'?' 输入顺序尚未确认。':''}</p></div>
          </div>
          <div className="explorer-panel" role="tabpanel" id="history-panel" aria-labelledby="history-tab" tabIndex={p.panel==='history'?0:-1} hidden={p.panel!=='history'} inert={p.panel!=='history'}>
            <div className="explorer-title"><div><h2>对局记录</h2><p>按对局顺序排列，最近记录在前。</p></div><span className="small-label">{dataset.sourceKind==='synthetic'?'模拟记录':'本地记录'}</span></div>
            <div className="history-toolbar"><span className="history-summary">{records.length} 条 · {records.filter(r=>r.outcome==='win').length} 胜 / {records.filter(r=>r.outcome==='loss').length} 负</span><button className="inline-action" onClick={()=>p.setDrawer('import')}><Icon name="layers"/>导入与补录</button></div>
            <div className="history-tools"><select aria-label="历史模式筛选" value={p.historyMode} onChange={e=>{p.setHistoryMode(e.target.value);p.setPage(0);}}><option value="all">所有模式</option>{modes.map(mode=><option key={mode} value={mode}>{MODE_NAMES[mode]??(mode==='unknown'?'模式未指定':mode)}</option>)}</select><button className="text-button" onClick={()=>p.setDrawer('import')}>批量输入胜负</button><button className="text-button" disabled={!history.length} onClick={()=>{setBulkRole(scope==='all'?null:scope);setBulkConfirmed(false);setBulkError('');setBulkOpen(true);}}>批量位置</button></div>
            <table className="history-table" aria-label="当前范围对局记录"><thead><tr><th scope="col">序号</th><th scope="col">结果</th><th scope="col">位置</th><th scope="col">模式 / 详情</th></tr></thead><tbody>{visible.map(r=><tr key={r.id}><td>{String(r.ordinal).padStart(2,'0')}{r.gapBefore&&<span title="此前存在历史缺口"> ·</span>}</td><td><Result outcome={r.outcome}/></td><td><span className="history-role">{ROLE_NAMES[r.role??'unknown']}</span></td><td><button className="row-detail" onClick={()=>p.setEditing(r)}><span>{MODE_NAMES[r.mode??'']??r.mode??'未指定'}</span><small>{r.map??'查看 / 编辑'}</small></button></td></tr>)}{!visible.length&&<tr><td colSpan={4}><div className="empty-history">{data.records.some(r=>r.datasetId===dataset.id)?'当前筛选下没有记录。切换“全部”位置和“所有模式”查看已保存的对局。':'还没有记录。记一局，或导入过去的历史。'}</div></td></tr>}</tbody></table>
            <div className="history-pagination"><p>{history.length?'第 '+(historyPage*6+1)+'–'+Math.min((historyPage+1)*6,history.length)+' 条 / 共 '+history.length+' 条':'0 条记录'}</p><div className="page-actions"><button aria-label="查看较新记录" disabled={!historyPage} onClick={()=>p.setPage(historyPage-1)}><Icon name="arrow" className="icon reverse"/></button><button aria-label="查看较早记录" disabled={(historyPage+1)*6>=history.length} onClick={()=>p.setPage(historyPage+1)}><Icon name="arrow"/></button></div></div>
            <details className="batch-list"><summary>导入批次与撤销</summary>{data.batches.filter(b=>b.datasetId===dataset.id&&b.recordIds.length).slice().reverse().map(b=><div key={b.id}><span>{b.name} · {b.recordIds.length} 条</span><button className="text-button" disabled={busy} onClick={()=>undoBatch(b.recordIds)}>撤销此批次</button></div>)}{!data.batches.some(b=>b.datasetId===dataset.id&&b.recordIds.length)&&<p>暂无导入批次</p>}</details>
            <p className="history-note">位置未指定的记录参与“全部”。不处理重复截图，请自行确认图片范围与导入顺序。{p.historyMode!=='all'?'此筛选只影响表格，预测仍使用所有模式。':''}</p>
          </div></div>
        </section></div>
      <div className="prototype-caption"><span className="caption-left"><Icon name="storage"/>{dataset.sourceKind==='synthetic'?'模拟数据 · 不代表真实玩家预测效果':'已保存到本机浏览器 · 建议定期导出备份'}</span><span className="caption-right">预测仅使用已确认的历史胜负</span></div>
    </main>
    {p.toast&&<div className="toast-wrap"><div className="toast" role="status"><Icon name="check"/><span>{p.toast.message}</span>{p.toast.undo&&<button disabled={busy} onClick={()=>void persist(p.toast!.undo!,'已撤销')} id="undo-button">撤销</button>}<button className="toast-close" aria-label="关闭提示" onClick={()=>p.setToast(null)}>×</button></div></div>}
    {p.drawer==='import'&&<ImportDrawer data={data} busy={busy} saveError={p.error} persist={persist} onClose={()=>p.setDrawer(null)} onImported={()=>{p.setPanel('history');p.setHistoryMode('all');p.setScoreMode('all');p.setPage(0);p.setDrawer(null);}}/>}
    {bulkOpen&&<Modal title="给这些对局补上位置" onClose={()=>setBulkOpen(false)}><p>将修改当前“{title}”范围、{p.historyMode==='all'?'所有模式':MODE_NAMES[p.historyMode]??p.historyMode}筛选下的全部 {history.length} 条记录，包含其他分页。</p><p className="subtle-note">不会根据截图猜位置。修改归属会重算分位置预测；全部范围的胜负顺序不变。请只为确定属于同一位置的记录统一填写。</p><label className="field">批量分配位置<select value={bulkRole??'unknown'} onChange={e=>{setBulkRole(e.target.value==='unknown'?null:e.target.value as Role);setBulkConfirmed(false);}}>{['unknown','tank','damage','support'].map(r=><option key={r} value={r}>{ROLE_NAMES[r as keyof typeof ROLE_NAMES]}</option>)}</select></label><label className="check-field"><input type="checkbox" checked={bulkConfirmed} onChange={e=>setBulkConfirmed(e.target.checked)}/>我已确认这 {history.length} 条的位置</label><ErrorText text={bulkError}/><button className="primary-button full" disabled={busy||!bulkConfirmed||!history.length} onClick={()=>void assignRoles()}>保存这 {history.length} 条的位置</button></Modal>}
    {p.drawer==='data'&&<DataDrawer data={data} db={db} busy={busy} persist={persist} onClose={()=>p.setDrawer(null)}/>}
    {p.drawer==='models'&&<ModelSettings data={data} configuration={configuration} busy={busy} persist={persist} onClose={()=>p.setDrawer(null)}/>}
    {p.drawer==='simulation'&&<Modal title="模拟对局" onClose={()=>p.setDrawer(null)}><p className="subtle-note">选择一种公开规律，生成独立模拟数据集。不会混入你的个人历史；固定随机种子为 20261004。</p><div className="scenario-grid">{(Object.keys(SCENARIO_NAMES) as Scenario[]).map(s=><button key={s} className={p.scenario===s?'selected':''} onClick={()=>p.setScenario(s)}><Icon name="chart"/><strong>{SCENARIO_NAMES[s]}</strong><span>{s==='fair'?'独立 50%':s==='alternating'?'严格交替，长期 50%':s==='shift'?'前半 80%，后半 20%':'坦克 70%、输出 35%、辅助 50%'}</span></button>)}</div><label className="field">场数<select value={p.sampleCount} onChange={e=>p.setSampleCount(Number(e.target.value))}>{[40,100,200,500].map(n=><option key={n}>{n}</option>)}</select></label><button className="primary-button full" disabled={busy} onClick={()=>void createSimulation()}>创建模拟数据集</button></Modal>}
    {p.explain&&<Modal title={MODELS[p.explain].name} onClose={()=>p.setExplain(null)}><ModelExplanation id={p.explain} parameters={configuration.parameters} scope={title+' · 所有模式'} probability={result?.next[p.explain]} eloState={p.explain==='eloFeedback'?result?.elo:undefined} weights={p.explain==='hedge'?result?.weights.hedge:p.explain==='fixedShare'?result?.weights.fixedShare:undefined} onSettings={()=>{p.setExplain(null);p.setDrawer('models');}}/></Modal>}
    {p.editing&&<RecordEditor record={p.editing} data={data} db={db} busy={busy} persist={persist} onClose={()=>p.setEditing(null)} onMove={direction=>move(p.editing!,direction)}/>}
  </>;
}
