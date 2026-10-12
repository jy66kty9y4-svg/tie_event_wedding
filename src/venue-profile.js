export const VENUE_DAYS = [['mon','Пн'],['tue','Вт'],['wed','Ср'],['thu','Чт'],['fri','Пт'],['sat','Сб'],['sun','Вс']];
export const MAX_VENUE_PHOTOS = 16;
const fail = message => { throw new Error(message); };
const text = (value, limit=8000) => {
  if (value != null && typeof value !== 'string') fail('Проверьте текст условий площадки');
  const result=(value||'').trim();
  if(result.length>limit) fail(`Текст площадки: не более ${limit} символов`);
  return result;
};
const amount = value => {
  if(value==null || value==='') return null;
  if(!Number.isSafeInteger(value)||value<0||value>1e12) fail('Стоимость площадки должна быть неотрицательной суммой');
  return value;
};
export function normalizeVenue(value) {
  if(value==null) return null;
  if(typeof value!=='object'||Array.isArray(value)) fail('Проверьте условия площадки');
  const v=value, result={};
  for(const key of ['address','type','website','mapUrl'])result[key]=text(v[key],key.endsWith('Url')||key==='website'?2400:1000);
  for(const key of ['depositTerms','serviceTerms','accommodation','included','details'])result[key]=text(v[key],key==='details'?30000:8000);
  for(const key of ['website','mapUrl'])if(result[key]){
    let url;try{url=new URL(result[key])}catch{fail('Ссылка площадки должна начинаться с https://')}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)fail('Разрешены только ссылки http:// или https://');
  }
  result.capacity=v.capacity==null||v.capacity===''?null:v.capacity;
  if(result.capacity!=null&&(!Number.isInteger(result.capacity)||result.capacity<1||result.capacity>100000))fail('Проверьте вместимость площадки');
  result.rentMode=v.rentMode||'range';
  if(!['range','days'].includes(result.rentMode))fail('Выберите способ указания аренды');
  for(const key of ['rentMin','rentMax','rentOverride','menuFrom','deposit','extraFrom'])result[key]=amount(v[key]);
  if(result.rentMin!=null&&result.rentMax!=null&&result.rentMin>result.rentMax)fail('Минимальная аренда не может быть больше максимальной');
  if(v.rentDays!=null&&(typeof v.rentDays!=='object'||Array.isArray(v.rentDays)))fail('Проверьте тарифы по дням недели');
  result.rentDays=Object.fromEntries(VENUE_DAYS.map(([key])=>[key,amount(v.rentDays?.[key])]));
  result.servicePercent=v.servicePercent==null||v.servicePercent===''?null:v.servicePercent;
  if(result.servicePercent!=null&&(!Number.isFinite(result.servicePercent)||result.servicePercent<0||result.servicePercent>100))fail('Сервисный сбор: от 0 до 100%');
  result.depositKind=v.depositKind||'unknown';
  if(!['unknown','minimum','separate','included'].includes(result.depositKind))fail('Укажите условия депозита');
  if(v.extras!=null&&(!Array.isArray(v.extras)||v.extras.length>40))fail('Можно добавить до 40 дополнительных расходов');
  result.extras=(v.extras||[]).map(item=>{
    if(!item||typeof item!=='object')fail('Проверьте дополнительный расход');
    const label=text(item.label,240);if(!label)fail('Укажите название дополнительного расхода');
    const unit=item.unit||'fixed';if(!['fixed','guest'].includes(unit))fail('Проверьте единицу дополнительного расхода');
    if(item.required!==undefined&&typeof item.required!=='boolean')fail('Проверьте обязательность дополнительного расхода');
    return {label,amount:amount(item.amount),unit,required:item.required!==false,note:text(item.note,2000)};
  });
  const required=result.extras.filter(item=>item.required),fixed=required.filter(item=>item.unit==='fixed').reduce((sum,item)=>sum+(item.amount||0),0);
  if(result.extraFrom!=null&&(result.extraFrom<fixed||(result.extraFrom===0&&required.some(item=>item.amount==null||item.amount>0))))fail('Сводная сумма доплат меньше обязательных расходов. Уточните суммы или условия.');
  return result;
}
export function venuePhotoIds(data={}) {
  return [...new Set(Array.isArray(data.photoIds)?data.photoIds:data.photoId?[data.photoId]:[])];
}
export function normalizeVenuePhotos(value) {
  if(!Array.isArray(value)||value.length>MAX_VENUE_PHOTOS||value.some(id=>typeof id!=='string'||!id||id.length>120)||new Set(value).size!==value.length)fail(`Добавьте не более ${MAX_VENUE_PHOTOS} разных фотографий`);
  return [...value];
}
export const venueMoney = value => value==null?'Нужно уточнить':`${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(value/100)} ₽`;
export function venueRent(data={},date='') {
  const v=data.venue||{};
  if(v.rentOverride!=null)return {min:v.rentOverride,max:v.rentOverride,source:'override'};
  if(v.rentMode==='days'){
    if(/^\d{4}-\d{2}-\d{2}$/.test(date)){
      const day=new Date(`${date}T12:00:00Z`).getUTCDay(),key=VENUE_DAYS[(day+6)%7]?.[0],value=v.rentDays?.[key];
      return {min:value??null,max:value??null,source:'date'};
    }
    const values=VENUE_DAYS.map(([key])=>v.rentDays?.[key]).filter(n=>n!=null);
    return {min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null,source:'days',partial:values.length>0&&values.length<7};
  }
  return {min:v.rentMin??null,max:v.rentMax??null,source:'range'};
}
export function venueRentLabel(data,date) {
  const {min,max}=venueRent(data,date);
  if(min==null&&max==null)return 'Нужно уточнить';
  if(min==null)return `до ${venueMoney(max)}`;
  if(max==null)return `от ${venueMoney(min)}`;
  if(min===max)return venueMoney(min);
  return `${venueMoney(min).replace(' ₽','')}–${venueMoney(max)}`;
}
export function venueExtraLabel(data={}) {
  const v=data.venue||{};
  if(v.extraFrom!=null)return v.extraFrom===0?'Включены':`от ${venueMoney(v.extraFrom)}`;
  const required=(v.extras||[]).filter(item=>item.required);
  if(!required.length||required.some(item=>item.amount==null))return 'Нужно уточнить';
  if(required.some(item=>item.unit==='guest'))return 'Зависит от гостей';
  const sum=required.reduce((s,item)=>s+item.amount,0);
  return sum===0?'Включены':`от ${venueMoney(sum)}`;
}
export function venueMapUrl(data={}) {
  const v=data.venue||{};
  return v.mapUrl||(v.address?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.address)}`:'');
}
export function venuePublicDraft(vendor) {
  const d=vendor.data||vendor;
  return {...(d.venue!==undefined?{venue:structuredClone(d.venue)}:{}),...(d.photoIds!==undefined?{photoIds:[...d.photoIds]}:{})};
}
