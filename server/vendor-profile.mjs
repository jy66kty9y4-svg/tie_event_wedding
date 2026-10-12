import {assert,Fault,uid} from './db.mjs';
import {requireAccess,canHoldFunds} from './auth.mjs';
import {getScoped,projectVisible} from './model.mjs';
import {currentUser} from './v2/common.mjs';
import {sanitizeRaster} from './v2/publishing/index.mjs';
import {venuePhotoIds,normalizeVenuePhotos} from '../src/venue-profile.js';
const marker='vendor-photo';
function uploadAccess(db,user,{projectId=null,entityId=null,field='photoId'}) {
  assert(['photoId','photoIds'].includes(field),'Проверьте поле фотографии');
  const u=currentUser(db,user), row=entityId?getScoped(db,u,entityId,projectId,projectId?'selection':'vendor'):null;
  assert(!row?.deleted,'Подрядчик удалён',409);
  if(projectId) assert(projectVisible(db,u,projectId)&&canHoldFunds(db,u,projectId),'Нет права изменять карточку подрядчика',403);
  requireAccess(db,u,[row?'edit':'create',...(!projectId?['catalog']:[])],projectId,projectId?'vendors':'vendor',row?.id||null,[field]);
  return u;
}
export async function uploadVendorPhoto(db,user,input) {
  uploadAccess(db,user,input);
  assert(Buffer.isBuffer(input.content)&&input.content.length<=5*1024*1024,'Фото должно быть не больше 5 МБ',413);
  let image;
  try { image=await sanitizeRaster(input.content,{maxDimension:1600}); }
  catch(error) { if(error instanceof Fault)throw error;throw new Fault('Не удалось прочитать фото. Выберите JPEG, PNG, WebP или AVIF.',400); }
  const u=uploadAccess(db,user,input),id=uid();
  db.prepare("INSERT INTO published_assets(id,agency_id,project_id,owner_id,revision_id,mime,width,height,content,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,datetime('now'))").run(id,u.agency_id,input.projectId||null,u.id,marker,image.mime,image.width,image.height,image.content);
  return {id,mime:image.mime,width:image.width,height:image.height};
}
export function validateVendorPhoto(db,u,id,p,current,source,field='photoId') {
  if(id===null||id===undefined||id==='') return null;
  assert(typeof id==='string','Проверьте фотографию');
  const asset=db.prepare('SELECT * FROM published_assets WHERE id=? AND agency_id=? AND revision_id=? AND active=0').get(id,u.agency_id,marker);
  assert(asset,'Фото не найдено',404);
  const retained=current?.data.photoId===id||venuePhotoIds(current?.data).includes(id);
  const inherited=source?.data.photoId===id||venuePhotoIds(source?.data).includes(id);
  assert(retained || (asset.owner_id===u.id&&asset.project_id===(p||null)) || inherited,'Фото принадлежит другой карточке',403);
  if(inherited&&!retained) requireAccess(db,u,['read','catalog'],null,'vendor',source.id,[id===source.data.photoId?'photoId':'photoIds']);
  return id;
}
export function validateVendorGallery(db,u,ids,p,current,source) {
  let normalized;try{normalized=normalizeVenuePhotos(ids)}catch(error){throw new Fault(error.message,400)}
  return normalized.map(id=>validateVendorPhoto(db,u,id,p,current,source,'photoIds'));
}
export function getVendorPhoto(db,user,id,recordId) {
  const u=currentUser(db,user),asset=db.prepare('SELECT * FROM published_assets WHERE id=? AND agency_id=? AND revision_id=? AND active=0').get(id,u.agency_id,marker);
  assert(asset,'Фото не найдено',404);
  if(recordId) {
    const row=getScoped(db,u,recordId,undefined);
    assert(['vendor','selection'].includes(row.kind)&&!row.deleted&&(row.data.photoId===id||venuePhotoIds(row.data).includes(id)),'Фото не найдено',404);
    if(row.project_id) assert(projectVisible(db,u,row.project_id),'Нет доступа к свадьбе',403);
    const field=row.data.photoId===id?'photoId':'photoIds';
    if(field==='photoId'&&row.data.photoIds?.includes(id)){
      try{requireAccess(db,u,['read',...(!row.project_id?['catalog']:[])],row.project_id,row.project_id?'vendors':'vendor',row.id,['photoId'])}
      catch(error){if(error.status!==403)throw error;requireAccess(db,u,['read',...(!row.project_id?['catalog']:[])],row.project_id,row.project_id?'vendors':'vendor',row.id,['photoIds'])}
    }else requireAccess(db,u,['read',...(!row.project_id?['catalog']:[])],row.project_id,row.project_id?'vendors':'vendor',row.id,[field]);
  } else {
    assert(asset.owner_id===u.id,'Фото не найдено',404);
    if(asset.project_id) assert(canHoldFunds(db,u,asset.project_id),'Нет доступа к фото',403);
    try{requireAccess(db,u,['read',...(!asset.project_id?['catalog']:[])],asset.project_id,asset.project_id?'vendors':'vendor',null,['photoId'])}
    catch(error){if(error.status!==403)throw error;requireAccess(db,u,['read',...(!asset.project_id?['catalog']:[])],asset.project_id,asset.project_id?'vendors':'vendor',null,['photoIds'])}
  }
  return asset;
}
