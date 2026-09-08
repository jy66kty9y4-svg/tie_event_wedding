export const DEFAULT_TASK_BLUEPRINTS = [
  ['brief_budget','Бриф и бюджет','start',-180], ['guest_list','Список гостей','start',-170],
  ['venue','Площадка','vendors',-160], ['concept','Концепция','style',-145],
  ['photo','Фотограф','vendors',-140], ['video','Видеограф','vendors',-140],
  ['host','Ведущий','vendors',-130], ['decor','Декор','style',-120], ['looks','Образы','style',-110],
  ['menu','Меню','vendors',-90], ['invites','Приглашения','guests',-75], ['transfer','Трансфер','logistics',-60],
  ['rsvp','Сбор ответов','guests',-45], ['seating','Рассадка','guests',-30], ['timing','Окончательный тайминг','day',-21],
  ['team_confirm','Подтверждение команды','day',-14], ['final_payments','Финальные выплаты','finance',-7], ['returns','Возврат имущества','after',2]
].map(([key,title,phaseKey,offsetDays], order) => ({ key,title,phaseKey,offsetDays,order,assigneeRole:null,dependencyKeys:[] }));
export const DEFAULT_TASK_PHASES=[{key:"start",name:"Начало"},{key:"vendors",name:"Команда"},{key:"style",name:"Концепция"},{key:"guests",name:"Гости"},{key:"logistics",name:"Логистика"},{key:"day",name:"День свадьбы"},{key:"finance",name:"Финансы"},{key:"after",name:"После свадьбы"}];
