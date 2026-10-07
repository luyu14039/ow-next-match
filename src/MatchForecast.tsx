import { Icon, NumberTransition } from './components';
import { MODELS } from './models';
import type { ModelId } from './domain';

export function MatchForecast({model,probability,count,reduced,onExplain}:{model:ModelId;probability?:number;count:number;reduced:boolean;onExplain:()=>void}) {
  // Decide from the displayed precision so a displayed 50.0% never claims a winner.
  const win=probability===undefined?null:Number((probability*100).toFixed(1));
  const outcome=win===null?'loading':win===50?'balanced':win>50?'win':'loss';
  const word={loading:'计算中',balanced:'胜负各半',win:'胜利',loss:'失败'}[outcome];
  const chance=win===null?undefined:(outcome==='loss'?100-win:win)/100;
  const icon=outcome==='win'?'cup':outcome==='loss'?'close':outcome==='loading'?'change':'layers';
  return <section className="match-call" data-outcome={outcome} aria-label="本局结果预测">
    <div className="match-call-main">
      <div className="match-call-emblem" aria-hidden="true">
        <svg className="match-call-orbit" viewBox="0 0 80 80"><circle className="call-orbit-track" cx="40" cy="40" r="35"/><circle className="call-orbit-progress" cx="40" cy="40" r="35" pathLength="100" strokeDasharray={(chance??.5)*100+' 100'}/></svg>
        <Icon name={icon}/>
      </div>
      <div className="match-call-copy">
        <p className="match-call-label">本局可能会：</p>
        <div className="match-call-result" role="status" aria-live="polite" aria-atomic="true">
          <h3 id="match-call-title" key={word}>{word}</h3>
          <div className="match-call-chance" aria-label={chance===undefined?'概率计算中':(outcome==='loss'?'失败':outcome==='win'?'胜利':'双方')+'概率 '+(chance*100).toFixed(1)+'%'}>
            <strong>{chance===undefined?<span className="number">—</span>:<NumberTransition key={model+'-'+outcome} value={chance} reduced={reduced}/>}<span className="call-unit">%</span></strong>
            <span>{outcome==='loss'?'失败概率':outcome==='win'?'胜利概率':outcome==='loading'?'等待计算':'双方机会'}</span>
          </div>
        </div>
      </div>
    </div>
    <div className="match-call-footer">
      <button type="button" className="call-model" onClick={onExplain} aria-label={MODELS[model].name+'模型说明'}><Icon name={MODELS[model].icon}/><span>{MODELS[model].name}</span><Icon name="arrow"/></button>
      <span className="call-context">{win===null?'正在读取当前范围的历史':count===0?'尚无有效胜负 · 50% 为起始值':<>胜 {win.toFixed(1)}%<span aria-hidden="true"> / </span>负 {(100-win).toFixed(1)}%</>}</span>
    </div>
  </section>;
}
