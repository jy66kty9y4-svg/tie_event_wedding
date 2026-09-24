const fallbackTimeZone='Europe/Moscow';
const weddingDatePattern=/^\d{4}-\d{2}-\d{2}$/;

export function localDate(now, timeZone=fallbackTimeZone) {
  let formatter;
  try {
    formatter=new Intl.DateTimeFormat('en-US',{timeZone:timeZone||fallbackTimeZone,year:'numeric',month:'2-digit',day:'2-digit'});
  } catch {
    formatter=new Intl.DateTimeFormat('en-US',{timeZone:fallbackTimeZone,year:'numeric',month:'2-digit',day:'2-digit'});
  }
  const parts=Object.fromEntries(formatter.formatToParts(now).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isPastWedding(project, now=new Date()) {
  const {date,timeZone}=project?.data||project||{};
  return typeof date==='string'&&weddingDatePattern.test(date)&&date<localDate(now,timeZone);
}
