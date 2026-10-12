import {useEffect,useState} from 'react';
import {vendorLinks,vendorPhotoUrl} from '../vendor-profile.js';
import './vendor-profile.css';

export function VendorAvatar({data={},entityId,large=false}) {
  const [failed,setFailed]=useState(false),name=data.name||data.title||'Подрядчик';
  useEffect(()=>setFailed(false),[data.photoId,entityId]);
  return <div className={`vendor-monogram vendor-photo ${large?'is-large':''}`}>{data.photoId&&!failed?<img src={vendorPhotoUrl(data.photoId,entityId)} alt={`Фото: ${name}`} onError={()=>setFailed(true)}/>:<span aria-label="Фото не загружено">{name.split(' ').filter(Boolean).slice(0,2).map(n=>n[0]).join('')}</span>}</div>;
}
export function VendorLinks({data}) {
  const links=vendorLinks(data);
  return links.length?<div className="vendor-links" aria-label="Ссылки подрядчика">{links.map((link,i)=><div key={i}><a href={link.url} target="_blank" rel="noreferrer">{link.title||link.url}</a>{link.comment&&<small>{link.comment}</small>}</div>)}</div>:null;
}
export function VendorLinksEditor({value,onChange}) {
  const update=(index,key,text)=>onChange(value.map((link,i)=>i===index?{...link,[key]:text}:link));
  return <fieldset className="vendor-links-editor"><legend>Ссылки подрядчика</legend>{value.map((link,index)=><div className="vendor-link-entry" key={index}><label className="form-field">Название ссылки<input maxLength={160} aria-label={`Название ссылки ${index+1}`} placeholder="Instagram, сайт, Telegram" value={link.title} onChange={e=>update(index,'title',e.target.value)}/></label><label className="form-field">URL<input required type="url" maxLength={2400} aria-label={`URL ссылки ${index+1}`} placeholder="https://" value={link.url} onChange={e=>update(index,'url',e.target.value)}/></label><label className="form-field">Комментарий<input maxLength={1000} aria-label={`Комментарий ссылки ${index+1}`} placeholder="Портфолио, цены или связь" value={link.comment} onChange={e=>update(index,'comment',e.target.value)}/></label><button type="button" className="text-button danger-text" aria-label={`Удалить ссылку ${index+1}`} onClick={()=>onChange(value.filter((_,i)=>i!==index))}>Удалить</button></div>)}<button type="button" className="text-button" disabled={value.length>=20} onClick={()=>onChange([...value,{title:'',url:'',comment:''}])}>+ Добавить ссылку</button></fieldset>;
}
