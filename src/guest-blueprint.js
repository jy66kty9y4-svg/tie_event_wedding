export const DEFAULT_GUEST_COLUMNS = [
  {id:'name',name:'ФИО',type:'text'},
  {id:'side',name:'Чей гость',type:'select',options:['Невеста','Жених','Общие']},
  {id:'relation',name:'Кем приходится',type:'text'},
  {id:'allergies',name:'Пищевые аллергии',type:'text'},
  {id:'alcohol',name:'Алкоголь',type:'text'},
  {id:'contact',name:'Контакт',type:'text'},
  {id:'status',name:'Приглашение',type:'select',options:['Не отправлено','Приглашён','Подтвердил','Отказ']}
];

export const DEFAULT_GUEST_SEMANTIC_MAP = {
  guestName:'name',
  rsvpStatus:'status',
  allergies:'allergies',
  contact:'contact',
  rsvpValues:{unanswered:'Не отправлено',tentative:'Приглашён',confirmed:'Подтвердил',declined:'Отказ'}
};

const guestColumnBlueprints = [
  {key:'guestName', fallback:'name', name:'ФИО'},
  {fallback:'side', name:'Чей гость'},
  {fallback:'relation', name:'Кем приходится'},
  {key:'allergies', fallback:'allergies', name:'Пищевые аллергии'},
  {fallback:'alcohol', name:'Алкоголь'},
  {key:'contact', fallback:'contact', name:'Контакт'},
  {key:'rsvpStatus', fallback:'status', name:'Приглашение'}
];

export function normalizeGuestRegistry(columns=[], semanticMap={}) {
  const current=new Map(columns.map(column=>[column.id,column]));
  const defaults=new Map(DEFAULT_GUEST_COLUMNS.map(column=>[column.id,column]));
  const selected=guestColumnBlueprints.map(({key,fallback,name})=>{
    const mappedId=key&&typeof semanticMap[key]==='string'&&current.has(semanticMap[key])?semanticMap[key]:fallback;
    const column=current.get(mappedId)||defaults.get(fallback);
    return {...column,id:mappedId,name,options:column.options?[...column.options]:undefined};
  });
  const nextMap={
    guestName:selected[0].id,
    rsvpStatus:selected[6].id,
    allergies:selected[3].id,
    contact:selected[5].id,
    rsvpValues:structuredClone(semanticMap.rsvpValues||DEFAULT_GUEST_SEMANTIC_MAP.rsvpValues)
  };
  const seatingIds=['seatingTable','seatIndex'].map(key=>semanticMap[key]);
  const seatingColumns=seatingIds.every(id=>typeof id==='string'&&current.has(id))?seatingIds.map(id=>current.get(id)):[];
  if(seatingColumns.length) {
    nextMap.seatingTable=seatingIds[0];
    nextMap.seatIndex=seatingIds[1];
  }
  return {columns:[...selected,...seatingColumns],semanticMap:nextMap};
}

export function mergeGuestColumns(columns=[]) {
  const current=new Map(columns.map(column=>[column.id,column]));
  const defaults=DEFAULT_GUEST_COLUMNS.map(column=>({...column,...current.get(column.id),name:column.name,options:column.options||current.get(column.id)?.options}));
  return [...defaults,...columns.filter(column=>!DEFAULT_GUEST_COLUMNS.some(item=>item.id===column.id))];
}
