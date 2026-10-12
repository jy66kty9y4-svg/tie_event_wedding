import {venuePublicDraft} from './venue-profile.js';
export function normalizeVendorLinks(value) {
  if (!Array.isArray(value) || value.length > 20) throw new Error('Можно добавить до 20 ссылок');
  return value.map(link => {
    const url = String(link?.url || '').trim(), title = String(link?.title || '').trim(), comment = String(link?.comment || '').trim();
    let parsed; try { parsed = new URL(url); } catch { throw new Error('Введите полный адрес ссылки, начиная с https://'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || url.length > 2400) throw new Error('Разрешены только ссылки http:// или https://');
    if (title.length > 160 || comment.length > 1000) throw new Error('Название ссылки: до 160 символов, комментарий: до 1000');
    return {url, title, comment};
  });
}
export function vendorLinks(data = {}) {
  const links = Array.isArray(data.links) ? data.links : [];
  return data.portfolio && !links.some(link => link.url === data.portfolio) ? [{url:data.portfolio,title:'Портфолио',comment:''}, ...links] : links;
}
const fold = value => String(value || '').toLocaleLowerCase('ru').replace(/ё/g,'е').trim();
const digits = value => String(value || '').replace(/\D/g,'');
const phoneKey = value => { const n = digits(value); return n.length === 11 && n[0] === '8' ? '7' + n.slice(1) : n; };
export function vendorMatchesQuery(vendor, query) {
  const data = vendor.data || vendor, q = fold(query);
  if (!q) return true;
  const text = fold([data.name, data.title, data.contact, data.phone, data.email, data.services, data.terms, data.notes, data.categoryName, data.portfolio, data.venue?.address,data.venue?.type, ...vendorLinks(data).flatMap(link=>[link.title,link.url,link.comment])].filter(Boolean).join(' '));
  if (q.split(/\s+/).every(part=>text.includes(part))) return true;
  const number = phoneKey(q);
  return number.length >= 4 && !/[a-zа-я]/i.test(q) && [data.contact,data.phone].filter(Boolean).some(value => [value,...(String(value).match(/\+?\d[\d\s().-]{6,}\d/g)||[])].some(phone=>phoneKey(phone).includes(number)));
}
export function vendorDraftFromCatalog(vendor) {
  const d = vendor.data || vendor;
  return {vendorId:vendor.id,name:d.name||d.title||'',contact:d.contact||'',services:d.services||'',terms:d.terms||'',price:d.price??null,categoryId:d.categoryId||'',portfolio:d.portfolio||'',links:vendorLinks(d),photoId:d.photoId||null,...venuePublicDraft(vendor)};
}
export function vendorPhotoUrl(photoId, entityId) {
  return photoId ? `/api/vendor-photos/${encodeURIComponent(photoId)}${entityId?'?entityId='+encodeURIComponent(entityId):''}` : '';
}
