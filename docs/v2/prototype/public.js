(function (T) {
  'use strict';

  var selectedStory = 0;
  var selectedService = 0;
  var applicationSent = false;

  var stories = [
    { title: 'Сентябрь в старой усадьбе', place: 'Переделкино · 64 гостя', cover: 'venue', accent: 'tables', text: 'Семейный обед под яблонями, церемония в саду и длинный ужин при свечах.', quote: '«Нам было спокойно даже в самый важный день».', details: ['Камерная церемония в саду', 'Ужин за общим столом', 'Вечерняя съёмка на территории'] },
    { title: 'Тёплый свет у воды', place: 'Москва-река · 82 гостя', cover: 'couple', accent: 'decor', text: 'Собрали праздник вокруг одного длинного стола, воды и мягкого света к вечеру.', quote: '«Получилось очень про нас: легко, красиво, по-настоящему».', details: ['Площадка и логистика', 'Концепция и декор', 'Координация всего дня'] },
    { title: 'Цветы, музыка, друзья', place: 'Никола-Ленивец · 46 гостей', cover: 'decor', accent: 'wedding', text: 'Неформальный день на природе с живой музыкой, полевыми цветами и свободным расписанием.', quote: '«Ни одна деталь не осталась без внимания».', details: ['Выездная команда', 'Сценарий и тайминг', 'Забота о гостях'] }
  ];

  var services = [
    { title: 'Полная организация', subtitle: 'От первой встречи до последнего танца', image: 'wedding', text: 'Берём подготовку целиком: помогаем с концепцией, бюджетом, площадкой, командой и самим днём.', includes: ['Личный организатор', 'Концепция и план подготовки', 'Подбор команды и координация'] },
    { title: 'Подключаемся к подготовке', subtitle: 'Когда часть пути уже пройдена', image: 'tables', text: 'Разбираем, что уже сделано, собираем понятный маршрут и берём на себя те задачи, где нужна опора.', includes: ['Аудит подготовки', 'План следующих шагов', 'Работа с выбранными подрядчиками'] },
    { title: 'Координация дня', subtitle: 'Чтобы вы были гостями на своей свадьбе', image: 'venue', text: 'Команда бережно ведёт день на площадке, следит за таймингом и решает всё, что не должно попадать в ваше поле зрения.', includes: ['Тайминг и монтаж', 'Команда на площадке', 'Забота о гостях'] }
  ];

  function asset(name) {
    return (T.assets && T.assets[name]) || '';
  }
  function publicDraft() {
    return (T.data && T.data.siteDraft) || {};
  }
  function img(name, alt, extra) {
    return '<img src="' + T.escape(asset(name)) + '" alt="' + T.escape(alt) + '" ' + (extra || '') + '>';
  }
  function nav(active, guest) {
    var logoTarget = guest ? 'guest' : 'public';
    return '<header class="pub-nav">' +
      '<button class="pub-brand" data-action="pub-go" data-route="' + logoTarget + '" aria-label="tie.event — главная">tie<i aria-hidden="true"></i></button>' +
      '<nav class="pub-nav-links" aria-label="Публичная навигация">' +
        '<button class="' + (active === 'stories' ? 'is-active' : '') + '" data-action="pub-go" data-route="stories">Истории</button>' +
        '<button class="' + (active === 'services' ? 'is-active' : '') + '" data-action="pub-go" data-route="services">Услуги</button>' +
        '<button class="' + (active === 'faq' ? 'is-active' : '') + '" data-action="pub-go" data-route="faq">FAQ</button>' +
      '</nav>' +
      '<button class="pub-login" data-action="pub-go" data-route="login">Войти <span aria-hidden="true">↗</span></button>' +
    '</header>';
  }
  function footer() {
    return '<footer class="pub-footer"><button class="pub-brand" data-action="pub-go" data-route="public">tie<i aria-hidden="true"></i></button><p>Свадьбы, в которых есть место для вас.</p><div><button data-action="pub-go" data-route="stories">Истории</button><button data-action="pub-go" data-route="services">Услуги</button><button data-action="pub-go" data-route="faq">Вопросы</button></div></footer>';
  }
  function cta(label, route, extra) {
    return '<button class="pub-cta ' + (extra || '') + '" data-action="pub-go" data-route="' + route + '">' + label + ' <span aria-hidden="true">→</span></button>';
  }
  function guestProject() {
    var project = T.project ? T.project() : null;
    return {
      name: (project && project.name) || 'Алина и Даниил',
      date: (project && project.date) || '19 сентября 2026',
      venue: (project && project.venue) || 'Усадьба «Липы»',
      guestName: (T.state && T.state.guestName) || 'Нина'
    };
  }
  function storyCard(story, i) {
    var draft = publicDraft();
    if (i === 0) story = Object.assign({}, story, { title: draft.caseTitle || story.title, text: draft.caseText || story.text });
    return '<article class="pub-story-card"><button class="pub-story-image" data-action="pub-story" data-id="' + i + '" aria-label="Открыть историю: ' + T.escape(story.title) + '">' + img(story.cover, story.title) + '<span>' + T.escape(story.place) + '</span></button><div><p class="pub-kicker">История пары</p><h3>' + T.escape(story.title) + '</h3><p>' + T.escape(story.text) + '</p><button class="pub-text-link" data-action="pub-story" data-id="' + i + '">Посмотреть историю <span>↗</span></button></div></article>';
  }
  function serviceCard(service, i) {
    return '<article class="pub-service-card"><div class="pub-service-image">' + img(service.image, service.title) + '</div><div><p class="pub-kicker">' + T.escape(service.subtitle) + '</p><h3>' + T.escape(service.title) + '</h3><p>' + T.escape(service.text) + '</p><button class="pub-text-link" data-action="pub-service" data-id="' + i + '">Подробнее <span>↗</span></button></div></article>';
  }

  function publicHome() {
    return '<main class="pub-page">' + nav('public') +
      '<section class="pub-hero"><div class="pub-hero-copy"><p class="pub-kicker">Свадебное агентство</p><h1>Свадьба,<br><em>в которой вы</em><br>сами себе нравитесь.</h1><p class="pub-lead">Придумываем и бережно собираем день, в котором хочется быть — вместе с близкими и без лишней суеты.</p>' + cta('Обсудить свою свадьбу', 'application') + '</div><div class="pub-hero-photo">' + img('wedding', 'Пара на свадьбе') + '<span class="pub-hero-note">Москва и область<br>Сезон 2026</span></div></section>' +
      '<section class="pub-manifest"><p>Нам важны не идеальные картинки, а ваше чувство: <b>это действительно наш день.</b> Поэтому сначала слушаем, а затем собираем всё остальное — людей, свет, время и детали.</p></section>' +
      '<section class="pub-section"><div class="pub-section-head"><div><p class="pub-kicker">Несколько историй</p><h2>Разные люди.<br>Одна большая любовь.</h2></div><button class="pub-text-link" data-action="pub-go" data-route="stories">Все истории <span>→</span></button></div><div class="pub-stories-grid">' + stories.map(storyCard).join('') + '</div></section>' +
      '<section class="pub-process"><div>' + img('decor', 'Свадебный декор') + '</div><div><p class="pub-kicker">Как это происходит</p><h2>Сначала — разговор.<br>Потом всё встаёт на места.</h2><ol><li><b>Знакомимся</b><span>Говорим о вас, ваших людях и о том, каким хочется видеть этот день.</span></li><li><b>Находим форму</b><span>Собираем концепцию, смету и команду, которая вам подходит.</span></li><li><b>Проживаем день</b><span>Вы празднуете. Мы остаёмся рядом и заботимся обо всём остальном.</span></li></ol>' + cta('Запланировать встречу', 'application', 'pub-cta-light') + '</div></section>' +
      '<section class="pub-section pub-service-preview"><div class="pub-section-head"><div><p class="pub-kicker">Формат работы</p><h2>Рядом ровно<br>настолько, насколько нужно.</h2></div><button class="pub-text-link" data-action="pub-go" data-route="services">Все услуги <span>→</span></button></div><div class="pub-service-list">' + services.map(function (s, i) { return '<button data-action="pub-service" data-id="' + i + '"><span>0' + (i + 1) + '</span><b>' + T.escape(s.title) + '</b><i>' + T.escape(s.subtitle) + '</i><em>→</em></button>'; }).join('') + '</div></section>' +
      '<section class="pub-callout"><div><p class="pub-kicker">Начать можно сегодня</p><h2>Расскажите нам<br>о своём дне.</h2></div>' + cta('Оставить заявку', 'application') + '</section>' + footer() + '</main>';
  }

  function storiesPage() {
    return '<main class="pub-page">' + nav('stories') + '<section class="pub-intro"><p class="pub-kicker">Истории наших пар</p><h1>Дни, которые<br><em>не хочется торопить.</em></h1><p>Каждая свадьба начинается с людей. Мы бережно ищем для их истории своё место, ритм и настроение.</p></section><section class="pub-stories-all">' + stories.map(storyCard).join('') + '</section><section class="pub-callout"><div><p class="pub-kicker">Ваша история — следующая</p><h2>Найдём форму,<br>которая будет вашей.</h2></div>' + cta('Обсудить свадьбу', 'application') + '</section>' + footer() + '</main>';
  }

  function storyPage() {
    var s = stories[selectedStory] || stories[0];
    return '<main class="pub-page">' + nav('stories') + '<section class="pub-story-hero">' + img(s.cover, s.title) + '<div><button class="pub-back" data-action="pub-go" data-route="stories">← Все истории</button><p class="pub-kicker">' + T.escape(s.place) + '</p><h1>' + T.escape(s.title) + '</h1><p>' + T.escape(s.text) + '</p></div></section><section class="pub-case-text"><p class="pub-kicker">Идея дня</p><h2>Много воздуха,<br>близкие рядом и детали,<br>которые замечают позже.</h2><p>Пара хотела сохранить ощущение живого семейного праздника. Мы сделали ставку на место, естественный свет и время, которое не нужно было никуда торопить.</p></section><section class="pub-case-gallery"><div>' + img(s.accent, 'Деталь свадьбы') + '</div><div>' + img('tables', 'Сервировка свадебного стола') + '</div><div class="pub-quote">' + T.escape(s.quote) + '</div></section><section class="pub-case-facts"><p class="pub-kicker">Что мы сделали</p><div>' + s.details.map(function (x, i) { return '<p><span>0' + (i + 1) + '</span>' + T.escape(x) + '</p>'; }).join('') + '</div></section><section class="pub-callout"><div><p class="pub-kicker">Готовы начать</p><h2>Ваша свадьба<br>может быть совсем другой.</h2></div>' + cta('Обсудить свою историю', 'application') + '</section>' + footer() + '</main>';
  }

  function servicesPage() {
    return '<main class="pub-page">' + nav('services') + '<section class="pub-intro pub-intro-services"><p class="pub-kicker">Услуги</p><h1>Хорошая подготовка<br><em>ощущается как спокойствие.</em></h1><p>Мы не продаём универсальный сценарий. На встрече поймём, какой формат поддержки нужен именно вам.</p></section><section class="pub-services-all">' + services.map(serviceCard).join('') + '</section><section class="pub-service-note"><p class="pub-kicker">Стоимость и состав</p><h2>Обсуждаем после первой встречи.</h2><p>Так у предложения появляется реальная опора: ваш масштаб, площадка, число гостей и то, что уже есть в подготовке.</p>' + cta('Запланировать разговор', 'application') + '</section>' + footer() + '</main>';
  }

  function serviceDetail() {
    var s = services[selectedService] || services[0];
    return '<main class="pub-page">' + nav('services') + '<section class="pub-service-detail"><div>' + img(s.image, s.title) + '</div><div><button class="pub-back" data-action="pub-go" data-route="services">← Все услуги</button><p class="pub-kicker">' + T.escape(s.subtitle) + '</p><h1>' + T.escape(s.title) + '</h1><p>' + T.escape(s.text) + '</p><ul>' + s.includes.map(function (x) { return '<li>' + T.escape(x) + '</li>'; }).join('') + '</ul>' + cta('Обсудить этот формат', 'application') + '</div></section><section class="pub-question"><h2>Не уверены, какой формат выбрать?</h2><p>Это нормально. На первой встрече разберём вашу ситуацию и честно подскажем, что может быть полезно.</p><button class="pub-text-link" data-action="pub-go" data-route="application">Задать вопрос <span>→</span></button></section>' + footer() + '</main>';
  }

  function faqPage() {
    var questions = [
      ['С чего начинается работа?', 'С первой встречи. Обсуждаем ваш день, его масштаб, важные для вас детали и то, на каком этапе вы сейчас. После этого готовим понятное предложение.'],
      ['Когда лучше обращаться?', 'Чем раньше — тем больше вариантов площадок и команды. Но если свадьба уже близко, всё равно напишите: иногда достаточно точного подключения к подготовке или координации дня.'],
      ['Как формируется бюджет?', 'Мы собираем бюджет из реальных задач и выбранной команды. Все решения обсуждаются с вами заранее, без неожиданных трат в процессе.'],
      ['Можно ли выбрать только координацию дня?', 'Да. Мы заранее познакомимся с вашим планом, командой и площадкой, чтобы в сам день вы могли быть только гостями своего праздника.'],
      ['Где вы работаете?', 'В Москве и области. Для других городов и выездных свадеб формат обсуждаем отдельно на первой встрече.']
    ];
    return '<main class="pub-page">' + nav('faq') + '<section class="pub-intro pub-faq-intro"><p class="pub-kicker">Вопросы</p><h1>Чтобы было<br><em>спокойнее начать.</em></h1><p>Собрали то, о чём нас спрашивают чаще всего. Если не нашли свой вопрос — просто напишите.</p></section><section class="pub-faq-list">' + questions.map(function (q, i) { return '<details ' + (i === 0 ? 'open' : '') + '><summary>' + T.escape(q[0]) + '<span>+</span></summary><p>' + T.escape(q[1]) + '</p></details>'; }).join('') + '</section><section class="pub-callout"><div><p class="pub-kicker">Остался вопрос?</p><h2>Лучше обсудить<br>его лично.</h2></div>' + cta('Написать нам', 'application') + '</section>' + footer() + '</main>';
  }

  function applicationPage() {
    if (applicationSent) return '<main class="pub-page">' + nav() + '<section class="pub-confirm"><div class="pub-confirm-mark">✓</div><p class="pub-kicker">Заявка принята</p><h1>Спасибо.<br><em>Уже интересно.</em></h1><p>Мы внимательно посмотрим на ваш рассказ и свяжемся с вами, чтобы договориться о первой встрече.</p><button class="pub-text-link" data-action="pub-reset-application" data-route="public">Вернуться на главную <span>→</span></button></section>' + footer() + '</main>';
    return '<main class="pub-page">' + nav() + '<section class="pub-application"><div><p class="pub-kicker">Первая встреча</p><h1>Расскажите<br><em>о вашем дне.</em></h1><p>Не нужно знать всё заранее. Достаточно того, что уже есть: мечта, дата или просто желание начать.</p><div class="pub-application-photo">' + img('couple', 'Влюблённая пара') + '</div></div><form data-action-form="pub-application-submit"><label>Ваши имена<input name="names" required placeholder="Например, Маша и Лёша"></label><label>Как с вами связаться<input name="contact" required placeholder="Телефон или почта"></label><label>Дата свадьбы или сезон<input name="date" placeholder="Например, август 2026"></label><label>Где планируете праздник?<input name="place" placeholder="Город, площадка или идея"></label><label class="pub-field-wide">Что для вас сейчас самое важное?<textarea name="message" required placeholder="Расскажите немного о себе и о свадьбе"></textarea></label><label class="pub-check"><input required type="checkbox"> <span>Я согласен(-на) на связь по этой заявке</span></label><button class="pub-cta" type="submit">Отправить заявку <span>→</span></button></form></section>' + footer() + '</main>';
  }

  function loginPage() {
    return '<main class="pub-page">' + nav() + '<section class="pub-login-page"><div class="pub-login-copy">' + img('tables', 'Свадебный стол') + '<p class="pub-kicker">Пространство подготовки</p><h1>Всё важное<br><em>в одном месте.</em></h1><p>Планы, решения и заботы о гостях — рядом с вами во время подготовки.</p></div><form data-action-form="pub-login-submit"><p class="pub-kicker">Демо-вход</p><h2>Рады видеть</h2><p>Выберите роль, чтобы посмотреть визуальный макет кабинета.</p><label>Имя или почта<input required name="demo-login" value="Алина и Даниил"></label><div class="pub-role-switch"><button type="button" class="' + (T.state.role === 'couple' ? 'is-active' : '') + '" data-action="pub-role" data-role="couple">Пара</button><button type="button" class="' + (T.state.role === 'organizer' ? 'is-active' : '') + '" data-action="pub-role" data-role="organizer">Организатор</button></div><button class="pub-cta" type="submit">Войти в макет <span>→</span></button><button class="pub-text-link" type="button" data-action="pub-go" data-route="public">На публичный сайт</button></form></section>' + footer() + '</main>';
  }

  function guestPage() {
    var project = guestProject();
    var response = (T.state && T.state.guestRsvp) || {};
    var selected = function (value, current) { return value === current ? ' selected' : ''; };
    var checked = function (value) { return value === response.answer ? ' checked' : ''; };
    return '<main class="guest-page"><header class="guest-nav"><button data-action="pub-go" data-route="public">tie<i aria-hidden="true"></i></button><span>' + T.escape(project.name) + '</span><button data-action="pub-scroll-rsvp">Ответить</button></header><section class="guest-hero"><div class="guest-hero-photo">' + img('couple', project.name) + '</div><div class="guest-hero-copy"><p>Приглашение</p><h1>' + T.escape(project.name).replace(' и ', '<br><em>&amp; </em>') + '</h1><span>' + T.escape(project.date) + '</span><button data-action="pub-scroll-rsvp">Разделить с нами день <b>↓</b></button></div></section><section class="guest-message"><p>Мы очень ждём этот день и будем счастливы провести его вместе с вами.</p></section><section class="guest-schedule"><p class="pub-kicker">Программа дня</p><div><article><b>14:30</b><p>Сбор гостей<br><span>Сад у главного дома</span></p></article><article><b>15:30</b><p>Церемония<br><span>У старой липы</span></p></article><article><b>17:00</b><p>Ужин и праздник<br><span>Большая веранда</span></p></article></div></section><section class="guest-palette"><div>' + img('decor', 'Свадебная палитра') + '</div><div><p class="pub-kicker">Дресс-код</p><h2>Нежные природные оттенки.</h2><p>Будем рады, если вы выберете что-то светлое, спокойное и удобное для праздника.</p><span class="guest-swatches"><i></i><i></i><i></i><i></i></span></div></section><section class="guest-info"><article><p class="pub-kicker">Как добраться</p><h2>' + T.escape(project.venue) + '</h2><p>Московская область, 24 км от МКАД. Трансфер от метро «Кунцевская» отправится в 13:30.</p></article><article><p class="pub-kicker">Важное</p><h2>Меню и дети</h2><p>Подскажите в форме, если есть особенности питания. Детям мы тоже очень рады.</p></article></section><section class="guest-rsvp" id="guest-rsvp"><p class="pub-kicker">Ответ на приглашение</p><h2>' + T.escape(project.guestName) + ', вы будете с нами?</h2><p>Будем благодарны за ответ до 12 сентября.</p><form data-action-form="pub-rsvp-submit"><div><label><input type="radio" name="answer" value="yes" required' + checked('yes') + '> Я с радостью приду</label><label><input type="radio" name="answer" value="no"' + checked('no') + '> К сожалению, не смогу</label><label><input type="radio" name="answer" value="maybe"' + checked('maybe') + '> Пока не знаю</label></div><label>Питание<select name="food"><option value="regular"' + selected('regular', response.food || 'regular') + '>Без особенностей</option><option value="vegetarian"' + selected('vegetarian', response.food) + '>Вегетарианское</option><option value="other"' + selected('other', response.food) + '>Другое — напишу ниже</option></select></label><label>Трансфер<select name="transfer"><option value="no"' + selected('no', response.transfer || 'no') + '>Не нужен</option><option value="yes"' + selected('yes', response.transfer) + '>Нужен</option><option value="maybe"' + selected('maybe', response.transfer) + '>Пока не знаю</option></select></label><label>Пожелания и детали<textarea name="note" placeholder="Можно оставить пустым">' + T.escape(response.note || '') + '</textarea></label><button class="pub-cta" type="submit">Отправить ответ <span>→</span></button></form></section><footer class="guest-footer">' + T.escape(project.name) + ' · ' + T.escape(project.date) + '</footer></main>';
  }
  function guestSuccess() {
    var answer = (T.state && T.state.guestAnswer) || 'Ваш ответ';
    var project = guestProject();
    return '<main class="guest-page guest-success"><header class="guest-nav"><button data-action="pub-go" data-route="guest">← Приглашение</button><span>' + T.escape(project.name) + '</span><span></span></header><section><div class="pub-confirm-mark">✓</div><p class="pub-kicker">Спасибо за ответ</p><h1>' + T.escape(answer) + '</h1><p>Мы очень ждём встречи. Если планы поменяются, вы сможете изменить ответ в любое время.</p><button class="pub-cta" data-action="pub-go" data-route="guest">Изменить ответ <span>→</span></button></section></main>';
  }

  /* The editor writes the same draft that the public surface reads on every render. */
  var publicHomeOriginal = publicHome;
  publicHome = function () {
    var draft = publicDraft();
    var title = T.escape(draft.title || 'Ваша история. Внимание к каждой детали.');
    var headline = title.indexOf('.') >= 0 ? title.replace(/\.\s*/, '.<br><em>') + '</em>' : title;
    var text = T.escape(draft.text || 'Придумываем и бережно собираем день, в котором хочется быть — вместе с близкими и без лишней суеты.');
    return publicHomeOriginal()
      .replace('Свадьба,<br><em>в которой вы</em><br>сами себе нравитесь.', headline)
      .replace('Придумываем и бережно собираем день, в котором хочется быть — вместе с близкими и без лишней суеты.', text);
  };

  var storyPageOriginal = storyPage;
  storyPage = function () {
    var draft = publicDraft();
    if (selectedStory !== 0 || (!draft.caseTitle && !draft.caseText)) return storyPageOriginal();
    return storyPageOriginal()
      .replace(T.escape(stories[0].title), T.escape(draft.caseTitle || stories[0].title))
      .replace(T.escape(stories[0].text), T.escape(draft.caseText || stories[0].text));
  };

  var faqPageOriginal = faqPage;
  faqPage = function () {
    var draft = publicDraft();
    if (!draft.faqTitle && !draft.faqText) return faqPageOriginal();
    return faqPageOriginal()
      .replace('С чего начинается работа?', T.escape(draft.faqTitle || 'С чего начинается работа?'))
      .replace('С первой встречи. Обсуждаем ваш день, его масштаб, важные для вас детали и то, на каком этапе вы сейчас. После этого готовим понятное предложение.', T.escape(draft.faqText || 'С первой встречи. Обсуждаем ваш день, его масштаб, важные для вас детали и то, на каком этапе вы сейчас. После этого готовим понятное предложение.'));
  };

  var guestPageOriginal = guestPage;
  guestPage = function () {
    var draft = publicDraft();
    if (!draft.weddingTitle && !draft.weddingText) return guestPageOriginal();
    var original = 'Мы очень ждём этот день и будем счастливы провести его вместе с вами.';
    var message = T.escape(draft.weddingTitle || original) + (draft.weddingText ? '<small>' + T.escape(draft.weddingText) + '</small>' : '');
    return guestPageOriginal().replace(original, message);
  };

  T.register({
    public: { title: 'tie.event', scope: 'public', render: publicHome },
    stories: { title: 'Истории', scope: 'public', render: storiesPage },
    story: { title: 'История пары', scope: 'public', render: storyPage },
    services: { title: 'Услуги', scope: 'public', render: servicesPage },
    'service-detail': { title: 'Услуга', scope: 'public', render: serviceDetail },
    faq: { title: 'Вопросы', scope: 'public', render: faqPage },
    application: { title: 'Заявка', scope: 'public', render: applicationPage },
    login: { title: 'Вход', scope: 'public', render: loginPage },
    guest: { title: 'Приглашение', scope: 'public', render: guestPage },
    'guest-success': { title: 'Ответ принят', scope: 'public', render: guestSuccess }
  });

  T.registerActions({
    'pub-go': function (el) { T.go(el.dataset.route); },
    'pub-story': function (el) { selectedStory = Number(el.dataset.id) || 0; T.go('story'); },
    'pub-service': function (el) { selectedService = Number(el.dataset.id) || 0; T.go('service-detail'); },
    'pub-role': function (el) {
      T.state.role = el.dataset.role;
      el.parentElement.querySelectorAll('button').forEach(function (button) { button.classList.toggle('is-active', button === el); });
    },
    'pub-scroll-rsvp': function () { var form = document.getElementById('guest-rsvp'); if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    'pub-reset-application': function (el) { applicationSent = false; T.go(el.dataset.route); }
  });

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (form.dataset.actionForm === 'pub-application-submit') {
      event.preventDefault(); applicationSent = true; T.render();
    }
    if (form.dataset.actionForm === 'pub-login-submit') {
      event.preventDefault(); T.go(T.state.role==='couple'?'overview':'today');
    }
    if (form.dataset.actionForm === 'pub-rsvp-submit') {
      event.preventDefault();
      var values = T.formValues(form);
      T.state.guestRsvp = values;
      var invited = (T.data.guests || []).find(function(g){return g.id===T.state.guestId;});
      if(invited){invited.rsvp=values.answer;invited.note=values.note;invited.food=values.food;invited.transfer=values.transfer;}
      T.state.guestAnswer = values.answer === 'yes' ? 'До встречи!' : 'Будем скучать.';
      if (values.answer === 'maybe') T.state.guestAnswer = 'Будем ждать вашего решения.';
      rsvpSent = true;
      T.go('guest-success');
    }
  });
})(window.Tie);
