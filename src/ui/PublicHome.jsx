import { useState } from 'react';
import './public-home.css';

const list = value => Array.isArray(value) ? value.filter(Boolean) : [];
const copy = value => String(value || '').trim();
const serviceTitle = service => typeof service === 'string' ? service : copy(service?.title || service?.name);
const serviceText = service => typeof service === 'string' ? '' : copy(service?.description || service?.text || service?.summary);
const portfolioTitle = item => copy(item?.title || item?.name || item?.headline);
const portfolioText = item => copy(item?.description || item?.text || item?.summary);
const portfolioImage = item => copy(item?.image || item?.imageUrl || item?.cover);

function Wordmark({ name }) {
  return <a className="ui-ph-wordmark" href="/" aria-label={`${name} — главная`}><i aria-hidden="true" /><span>{name}</span></a>;
}

export function PublicHome({ info, onAuth, onApplication }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const settings = info?.settings || info || {};
  const services = list(settings.services);
  const portfolio = list(settings.portfolio);
  const name = copy(info?.name || settings.name) || 'tie';
  const description = copy(settings.description) || 'Собираем день, в котором вы сможете быть собой и прожить каждую важную минуту.';
  const contact = copy(settings.contact) || 'Оставьте заявку, чтобы обсудить вашу дату, настроение и первые шаги.';
  const closeMenu = () => setMenuOpen(false);
  const openAuth = mode => { closeMenu(); onAuth?.(mode); };
  const openApplication = () => { closeMenu(); onApplication?.(); };

  return <div className="ui-public-home">
    <header className="ui-ph-nav">
      <Wordmark name={name} />
      <button className="ui-ph-menu" type="button" aria-label="Открыть меню" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}><span /><span /></button>
      <div className={`ui-ph-nav-actions${menuOpen ? ' is-open' : ''}`}>
        <nav aria-label="Основная навигация"><a href="#stories" onClick={closeMenu}>Истории</a><a href="#services" onClick={closeMenu}>Услуги</a><a href="#contact" onClick={closeMenu}>Контакты</a></nav>
        <button className="ui-ph-login" type="button" onClick={() => openAuth('login')}>Войти</button>
        <button className="ui-ph-nav-cta" type="button" onClick={() => openAuth('register')}>Создать пространство</button>
      </div>
    </header>

    <main>
      <section className="ui-ph-hero">
        <div className="ui-ph-hero-copy">
          <p className="ui-ph-kicker">Свадебное агентство</p>
          <h1>Ваша история.<br /><em>Внимание к каждой детали.</em></h1>
          <p className="ui-ph-lead">{description}</p>
          <div className="ui-ph-actions">
            <button className="ui-ph-button" type="button" onClick={openApplication}>Оставить заявку <span aria-hidden="true">→</span></button>
            <button className="ui-ph-text-button" type="button" onClick={() => openAuth('login')}>У меня уже есть приглашение</button>
          </div>
        </div>
        <figure className="ui-ph-hero-image"><img src="/images/agency-wedding.jpg" alt="Свадебная церемония" /></figure>
      </section>

      <section id="services" className="ui-ph-section ui-ph-services">
        <div className="ui-ph-section-head"><p className="ui-ph-kicker">Как мы работаем</p><h2>У каждой свадьбы — свой ритм и свои важные детали.</h2></div>
        {services.length ? <div className="ui-ph-service-grid">{services.map((service, index) => <article key={`${serviceTitle(service)}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><h3>{serviceTitle(service) || 'Формат работы'}</h3>{serviceText(service) && <p>{serviceText(service)}</p>}</article>)}</div> : <p className="ui-ph-empty">Форматы работы агентство расскажет на первой встрече.</p>}
      </section>

      <section id="stories" className="ui-ph-stories">
        <div className="ui-ph-stories-head"><p className="ui-ph-kicker">Истории</p><h2>Свадьбы, собранные с вниманием.</h2></div>
        {portfolio.length ? <div className="ui-ph-story-grid">{portfolio.map((item, index) => <article className="ui-ph-story" key={`${portfolioTitle(item)}-${index}`}>{portfolioImage(item) && <img src={portfolioImage(item)} alt={portfolioTitle(item) || 'Фотография свадьбы'} />}<div><h3>{portfolioTitle(item) || 'История свадьбы'}</h3>{portfolioText(item) && <p>{portfolioText(item)}</p>}</div></article>)}</div> : <p className="ui-ph-empty ui-ph-story-empty">Здесь появятся истории, которыми пары и фотографы разрешили поделиться.</p>}
      </section>

      <section id="contact" className="ui-ph-contact">
        <div><p className="ui-ph-kicker">Начать разговор</p><h2>{copy(settings.tagline) || 'Расскажите о вашем дне'}</h2><p>{contact}</p></div>
        <button className="ui-ph-button ui-ph-button-light" type="button" onClick={openApplication}>Оставить заявку <span aria-hidden="true">→</span></button>
      </section>
    </main>
    <footer className="ui-ph-footer"><Wordmark name={name} /><p>© {new Date().getFullYear()} {name}</p></footer>
  </div>;
}
