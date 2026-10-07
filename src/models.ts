import { DEFAULT_PARAMETERS, MODEL_IDS, type Match, type ModelId, type Parameters, type Probabilities } from './domain';
import { EloFeedback } from './elo';
export const MODELS: Record<ModelId,{name:string;icon:string;color:string;summary:string;formula:string;detail:string}> = {
  fair50:{name:'固定 50%',icon:'layers',color:'#8996a9',summary:'理想公平匹配的基准',formula:'p = 0.5',detail:'如果每局在已有信息下都完全公平，历史胜负不改变下一局的概率。'},
  beta10:{name:'Beta 10',icon:'chart',color:'#7c7db4',summary:'用短窗口估计近期胜率',formula:'p = (α + 最近 W 条胜数) / (2α + W内场数)',detail:'默认 Beta(5,5) 先验，把小样本估计向五五开收缩。短窗口默认 10 条。'},
  beta30:{name:'Beta 30',icon:'chart',color:'#728abd',summary:'用长窗口平滑近期胜率',formula:'p = (α + 最近 W 条胜数) / (2α + W内场数)',detail:'长窗口默认 30 条，反应更平缓。窗口内胜率近似不变是模型假设。'},
  markov30:{name:'Markov',icon:'markov',color:'#3d75b1',summary:'统计上一局之后的胜负',formula:'p(胜 | 上一条=a) = (α + Nₐ₁)/(2α + Nₐ₀ + Nₐ₁)',detail:'统计最近有效记录中的相邻转移，不预设连胜延续或反转。'},
  bocpd:{name:'BOCPD',icon:'change',color:'#348274',summary:'估计近期胜率的变化',formula:'p = h/2 + (1−h) Σₖ q(k) (α + sₖ)/(2α + k)',detail:'比较近期胜率可能从哪一局开始改变，不推断变化的原因。'},
  hedge:{name:'Hedge',icon:'share',color:'#8f739a',summary:'按历史误差加权基础模型',formula:'wᵢ ← normalize(wᵢ exp(−η(pᵢ−y)²))',detail:'五个基础专家：固定 50%、Beta 10、Beta 30、Markov、BOCPD。默认 η=2，用已经发生的误差更新权重。'},
  fixedShare:{name:'Fixed-Share',icon:'share',color:'#b17a3d',summary:'加权预测，保留重新调整的余地',formula:'wᵢ ← (1−γ) normalize(wᵢ exp(−η lossᵢ)) + γ/5',detail:'根据误差分配权重，同时给每个基础模型保留少量权重。'},
  eloFeedback:{name:'Elo 反馈',icon:'next',color:'#6673b1',summary:'模拟评分变化与重新匹配',formula:'E = 1 / (1 + 10^((O − R)/400))\nR′ = R + K(s − E)\nO′ = O + a(R′ − O)\np下一局 = 1 / (1 + 10^((O′ − A)/400))',detail:'独立的 Elo 评分与匹配反馈模拟：假定能力短期稳定，对手强度随模拟评分调整。不是官方 MMR 估计。'},
};
// A forecasting assumption, not an estimate of Blizzard's matchmaker or its MMR.
export const fairAnchor = (probability:number,strength:number) => .5+(1-strength)*(probability-.5);
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
  private elo:EloFeedback;
  constructor(readonly parameters: Parameters = DEFAULT_PARAMETERS) {this.elo=new EloFeedback(parameters.eloK??32,parameters.eloResponse??1);}
  break(resetElo=true) { this.last=null; this.breakPending=true;if(resetElo)this.elo.reset(); }
  draw(){this.elo.update(.5);}
  eloState(){return this.elo.state();}
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
    // Missing fairness means a legacy v1 forecast. Ensembles mix anchored experts once.
    const base=[.5,this.beta(p.shortWindow),this.beta(p.window),this.markov(),cp].map(v=>fairAnchor(v,p.fairness??0));
    const hedge=normalize(this.hedgeLogs), fixed=normalize(this.fixedLogs);
    return {fair50:base[0],beta10:base[1],beta30:base[2],markov30:base[3],bocpd:base[4],
      hedge:base.reduce((s,v,i)=>s+v*hedge[i],0),fixedShare:base.reduce((s,v,i)=>s+v*fixed[i],0),eloFeedback:this.elo.predict()};
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
    this.elo.update(y);
  }
  weights() { return {hedge:normalize(this.hedgeLogs),fixedShare:normalize(this.fixedLogs)}; }
}
export interface PredictionRow { recordId:string; sequence:number; ordinal:number; y:number; mode:string|null; predictions:Partial<Probabilities> }
export const hasForecasts=(row:PredictionRow,ids:ModelId[])=>ids.every(id=>Number.isFinite(row.predictions[id]));
export interface Score { n:number; brier:number|null; logLoss:number|null; direction:number|null; skill:number|null }
export function scoreRows(rows:PredictionRow[]): Record<ModelId,Score> {
  return Object.fromEntries(MODEL_IDS.map(id=>{
    const valid=rows.filter(r=>Number.isFinite(r.predictions[id])),n=valid.length;
    const brier=n?valid.reduce((s,r)=>s+(r.predictions[id]!-r.y)**2,0)/n:null;
    return [id,{n,brier,skill:brier===null?null:1-brier/.25,
      logLoss:n?-valid.reduce((s,r)=>{const p=Math.min(1-1e-12,Math.max(1e-12,r.predictions[id]!));return s+r.y*Math.log(p)+(1-r.y)*Math.log(1-p);},0)/n:null,
      direction:n?valid.reduce((s,r)=>s+(r.predictions[id]===.5?.5:Number((r.predictions[id]!>.5)===Boolean(r.y))),0)/n:null}];
  })) as Record<ModelId,Score>;
}
export function replay(records:Match[],parameters:Parameters=DEFAULT_PARAMETERS) {
  const engine=new Engine(parameters), rows:PredictionRow[]=[];
  if(parameters.historyLimit)records=records.slice(-parameters.historyLimit);
  for(const record of records) {
    if(record.gapBefore) engine.break();
    if(record.outcome!=='win' && record.outcome!=='loss') { engine.break(record.outcome!=='draw');if(record.outcome==='draw')engine.draw();continue; }
    const predictions=engine.predict(), y=Number(record.outcome==='win');
    rows.push({recordId:record.id,sequence:rows.length+1,ordinal:record.ordinal,y,mode:record.mode,predictions});
    engine.update(y,predictions);
  }
  return {rows,scores:scoreRows(rows),next:engine.predict(),weights:engine.weights(),elo:engine.eloState()};
}
export type ReplayResult = ReturnType<typeof replay>;
