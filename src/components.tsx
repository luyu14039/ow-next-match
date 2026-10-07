import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import symbols from './symbols.svg?raw';
import { MODELS, hasForecasts, type PredictionRow } from './models';
import { OUTCOME_NAMES, type ModelId, type Outcome } from './domain';
import { chartScale } from './chartScale';
export function Symbols(){return <div aria-hidden="true" dangerouslySetInnerHTML={{__html:symbols}}/>;}
export function Icon({name,className='icon'}:{name:string;className?:string}){return <svg className={className} aria-hidden="true"><use href={'#i-'+name}/></svg>;}
export function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null), trigger=useRef<HTMLElement|null>(null);
  useEffect(()=>{trigger.current=document.activeElement as HTMLElement;const element=ref.current!,overflow=document.documentElement.style.overflow;document.documentElement.style.overflow='hidden';element.showModal();return()=>{element.close();document.documentElement.style.overflow=overflow;trigger.current?.focus();};},[]);
  return <dialog ref={ref} className={'sheet'+(wide?' wide-sheet':'')} aria-labelledby="sheet-title" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget){const b=e.currentTarget.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)onClose();}}}>
    <div className="sheet-top"><div><span className="eyebrow">对局手记</span><h2 id="sheet-title">{title}</h2></div><button type="button" className="circle-button" onClick={onClose} aria-label="关闭"><Icon name="dismiss"/></button></div>
    <div className="sheet-content">{children}</div>
  </dialog>;
}
export function ErrorText({text}:{text:string}){return text?<p className="form-error" role="alert">{text}</p>:null;}
export function SectionTitle({icon,children,caption}:{icon:string;children:ReactNode;caption?:ReactNode}){return <div className="section-heading"><h2><span className="section-icon"><Icon name={icon}/></span>{children}</h2>{caption && <span className="caption">{caption}</span>}</div>;}
export function Result({outcome}:{outcome:Outcome}){return <span className={'history-result '+(outcome==='loss'?'loss':'')+(outcome!=='win'&&outcome!=='loss'?' neutral':'')}><Icon name={outcome==='win'?'check':outcome==='loss'?'close':'history'}/>{OUTCOME_NAMES[outcome]}</span>;}
export function NumberTransition({value,reduced}:{value:number;reduced:boolean}){
  const [display,setDisplay]=useState(value),previous=useRef(value);
  useEffect(()=>{if(reduced || matchMedia('(prefers-reduced-motion: reduce)').matches){setDisplay(value);previous.current=value;return;}let frame=0;const start=performance.now(),from=previous.current;
    const update=(time:number)=>{const t=Math.min(1,(time-start)/250),v=from+(value-from)*(1-(1-t)**3);setDisplay(v);previous.current=v;if(t<1)frame=requestAnimationFrame(update);};
    frame=requestAnimationFrame(update);return()=>cancelAnimationFrame(frame);
  },[value,reduced]);
  return <span className="number" aria-hidden="true">{(display*100).toFixed(1)}</span>;
}
export function TraceChart({rows,models,emptyMessage='记录第一局后，开始回放。'}:{rows:PredictionRow[];models:ModelId[];emptyMessage?:string}){
  const [hover,setHover]=useState<number|null>(null),[fullScale,setFullScale]=useState(false),svg=useRef<SVGSVGElement>(null);
  const [size,setSize]=useState({width:540,height:210});
  useEffect(()=>{
    const observer=new ResizeObserver(([entry])=>{
      const {width,height}=entry.contentRect;
      if(width>0&&height>0)setSize(old=>old.width===width&&old.height===height?old:{width,height});
    });
    observer.observe(svg.current!);return()=>observer.disconnect();
  },[]);
  const trace=rows.filter(row=>hasForecasts(row,models)).slice(-20),w=size.width,h=size.height,x0=48,y0=16,x1=w-16,y1=h-34;
  const scale=chartScale(trace.flatMap(row=>models.map(id=>row.predictions[id]!)),fullScale);
  const x=(i:number)=>trace.length===1?(x0+x1)/2:x0+(x1-x0)*i/Math.max(1,trace.length-1),y=(p:number)=>y1-(y1-y0)*(p-scale.min)/(scale.max-scale.min);
  const range=Math.round(scale.min*100)+'–'+Math.round(scale.max*100)+'%';
  const point=hover===null?null:trace[hover];
  useEffect(()=>setHover(null),[rows]);
  return <figure className="chart-figure"><div className="chart-legend">{models.map(id=><span key={id}><i className="legend-stroke" style={{'--trace':MODELS[id].color} as CSSProperties}/>{MODELS[id].name}</span>)}<span><i className="legend-stroke baseline"/>50% 基准</span></div><div className="chart-scale-control"><span>纵轴 {range}{!fullScale&&trace.length?' · 自动缩放':''}</span><button type="button" className="text-button" aria-pressed={fullScale} onClick={()=>setFullScale(v=>!v)}>{fullScale?'恢复自动缩放':'查看 0–100%'}</button></div>
    <div className="chart-stage" tabIndex={trace.length?0:-1} role="group" aria-label="回放曲线，方向键逐条检查" onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();setHover(i=>Math.min(trace.length-1,Math.max(0,(i??0)+(e.key==='ArrowRight'?1:-1))));}if(e.key==='Escape')setHover(null);}}
      onPointerMove={e=>{if(!trace.length)return;const b=svg.current!.getBoundingClientRect();const index=Math.round(((e.clientX-b.left)/b.width*w-x0)/(x1-x0)*Math.max(1,trace.length-1));setHover(Math.min(trace.length-1,Math.max(0,index)));}} onPointerLeave={()=>setHover(null)}>
      <svg ref={svg} viewBox={'0 0 '+w+' '+h} role="img" aria-label={'最近 '+trace.length+' 条事前回放概率，纵轴 '+range+'，虚线为固定 50%'}>{scale.ticks.map(p=><g key={p}><line x1={x0} x2={x1} y1={y(p)} y2={y(p)} className={p===.5?'chart-baseline':'chart-grid'}/><text x={x0-9} y={y(p)+4} textAnchor="end" className="chart-axis">{Math.round(p*100)}%</text></g>)}{!scale.ticks.includes(.5)&&<line x1={x0} x2={x1} y1={y(.5)} y2={y(.5)} className="chart-baseline"/>}
        {models.map(id=><g key={id} style={{color:MODELS[id].color}}><path d={trace.map((r,i)=>(i?'L':'M')+x(i)+','+y(r.predictions[id]!)).join(' ')} className="chart-path"/>{trace.length>0 && <circle cx={x(trace.length-1)} cy={y(trace.at(-1)!.predictions[id]!)} r="3" fill="currentColor" className="chart-dot"/>}</g>)}
        {[0,Math.floor((trace.length-1)/2),trace.length-1].filter((v,i,a)=>v>=0&&v<trace.length&&a.indexOf(v)===i).map(i=><text key={i} x={x(i)} y={h-9} textAnchor={i===0?'start':i===trace.length-1?'end':'middle'} className="chart-axis">第 {trace[i]?.sequence} 条</text>)}
        {point && <line x1={x(hover!)} x2={x(hover!)} y1={y0} y2={y1} className="chart-baseline"/>}
      </svg>
      {!trace.length && <div className="chart-empty">{emptyMessage}</div>}
      {point && <div className="chart-tooltip" role="status">第 {point.sequence} 条 · {point.y?'胜':'负'}{models.map(id=><span key={id}>{MODELS[id].name} {(point.predictions[id]!*100).toFixed(1)}%</span>)}</div>}
    </div><figcaption>最近 {trace.length} 条的赛前概率 · 方向键可查看各点。缩放只改变刻度，不改变概率。</figcaption></figure>;
}
