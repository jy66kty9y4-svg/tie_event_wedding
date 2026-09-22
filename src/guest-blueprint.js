export const DEFAULT_GUEST_COLUMNS = [
  {id:'name',name:'ФИО',type:'text'},
  {id:'photo',name:'Фото',type:'file'},
  {id:'side',name:'Чей гость',type:'select',options:['Невеста','Жених','Общие']},
  {id:'relation',name:'Кем приходится',type:'text'},
  {id:'allergies',name:'Пищевые аллергии',type:'text'},
  {id:'alcohol',name:'Алкоголь',type:'text'},
  {id:'contact',name:'Контакт',type:'text'},
  {id:'status',name:'Приглашение',type:'select',options:['Не отправлено','Приглашён','Подтвердил','Отказ']},
  {id:'meal',name:'Пожелания по питанию',type:'text'}
];

export const DEFAULT_GUEST_SEMANTIC_MAP = {
  guestName:'name',
  rsvpStatus:'status',
  allergies:'allergies',
  contact:'contact',
  rsvpValues:{unanswered:'Не отправлено',tentative:'Приглашён',confirmed:'Подтвердил',declined:'Отказ'}
};

export function mergeGuestColumns(columns=[]) {
  const current=new Map(columns.map(column=>[column.id,column]));
  const defaults=DEFAULT_GUEST_COLUMNS.map(column=>({...column,...current.get(column.id),name:column.name,options:column.options||current.get(column.id)?.options}));
  return [...defaults,...columns.filter(column=>!DEFAULT_GUEST_COLUMNS.some(item=>item.id===column.id))];
}
