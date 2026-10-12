// Stable stage IDs keep organizer notes independent of renamed wedding tables.
export const WEDDING_STAGES = [
  ['venue','Площадка','🏠'],['host','Ведущий','🎤'],['photo','Фотограф','📷'],
  ['video','Видеограф','🎥'],['decor','Декор','🌸'],['sound','Звук','🎵'],
  ['cake','Торт','🍰'],['invitations','Приглашения','💌'],
  ['brief','Наш бриф','📝'],['questionnaire','Анкета','📄'],
  ['light','Свет','💡'],['stylist','Стилист','💄'],['effects','Спецэффекты','✨'],
  ['band','Кавер-группа','🎸'],['transfer','Трансфер','🚐'],['alcohol','Алкоголь','🍷'],
  ['menu','Меню','🍽️'],['registry','ЗАГС','💍']
].map(([id,name,emoji])=>({id,name,emoji}));
// Retired stages may remain in saved JSON, but do not render or affect readiness.
export const STAGE_STATUSES = {open:'Не начато',done:'Закрыто',problem:'Есть проблема'};
export function weddingStage(control,id) {
  return {status:'open',comment:'',notRequired:false,...control?.stages?.[id]};
}
export function weddingProgress(control) {
  const stages=WEDDING_STAGES.map(stage=>weddingStage(control,stage.id));
  const required=stages.filter(stage=>!stage.notRequired);
  const done=required.filter(stage=>stage.status==='done').length;
  return {done,total:required.length,problems:required.filter(stage=>stage.status==='problem').length,
    percent:required.length?Math.round(done/required.length*100):0};
}
