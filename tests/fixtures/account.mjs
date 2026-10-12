import { register } from '../../server/service.mjs';

let sequence = 0;
// Existing domain scenarios use accounts from before administrator-led onboarding.
// Signup/onboarding tests call the real register function without this fixture.
export function registerTestUser(db, body, ...args) {
  const phone = `+7999${String(++sequence).padStart(7, '0')}`;
  const result = register(db, { phone, ...body }, ...args);
  markLegacyAccount(db, result.user.id);
  return result;
}

export function markLegacyAccount(db, userId) {
  const entry=db.prepare("SELECT id FROM entities WHERE kind='accountOnboarding' AND json_extract(data,'$.userId')=?").get(userId);
  if(entry){
    const notifications=db.prepare("SELECT id FROM entities WHERE kind='notification' AND json_extract(data,'$.sourceId')=?").all(entry.id);
    for(const notification of notifications){db.prepare('DELETE FROM audit WHERE entity_id=?').run(notification.id);db.prepare('DELETE FROM entities WHERE id=?').run(notification.id);}
    db.prepare('DELETE FROM notification_outbox WHERE source_id=?').run(entry.id);
    db.prepare('DELETE FROM audit WHERE entity_id=?').run(entry.id);db.prepare('DELETE FROM entities WHERE id=?').run(entry.id);
  }
}
