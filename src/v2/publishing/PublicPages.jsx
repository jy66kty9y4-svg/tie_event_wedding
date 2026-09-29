import React, { useState } from 'react';
import './publishing.css';

const assetUrl = id => `/api/public/assets/${encodeURIComponent(id)}`;
const galleryOf = revision => revision?.gallery?.length ? revision.gallery : (revision?.assetIds || []).map((assetId, order) => ({ assetId, alt: '', caption: '', order }));
const copy = value => String(value || '').trim();

function Brand({name='tie'}) { return <a className="v2-public-brand" href="/" aria-label={`${name} — главная`}>{name}<span aria-hidden="true" /></a>; }
function PublicImage({ item, className = '' }) { return item?.assetId ? <figure className={`v2-public-image ${className}`}><img src={assetUrl(item.assetId)} alt={item.alt || 'Фотография свадьбы'} />{item.caption && <figcaption>{item.caption}</figcaption>}</figure> : null; }
function Apply({ onApply, sourceCaseId, sourcePackageId, children = 'Обсудить свадьбу' }) {
  if (!onApply) return <a className="v2-public-cta" href={`/app?${new URLSearchParams({application:'1',...(sourceCaseId?{sourceCaseId}:{}),...(sourcePackageId?{sourcePackageId}:{})})}`}>{children}<span aria-hidden="true">→</span></a>;
  return <button className="v2-public-cta" onClick={() => onApply({ sourceCaseId, sourcePackageId })}>{children}<span aria-hidden="true">→</span></button>;
}
function EmptySection({ title, children }) { return <section className="v2-public-empty"><p className="v2-public-kicker">Скоро здесь будет больше</p><h2>{title}</h2><p>{children}</p></section>; }

export function AgencyPublicPage({ agency, home, content = [], onApply }) {
  const [openFaq, setOpenFaq] = useState(null);
  const main = home?.revision || home || {};
  const cases = content.filter(item => item.kind === 'case');
  const packages = content.filter(item => item.kind === 'package');
  const faqs = content.filter(item => item.kind === 'faq');
  const title = copy(main.heroTitle) || copy(agency?.tagline) || 'Ваша история. Внимание к каждой детали.';
  const intro = copy(main.heroText) || copy(agency?.description);
  const heroImage = galleryOf(main)[0];
  return <main className="v2-public-site">
    <header className="v2-public-nav"><Brand name={agency?.name || 'tie'} /><nav aria-label="Публичная навигация"><a href="#stories">Истории</a><a href="#services">Услуги</a><a href="#faq">FAQ</a></nav><a className="v2-public-login" href="/app?login=1">Войти <span aria-hidden="true">↗</span></a></header>
    <section className="v2-public-hero"><div><p className="v2-public-kicker">Свадебное агентство</p><h1>{title}</h1>{intro && <p className="v2-public-lead">{intro}</p>}<Apply onApply={onApply}>Обсудить свою свадьбу</Apply></div>{heroImage && <PublicImage item={heroImage} className="v2-public-hero-image" />}</section>
    {copy(main.approach) && <section className="v2-public-approach"><p>{main.approach}</p></section>}
    <section id="stories" className="v2-public-section"><div className="v2-public-section-head"><div><p className="v2-public-kicker">Истории наших пар</p><h2>Дни, которые хочется помнить.</h2></div></div>{cases.length ? <div className="v2-public-cards">{cases.map(item => { const revision = item.revision || {}; return <article key={item.id} className="v2-public-card">{galleryOf(revision)[0] && <PublicImage item={galleryOf(revision)[0]} />}<div><h3>{revision.title}</h3>{revision.summary && <p>{revision.summary}</p>}<a className="v2-public-link" href={`/stories/${encodeURIComponent(revision.slug || item.slug || '')}`}>Посмотреть историю <span>→</span></a></div></article>; })}</div> : <EmptySection title="Истории появятся здесь">Агентство добавит опубликованные кейсы, когда получит разрешение пар и фотографов.</EmptySection>}</section>
    <section id="services" className="v2-public-section v2-public-services"><div className="v2-public-section-head"><div><p className="v2-public-kicker">Формат работы</p><h2>Рядом ровно настолько, насколько нужно.</h2></div></div>{packages.length ? <div className="v2-public-service-list">{packages.map(item => { const revision = item.revision || {}; return <article key={item.id}><div><p className="v2-public-index">{String((revision.order || 0) + 1).padStart(2, '0')}</p><h3>{revision.title}</h3>{revision.summary && <p>{revision.summary}</p>}</div><Apply onApply={onApply} sourcePackageId={item.id}>Подробнее</Apply></article>; })}</div> : <EmptySection title="Форматы работы готовятся">На первой встрече агентство расскажет, какая поддержка подойдёт именно вам.</EmptySection>}</section>
    {Array.isArray(main.steps) && main.steps.length > 0 && <section className="v2-public-process"><div><p className="v2-public-kicker">Как это происходит</p><h2>Сначала разговор. Потом всё встаёт на места.</h2></div><ol>{main.steps.map((step, index) => <li key={`${index}-${step}`}><b>{String(index + 1).padStart(2, '0')}</b><span>{step}</span></li>)}</ol></section>}
    <section id="faq" className="v2-public-section v2-public-faq"><p className="v2-public-kicker">Вопросы</p><h2>Чтобы было спокойнее начать.</h2>{faqs.length ? <div>{faqs.map(item => { const revision = item.revision || {}; const open = openFaq === item.id; return <article key={item.id}><button aria-expanded={open} onClick={() => setOpenFaq(open ? null : item.id)}>{revision.question}<span aria-hidden="true">+</span></button>{open && <p>{revision.answer}</p>}</article>; })}</div> : <EmptySection title="Ответы готовятся">Если у вас есть вопрос, оставьте заявку — агентство ответит лично.</EmptySection>}</section>
    <section className="v2-public-callout"><div><p className="v2-public-kicker">Начать можно сегодня</p><h2>Расскажите нам о своём дне.</h2></div><Apply onApply={onApply}>Оставить заявку</Apply></section>
    <footer className="v2-public-footer"><Brand name={agency?.name || 'tie'} /><p>{agency?.name || 'tie'} · свадьбы, в которых есть место для вас</p></footer>
  </main>;
}

export function WeddingPublicPage({ site, onRsvp }) {
  const page = site?.revision;
  if (!page) return <main className="v2-public-site v2-wedding-site"><section className="v2-public-empty"><h1>Страница недоступна</h1><p>Свяжитесь с организатором, если нужна помощь.</p></section></main>;
  const gallery = galleryOf(page); const visible = id => !page.blocks || page.blocks.find(block => block.id === id)?.visible !== false;
  return <main className={`v2-public-site v2-wedding-site v2-template-${page.template || 'light'}`}>
    <header className="v2-wedding-cover">{gallery[0] && <PublicImage item={gallery[0]} className="v2-wedding-cover-image" />}<div><p className="v2-public-kicker">Приглашение</p><h1>{page.coupleNames}</h1><p>{page.dateLabel}{page.venue ? ` · ${page.venue}` : ''}</p>{page.intro && <p className="v2-wedding-intro">{page.intro}</p>}<button className="v2-public-link" onClick={() => onRsvp ? onRsvp() : document.getElementById('rsvp')?.scrollIntoView({ behavior: 'smooth' })}>Ответить на приглашение <span>↓</span></button></div></header>
    {visible('program') && page.schedule?.length > 0 && <section className="v2-wedding-program"><p className="v2-public-kicker">Программа дня</p>{page.schedule.map((item, index) => <article key={`${item.time}-${index}`}><time>{item.time}</time><div><h2>{item.title}</h2>{item.note && <p>{item.note}</p>}</div></article>)}</section>}
    {visible('directions') && page.directions && <section className="v2-wedding-detail"><p className="v2-public-kicker">Как добраться</p><h2>{page.venue || 'Место встречи'}</h2><p>{page.directions}</p>{page.mapUrl && <a className="v2-public-link" href={page.mapUrl} rel="noreferrer">Открыть карту <span>↗</span></a>}</section>}
    {visible('gallery') && gallery.length > 1 && <section className="v2-wedding-gallery">{gallery.slice(1).map(item => <PublicImage key={item.assetId} item={item} />)}</section>}
    <section className="v2-wedding-rsvp" id="rsvp"><p className="v2-public-kicker">Ответ на приглашение</p><h2>Будем рады разделить этот день с вами.</h2><p>Откройте персональную ссылку из приглашения, чтобы подтвердить участие и сообщить важные детали.</p>{onRsvp && <Apply onApply={onRsvp}>Ответить</Apply>}</section>
  </main>;
}
