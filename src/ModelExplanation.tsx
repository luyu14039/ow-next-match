import type { CSSProperties } from 'react';
import type { ModelId, Parameters } from './domain';
import { Icon } from './components';
import { fairAnchor, MODELS } from './models';

const percent=(p:number)=>(p*100).toFixed(1)+'%';
const EXPERT_NAMES=['固定 50%','Beta 10','Beta 30','Markov','BOCPD'];
interface Explanation { label:string; intro:string; steps:string[]; example:string; limit:string; parameters:string }
function explanation(id:ModelId,p:Parameters):Explanation {
  const alpha=p.prior,strength=p.fairness??0,window=id==='beta10'?p.shortWindow:p.window;
  const n=Math.min(window,10),wins=Math.round(n*.7),beta=(alpha+wins)/(2*alpha+n);
  const transitions=Math.min(p.window-1,10),followingWins=Math.round(transitions*.6),markov=(alpha+followingWins)/(2*alpha+transitions);
  const votes=[.5,.6,.55,.45,.65].map(v=>fairAnchor(v,strength)),average=votes.reduce((a,b)=>a+b,0)/votes.length;
  const feedback=strength===1?'由于校正后全为 50%，它们这一局的误差相同，不会按优劣改变权重。':`如果这一局赢了，${percent(votes[4])} 的误差比 ${percent(votes[3])} 小；下一局才会据此调整权重。`;
  const experts={
    steps:['先请五个基础模型分别预测：固定 50%、Beta 10、Beta 30、Markov 和 BOCPD。首页选择展示哪三个，不会改变这五个参与者。','开始时，每个模型占 20% 的权重。把它们的胜率按权重相加，就是组合预测。','这一局结束后，再检查每个预测的误差。赢了记为 1，输了记为 0，用“预测概率减去结果，再平方”计分；误差越小，下次获得的权重通常越大。'],
    example:`假设五个模型的原始估计是 50%、60%、55%、45%、65%。按当前回归强度校正后，是 ${votes.map(percent).join('、')}。初始权重相同，组合胜率为 ${percent(average)}。${feedback}`,
  };
  switch(id){
    case 'fair50':return {label:'公平匹配基准',intro:'每一局都给出 50%。它表达的是：在当前已有的信息下，双方获胜机会相同。',steps:['它不统计连胜、连败，也不读取累计胜率。上一局的结果不会改变下一局的预测。','如果我们严格假设匹配系统每局都做到了完全公平，那么所有仅依赖历史胜负的模型都应给出这个答案。'],example:'即使刚刚连赢五局，下一局仍是 50%。连续五次赢本来就可能发生；它不意味着下一局必须输来“补偿”。',limit:'50% 是公平匹配的参照，不是对任意一场实际比赛的保证。长期胜率接近 50%，也不能单独证明每局都公平或彼此独立。',parameters:'无参数。向 50% 回归的校正不会改变这个模型。'};
    case 'beta10':case 'beta30':return {label:'近期胜率 · 贝叶斯估计',intro:`它查看最近 ${window} 条有效胜负，估计这段时间的获胜机会。${id==='beta10'?'较短的窗口更快反映近期结果，也更容易受偶然输赢影响。':'较长的窗口通常更平稳，但对近期变化的反应较慢。'}`,steps:[`只取窗口内的胜负；可用记录不足 ${window} 条时，就使用已有记录。平局和未确认结果不计入胜负。`,`计算前先加入对称先验：相当于已有 ${alpha} 次胜利和 ${alpha} 次失败的参考信息。因此，一两局结果不会轻易变成接近 0% 或 100% 的估计。`,'将窗口内的胜数加到先验里，计算胜数占总数的比例，最后再按当前设置向 50% 回归。'],example:`假设只有 ${n} 局可用，其中 ${wins} 胜、${n-wins} 负。原始估计是 (${alpha} + ${wins}) ÷ (${2*alpha} + ${n}) = ${percent(beta)}；按当前回归强度，最终显示 ${percent(fairAnchor(beta,strength))}。`,limit:'它假设这个窗口里的胜率大致稳定。队伍、模式或玩家水平发生变化时，简单的窗口统计可能跟不上；近期胜率也不等于下一局的真实胜率。',parameters:`对称先验 α = ${alpha}；窗口 W = ${window}。名称中的 10 / 30 表示默认窗口。`};
    case 'markov30':return {label:'胜负转移 · 一阶 Markov',intro:'它问的是：过去出现与上一局相同的结果之后，紧接着的那局通常是赢还是输？',steps:[`在最近 ${p.window} 条有效胜负中查找相邻对局。如果上一局赢了，就统计“胜→胜”和“胜→负”；上一局输了，则统计“负→胜”和“负→负”。`,`将这些次数和对称先验合在一起估计概率，再向 50% 回归。样本很少时，先验会让结果保持在 50% 附近。`,'历史缺口、平局或未知结果会打断相邻关系。它不会把缺口两边的记录当成连续两局。'],example:`假设上一局赢了，窗口中找到 ${transitions} 次“赢后再打”的记录：${followingWins} 次再赢、${transitions-followingWins} 次输。原始胜率为 (${alpha} + ${followingWins}) ÷ (${2*alpha} + ${transitions}) = ${percent(markov)}；校正后为 ${percent(fairAnchor(markov,strength))}。`,limit:'它只看上一条有效结果，不理解队友、地图或连胜的原因。相关性可能只是偶然；它既不预设“连胜会继续”，也不预设“连胜后必输”。',parameters:`对称先验 α = ${alpha}；转移统计窗口 W = ${p.window}。`};
    case 'bocpd':return {label:'在线贝叶斯变点检测',intro:'它尝试判断：近期的胜率是否与更早的时候不同？如果不同，这种变化可能从哪一局开始？',steps:['同时保留多个解释：状态可能刚刚改变，也可能已持续了几局或更久。每个解释分别用对应历史估计胜率。','每加入一个结果，就看哪些解释更符合数据，调整它们的可信程度。下一局的预测是这些解释的加权平均。',`模型还保留每局开始新状态段的可能性，当前先验概率是 ${(p.hazard*100).toFixed(2)}%。新段从 50% 开始；最终预测再应用共同的 50% 回归校正。`],example:'例如，较早的记录输赢相当，最近几局连续获胜。模型会同时比较“偶然连胜”和“近期胜率已经改变”这两类解释。它不会因为刚赢了一局就直接宣布发生了变化。',limit:'变点表示统计分布可能改变，不能告诉你原因。新段概率是事先设置的假设，不是检测到的匹配调整频率；也不是每隔固定场数就必定换段。',parameters:`对称先验 α = ${alpha}；新段先验概率 h = ${p.hazard.toFixed(5)}。使用全部选定历史进行精确递推。`};
    case 'hedge':return {label:'在线学习 · 专家加权',intro:'它把几个基础模型的意见合起来，根据已经发生的预测误差，逐局调整各自的权重。这里的“专家”就是数学模型。',steps:experts.steps,example:experts.example,limit:'如果所有基础模型都缺少有效信号，组合它们也不会凭空获得新信息。权重反映这段历史的误差，不代表哪个模型下一局一定更准。它的基础预测已向 50% 回归，不会再对组合结果重复校正。',parameters:`基础模型共 5 个；学习率 η = ${p.eta}。η 越大，权重对一次误差的反应越明显。`};
    case 'fixedShare':return {label:'在线学习 · 可切换专家加权',intro:'它在 Hedge 的误差加权上多做一步：每局给所有基础模型重新分配少量权重，让曾经表现较差的模型仍有机会参与后续预测。',steps:[...experts.steps,`误差更新后，保留 ${(100*(1-p.share)).toFixed(0)}% 的权重分配，将剩下的 ${(100*p.share).toFixed(0)}% 均分给五个模型。因此每个模型至少有 ${(100*p.share/5).toFixed(2)}% 的权重。`],example:`${experts.example} 再分配的部分不依据这一局谁最准，而是均匀补给每个模型。`,limit:'重新分配有利于在规律变化时调整，但也会给近期较差的模型保留份额。它不保证比 Hedge 更准；回流比例设为 0 时，权重更新与 Hedge 相同。',parameters:`学习率 η = ${p.eta}；均匀回流比例 γ = ${p.share}。组合的是已校正的基础预测，不重复向 50% 回归。`};
  }
}

export function ModelExplanation({id,parameters,scope,probability,weights,onSettings}:{id:ModelId;parameters:Parameters;scope:string;probability?:number;weights?:number[];onSettings:()=>void}){
  const content=explanation(id,parameters),strength=parameters.fairness??0;
  return <article className="model-explanation" style={{'--explanation-color':MODELS[id].color} as CSSProperties}>
    <div className="explanation-intro"><span className="explanation-label"><Icon name={MODELS[id].icon}/>{content.label}</span><p>{content.intro}</p>{probability!==undefined&&<div className="explanation-current"><span>当前下一局胜率</span><strong>{percent(probability)}</strong></div>}</div>
    <section className="explanation-section"><h3>计算过程</h3><ol className="explanation-steps">{content.steps.map((step,i)=><li key={i}><span aria-hidden="true">{String(i+1).padStart(2,'0')}</span><p>{step}</p></li>)}</ol></section>
    <section className="explanation-example"><h3><Icon name="chart"/>举个例子</h3><p>{content.example}</p><small>示例用于解释计算，不是你的实际对局。</small></section>
    {id!=='fair50'&&<section className="explanation-section"><h3>公平匹配假设</h3><p>当前回归强度为 <strong>{Math.round(strength*100)}%</strong>。把历史估计偏离 50% 的幅度保留 {Math.round((1-strength)*100)}%，作为下一局的预测。比如历史估计 60%，校正后是 {percent(fairAnchor(.6,strength))}。</p><p>100% 表示每局完全公平，所有模型都预测 50%；0% 表示保留原始历史估计。这个强度是本项目的建模假设，没有用对手或官方 MMR 估算。</p></section>}
    <section className="explanation-section"><h3>如何理解结果</h3><p>{content.limit}</p><p>当前使用：{scope}。只读取已确认的历史胜负，不包含下一局的队友、对手或阵容信息。长期胜率为 50%，仍可能出现连续输赢。</p></section>
    <details className="explanation-math"><summary>计算公式与当前参数</summary><div className="formula">{MODELS[id].formula}</div>{id!=='fair50'&&<div className="formula">p = 0.5 + (1 − λ) × (p历史 − 0.5)<br/>λ = {strength}（50% 回归强度）</div>}<p>{content.parameters}</p>{weights&&<div className="expert-weights" aria-label="当前基础模型权重"><h4>当前基础模型权重</h4>{weights.map((weight,i)=><div key={i}><span>{EXPERT_NAMES[i]}</span><meter min="0" max="1" value={weight} aria-label={EXPERT_NAMES[i]+' 权重'}/><strong>{percent(weight)}</strong></div>)}</div>}</details>
    <div className="explanation-footer"><a href="https://overwatch.blizzard.com/en-gb/news/23910161/overwatch-2-developer-blog-explaining-matchmaker-goals-and-plans-part-2/" target="_blank" rel="noreferrer">暴雪的公平匹配说明 <Icon name="arrow"/></a><button className="primary-button" onClick={onSettings}>调整模型设置</button></div>
  </article>;
}
