import { newMatch, type Match } from './domain';
export type Scenario = 'fair' | 'alternating' | 'shift' | 'roles';
export const SCENARIO_NAMES:Record<Scenario,string> = {fair:'公平硬币',alternating:'一胜一负',shift:'状态改变',roles:'位置差异'};
export function syntheticRecords(datasetId:string,scenario:Scenario,count=100,seed=20261004):Match[] {
  let state=seed>>>0;
  const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
  return Array.from({length:count},(_,i)=>{
    const role=(['tank','damage','support'] as const)[i%3];
    const p=scenario==='shift'?(i<count/2?.8:.2):scenario==='roles'?({tank:.7,damage:.35,support:.5}[role]):.5;
    const win=scenario==='alternating'?i%2===1:random()<p;
    return newMatch(datasetId,{ordinal:i+1,outcome:win?'win':'loss',role,mode:i%2?'competitive':'quick-play',entryKind:'synthetic',fieldOrigin:'synthetic'});
  });
}
