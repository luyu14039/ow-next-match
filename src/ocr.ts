import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { parseDuration } from './formats';
import type { Outcome } from './domain';
export interface Band { top:number; bottom:number; partial:boolean }
export interface OCRFields { map:string; mode:string; relativeTimeText:string; durationText:string; outcome:Outcome; scoreDisplay:string; rawFields:string }
export function detectBands(pixels:Uint8ClampedArray,width:number,height:number):Band[] {
  const spans:{start:number;end:number}[]=[];let start=-1;
  for(let y=0;y<height;y++){
    let colored=0,total=0;
    for(let x=Math.floor(width*.87);x<width*.975;x+=Math.max(2,Math.floor(width/250))){
      const i=(y*width+x)*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2];total++;
      if((g>100 && g>r*1.4 && b<g*.8)||(r>120 && r>g*1.5 && r>b*1.5))colored++;
    }
    const active=colored>total*.4;
    if(active && start<0)start=y;
    if(!active && start>=0){if(y-start>=5)spans.push({start,end:y});start=-1;}
  }
  if(start>=0 && height-start>=5)spans.push({start,end:height});
  if(!spans.length) return [];
  const centers=spans.map(s=>(s.start+s.end)/2);
  const pitches=centers.slice(1).map((c,i)=>c-centers[i]).sort((a,b)=>a-b);
  const pitch=pitches.length?pitches[Math.floor(pitches.length/2)]:(spans[0].end-spans[0].start)*1.9;
  return centers.map((c,i)=>({
    top:Math.max(0,Math.round(i?(centers[i-1]+c)/2:c-pitch/2)),
    bottom:Math.min(height,Math.round(i<centers.length-1?(c+centers[i+1])/2:c+pitch/2)),
    partial:i===centers.length-1 && height-c<pitch*.5,
  }));
}
export function parseOCRFields(columns:{map:string;mode:string;time:string;result:string}):OCRFields {
  const compact=(s:string)=>s.normalize('NFKC').replace(/\s/g,'');
  const result=compact(columns.result), time=compact(columns.time);
  const wins=result.includes('胜利'),losses=result.includes('战败')||result.includes('失败');
  const outcome:Outcome=wins!==losses?(wins?'win':'loss'):result.includes('平局')?'draw':'unknown';
  const relative=time.match(/\d+(?:分钟|小时|天|周)(?:之前|前)/)?.[0] ?? '';
  const duration=time.match(/\d{1,3}:\d{2}(?::\d{2})?/g)?.at(-1) ?? '';
  let durationText='';try{if(duration && parseDuration(duration)!==null)durationText=duration;}catch{ /* keep untrusted text only in rawFields */ }
  const mode=compact(columns.mode);
  return {map:compact(columns.map),mode:mode.includes('快速')?'quick-play':mode.includes('竞技')?'competitive':mode.includes('街机')?'arcade':'',
    relativeTimeText:relative,durationText,outcome,scoreDisplay:result.match(/\d+[-一–—]\d+/)?.[0].replace(/[一–—]/g,'-') ?? '',
    rawFields:[columns.map,columns.mode,columns.time,columns.result].join(' | ')};
}
export class LocalOCR {
  private worker:Worker|null=null;
  private cancelled=false;
  private abort!:(reason:Error)=>void;
  private cancelSignal:Promise<never>;
  private resourceAbort=new AbortController();
  constructor(){this.cancelSignal=new Promise<never>((_,reject)=>{this.abort=reject;});void this.cancelSignal.catch(()=>{});}
  private cancellable<T>(job:Promise<T>,timeout=60000):Promise<T>{
    const timer=setTimeout(()=>{this.cancelled=true;this.resourceAbort.abort();this.abort(new Error('识别响应超时，请重试或手工校对。'));void this.close().catch(()=>{});},timeout);
    return Promise.race([job,this.cancelSignal]).finally(()=>clearTimeout(timer));
  }
  private async readCanvas(canvas:HTMLCanvasElement,output?:Parameters<Worker['recognize']>[2]){
    // Encode before dispatch: Tesseract's deferred canvas conversion can otherwise
    // post to a terminated worker when the user cancels during toBlob/FileReader.
    const blob=await this.cancellable(new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('图片转换失败，请重试或手工校对。')))));
    const source=await this.cancellable(new Promise<string>((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(reader.result as string);reader.onerror=()=>reject(new Error('图片读取失败，请重试或手工校对。'));reader.readAsDataURL(blob);
    }));
    if(!this.worker||this.cancelled)throw new Error('已取消识别，草稿已保留。');
    return this.cancellable(this.worker.recognize(source,{},output));
  }
  async initialize(progress:(status:string,value:number)=>void) {
    this.cancelled=false;
    const base=new URL(import.meta.env.BASE_URL+'ocr/',location.href).href;
    progress('checking resources',0);
    // Fail before spawning a Worker if a static host serves a missing asset as HTML.
    await this.cancellable(Promise.all(['worker.min.js','chi_sim.traineddata.gz','eng.traineddata.gz'].map(async file=>{
      const response=await fetch(base+file,{method:'HEAD',signal:this.resourceAbort.signal});
      if(!response.ok || response.headers.get('content-type')?.includes('text/html'))throw new Error('本地识别资源不可用：'+file+'（'+response.status+'）。请检查网页服务后重试，或手工校对。');
    })),15000);
    const creation=createWorker(['chi_sim','eng'],OEM.LSTM_ONLY,{
      workerPath:base+'worker.min.js',corePath:base,langPath:base,workerBlobURL:false,
      legacyCore:false,legacyLang:false,
      logger:m=>{if(!this.cancelled)progress(m.status,m.progress);},
      errorHandler:error=>{this.cancelled=true;this.abort(new Error(typeof error==='string'?error:String(error)));},
    });
    void creation.then(worker=>{if(this.cancelled)void worker.terminate();}).catch(()=>{});
    this.worker=await this.cancellable(creation);
    if(this.cancelled){await this.worker.terminate();this.worker=null;throw new Error('已取消识别，草稿已保留。');}
    await this.cancellable(this.worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,preserve_interword_spaces:'1',user_defined_dpi:'150'}));
  }
  async recognize(bitmap:ImageBitmap,band:Band):Promise<OCRFields> {
    if(!this.worker || this.cancelled)throw new Error('已取消识别。');
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=band.bottom-band.top;
    const context=canvas.getContext('2d',{willReadFrequently:true})!;context.drawImage(bitmap,0,-band.top);
    const image=context.getImageData(0,0,canvas.width,canvas.height),{data}=image;
    // Locate the colored result badge, but read its words to determine the result.
    let left=canvas.width,right=0,top=canvas.height,bottom=0;
    for(let y=0;y<canvas.height;y++)for(let x=Math.floor(canvas.width*.86);x<canvas.width;x++){
      const i=(y*canvas.width+x)*4,r=data[i],g=data[i+1],b=data[i+2];
      if((g>100&&g>r*1.4&&b<g*.8)||(r>120&&r>g*1.5&&r>b*1.5)){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    }
    let resultText='';
    if(right>left&&bottom>top){
      // Exclude rounded white corners; otherwise inversion creates a black frame.
      const inset=Math.min(8,Math.floor((bottom-top)/6));left+=inset;right-=inset;top+=inset;bottom-=inset;
      const badge=document.createElement('canvas');badge.width=right-left+21;badge.height=bottom-top+21;
      const badgeContext=badge.getContext('2d')!;badgeContext.fillStyle='white';badgeContext.fillRect(0,0,badge.width,badge.height);
      const badgePixels=badgeContext.getImageData(0,0,badge.width,badge.height);
      for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
        const source=(y*canvas.width+x)*4,dest=((y-top+10)*badge.width+x-left+10)*4;
        // Preserve anti-aliased text strokes; a hard white threshold erases small glyphs.
        const value=255-Math.min(data[source],data[source+1],data[source+2]);
        badgePixels.data[dest]=badgePixels.data[dest+1]=badgePixels.data[dest+2]=value;
      }
      badgeContext.putImageData(badgePixels,0,0);
      const large=document.createElement('canvas');large.width=badge.width*3;large.height=badge.height*3;large.getContext('2d')!.drawImage(badge,0,0,large.width,large.height);
      await this.cancellable(this.worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE,tessedit_char_whitelist:'胜利战败失败平局取消0123456789|-–—'}));
      resultText=(await this.readCanvas(large)).data.text;
      // A cropped row or a badge without a score can fail single-line segmentation.
      for(const mode of [PSM.SINGLE_BLOCK,PSM.SPARSE_TEXT]){
        if(parseOCRFields({map:'',mode:'',time:'',result:resultText}).outcome!=='unknown')break;
        await this.cancellable(this.worker.setParameters({tessedit_pageseg_mode:mode}));
        const retry=(await this.readCanvas(large)).data.text;
        if(parseOCRFields({map:'',mode:'',time:'',result:retry}).outcome!=='unknown')resultText=retry;
      }
      await this.cancellable(this.worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,tessedit_char_whitelist:''}));
    }
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
      const i=(y*canvas.width+x)*4;
      if(x<canvas.width*.42){
        const white=data[i]>190 && data[i+1]>190 && data[i+2]>190;
        const v=white?0:255;data[i]=data[i+1]=data[i+2]=v;
      }
      if(x<canvas.width*.048 || (x>canvas.width*.4 && x<canvas.width*.47)||x>canvas.width*.86)data[i]=data[i+1]=data[i+2]=255;
    }
    context.putImageData(image,0,0);
    const enlarged=document.createElement('canvas');enlarged.width=canvas.width*1.5;enlarged.height=canvas.height*1.5;
    enlarged.getContext('2d')!.drawImage(canvas,0,0,enlarged.width,enlarged.height);
    const {data:page}=await this.readCanvas(enlarged,{text:true,blocks:true});
    const words=page.blocks?.flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words))) ?? [];
    const column=(start:number,end:number)=>words.filter(w=>{const c=(w.bbox.x0+w.bbox.x1)/2/enlarged.width;return c>=start && c<end;}).map(w=>w.text).join(' ');
    return parseOCRFields({map:column(.048,.4),mode:column(.47,.67),time:column(.67,.86),result:resultText});
  }
  async cancel(){this.cancelled=true;this.resourceAbort.abort();this.abort(new Error('已取消识别，草稿已保留。'));await this.close();}
  async close(){this.resourceAbort.abort();const worker=this.worker;this.worker=null;if(worker)await worker.terminate();}
}
