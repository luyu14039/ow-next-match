/** Classical logistic Elo expected score; interpreted as win probability for binary games. */
export function eloExpected(player:number,opponent:number):number {
  return 1/(1+10**((opponent-player)/400));
}
export interface EloState { rating:number; opponent:number; ability:number; expectedScore:number; probability:number }
/** Elo rating updates plus an explicitly assumed rating-following matchmaking policy. */
export class EloFeedback {
  private rating=1500;
  private opponent=1500;
  readonly ability=1500;
  constructor(readonly k=32,readonly response=1){}
  predict(){return eloExpected(this.ability,this.opponent);}
  update(score:number){
    const expected=eloExpected(this.rating,this.opponent);
    this.rating+=this.k*(score-expected);
    this.opponent+=this.response*(this.rating-this.opponent);
  }
  reset(){this.rating=1500;this.opponent=1500;}
  state():EloState {return {rating:this.rating,opponent:this.opponent,ability:this.ability,expectedScore:eloExpected(this.rating,this.opponent),probability:this.predict()};}
}
