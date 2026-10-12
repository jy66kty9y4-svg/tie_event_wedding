export const budgetFontSizes=[12,14,16,18,20,24,28];
const properties=new Set(['bold','italic','fontSize','color','highlight']);
const plainObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=()=>{throw new Error('Проверьте форматирование ячейки');};
function cleanStyle(value){
  if(!plainObject(value))fail();
  const result={};
  for(const[key,item]of Object.entries(value)){
    if(!properties.has(key))fail();
    if(key==='bold'||key==='italic'){if(typeof item!=='boolean')fail();}
    else if(key==='fontSize'){if(!budgetFontSizes.includes(item))fail();}
    else if(!(typeof item==='string'&&(/^#[0-9a-f]{6}$/i.test(item)||key==='highlight'&&item==='none')))fail();
    result[key]=typeof item==='string'?item.toLowerCase():item;
  }
  return result;
}
const same=(a,b)=>JSON.stringify(Object.entries(a).sort())===JSON.stringify(Object.entries(b).sort());
function rangesFrom(styles){
  const ranges=[];
  for(let from=0;from<styles.length;){let to=from+1;while(to<styles.length&&same(styles[from],styles[to]))to++;
    if(Object.keys(styles[from]).length)ranges.push({from,to,style:styles[from]});from=to;
  }
  return ranges;
}
function rangeStyles(format,length){
  const styles=Array.from({length},()=>({}));
  for(const range of format?.ranges||[])for(let i=range.from;i<range.to;i++)Object.assign(styles[i],range.style);
  return styles;
}
const compact=(style,ranges)=>Object.keys(style).length||ranges.length?{style,ranges}:null;
export function normalizeBudgetFormat(value,text='',isText=true){
  if(value==null)return null;
  if(!plainObject(value)||Object.keys(value).some(key=>!['style','ranges'].includes(key)))fail();
  const style=cleanStyle(value.style||{}),ranges=value.ranges||[];
  if(!Array.isArray(ranges)||ranges.length>500||!isText&&ranges.length)fail();
  const styles=Array.from({length:text.length},()=>({}));
  for(const range of ranges){
    if(!plainObject(range)||Object.keys(range).some(key=>!['from','to','style'].includes(key))||!Number.isInteger(range.from)||!Number.isInteger(range.to)||range.from<0||range.to<=range.from||range.to>text.length)fail();
    const mark=cleanStyle(range.style);
    for(let i=range.from;i<range.to;i++)Object.assign(styles[i],mark);
  }
  return compact(style,rangesFrom(styles));
}
export function applyBudgetFormat(format,text,from,to,patch,isText=true){
  const current=normalizeBudgetFormat(format,text,isText)||{style:{},ranges:[]};
  const all=!isText||from===to;
  if(patch===null){
    if(all||from===0&&to===text.length)return null;
    patch={bold:false,italic:false,fontSize:16,color:'#434343',highlight:'none'};
  }
  patch=cleanStyle(patch);
  const styles=rangeStyles(current,text.length);
  if(all){
    for(const mark of styles)for(const key of Object.keys(patch))delete mark[key];
    return compact({...current.style,...patch},rangesFrom(styles));
  }
  for(let i=Math.max(0,from);i<Math.min(text.length,to);i++)Object.assign(styles[i],patch);
  return compact(current.style,rangesFrom(styles));
}
export function budgetSelectionStyle(format,text,from,to){
  const styles=rangeStyles(format,text.length),values=styles.slice(from,to>from?to:from+1);
  const first={...(format?.style||{}),...(values[0]||{})};
  for(const key of Object.keys(first))if(values.some(mark=>(mark[key]??format?.style?.[key])!==first[key]))delete first[key];
  return first;
}
export function rebaseBudgetFormat(format,before,after){
  if(!format||before===after)return format;
  let from=0;while(from<before.length&&from<after.length&&before[from]===after[from])from++;
  let end=0;while(end<before.length-from&&end<after.length-from&&before[before.length-1-end]===after[after.length-1-end])end++;
  const styles=rangeStyles(format,before.length),inherited=styles[from?from-1:0]||{};
  const inserted=Array.from({length:after.length-from-end},()=>({...inherited}));
  return compact(format.style||{},rangesFrom([...styles.slice(0,from),...inserted,...(end?styles.slice(before.length-end):[])]));
}
export function trimBudgetText(text,format){
  const value=text.trim(),offset=text.length-text.trimStart().length;
  return {text:value,format:format?compact(format.style||{},rangesFrom(rangeStyles(format,text.length).slice(offset,offset+value.length))):null};
}
export function budgetFormatSegments(text,format){
  const styles=rangeStyles(format,text.length),segments=[];
  for(let from=0;from<text.length;){let to=from+1;while(to<text.length&&same(styles[from],styles[to]))to++;segments.push({text:text.slice(from,to),style:styles[from]});from=to;}
  return segments;
}
export const budgetStyle=style=>({
  ...(style?.bold!=null?{fontWeight:style.bold?700:400}:{}),
  ...(style?.italic!=null?{fontStyle:style.italic?'italic':'normal'}:{}),
  ...(style?.fontSize?{fontSize:style.fontSize+'px'}:{}),
  ...(style?.color?{color:style.color}:{}),
  ...(style?.highlight?{backgroundColor:style.highlight==='none'?'transparent':style.highlight}:{}),
});
const budgetNumberFormat=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
export const displayBudgetAmount=cents=>budgetNumberFormat.format((cents||0)/100).replaceAll('\u00a0',' ');
export function parseBudgetAmount(text){
  const value=text.replace(/[\s\u202f]/g,'');
  if(!value)return null;
  if(!/^\d+(?:[.,]\d{1,2})?$/.test(value))throw new Error('Сумма: не более двух знаков после запятой');
  const cents=Math.round(Number(value.replace(',','.'))*100);
  if(!Number.isSafeInteger(cents))throw new Error('Сумма слишком большая');
  return cents;
}
