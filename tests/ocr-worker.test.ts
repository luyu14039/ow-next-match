import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorker, type Worker } from 'tesseract.js';
import { LocalOCR } from '../src/ocr';

vi.mock('tesseract.js',async original=>({...await original<typeof import('tesseract.js')>(),createWorker:vi.fn()}));
const factory=vi.mocked(createWorker);
const makeWorker=()=>({setParameters:vi.fn().mockResolvedValue(undefined),recognize:vi.fn(),terminate:vi.fn().mockResolvedValue(undefined)}) as unknown as Worker;
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('location',{href:'http://localhost/lab/'});vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,headers:new Headers({'content-type':'application/octet-stream'})}));});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('local OCR lifecycle',()=>{
  it('fails on missing language resources before starting a worker',async()=>{
    vi.mocked(fetch).mockResolvedValue({ok:false,status:404,headers:new Headers()} as Response);
    const engine=new LocalOCR();await expect(engine.initialize(()=>{})).rejects.toThrow('本地识别资源不可用');
    expect(factory).not.toHaveBeenCalled();await engine.close();
  });
  it('rejects an HTML fallback even when the server reports 200',async()=>{
    vi.mocked(fetch).mockResolvedValue({ok:true,status:200,headers:new Headers({'content-type':'text/html'})} as Response);
    await expect(new LocalOCR().initialize(()=>{})).rejects.toThrow('200');expect(factory).not.toHaveBeenCalled();
  });
  it('cancels pending resource requests without starting a worker',async()=>{
    vi.mocked(fetch).mockImplementation(()=>new Promise(()=>{}));const engine=new LocalOCR(),job=engine.initialize(()=>{});
    const rejected=expect(job).rejects.toThrow('已取消');await engine.cancel();await rejected;
    expect((vi.mocked(fetch).mock.calls[0][1]!.signal as AbortSignal).aborted).toBe(true);expect(factory).not.toHaveBeenCalled();
  });
  it('cleans up a worker that finishes initialization after cancellation',async()=>{
    let ready!:(worker:Worker)=>void;const worker=makeWorker();factory.mockImplementation(()=>new Promise(resolve=>ready=resolve));
    const engine=new LocalOCR(),job=engine.initialize(()=>{});await vi.waitFor(()=>expect(factory).toHaveBeenCalledOnce());
    const rejected=expect(job).rejects.toThrow('已取消');await engine.cancel();await rejected;ready(worker);
    await vi.waitFor(()=>expect(worker.terminate).toHaveBeenCalledOnce());expect(worker.setParameters).not.toHaveBeenCalled();
  });
  it('propagates initialization errors that the worker factory leaves pending',async()=>{
    factory.mockImplementation(()=>new Promise(()=>{}));const engine=new LocalOCR(),job=engine.initialize(()=>{});
    await vi.waitFor(()=>expect(factory).toHaveBeenCalledOnce());const rejected=expect(job).rejects.toThrow('language initialization failed');
    factory.mock.calls[0][2]!.errorHandler!('language initialization failed');await rejected;await engine.close();
  });
  it('times out an unresponsive initialized worker and terminates it',async()=>{
    vi.useFakeTimers();const worker=makeWorker();vi.mocked(worker.setParameters).mockImplementation(()=>new Promise(()=>{}));factory.mockResolvedValue(worker);
    const engine=new LocalOCR(),job=engine.initialize(()=>{});await vi.waitFor(()=>expect(worker.setParameters).toHaveBeenCalledOnce());
    const rejected=expect(job).rejects.toThrow('响应超时');await vi.advanceTimersByTimeAsync(60000);await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();await engine.close();expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('allows a fresh OCR engine to succeed after a failed attempt',async()=>{
    vi.mocked(fetch).mockResolvedValueOnce({ok:false,status:503,headers:new Headers()} as Response);
    const failed=new LocalOCR();await expect(failed.initialize(()=>{})).rejects.toThrow('503');await failed.close();
    const worker=makeWorker();factory.mockResolvedValue(worker);const retry=new LocalOCR();await retry.initialize(()=>{});
    expect(worker.setParameters).toHaveBeenCalledOnce();await retry.close();expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('does not dispatch a late image conversion after cancellation',async()=>{
    let finish!:(blob:Blob)=>void;
    const context={drawImage:vi.fn(),getImageData:()=>({data:new Uint8ClampedArray(100*10*4)}),putImageData:vi.fn()};
    vi.stubGlobal('document',{createElement:()=>({getContext:()=>context,toBlob:(callback:(blob:Blob)=>void)=>{finish=callback;}})});
    const worker=makeWorker();factory.mockResolvedValue(worker);const engine=new LocalOCR();await engine.initialize(()=>{});
    const job=engine.recognize({width:100} as ImageBitmap,{top:0,bottom:10,partial:false});
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));const rejected=expect(job).rejects.toThrow('已取消');
    await engine.cancel();await rejected;finish(new Blob(['late canvas']));await Promise.resolve();
    expect(worker.recognize).not.toHaveBeenCalled();expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
