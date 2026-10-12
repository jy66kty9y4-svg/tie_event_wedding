import { useEffect, useRef, useState } from 'react';
import { api } from '../client.js';
import { BrandLogo } from './Mark.jsx';
import { AuthPhoneInput } from './AuthPhoneInput.jsx';
import { normalizePhone } from '../auth-identity.js';
import { formatPhoneInput } from '../phone-input.js';
import './auth-page.css';

function PasswordHelp({ contact, onClose }) {
  const dialog = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className="auth-password-help" aria-labelledby="auth-password-help-title" onClose={onClose} onClick={event => {
    if (event.target !== dialog.current) return;
    const bounds = dialog.current.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current.close();
  }}>
    <button type="button" className="auth-help-close" aria-label="Закрыть" onClick={() => dialog.current.close()}>×</button>
    <h2 id="auth-password-help-title">Забыли пароль?</h2>
    <p>Свяжитесь с организатором вашей свадьбы, чтобы восстановить доступ.</p>
    {contact && <p className="auth-organizer-contact">{contact}</p>}
    <button type="button" className="auth-primary" onClick={() => dialog.current.close()}>Понятно</button>
  </dialog>;
}

export function AuthPage({ info, mode = 'login', onModeChange, onAuth }) {
  const login = mode === 'login';
  const setup = mode === 'setup';
  const invitation = new URLSearchParams(location.search).get('invite');
  const [identityMethod, setIdentityMethod] = useState(invitation || setup ? 'email' : 'phone');
  const [values, setValues] = useState({ name: '', email: '', phone: '', password: '', agencyName: '', slug: 'tie' });
  const [rememberSession, setRememberSession] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [passwordHelp, setPasswordHelp] = useState(false);
  const failedLogins = useRef({ identifier: '', count: 0 });
  const activeInput = useRef(null);
  const sessionHelp = useRef(null);
  const title = login ? 'Войти в tie' : setup ? 'Настроить агентство' : 'Создать аккаунт';
  const set = (key, value) => { setValues(current => ({ ...current, [key]: value })); setError(''); };

  useEffect(() => { activeInput.current?.focus(); }, []);

  useEffect(() => {
    const closeOutside = event => {
      const help = sessionHelp.current;
      if (help?.open && !help.contains(event.target)) help.removeAttribute('open');
    };
    const closeOnEscape = event => {
      const help = sessionHelp.current;
      if (event.key !== 'Escape' || !help?.open) return;
      help.removeAttribute('open');
      if (help.contains(document.activeElement)) help.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', closeOutside, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const back = () => {
    if (busy) return;
    setError('');
    setShowPassword(false);
    onModeChange('login');
  };

  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    setError('');
    const phone = formatPhoneInput(values.phone);
    const identifier = identityMethod === 'phone' ? phone : values.email;
    if ((!login || identityMethod === 'phone') && !/^\+7\d{10}$/.test(normalizePhone(phone) || '')) {
      setError('Проверьте номер телефона');
      return;
    }
    setBusy(true);
    try {
      const slug = new URLSearchParams(location.search).get('agency') || info?.slug || 'tie';
      const identity = { phone, email: values.email };
      const body = login ? { identifier, password: values.password, slug, rememberSession }
        : setup ? { name: values.name, agencyName: values.agencyName, slug: values.slug, password: values.password, ...identity }
          : { name: values.name, password: values.password, slug, invitation: invitation || undefined, ...identity };
      const result = await api(login ? '/api/login' : setup ? '/api/setup' : '/api/register', { method: 'POST', body: JSON.stringify(body) });
      failedLogins.current = { identifier: '', count: 0 };
      if (setup) {
        const url = new URL(location.href);
        url.searchParams.set('agency', values.slug);
        history.replaceState(null, '', url);
      }
      await onAuth(result);
    } catch (cause) {
      setError(cause.message || 'Не удалось продолжить');
      if (login && cause.status === 401) {
        const key = identityMethod === 'phone' ? normalizePhone(phone) : values.email.trim().toLowerCase();
        const count = failedLogins.current.identifier === key ? failedLogins.current.count + 1 : 1;
        failedLogins.current = { identifier: key, count };
        if (count >= 2) setPasswordHelp(true);
      }
    }
    finally { setBusy(false); }
  };

  const password = <div className="auth-field">
    <label htmlFor="auth-password">Пароль</label>
    <span className="auth-password">
      <input id="auth-password" type={showPassword ? 'text' : 'password'} required minLength={login ? undefined : 10} maxLength={256} autoComplete={login ? 'current-password' : 'new-password'} name="password" placeholder={login ? 'Введите пароль' : 'Не менее 10 символов'} value={values.password} onChange={event => set('password', event.target.value)} aria-invalid={!!error} aria-describedby={error ? 'auth-error' : undefined} />
      <button type="button" className="auth-password-toggle" aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{showPassword && <path d="m3 3 18 18" />}</svg>
      </button>
    </span>
  </div>;

  return <div className="auth-page">
    <div className="auth-brand-art" aria-hidden="true"><img className="auth-signature" src="/brand/tie/signature-red.png" alt=""/><img className="auth-pattern" src="/brand/tie/event-pattern.png" alt=""/></div>
    <header className="auth-header"><a className="auth-wordmark" href="/" aria-label="TIE — вход"><BrandLogo tone="light"/></a><span>Свадьба, собранная вместе</span></header>
    <main className="auth-main">
      <div className="auth-center">
        <section className="auth-card" role="region" aria-label={title}>
          {!login && <button type="button" className="auth-back" onClick={back} disabled={busy} aria-label="Назад ко входу"><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m10 5-7 7 7 7M3 12h18" /></svg></button>}
          <div className="auth-logo"><BrandLogo/></div>
          <h1>{title}</h1>
          <p className="auth-intro">{login ? 'Войдите в пространство вашей свадьбы' : setup ? 'Создайте пространство для вашей команды' : invitation ? 'Создайте аккаунт, чтобы принять приглашение' : 'Для подготовки свадьбы вместе с командой'}</p>
          <form className="auth-form" onSubmit={submit} aria-busy={busy}>
            {!login && <label className="auth-field"><span>Ваше имя</span><input ref={activeInput} required name="name" autoComplete="name" placeholder="Как к вам обращаться" value={values.name} onChange={event => set('name', event.target.value)} /></label>}
            {setup && <><label className="auth-field"><span>Название агентства</span><input required name="agencyName" autoComplete="organization" value={values.agencyName} onChange={event => set('agencyName', event.target.value)} /></label><label className="auth-field"><span>Адрес агентства</span><input required pattern="(?:[a-z0-9]|-){2,50}" name="slug" value={values.slug} onChange={event => set('slug', event.target.value.toLowerCase())} /><small>Латинские буквы, цифры и дефис</small></label></>}
            {login && <div className="auth-methods" role="group" aria-label="Способ входа">
              <button type="button" aria-pressed={identityMethod === 'phone'} disabled={busy} onClick={() => { setIdentityMethod('phone'); setError(''); }}>Телефон</button>
              <button type="button" aria-pressed={identityMethod === 'email'} disabled={busy} onClick={() => { setIdentityMethod('email'); setError(''); }}>Почта</button>
            </div>}
            {(!login || identityMethod === 'phone') && <label className="auth-field"><span>Номер телефона</span><AuthPhoneInput inputRef={login ? activeInput : undefined} type="tel" required name="phone" autoComplete={login ? 'username' : 'tel'} inputMode="tel" maxLength={18} pattern="\+7 \([0-9]{3}\) [0-9]{3}-[0-9]{2}-[0-9]{2}" placeholder="+7 (___) ___-__-__" value={values.phone} onChange={value => set('phone', value)} aria-invalid={!!error} aria-describedby={error ? 'auth-error' : undefined} /></label>}
            {(!login || identityMethod === 'email') && <label className="auth-field"><span>Почта</span><input ref={login ? activeInput : undefined} type="email" required name="email" autoComplete={login ? 'username' : 'email'} inputMode="email" autoCapitalize="none" spellCheck={false} maxLength={200} placeholder="name@example.com" value={values.email} onChange={event => set('email', event.target.value)} aria-invalid={!!error} aria-describedby={error ? 'auth-error' : undefined} />{!login && invitation && <small>Почта, на которую оформлено приглашение.</small>}</label>}
            {password}
            {login && <div className="auth-session"><label><input type="checkbox" checked={rememberSession} onChange={event => setRememberSession(event.target.checked)} /><span>Сохранить вход</span></label><details ref={sessionHelp}><summary aria-label="О сохранении входа">?</summary><p>На личном устройстве вход сохранится на 7 дней. Снимите отметку на чужом устройстве — вход сохранится только до закрытия браузера.</p></details></div>}
            {error && <p id="auth-error" className="auth-error" role="alert">{error}</p>}
            <button className="auth-primary" type="submit" disabled={busy}>{busy ? 'Подождите…' : login ? 'Войти' : setup ? 'Настроить агентство' : 'Создать аккаунт'}</button>
          </form>
          {login && <button type="button" className="auth-secondary" disabled={busy} onClick={() => onModeChange(info?.setup ? 'setup' : 'register')}>Создать аккаунт</button>}
          {!login && <p className="auth-signin">Уже есть аккаунт? <button type="button" disabled={busy} onClick={back}>Войти</button></p>}
        </section>
        <details className="auth-help"><summary>Помощь</summary><p>{info?.contact || info?.settings?.contact || 'Если не получается войти, обратитесь к организатору вашей свадьбы.'}</p></details>
      </div>
    </main>
    <footer className="auth-footer"><span>© {new Date().getFullYear()} tie</span><span>{info?.name && info.name !== 'tie' ? info.name : 'Пространство пары и команды'}</span><span>Русский</span></footer>
    {passwordHelp && <PasswordHelp contact={info?.contact || info?.settings?.contact} onClose={() => setPasswordHelp(false)} />}
  </div>;
}
