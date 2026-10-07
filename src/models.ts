import { DEFAULT_PARAMETERS, MODEL_IDS, type Match, type ModelId, type Parameters, type Probabilities } from './domain';
export const MODELS: Record<ModelId,{name:string;icon:string;color:string;summary:string;formula:string;detail:string}> = {
  fair50:{name:'固定 50%',icon:'layers',color:'#8996a9',summary:'把公平随机作为共同参照',formula:'p = 0.5',detail:'如果下一条结果独立且公平，过去的输赢不会改变它。这个基准可以胜过复杂模型。'},
  beta10:{name:'Beta 10',icon:'chart',color:'#7c7db4',summary:'用短窗口估计近期胜率',formula:'p = (α + 最近 W 条胜数) / (2α + W内场数)',detail:'默认 Beta(5,5) 先验，把小样本估计向五五开收缩。短窗口默认 10 条。'},
  beta30:{name:'Beta 30',icon:'chart',color:'#728abd',summary:'用长窗口平滑近期胜率',formula:'p = (α + 最近 W 条胜数) / (2α + W内场数)',detail:'长窗口默认 30 条，反应更平缓。窗口内胜率近似不变是模型假设。'},
  markov30:{name:'Markov',icon:'markov',color:'#3d75b1',summary:'看看胜负之间的转移',formula:'p(胜 | 上一条=a) = (α + Nₐ₁)/(2α + Nₐ₀ + Nₐ₁)',detail:'默认统计最近 30 个有效标签中未断开的相邻转移。允许连胜延续或反转，没有预设“连胜必输”。'},
  bocpd:{name:'BOCPD',icon:'change',color:'#348274',summary:'留意状态是否发生变化',formula:'p = h/2 + (1−h) Σₖ q(k) (α + sₖ)/(2α + k)',detail:'维护当前状态段长度的贝叶斯后验。默认每条开始新段的先验概率 h=1/30。检测分布变化，不推断队友、疲劳或匹配系统的原因。'},
  hedge:{name:'Hedge',icon:'share',color:'#8f739a',summary:'让过去误差决定专家权重',formula:'wᵢ ← normalize(wᵢ exp(−η(pᵢ−y)²))',detail:'五个基础专家：固定 50%、Beta 10、Beta 30、Markov、BOCPD。默认 η=2，用已经发生的误差更新权重。'},
  fixedShare:{name:'Fixed-Share',icon:'share',color:'#b17a3d',summary:'让各个专家动态分工',formula:'wᵢ ← (1−γ) normalize(wᵢ exp(−η lossᵢ)) + γ/5',detail:'默认 γ=0.04，让少量权重均匀回流。环境变化时，曾经失宠的专家有机会重新参与。这是动态专家学习，不是隐藏分反演。'},
};
const EXPERTS: ModelId[] = ['fair50','beta10','beta30','markov30','bocpd'];
const normalize = (logs:number[]) => { const max=Math.max(...logs); const w=logs.map(x=>Math.exp(x-max)); const sum=w.reduce((a,b)=>a+b,0); return w.map(x=>x/sum); };
export class Engine {
  private history: number[] = [];
  private connected: boolean[] = [];
  private prefix = [0];
  private q = [1];
  private last: number | null = null;
  private breakPending = false;
  private hedgeLogs = EXPERTS.map(()=>-Math.log(5));
  private fixedLogs = [...this.hedgeLogs];
  constructor(readonly parameters: Parameters = DEFAULT_PARAMETERS) {}
  break() { this.last=null; this.breakPending=true; }
  private beta(window:number) { const values=this.history.slice(-window); return (this.parameters.prior+values.reduce((a,b)=>a+b,0))/(2*this.parameters.prior+values.length); }
  private markov() {
    if(this.last===null) return .5;
    const start=Math.max(0,this.history.length-this.parameters.window);
    let count=0,wins=0;
    for(let i=start+1;i<this.history.length;i++) if(this.connected[i] && this.history[i-1]===this.last) { count++; wins+=this.history[i]; }
    return (this.parameters.prior+wins)/(2*this.parameters.prior+count);
  }
  private means() { const n=this.history.length; return this.q.map((_,k)=>(this.parameters.prior+this.prefix[n]-this.prefix[n-k])/(2*this.parameters.prior+k)); }
  predict(): Probabilities {
    const p=this.parameters, means=this.means();
    const cp=p.hazard*.5+(1-p.hazard)*this.q.reduce((s,q,k)=>s+q*means[k],0);
    const base=[.5,this.beta(p.shortWindow),this.beta(p.window),this.markov(),cp];
    const hedge=normalize(this.hedgeLogs), fixed=normalize(this.fixedLogs);
    return {fair50:base[0],beta10:base[1],beta30:base[2],markov30:base[3],bocpd:base[4],
      hedge:base.reduce((s,v,i)=>s+v*hedge[i],0),fixedShare:base.reduce((s,v,i)=>s+v*fixed[i],0)};
  }
  update(y:number, predictions=this.predict()) {
    const p=this.parameters, means=this.means(), q=Array(this.q.length+1).fill(0) as number[];
    q[1]=p.hazard*.5;
    this.q.forEach((v,k)=>{q[k+1]+=(1-p.hazard)*v*(y?means[k]:1-means[k]);});
    const total=q.reduce((a,b)=>a+b,0); this.q=q.map(x=>x/total);
    const losses=EXPERTS.map(id=>(predictions[id]-y)**2);
    const updatedLogs=this.hedgeLogs.map((w,i)=>w-p.eta*losses[i]);
    const maxLog=Math.max(...updatedLogs),logNormalizer=maxLog+Math.log(updatedLogs.reduce((sum,l)=>sum+Math.exp(l-maxLog),0));
    this.hedgeLogs=updatedLogs.map(l=>l-logNormalizer);
    const fixed=normalize(this.fixedLogs.map((w,i)=>w-p.eta*losses[i]));
    this.fixedLogs=fixed.map(w=>Math.log((1-p.share)*w+p.share/5 || Number.MIN_VALUE));
    this.connected.push(!this.breakPending && this.last!==null);
    this.history.push(y); this.prefix.push(this.prefix[this.prefix.length-1]+y);
    this.last=y; this.breakPending=false;
  }
  weights() { return {hedge:normalize(this.hedgeLogs),fixedShare:normalize(this.fixedLogs)}; }
}
export interface PredictionRow { recordId:string; sequence:number; ordinal:number; y:number; mode:string|null; predictions:Probabilities }
export interface Score { n:number; brier:number|null; logLoss:number|null; direction:number|null; skill:number|null }
export function scoreRows(rows:PredictionRow[]): Record<ModelId,Score> {
  return Object.fromEntries(MODEL_IDS.map(id=>{
    const n=rows.length;
    const brier=n?rows.reduce((s,r)=>s+(r.predictions[id]-r.y)**2,0)/n:null;
    return [id,{n,brier,skill:brier===null?null:1-brier/.25,
      logLoss:n?-rows.reduce((s,r)=>{const p=Math.min(1-1e-12,Math.max(1e-12,r.predictions[id]));return s+r.y*Math.log(p)+(1-r.y)*Math.log(1-p);},0)/n:null,
      direction:n?rows.reduce((s,r)=>s+(r.predictions[id]===.5?.5:Number((r.predictions[id]>.5)===Boolean(r.y))),0)/n:null}];
  })) as Record<ModelId,Score>;
}
export function replay(records:Match[],parameters:Parameters=DEFAULT_PARAMETERS) {
  const engine=new Engine(parameters), rows:PredictionRow[]=[];
  if(parameters.historyLimit)records=records.slice(-parameters.historyLimit);
  for(const record of records) {
    if(record.gapBefore) engine.break();
    if(record.outcome!=='win' && record.outcome!=='loss') { engine.break(); continue; }
    const predictions=engine.predict(), y=Number(record.outcome==='win');
    rows.push({recordId:record.id,sequence:rows.length+1,ordinal:record.ordinal,y,mode:record.mode,predictions});
    engine.update(y,predictions);
  }
  return {rows,scores:scoreRows(rows),next:engine.predict(),weights:engine.weights()};
}
export type ReplayResult = ReturnType<typeof replay>;
