import { replay } from './models';
self.onmessage = event => {
  const { records, parameters } = event.data;
  try { self.postMessage({result:replay(records,parameters)}); }
  catch(error) { self.postMessage({error:error instanceof Error?error.message:'计算失败'}); }
};
