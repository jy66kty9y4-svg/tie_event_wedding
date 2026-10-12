import {useTableScope,useTableView} from './useTableView.js';
import {SheetZoom} from './SheetZoom.jsx';
import {useEffect,useRef,useState} from 'react';
import {Modal} from './Modal.jsx';
import {VendorLinks} from './VendorProfile.jsx';
import {vendorDraftFromCatalog,vendorMatchesQuery,vendorPhotoUrl} from '../vendor-profile.js';
import {isVenueSelection} from '../vendor-category-tabs.mjs';
import {VENUE_DAYS,venuePhotoIds,venueMoney,venueRent,venueRentLabel,venueExtraLabel,venueMapUrl} from '../venue-profile.js';
import './venue.css';

export function VenueGallery({data,entityId,large=false,sources={},controls=true}){
  const ids=venuePhotoIds(data),[index,setIndex]=useState(0),[failed,setFailed]=useState(false),start=useRef(null);
  const position=Math.min(index,Math.max(0,ids.length-1)),id=ids[position];
  useEffect(()=>{setIndex(0)},[data.photoId,entityId]);
  useEffect(()=>setFailed(false),[id,entityId]);
  const move=delta=>setIndex((position+delta+ids.length)%ids.length);
  const source=Object.hasOwn(sources,id)?sources[id]:entityId;
  return <div className={`venue-gallery ${large?'is-large':''}`}>
    <div className="venue-photo" onTouchStart={e=>{if(!controls)return;const t=e.touches[0];start.current={x:t.clientX,y:t.clientY}}} onTouchEnd={e=>{const t=e.changedTouches[0],s=start.current;start.current=null;if(controls&&s&&ids.length>1&&Math.abs(t.clientX-s.x)>45&&Math.abs(t.clientX-s.x)>Math.abs(t.clientY-s.y))move(t.clientX<s.x?1:-1)}}>
      {id&&!failed?<img src={vendorPhotoUrl(id,source)} alt={`${data.title||data.name||'Площадка'} — фото ${position+1}`} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>:<div className="venue-photo-empty">{failed?'Фото недоступно':'Добавьте фотографии площадки'}</div>}
      {controls&&ids.length>1&&<><button type="button" className="venue-photo-arrow previous" aria-label="Предыдущее фото" onClick={()=>move(-1)}>‹</button><button type="button" className="venue-photo-arrow next" aria-label="Следующее фото" onClick={()=>move(1)}>›</button><div className="venue-photo-dots" aria-label="Фотографии площадки">{ids.map((photo,i)=><button type="button" key={photo} aria-label={`Фото ${i+1}`} aria-pressed={i===position} onClick={()=>setIndex(i)}/>)}</div><span className="sr-only" aria-live="polite">Фото {position+1} из {ids.length}</span></>}
    </div>
    {large&&ids.length>1&&<div className="venue-thumbnails">{ids.map((photo,i)=><button type="button" className={i===position?'active':''} key={photo} aria-label={`Открыть фото ${i+1}`} aria-pressed={i===position} onClick={()=>setIndex(i)}><img src={vendorPhotoUrl(photo,Object.hasOwn(sources,photo)?sources[photo]:entityId)} alt="" loading="lazy"/></button>)}</div>}
  </div>;
}
function VenueAddress({data}){const url=venueMapUrl(data);return <div className="venue-address">{url?<a href={url} target="_blank" rel="noreferrer"><span aria-hidden="true">⌖</span> {data.venue?.address||'На карте'} ↗</a>:<span>Адрес нужно уточнить</span>}</div>}
export function useVenueComparison(state){
  const key=`tie:venue-comparison:${state.agency?.id||''}:${state.user?.id||''}:${state.project?.id||'agency'}`;
  const read=()=>{try{const ids=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(ids)?ids.filter(id=>typeof id==='string'):[]}catch{return []}};
  const [stored,setStored]=useState(()=>({key,ids:read()}));
  useEffect(()=>{setStored({key,ids:read()});const update=event=>{if(event.key===key||event.detail===key)setStored({key,ids:read()})};window.addEventListener('storage',update);window.addEventListener('tie:venue-comparison',update);return()=>{window.removeEventListener('storage',update);window.removeEventListener('tie:venue-comparison',update)}},[key]);
  const ids=stored.key===key?stored.ids:[];
  const toggle=id=>setStored(current=>{const before=current.key===key?current.ids:read(),next=before.includes(id)?before.filter(x=>x!==id):[...before,id];try{localStorage.setItem(key,JSON.stringify(next));queueMicrotask(()=>window.dispatchEvent(new CustomEvent('tie:venue-comparison',{detail:key})))}catch{}return {key,ids:next}});
  return [ids,toggle];
}
export function VenueCard({item,date,compared,onCompare,onOpen,projectMode=false}){
  const d=item.data,v=d.venue||{},subtitle=[v.type||d.services,v.capacity?`до ${v.capacity} гостей`:null].filter(Boolean).join(' · ');
  return <article className="venue-card" data-venue-id={item.id}>
    <VenueGallery data={d} entityId={item.id}/>
    <h2>{d.title||d.name}</h2><VenueAddress data={d}/>{subtitle&&<p className="venue-card-subtitle">{subtitle}</p>}
    <div className="venue-card-bottom"><dl className="venue-card-prices"><div><dt>Аренда</dt><dd>{venueRentLabel(d,date)}</dd></div><div><dt>Меню</dt><dd>{v.menuFrom==null?'Нужно уточнить':`от ${venueMoney(v.menuFrom)} / гость`}</dd></div><div><dt>Депозит</dt><dd>{venueMoney(v.deposit)}</dd></div><div><dt>Доп. траты</dt><dd>{venueExtraLabel(d)}</dd></div></dl><button type="button" className="button" onClick={onOpen}>Посмотреть</button></div>
    <footer><label className="venue-compare-check"><input type="checkbox" checked={compared} onChange={onCompare}/>{compared?'В сравнении':'Добавить в сравнение'}</label>{projectMode&&d.selected&&<span className="venue-chosen">Выбор пары</span>}</footer>
  </article>;
}
const serviceLabel=v=>v.servicePercent==null?v.serviceTerms||'Нужно уточнить':`${v.servicePercent}%${v.serviceTerms?` · ${v.serviceTerms}`:' · базу расчёта нужно уточнить'}`;
const depositTypes={unknown:'Условия нужно уточнить',minimum:'Минимальный заказ',separate:'Отдельный платёж',included:'Входит в стоимость'};
export function VenueDetail({item,date,compared,onCompare,onEdit,onSelect,onSaveCatalog,onClose}){
  const d=item.data,v=d.venue||{},rent=venueRent(d,date),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  return <Modal wide title={d.title||d.name||'Площадка'} onClose={onClose} headerActions={onEdit&&<button type="button" className="text-button" onClick={onEdit}>Изменить</button>}><div className="venue-detail">
    <VenueGallery data={d} entityId={item.id} large/><div className="venue-detail-links"><VenueAddress data={d}/>{v.website&&<a href={v.website} target="_blank" rel="noreferrer">Сайт площадки ↗</a>}</div>
    <dl className="venue-detail-facts"><div><dt>Тип площадки</dt><dd>{v.type||d.services||'Нужно уточнить'}</dd></div><div><dt>Вместимость</dt><dd>{v.capacity?`до ${v.capacity} гостей`:'Нужно уточнить'}</dd></div><div><dt>Аренда</dt><dd>{venueRentLabel(d,date)}{rent.partial&&<small>Указаны тарифы не на все дни недели</small>}{rent.source==='date'&&<small>Тариф на дату свадьбы</small>}</dd></div><div><dt>Меню / гость</dt><dd>{v.menuFrom==null?'Нужно уточнить':`от ${venueMoney(v.menuFrom)}`}</dd></div><div><dt>Депозит</dt><dd>{venueMoney(v.deposit)}<small>{depositTypes[v.depositKind]||depositTypes.unknown}{v.depositTerms&&` · ${v.depositTerms}`}</small></dd></div><div><dt>Доп. траты</dt><dd>{venueExtraLabel(d)}</dd></div></dl>
    {v.rentMode==='days'&&<section><h3>Аренда по дням недели</h3><dl className="venue-week">{VENUE_DAYS.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{venueMoney(v.rentDays?.[key])}</dd></div>)}</dl></section>}
    <section><h3>Условия и дополнительные расходы</h3><dl className="venue-detail-facts"><div><dt>Сервисный сбор</dt><dd>{serviceLabel(v)}</dd></div><div><dt>Проживание</dt><dd>{v.accommodation||'Нужно уточнить'}</dd></div>{(v.extras||[]).map((extra,i)=><div key={i}><dt>{extra.label}<small>{extra.required?'Обязательный расход':'По желанию'}</small></dt><dd>{venueMoney(extra.amount)}{extra.unit==='guest'&&' / гость'}{extra.note&&<small>{extra.note}</small>}</dd></div>)}</dl></section>
    {(v.included||v.details||d.terms)&&<section><h3>Что входит и что уточнить</h3>{v.included&&<p>{v.included}</p>}{(v.details||d.terms)&&<p>{v.details||d.terms}</p>}</section>}
    {d.contact&&<section><h3>Контакты</h3><p>{d.contact}</p></section>}{d.notes&&<section><h3>Комментарий</h3><p>{d.notes}</p></section>}<VendorLinks data={d}/>
    <div className="venue-detail-actions">{onCompare&&<button type="button" className="button quiet" onClick={onCompare}>{compared?'Убрать из сравнения':'Добавить в сравнение'}</button>}{onSaveCatalog&&<button type="button" className="button quiet" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await onSaveCatalog()}catch(e){setError(e.message)}finally{setBusy(false)}}}>Сохранить в базу агентства</button>}{onSelect&&<button type="button" className="button" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await onSelect(!d.selected)}catch(e){setError(e.message)}finally{setBusy(false)}}}>{d.selected?'Отменить выбор площадки':'Выбрать площадку'}</button>}</div>{error&&<p className="form-error" role="alert">{error}</p>}
  </div></Modal>;
}
export function VenueComparison(props){
  const view=useTableScope('venues:comparison');
  return <ComparisonForDevice key={view.key} {...props} view={view}/>;
}
function ComparisonForDevice({view,items,date,onRemove,onOpen}){
  const columns=[{id:'conditions',type:'text',viewWidth:140,desktopWidth:160},...items.map(item=>({id:item.id,type:'text',viewWidth:180,desktopWidth:220}))];
  const {table,layout,scaleKey,initialScale,defaultFit}=useTableView({...view,columns});
  const rows=[['Аренда',d=>venueRentLabel(d,date)],['Меню / гость',d=>d.venue?.menuFrom==null?'Нужно уточнить':`от ${venueMoney(d.venue.menuFrom)}`],['Депозит',d=>`${venueMoney(d.venue?.deposit)}${d.venue?.depositKind&&d.venue.depositKind!=='unknown'?` · ${depositTypes[d.venue.depositKind]}`:''}`],['Доп. траты',venueExtraLabel],['Обязательные доплаты',d=>(d.venue?.extras||[]).filter(x=>x.required).map(x=>`${x.label}: ${venueMoney(x.amount)}${x.unit==='guest'?' / гость':''}`).join('\n')||'Нужно уточнить'],['Сервис',d=>serviceLabel(d.venue||{})],['Вместимость',d=>d.venue?.capacity?`до ${d.venue.capacity} гостей`:'Нужно уточнить'],['Проживание',d=>d.venue?.accommodation||'Нужно уточнить'],['Что входит',d=>d.venue?.included||'Нужно уточнить'],['Условия депозита',d=>d.venue?.depositTerms||'Нужно уточнить']];
  if(!items.length)return <div className="venue-empty"><h2>Выберите площадки для сравнения</h2><p>Отметьте «Добавить в сравнение» на нужных карточках.</p></div>;
  return <><p className="venue-comparison-hint">Сравните условия и обязательные доплаты{date?' на дату свадьбы':'. Для открытой даты показаны диапазоны аренды'}.</p><SheetZoom minScale={.1} storageKey={scaleKey} initialScale={initialScale} defaultFit={defaultFit} label="Сравнение площадок" controlsLabel="Масштаб таблицы" className="venue-comparison-scroll"><table ref={table} style={{width:columns.reduce((sum,c)=>sum+layout.columnWidths[c.id],0)}} className="venue-comparison" data-count={items.length}><colgroup>{columns.map(c=><col key={c.id} style={{width:layout.columnWidths[c.id]}}/>)}</colgroup><thead><tr><th scope="col">Условия</th>{items.map(item=><th scope="col" key={item.id}><button type="button" className="venue-remove-compare" aria-label={`Убрать ${item.data.title||item.data.name} из сравнения`} onClick={()=>onRemove(item.id)}>×</button><VenueGallery controls={false} data={item.data} entityId={item.id}/><span>{item.data.title||item.data.name}</span></th>)}</tr></thead><tbody>{rows.map(([label,value])=><tr key={label} className={label.includes('доплат')||label==='Доп. траты'?'venue-expense-row':''}><th scope="row">{label}</th>{items.map(item=><td key={item.id}>{value(item.data).split('–').map((part,i)=><span key={i}>{i>0&&<>–<wbr/></>}{part}</span>)}</td>)}</tr>)}</tbody><tfoot><tr><th/><>{items.map(item=><td key={item.id}><button type="button" className="text-button" onClick={()=>onOpen(item)}>Посмотреть</button></td>)}</></tr></tfoot></table></SheetZoom></>;
}
export function VenueCatalog({state,items,categories,onVendor,onAdd,canAdd,canEdit,canSelect,onSelect,onSaveCatalog,canSaveCatalog,embedded=false,comparisonOnly=false}){
  const [query,setQuery]=useState(''),[tab,setTab]=useState(comparisonOnly?'compare':'all'),[archived,setArchived]=useState(false),[detailId,setDetailId]=useState(null),[compared,toggle]=useVenueComparison(state);
  const date=state.project?.data?.date||'',projectMode=!!state.project;
  const live=items.filter(item=>!item.deleted&&(archived||!item.data.archived)),visible=live.filter(item=>vendorMatchesQuery(item,query)&&(tab!=='selected'||item.data.selected));
  const comparedItems=items.filter(item=>!item.deleted&&!item.data.archived&&compared.includes(item.id));
  const detail=items.find(item=>item.id===detailId&&!item.deleted);
  const agency=projectMode?(state.catalog||[]).filter(item=>item.kind==='vendor'&&!item.deleted&&!item.data.archived&&isVenueSelection(item,categories)&&vendorMatchesQuery(item,query)):[];
  return <section className="venue-workspace">
    {!embedded&&<header className="page-header"><div><h1>Площадки</h1></div>{canAdd&&<button type="button" className="button" onClick={onAdd}>+ Добавить площадку</button>}</header>}
    <nav className="venue-tabs" aria-label="Площадки"><button type="button" className={tab==='all'?'active':''} onClick={()=>setTab('all')}>Площадки</button><button type="button" className={tab==='compare'?'active':''} onClick={()=>setTab('compare')}>Сравнение · {comparedItems.length}</button>{projectMode&&<button type="button" className={tab==='selected'?'active':''} onClick={()=>setTab('selected')}>Итоговый выбор</button>}</nav>
    {tab==='compare'?<VenueComparison items={comparedItems} date={date} onRemove={toggle} onOpen={item=>setDetailId(item.id)}/>:<>
      <div className="filters venue-filters"><label className="search"><input aria-label="Поиск площадки" placeholder={canAdd&&projectMode?'Найти в свадьбе и базе агентства':'Поиск площадки'} value={query} onChange={e=>setQuery(e.target.value)}/></label>{canAdd&&<label className="check-field"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>Показать архив</label>}</div>
      {canAdd&&query.trim()&&agency.length>0&&<section className="vendor-agency-results"><h2>База агентства</h2>{agency.slice(0,12).map(item=>{const assigned=items.find(row=>row.data.vendorId===item.id&&!row.data.archived);return <div className="vendor-search-result" key={item.id}><strong>{item.data.name}</strong><button type="button" className="button quiet small" onClick={()=>assigned?setDetailId(assigned.id):onVendor(undefined,vendorDraftFromCatalog(item))}>{assigned?'Открыть карточку':'Добавить в свадьбу'}</button></div>})}</section>}
      <div className="venue-grid">{visible.map(item=><VenueCard key={item.id} item={item} date={date} projectMode={projectMode} compared={compared.includes(item.id)} onCompare={()=>toggle(item.id)} onOpen={()=>setDetailId(item.id)}/>)}</div>
      {!visible.length&&<div className="venue-empty"><h2>{tab==='selected'?'Площадка ещё не выбрана':query?'Площадки не найдены':'Площадки пока не добавлены'}</h2><p>{canAdd?'Добавьте площадку или найдите готовую карточку в базе агентства.':'Здесь появятся площадки, предложенные организатором.'}</p></div>}
    </>}
    {detail&&<VenueDetail item={detail} date={date} compared={compared.includes(detail.id)} onCompare={()=>toggle(detail.id)} onClose={()=>setDetailId(null)} onEdit={canEdit?.(detail)?()=>{setDetailId(null);onVendor(detail)}:undefined} onSaveCatalog={detail.data.venue&&!detail.data.vendorId&&canSaveCatalog?.(detail)?()=>onSaveCatalog(detail):undefined} onSelect={canSelect?.(detail)?selected=>onSelect(detail,selected):undefined}/>}
  </section>;
}
