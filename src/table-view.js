export function tableDevice({coarse=false,width=0,height=0}) {
  return !coarse?'desktop':Math.min(width,height)<=767?'phone':'tablet';
}
export function tableViewKeys(scope,device) {
  const base=`tie:table-view:v1:${scope}:${device}`;
  return {scale:`${base}:scale`,columns:`${base}:columns`};
}
export function localColumnWidths(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  return Object.fromEntries(Object.entries(value).filter(([id,width])=>id.length<=100&&typeof width==='number'&&Number.isFinite(width)&&width>=80&&width<=800));
}
const scaleValue=(value,min=.1)=>value!=null&&Number(value)>0&&Number.isFinite(Number(value))?Math.max(min,Math.min(2.5,Number(value))):null;
export function readTableView(storage,keys) {
  let scale=null,columns={};
  try {
    scale=scaleValue(storage.getItem(keys.scale),keys.minScale);
    if(keys.migrated&&!storage.getItem(keys.migrated)) {
      if(scale==null){scale=scaleValue(storage.getItem(keys.legacy),keys.minScale);if(scale!=null)storage.setItem(keys.scale,String(scale));}
      storage.setItem(keys.migrated,'1');
    }
    columns=localColumnWidths(JSON.parse(storage.getItem(keys.columns)||'{}'));
  } catch {}
  return {scale,columns};
}
export const numericColumn=column=>['money','number','formula'].includes(column.type);
export function tableColumnWidth(column,device,shared={},local={},measured={}) {
  const compact={money:110,number:96,formula:110,boolean:80,date:145,time:110,datetime:185,select:140,users:160,relation:160,file:170,url:220,text:200};
  const baseline=column.viewWidth||compact[column.type]||160;
  return local[column.id]||(device==='phone'?Math.max(baseline,measured[column.id]||0):shared[column.id]||column.desktopWidth||(['text','url'].includes(column.type)?240:180));
}
