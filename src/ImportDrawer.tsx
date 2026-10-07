import { useEffect, useRef, useState } from 'react';
import { MODE_NAMES, OUTCOME_NAMES, ROLE_NAMES, insertImportedRecords, newMatch, now, removeRecords, sortedRecords, uid, type AppData, type Match, type Outcome, type Role, type SourceImage } from './domain';
import { formatDuration, parseDuration, parseManual, parseRecordFile } from './formats';
import { LocalOCR, detectBands, type Band, type OCRFields } from './ocr';
import { ErrorText, Icon, Modal } from './components';
import type { Persist } from './App';
interface DraftRow { id:string; band:Band; included:boolean; outcome:Outcome; role:Role; mode:string; map:string; relativeTimeText:string; durationText:string; scoreDisplay:string; rawFields:string; edited:boolean; dirtyFields:(keyof OCRFields)[] }
interface DraftImage { id:string; file:File; url:string; width:number; height:number; rows:DraftRow[]; status:'ready'|'queued'|'working'|'done'|'cancelled'|'error'; error:string; newestFirst:boolean; included:boolean; top:number; bottom:number; rowCount:number }
const failureText=(error:unknown)=>error instanceof Error?error.message:String(error);
const imageStatus={ready:'待识别',queued:'排队中',working:'识别中',done:'已识别 · 请校对',cancelled:'已取消 · 可重试',error:'识别失败 · 需处理'};
const blankRow=(band:Band):DraftRow=>({id:uid(),band,included:true,outcome:'unknown',role:null,mode:'',map:'',relativeTimeText:'',durationText:'',scoreDisplay:'',rawFields:'',edited:false,dirtyFields:[]});
type Tab='screenshots'|'manual'|'file';
export function ImportDrawer({data,busy,saveError,persist,onClose,onImported}:{data:AppData;busy:boolean;saveError:string;persist:Persist;onClose:()=>void;onImported:()=>void}){
  const [tab,setTab]=useState<Tab>('screenshots'),[images,setImages]=useState<DraftImage[]>([]),imagesRef=useRef<DraftImage[]>([]);
  const [selectedImage,setSelectedImage]=useState<string|null>(null),[selectedRow,setSelectedRow]=useState<string|null>(null),[zoom,setZoom]=useState(1);
  const [target,setTarget]=useState(data.activeDatasetId),[beforeId,setBeforeId]=useState(''),[retain,setRetain]=useState(true),[confirmed,setConfirmed]=useState(false);
  const [role,setRole]=useState<Role>(null),[mode,setMode]=useState(''),[manual,setManual]=useState(''),[fileRows,setFileRows]=useState<Match[]>([]),[fileName,setFileName]=useState(''),[reverseFile,setReverseFile]=useState(false),[filePage,setFilePage]=useState(0);
  const [running,setRunning]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),ocrRef=useRef<LocalOCR|null>(null),alive=useRef(true),cancelled=useRef(false),urls=useRef<string[]>([]);
  const [writeFailed,setWriteFailed]=useState(false),submitting=useRef(false);
  const [loading,setLoading]=useState(false),[processed,setProcessed]=useState(0),[total,setTotal]=useState(0),readingFiles=useRef(false),activeOCR=useRef(false);
  const processing=loading||running;
  const updateImages=(next:DraftImage[]|((old:DraftImage[])=>DraftImage[]))=>{const result=typeof next==='function'?next(imagesRef.current):next;imagesRef.current=result;setImages(result);};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;void ocrRef.current?.cancel();urls.current.forEach(url=>URL.revokeObjectURL(url));};},[]);
  const updateImage=(id:string,patch:Partial<DraftImage>)=>updateImages(old=>old.map(i=>i.id===id?{...i,...patch}:i));
  const editRow=(imageId:string,rowId:string,patch:Partial<DraftRow>)=>{
    setConfirmed(false);
    const fields=Object.keys(patch).filter(k=>['outcome','mode','map','relativeTimeText','durationText','scoreDisplay'].includes(k)) as (keyof OCRFields)[];
    updateImages(old=>old.map(i=>i.id===imageId?{...i,rows:i.rows.map(r=>r.id===rowId?{...r,...patch,edited:true,dirtyFields:[...new Set([...r.dirtyFields,...fields])]}:r)}:i));
  };
  const image=images.find(i=>i.id===selectedImage)??images[0], row=image?.rows.find(r=>r.id===selectedRow)??image?.rows[0];
  const addFiles=async(files:File[])=>{
    if(!files.length)return;
    if(readingFiles.current||activeOCR.current){setError('正在处理当前图片，请稍后再添加。');return;}
    setError('');setConfirmed(false);
    if(files.length+imagesRef.current.length>30){setError('每批最多 30 张，请拆成多批导入。');return;}
    readingFiles.current=true;setLoading(true);setProgress('正在读取图片…');
    const additions:DraftImage[]=[],issues:string[]=[];
    try{
    for(const file of files){
      if(!['image/png','image/jpeg'].includes(file.type)||file.size>15*1024*1024){issues.push(file.name+'：仅支持每张不超过 15 MB 的 PNG / JPEG。');continue;}
      let bitmap:ImageBitmap|null=null;
      try{
        bitmap=await createImageBitmap(file);if(!alive.current)break;
        if(bitmap.width*bitmap.height>12000000)throw new Error('图片超过 1200 万像素，请先使用截图区域。');
        const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
        const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(bitmap,0,0);
        const bands=detectBands(ctx.getImageData(0,0,bitmap.width,bitmap.height).data,bitmap.width,bitmap.height);
        const url=URL.createObjectURL(file);urls.current.push(url);
        additions.push({id:uid(),file,url,width:bitmap.width,height:bitmap.height,rows:bands.map(band=>({...blankRow(band),role,mode,edited:!!role||!!mode,dirtyFields:mode?['mode']:[]})),status:bands.length?'ready':'error',error:bands.length?'':'没有找到列表行。可指定区域和行数，或保留图片后人工填入。',newestFirst:true,included:true,top:0,bottom:100,rowCount:bands.length||1});
      }catch(e){issues.push(file.name+'：'+failureText(e));}finally{bitmap?.close();}
    }
    if(!alive.current){additions.forEach(i=>URL.revokeObjectURL(i.url));return;}updateImages(old=>[...old,...additions]);if(!selectedImage&&additions.length)setSelectedImage(additions[0].id);
    setError(issues.join(' '));
    const ids=additions.filter(i=>i.rows.length).map(i=>i.id);
    if(ids.length)void runOCR(ids,true);else setProgress(additions.length?'未找到可识别的记录行，请调整区域和行数。':'没有加入可用的图片。');
    }finally{readingFiles.current=false;if(alive.current)setLoading(false);}
  };
  const runOCR=async(imageIds?:string[],keepInputError=false)=>{
    if(activeOCR.current)return;
    const unfinished=imagesRef.current.some(i=>i.included&&i.rows.length&&i.status!=='done');
    const targets=imagesRef.current.filter(i=>i.included&&i.rows.length&&(imageIds?imageIds.includes(i.id):!unfinished||i.status!=='done'));
    if(!targets.length){setError('请先选图，并检查每张图的行数。');return;}
    activeOCR.current=true;setRunning(true);if(!keepInputError)setError('');cancelled.current=false;setConfirmed(false);setProcessed(0);setTotal(targets.reduce((n,i)=>n+i.rows.length,0));setProgress('准备自动识别…');
    updateImages(old=>old.map(i=>targets.some(t=>t.id===i.id)?{...i,status:'queued',error:''}:i));
    const engine=new LocalOCR();ocrRef.current=engine;let initialized=false,completed=0,failed=0;
    try{
      await engine.initialize((status,value)=>{if(alive.current&&!initialized)setProgress(status==='checking resources'?'检查本地识别资源…':'加载本地识别资源 '+Math.round(value*100)+'%');});initialized=true;
      for(let index=0;index<targets.length;index++){
        const targetImage=targets[index];if(cancelled.current)break;
        updateImage(targetImage.id,{status:'working',error:''});let bitmap:ImageBitmap|null=null;
        try{
          bitmap=await createImageBitmap(targetImage.file);
          for(let ri=0;ri<targetImage.rows.length;ri++){
            if(cancelled.current)break;const draft=targetImage.rows[ri];setProgress('第 '+(index+1)+'/'+targets.length+' 张 · 第 '+(ri+1)+'/'+targetImage.rows.length+' 行');
            const fields=await engine.recognize(bitmap,draft.band);
            if(alive.current)updateImages(old=>old.map(i=>i.id===targetImage.id?{...i,rows:i.rows.map(r=>r.id===draft.id?{...r,...Object.fromEntries(Object.entries(fields).filter(([key])=>!r.dirtyFields.includes(key as keyof OCRFields)))}:r)}:i));
            completed++;if(alive.current)setProcessed(completed);
          }
          if(alive.current)updateImage(targetImage.id,{status:cancelled.current?'cancelled':'done'});
        }catch(e){failed++;if(alive.current)updateImage(targetImage.id,{status:cancelled.current?'cancelled':'error',error:cancelled.current?'已取消，可重试或手工校对。':failureText(e)});}finally{bitmap?.close();}
      }
      if(alive.current)setProgress(cancelled.current?'识别已取消，草稿保留。':failed?'部分图片识别失败，请重试或手工校对。':'识别完成，请逐行核对。');
    }catch(e){if(alive.current){const reason=cancelled.current?'识别已取消，草稿保留。':failureText(e);setError(reason);setProgress(cancelled.current?reason:'识别未完成，可重试或手工填写。');updateImages(old=>old.map(i=>targets.some(t=>t.id===i.id)&&i.status==='queued'?{...i,status:cancelled.current?'cancelled':'error',error:reason}:i));}}
    finally{
      if(alive.current&&cancelled.current)updateImages(old=>old.map(i=>targets.some(t=>t.id===i.id)&&i.status==='queued'?{...i,status:'cancelled',error:''}:i));
      await engine.close().catch(()=>{});ocrRef.current=null;activeOCR.current=false;if(alive.current)setRunning(false);
    }
  };
  const cancelOCR=()=>{cancelled.current=true;void ocrRef.current?.cancel();};
  const moveImage=(id:string,direction:number)=>{setConfirmed(false);updateImages(old=>{const next=[...old],i=next.findIndex(r=>r.id===id),j=i+direction;if(j>=0&&j<next.length)[next[i],next[j]]=[next[j],next[i]];return next;});};
  const redivide=()=>{
    if(!image)return;setError('');
    if(image.top<0||image.bottom>100||image.top>=image.bottom||image.rowCount<1||image.rowCount>50){setError('请检查区域百分比和行数（1–50）。');return;}
    const top=Math.round(image.top/100*image.height),bottom=Math.round(image.bottom/100*image.height),height=(bottom-top)/image.rowCount;
    updateImage(image.id,{rows:Array.from({length:image.rowCount},(_,i)=>blankRow({top:Math.round(top+i*height),bottom:Math.round(top+(i+1)*height),partial:false})),status:'ready',error:''});setSelectedRow(null);setConfirmed(false);void runOCR([image.id]);
  };
  const applyBatch=()=>{setConfirmed(false);updateImages(old=>old.map(i=>({...i,rows:i.rows.map(r=>({...r,role,mode:mode||r.mode,edited:true,dirtyFields:mode?[...new Set([...r.dirtyFields,'mode' as const])]:r.dirtyFields}))})));setFileRows(old=>old.map(r=>({...r,role,mode:mode||r.mode,fieldOrigin:'user-entered'})));};
  const readFile=async(file:File)=>{
    setError('');setConfirmed(false);if(file.size>10*1024*1024){setError('记录文件最多 10 MB；完整图片备份请在数据工具恢复。');return;}
    try{setFileRows(parseRecordFile(await file.text(),file.name,target));setFileName(file.name);setFilePage(0);setReverseFile(false);}catch(e){setError((e as Error).message);}
  };
  const createManual=()=>{setError('');setConfirmed(false);try{setFileRows(parseManual(manual,target,role).map(r=>({...r,mode:mode||null})));setFileName('手工补录');setFilePage(0);}catch(e){setError((e as Error).message);}};
  const allDraftRows=images.filter(i=>i.included).flatMap(i=>i.rows.filter(r=>r.included)),importCount=tab==='screenshots'?allDraftRows.length:fileRows.length;
  const resolved=allDraftRows.filter(r=>r.outcome!=='unknown').length,unresolved=allDraftRows.length-resolved;
  const confirmImport=async()=>{
    if(submitting.current||busy||processing||!confirmed||!importCount)return;
    submitting.current=true;setError('');setWriteFailed(false);
    try{
      const batchId=uid(),records:Match[]=[],metadata:SourceImage[]=[],blobs=new Map<string,Blob>();
      if(tab==='screenshots'){
        for(const i of images.filter(i=>i.included)){
          if(!i.rows.length)throw new Error(i.file.name+' 没有记录行，请手工划分或取消选入。');
          metadata.push({id:i.id,name:i.file.name,width:i.width,height:i.height,size:i.file.size,retained:retain});if(retain)blobs.set(i.id,i.file);
          const rows=i.newestFirst?[...i.rows].reverse():i.rows;
          for(const r of rows.filter(r=>r.included))records.push(newMatch(target,{outcome:r.outcome,role:r.role,mode:r.mode||null,map:r.map.trim()||null,
            relativeTimeText:r.relativeTimeText.trim()||null,durationSeconds:parseDuration(r.durationText),scoreDisplay:r.scoreDisplay.trim()||null,
            sourceBatchId:batchId,sourceImageId:i.id,rowFromTop:i.rows.findIndex(v=>v.id===r.id)+1,partialRow:r.band.partial,
            rawFields:r.rawFields,fieldOrigin:r.edited?'user-entered':'ocr-reviewed',entryKind:'screenshot'}));
        }
      }else for(const r of reverseFile?[...fileRows].reverse():fileRows)records.push({...r,id:uid(),datasetId:target,sourceBatchId:batchId,sourceImageId:null});
      if(!records.length)throw new Error('没有选中任何记录。');
      const ids=records.map(r=>r.id),batchName=tab==='screenshots'?images.filter(i=>i.included).length+' 张截图':fileName;
      const ok=await persist(next=>{
        insertImportedRecords(next,{id:batchId,datasetId:target,createdAt:now(),name:batchName,recordIds:ids,imageIds:metadata.map(i=>i.id)},records,metadata,beforeId||null);
      },'已导入 '+records.length+' 条记录 · 正在展示全部位置、所有模式',next=>removeRecords(next,ids),blobs);
      if(ok)onImported();else setWriteFailed(true);
    }catch(e){setError((e as Error).message);}
    finally{submitting.current=false;}
  };
  const editFileRow=(index:number,patch:Partial<Match>)=>{setConfirmed(false);setFileRows(old=>old.map((r,i)=>i===index?{...r,...patch}:r));};
  return <Modal title="导入对局记录" wide onClose={()=>{cancelOCR();onClose();}}>
    <div className="import-tabs" role="tablist" aria-label="导入方式">{([['screenshots','批量截图'],['manual','手工序列'],['file','JSON / CSV']] as const).map(([value,label])=><button key={value} role="tab" aria-selected={tab===value} disabled={processing} onClick={()=>{setTab(value);setError('');setConfirmed(false);setFileRows([]);setFileName('');}}>{label}</button>)}</div>
    <div className="import-context field-grid"><label className="field">目标数据集<select value={target} disabled={running} onChange={e=>{setTarget(e.target.value);setBeforeId('');setConfirmed(false);}}>{data.datasets.map(ds=><option key={ds.id} value={ds.id}>{ds.name}</option>)}</select></label><label className="field">插入位置<select value={beforeId} onChange={e=>{setBeforeId(e.target.value);setConfirmed(false);}}><option value="">现有历史末尾（较新）</option><option value="start">现有历史开头（较旧）</option>{sortedRecords(data,target).map(r=><option key={r.id} value={r.id}>第 {r.ordinal} 条之前</option>)}</select></label></div>
    <div className="batch-fields"><label className="field">批量位置<select value={role??'unknown'} onChange={e=>setRole(e.target.value==='unknown'?null:e.target.value as Role)}>{['unknown','tank','damage','support'].map(r=><option key={r} value={r}>{ROLE_NAMES[r as keyof typeof ROLE_NAMES]}</option>)}</select></label><label className="field">批量模式<select value={mode} onChange={e=>setMode(e.target.value)}><option value="">沿用识别值 / 未指定</option>{Object.entries(MODE_NAMES).map(([v,n])=><option value={v} key={v}>{n}</option>)}</select></label><button className="secondary-button" disabled={running} onClick={applyBatch}>应用到全部草稿</button></div>
    {tab==='screenshots'?<>
      {(loading||images.length>0)&&<div className="recognition-status" role="status" aria-live="polite"><div><strong>{loading?'正在读取图片':running?'自动识别中 · 已处理 '+processed+'/'+total+' 行':progress||'请检查图片与记录行'}</strong>{running&&<p className="progress-text">{progress}</p>}<p>{allDraftRows.length>0?resolved+'/'+allDraftRows.length+' 条结果已读出 · '+unresolved+' 条待确认。截图没有位置信息，位置请手工填写。':'尚未检测到记录行，可在下方调整区域。'}</p>{running&&<progress aria-label="截图识别进度" value={processed} max={total||1}/>}</div>{running?<button className="secondary-button" onClick={cancelOCR}>取消识别</button>:!!images.length&&<button className="secondary-button" disabled={loading} onClick={()=>void runOCR()}>{images.some(i=>i.included&&i.status!=='done')?'重试未完成图片':'重新识别选中图片'}</button>}</div>}
      <div className="upload-zone" aria-busy={processing} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void addFiles(Array.from(e.dataTransfer.files));}} onPaste={e=>{const files=Array.from(e.clipboardData.files);if(files.length){e.preventDefault();void addFiles(files);}}} tabIndex={0}>
        <Icon name="layers"/><strong>选择、拖入或粘贴历史截图</strong><p>选入后自动识别 · PNG / JPEG · 不上传图片</p><label className="file-picker">选择多张截图<input type="file" aria-label="选择历史截图" accept="image/png,image/jpeg" multiple disabled={processing} onChange={e=>{void addFiles(Array.from(e.target.files??[]));e.target.value='';}}/></label><p>每张 ≤15 MB · 每批 ≤30 张</p>
      </div>
      {!!images.length&&<>
        <p className="microcopy">图片从最早的一屏排到最新的一屏。图片内通常最新在上；每图可单独修改。共 {images.length} 张 / {allDraftRows.length} 条选中行。</p>
        <div className="image-order">{images.map((i,index)=><div key={i.id} className={image?.id===i.id?'selected':''}><input type="checkbox" aria-label={'选入图片 '+i.file.name} checked={i.included} disabled={processing} onChange={e=>{updateImage(i.id,{included:e.target.checked});setConfirmed(false);}}/><button className="image-name" onClick={()=>{setSelectedImage(i.id);setSelectedRow(null);}}><span>{index+1}. {i.file.name}</span><small data-status={i.status}>{i.rows.length} 行 · {imageStatus[i.status]}{i.status==='done'?' · '+i.rows.filter(r=>r.outcome==='unknown').length+' 条结果待确认':''}</small></button><button className="order-button" aria-label={'向前移动图片 '+(index+1)} disabled={processing||index===0} onClick={()=>moveImage(i.id,-1)}>↑</button><button className="order-button" aria-label={'向后移动图片 '+(index+1)} disabled={processing||index===images.length-1} onClick={()=>moveImage(i.id,1)}>↓</button></div>)}</div>
        {image&&<div className="review-layout"><section><div className="image-review-heading"><strong>第 {images.indexOf(image)+1} 屏</strong><label>缩放<input aria-label="图片缩放" type="range" min={1} max={2} step={.1} value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label></div>
          <div className="preview-image-scroll"><div className="preview-image" style={{width:zoom*100+'%'}}><img src={image.url} alt="正在校对的历史截图"/>{row&&<div className="row-highlight" style={{top:row.band.top/image.height*100+'%',height:(row.band.bottom-row.band.top)/image.height*100+'%'}}/>}</div></div>
          <ErrorText text={image.error}/><label className="field">图片内时间方向<select value={image.newestFirst?'newest':'oldest'} disabled={running} onChange={e=>{updateImage(image.id,{newestFirst:e.target.value==='newest'});setConfirmed(false);}}><option value="newest">最新在上（入模时反转）</option><option value="oldest">最早在上（保留图中顺序）</option></select></label>
          <details><summary>调整列表区域和行数</summary><p className="microcopy">用垂直区域百分比重新等分。重新划分会清除此图的草稿字段。</p><div className="crop-controls">{(['top','bottom','rowCount'] as const).map(key=><label key={key}>{key==='top'?'顶部 %':key==='bottom'?'底部 %':'可见行数'}<input type="number" value={image[key]} min={key==='rowCount'?1:0} max={key==='rowCount'?50:100} disabled={running} onChange={e=>updateImage(image.id,{[key]:Number(e.target.value)})}/></label>)}</div><button className="secondary-button" disabled={running} onClick={redivide}>重新划分此图</button></details>
          <button className="text-button" disabled={processing} onClick={()=>void runOCR([image.id])}>重试识别此图</button>
        </section><section><h3>逐行校对 · 上 → 下</h3><div className="draft-row-list">{image.rows.map((r,index)=><div key={r.id} className={row?.id===r.id?'selected':''}><input type="checkbox" aria-label={'选入第 '+(index+1)+' 行'} checked={r.included} disabled={running} onChange={e=>editRow(image.id,r.id,{included:e.target.checked})}/><button onClick={()=>setSelectedRow(r.id)}><span>第 {index+1} 行 {r.band.partial?'· 裁切':''}</span><strong>{OUTCOME_NAMES[r.outcome]} · {r.map||'地图待确认'}</strong><small>{r.durationText||'时长未识别'} · {ROLE_NAMES[r.role??'unknown']}</small></button></div>)}</div>
          {row&&<div className="draft-fields"><h4>第 {image.rows.indexOf(row)+1} 行详情</h4><div className="field-grid"><label className="field">结果<select disabled={running} value={row.outcome} onChange={e=>editRow(image.id,row.id,{outcome:e.target.value as Outcome})}>{Object.entries(OUTCOME_NAMES).map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label><label className="field">位置<select disabled={running} value={row.role??'unknown'} onChange={e=>editRow(image.id,row.id,{role:e.target.value==='unknown'?null:e.target.value as Role})}>{['unknown','tank','damage','support'].map(r=><option key={r} value={r}>{ROLE_NAMES[r as keyof typeof ROLE_NAMES]}</option>)}</select></label>
            <label className="field">模式<select disabled={running} value={row.mode} onChange={e=>editRow(image.id,row.id,{mode:e.target.value})}><option value="">未指定</option>{Object.entries(MODE_NAMES).map(([v,n])=><option value={v} key={v}>{n}</option>)}</select></label>
            {(['map','durationText','scoreDisplay','relativeTimeText'] as const).map(key=><label className="field" key={key}>{({map:'地图',durationText:'持续时间（m:ss）',scoreDisplay:'比分原文',relativeTimeText:'相对时间原文'})[key]}<input disabled={running} value={row[key]} placeholder={key==='durationText'?'可留空':''} onChange={e=>editRow(image.id,row.id,{[key]:e.target.value})}/></label>)}</div><p className="raw-text">OCR 原文：{row.rawFields||'尚未识别，可直接手工填写。'}</p>
          </div>}
        </section></div>}
      </>}
    </>:<section className="sequence-import">{tab==='manual'?<><label className="field">从旧到新的胜负序列<textarea aria-label="胜负序列" rows={4} value={manual} onChange={e=>{setManual(e.target.value);setConfirmed(false);}} placeholder="胜 负 胜 胜 负 / WLWWL"/></label><button className="secondary-button" onClick={createManual}>生成补录草稿</button></>:<><p className="subtle-note">CSV 必须含 outcome 列；支持 win / loss / draw / cancelled / unknown。JSON 支持记录数组或 records 对象；完整备份请在数据工具恢复。</p><label className="file-picker">选择记录文件<input aria-label="选择记录 JSON 或 CSV" type="file" accept=".json,.csv" onChange={e=>{const f=e.target.files?.[0];if(f)void readFile(f);e.target.value='';}}/></label><button className="text-button" onClick={()=>{const text='outcome,role,mode,map,durationSeconds\nwin,support,quick-play,萨摩亚,936\nloss,support,competitive,,\n';const url=URL.createObjectURL(new Blob([text],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='next-match-template.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>下载 CSV 模板</button></>}
      {fileRows.length>0&&<><p>{fileName} · {fileRows.length} 条草稿</p><label className="check-field"><input type="checkbox" checked={reverseFile} onChange={e=>{setReverseFile(e.target.checked);setConfirmed(false);}}/>当前输入是新→旧，确认时反转</label><div className="file-draft-list">{fileRows.slice(filePage*10,filePage*10+10).map((r,offset)=>{const index=filePage*10+offset;return <div key={r.id}><span>输入 {index+1}</span><select aria-label={'草稿 '+(index+1)+' 结果'} value={r.outcome} onChange={e=>editFileRow(index,{outcome:e.target.value as Outcome})}>{Object.entries(OUTCOME_NAMES).map(([v,n])=><option key={v} value={v}>{n}</option>)}</select><select aria-label={'草稿 '+(index+1)+' 位置'} value={r.role??'unknown'} onChange={e=>editFileRow(index,{role:e.target.value==='unknown'?null:e.target.value as Role})}>{['unknown','tank','damage','support'].map(role=><option value={role} key={role}>{ROLE_NAMES[role as keyof typeof ROLE_NAMES]}</option>)}</select><span>{MODE_NAMES[r.mode??'']??r.mode??'模式未指定'} {formatDuration(r.durationSeconds)}</span></div>;})}</div><div className="button-row"><button className="secondary-button" disabled={!filePage} onClick={()=>setFilePage(filePage-1)}>上一组</button><span>第 {filePage+1}/{Math.ceil(fileRows.length/10)} 组</span><button className="secondary-button" disabled={(filePage+1)*10>=fileRows.length} onClick={()=>setFilePage(filePage+1)}>下一组</button></div></>}
    </section>}
    <div className="import-confirm"><p className="import-responsibility">本工具不检测重复截图或重复记录。请确认图片范围、顺序和内容正确；每次确认都会追加记录。</p>{tab==='screenshots'&&<label className="check-field"><input type="checkbox" checked={retain} onChange={e=>setRetain(e.target.checked)}/>保留原图，便于以后校对</label>}
      {tab==='screenshots'&&unresolved>0&&!processing&&<p className="form-error">还有 {unresolved} 条结果待确认，不参与胜率计算。请逐行补填，或确认需要保留为待确认记录。</p>}
      <label className="check-field"><input type="checkbox" aria-label="我已确认输入顺序和所有可见行" checked={confirmed} disabled={processing||!importCount} onChange={e=>setConfirmed(e.target.checked)}/>我已检查顺序与所有可见行；未知字段可保留空值。</label>
      <p className="microcopy">将新增 {importCount} 条 · {tab==='screenshots'?allDraftRows.filter(r=>r.outcome==='win').length:fileRows.filter(r=>r.outcome==='win').length} 胜 · {tab==='screenshots'?allDraftRows.filter(r=>r.outcome==='loss').length:fileRows.filter(r=>r.outcome==='loss').length} 负。时长是游戏持续时间，比分不用于判胜负。</p><p className="microcopy">保存后展示全部位置、所有模式。未指定位置的记录可在历史中补上位置，再查看对应预测。</p><ErrorText text={error||(writeFailed?(saveError||'本地写入失败。')+' 草稿仍保留。':'')}/>
      <button className="primary-button full" disabled={busy||processing||!confirmed||!importCount} onClick={()=>void confirmImport()}>确认导入 {importCount} 条</button>
    </div>
  </Modal>;
}
