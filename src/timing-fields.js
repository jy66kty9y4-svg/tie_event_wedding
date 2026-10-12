export const TIMING_STAFF_COLUMN = {id:'timing_assigned_users',name:'Сотрудники',type:'users'};
const STANDARD_FIELDS = {
 title:['title','text'],startTime:['time','time'],endTime:['end','time'],
 dayOffset:['timing_day_offset','number'],endDayOffset:['timing_end_day_offset','number'],
 required:['timing_required','boolean'],assignedUserIds:[TIMING_STAFF_COLUMN.id,'users']
};

// Saved custom mappings remain authoritative. Standard fields use stable IDs,
// so changing a visible column label cannot disconnect the calendar.
export function timingFields(table) {
 const data=table?.data;if(data?.key!=='timing')return {};
 if(data.semanticMap!=null)return data.semanticMap;
 const map=Object.fromEntries(Object.entries(STANDARD_FIELDS).filter(([, [id,type]])=>data.columns?.some(c=>c.id===id&&c.type===type)).map(([key,[id]])=>[key,id]));
 if(data.automaticTimingStaffId&&data.columns?.some(c=>c.id===data.automaticTimingStaffId&&c.type==='users'))map.assignedUserIds=data.automaticTimingStaffId;
 return map.title&&map.startTime?map:{};
}

export function needsTimingStaff(table) {
 const map=timingFields(table);
 return table?.data.semanticMap==null&&!!map.title&&!!map.startTime&&!map.assignedUserIds&&(table.data.columns?.length||0)<80;
}

export function withTimingStaff(data) {
 if(!needsTimingStaff({data}))return data;
 let id=TIMING_STAFF_COLUMN.id,n=2;while(data.columns.some(c=>c.id===id))id=`${TIMING_STAFF_COLUMN.id}_${n++}`;
 return {...data,columns:[...data.columns,{...TIMING_STAFF_COLUMN,id}],...(id!==TIMING_STAFF_COLUMN.id?{automaticTimingStaffId:id}:{})};
}
