import { operations as calendarOperations, queueChanges } from './calendar/index.mjs';
import { readinessOperations } from './calendar/readiness.mjs';
const raw={...calendarOperations,...readinessOperations};
export const operations=Object.fromEntries(Object.entries(raw).map(([op,descriptor])=>[op,{...descriptor,run(db,u,c){const before=db.prepare('SELECT coalesce(max(rowid),0) AS n FROM audit').get().n;const result=descriptor.run(db,u,c);queueChanges(db,u,before);return result;}}]));
export const typedKinds=new Set(['task','approval','approvalRevision','comment','meeting','seatingPlan','seatingTable','microsite','micrositeRevision','publicCase','servicePackage','faq','publicRevision','notification']);
