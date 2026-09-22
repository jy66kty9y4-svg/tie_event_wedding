const shift=(day,amount)=>{const value=new Date(`${day}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+amount);return value.toISOString().slice(0,10)};
export function calendarGrid(day,view='month'){
  const fallback='1970-01-01';
  const value=/^\d{4}-\d{2}-\d{2}$/.test(day||'')&&!Number.isNaN(Date.parse(`${day}T12:00:00Z`))?day:fallback;
  const weekday=(new Date(`${value}T12:00:00Z`).getUTCDay()+6)%7;
  const first=view==='month'?`${value.slice(0,8)}01`:value;
  const start=shift(first,-((new Date(`${first}T12:00:00Z`).getUTCDay()+6)%7));
  return {start,days:Array.from({length:view==='month'?42:7},(_,index)=>shift(start,index))};
}
