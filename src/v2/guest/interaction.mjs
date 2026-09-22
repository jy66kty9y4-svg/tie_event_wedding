import { clampPosition, rotatedExtents } from './geometry.mjs';

export const snakeQuarterPoints=[{x:0,y:1},{x:.38,y:.92},{x:.71,y:.71},{x:.92,y:.38},{x:1,y:0},{x:.65,y:0},{x:.6,y:.25},{x:.46,y:.46},{x:.25,y:.6},{x:0,y:.65}];
export const tableShapes={round150:'Круглый · 150 см',round:'Круглый · 180 см',rect:'Прямоугольный · 180 × 90 см',snakeQuarter:'Змейка · ¼ круга',custom:'Своя форма'};
export function tableFromPreset(preset,base={}) {
  const specs={round150:{shape:'round150',widthM:1.5,heightM:1.5},round:{shape:'round',widthM:1.8,heightM:1.8},rect:{shape:'rect',widthM:1.8,heightM:.9},snakeQuarter:{shape:'snakeQuarter',widthM:2.4,heightM:2.4,points:snakeQuarterPoints}};
  const spec=specs[preset];if(!spec)return {...base,shape:base.shape||'custom',preset:preset==='custom'?'custom':base.preset};
  return {...base,...spec,preset,...(spec.points?{points:spec.points.map(point=>({...point}))}:{points:undefined})};
}
export function tablePresetKey(data={}) {
  if(data.preset&&tableShapes[data.preset])return data.preset;
  if(data.shape==='round'&&Number(data.widthM)===1.5&&Number(data.heightM)===1.5)return'round150';
  if(data.shape==='round')return'round';
  if(data.shape==='rect')return'rect';
  return data.shape==='custom'?'custom':'rect';
}
export function nextTableNumber(tables,prefix='Стол') {
  return tables.reduce((max,t)=>{const label=(t.data||t).label||'',suffix=label.startsWith(prefix+' ')?label.slice(prefix.length+1):'';return /^\d+$/.test(suffix)?Math.max(max,Number(suffix)):max},0)+1;
}
export function batchTables(tables,zones,plan,options) {
  const used=new Set(tables.map(t=>(t.data||t).label)),placed=[...tables.map(t=>t.data||t),...zones],result=[];
  const prefix=options.prefix.trim()||'Стол';let number=Math.max(1,Math.trunc(Number(options.startNumber)||1));
  const count=Math.max(1,Math.min(20,Math.trunc(Number(options.count)||1)));
  const preset=tableFromPreset(options.shape,{shape:options.shape,widthM:options.shape==='rect'?2:1.6,heightM:options.shape==='rect'?1:1.6});
  for(let i=0;i<count;i++) {
    while(used.has(`${prefix} ${number}`))number++;
    const d={...preset,label:`${prefix} ${number++}`,capacity:Number(options.capacity),rotationDeg:0};
    let found=null;
    for(let y=.3;y+d.heightM<=plan.heightM-.1&&!found;y+=.25)for(let x=.3;x+d.widthM<=plan.widthM-.1;x+=.25){
      const overlaps=placed.some(p=>{const e=rotatedExtents(p),left=p.xM+(p.widthM-e.width)/2,top=p.yM+(p.heightM-e.height)/2;return x<left+e.width+.25&&x+d.widthM+.25>left&&y<top+e.height+.25&&y+d.heightM+.25>top});
      if(!overlaps){found={xM:+x.toFixed(4),yM:+y.toFixed(4)};break;}
    }
    if(!found)throw new Error(`Для ${count} новых столов не хватает свободного места. Уменьшите количество или увеличьте зал в параметрах плана.`);
    const item={...d,...found};result.push(item);placed.push(item);used.add(item.label);
  }
  return result;
}

export function pointOnPlan(clientX,clientY,rect,plan) {
  return {x:(clientX-rect.left)/rect.width*plan.widthM,y:(clientY-rect.top)/rect.height*plan.heightM};
}
export function dragPosition(session,clientX,clientY,rect,plan) {
  const point=pointOnPlan(clientX,clientY,rect,plan);
  const pos=clampPosition(session.data,plan,session.data.xM+point.x-session.startPoint.x,session.data.yM+point.y-session.startPoint.y);
  return {xM:pos.x,yM:pos.y};
}
export function drawnTable(points,label,capacity) {
  const xM=Math.min(...points.map(p=>p.x)),yM=Math.min(...points.map(p=>p.y));
  const widthM=Math.max(...points.map(p=>p.x))-xM,heightM=Math.max(...points.map(p=>p.y))-yM;
  if(points.length<3||widthM<.4||heightM<.4)throw new Error('Наметьте минимум три угла. Ширина и высота стола должны быть не меньше 40 см.');
  return {label,capacity:Number(capacity),shape:'custom',xM,yM,widthM,heightM,rotationDeg:0,points:points.map(p=>({x:(p.x-xM)/widthM,y:(p.y-yM)/heightM}))};
}

export function removeContourPoint(drawing) {
 if(!drawing||drawing.selected==null)return drawing;
 const points=drawing.points.filter((_,index)=>index!==drawing.selected);
 return {...drawing,points,selected:null,closed:drawing.closed&&points.length>=3};
}

export function outlineOnPlan(data) {
 const angle=(Number(data.rotationDeg)||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
 return (data.points||[]).map(p=>{
  const x=(p.x-.5)*data.widthM,y=(p.y-.5)*data.heightM;
  return {x:data.xM+data.widthM/2+x*c-y*s,y:data.yM+data.heightM/2+x*s+y*c};
 });
}

export function geometryDraft(saved,draft,strict=false) {
 const next={...saved,...draft};
 for(const key of ['xM','yM','widthM','heightM','rotationDeg','capacity']){
  if(!(key in next))continue;
  const value=next[key],number=Number(value);
  if(String(value).trim()===''||!Number.isFinite(number)||(['widthM','heightM'].includes(key)&&number<=0)){
   if(strict)throw new Error('Заполните числовые поля. Размеры должны быть больше нуля.');
   next[key]=saved[key];
  }else next[key]=number;
 }
 return next;
}
