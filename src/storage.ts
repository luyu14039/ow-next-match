import { initialData, upgradeConfiguration, type AppData } from './domain';
const DB_NAME = 'ow-next-match';
export async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{ request.result.createObjectStore('state'); request.result.createObjectStore('images'); };
    request.onerror=()=>reject(new Error('无法打开本地存储，请允许站点使用浏览器存储。'));
    request.onblocked=()=>reject(new Error('另一窗口正在更新数据库，请关闭旧窗口后重试。'));
    request.onsuccess=()=>{ request.result.onversionchange=()=>request.result.close(); resolve(request.result); };
  });
}
export async function loadData(db:IDBDatabase):Promise<AppData> {
  for(let attempt=0;attempt<3;attempt++){
    const data=await new Promise<AppData>((resolve,reject)=>{
      const request=db.transaction('state').objectStore('state').get('app');
      request.onsuccess=()=>resolve(request.result || initialData()); request.onerror=()=>reject(request.error);
    });
    const upgraded=upgradeConfiguration(data);
    if(!upgraded)return data;
    try{await saveData(db,upgraded,data.revision);return upgraded;}
    catch(error){if(attempt===2)throw error;}
  }
  throw new Error('配置升级失败，请刷新后重试。');
}
export async function saveData(db:IDBDatabase,data:AppData, expectedRevision:number, blobs:Map<string,Blob>=new Map()):Promise<void> {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['state','images'],'readwrite'), store=tx.objectStore('state');
    let failure:unknown=null;
    tx.oncomplete=()=>resolve();
    tx.onabort=()=>reject(failure || new Error(tx.error?.name==='QuotaExceededError'?'浏览器空间不足。请取消保留原图或先导出备份。':'本地保存失败，原记录没有改变。'));
    tx.onerror=()=>{};
    const get=store.get('app');
    get.onsuccess=()=>{
      if((get.result?.revision ?? 0)!==expectedRevision) { failure=new Error('另一窗口修改了记录。请刷新后重试，当前草稿可先复制。'); tx.abort(); return; }
      try { store.put(data,'app'); for(const [id,blob] of blobs) tx.objectStore('images').put(blob,id); }
      catch(error) { failure=error; tx.abort(); }
    };
  });
}
export function readImage(db:IDBDatabase,id:string):Promise<Blob|undefined> {
  return new Promise((resolve,reject)=>{const request=db.transaction('images').objectStore('images').get(id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
