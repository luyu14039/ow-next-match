export interface ChartScale { min:number; max:number; ticks:number[] }
/** Include the fair baseline, leave headroom, and never zoom to less than 10 pp. */
export function chartScale(values:number[],full=false):ChartScale {
  const finite=values.filter(v=>Number.isFinite(v)&&v>=0&&v<=1);
  if(full||!finite.length)return {min:0,max:1,ticks:[0,.25,.5,.75,1]};
  const low=Math.min(.5,...finite),high=Math.max(.5,...finite),span=Math.max(.1,high-low);
  const middle=(high+low)/2,padding=Math.max(.015,span*.12);
  const lower=Math.max(0,middle-span/2-padding),upper=Math.min(1,middle+span/2+padding);
  const width=upper-lower,step=width<=.2?.05:width<=.4?.1:width<=.8?.2:.25;
  const min=Number(Math.max(0,Math.floor((lower+1e-10)/step)*step).toFixed(6)),max=Number(Math.min(1,Math.ceil((upper-1e-10)/step)*step).toFixed(6));
  const ticks=[];
  for(let tick=min;tick<=max+1e-10;tick+=step)ticks.push(Number(tick.toFixed(6)));
  if(ticks.at(-1)!<max-1e-10)ticks.push(max);
  return {min,max,ticks};
}
