(function (T) {
  'use strict';

  var state = { query: '', rsvp: 'all', group: 'all', selectedGuest: null, selectedTable: 't1', selectedEvent: null, dayFilter: 'all' };
  var groupNames = ['Семья невесты', 'Семья жениха', 'Друзья пары', 'Коллеги', 'Дети'];
  var names = [
    ['Екатерина','Волкова'],['Иван','Платонов'],['Мария','Лаврова'],['Сергей','Мартынов'],['Анна','Беляева'],['Павел','Савельев'],['Виктория','Котова'],['Алексей','Нестеров'],
    ['Нина','Орлова'],['Артём','Соловьёв'],['Ольга','Рыбакова'],['Дмитрий','Чернов'],['Лидия','Морозова'],['Вадим','Соколов'],['Елена','Зорина'],['Михаил','Куликов'],
    ['Полина','Акимова'],['Кирилл','Романов'],['Софья','Ершова'],['Роман','Власов'],['Наталья','Брагина'],['Глеб','Ильин'],['Вероника','Данилова'],['Максим','Аксенов'],
    ['Дарья','Громова'],['Фёдор','Селезнёв'],['Ирина','Фомина'],['Леонид','Крылов'],['Ксения','Жукова'],['Тимур','Осипов'],['Алина','Мельникова'],['Егор','Тарасов']
  ];
  var seed = ['yes','yes','yes','yes','yes','yes','yes','yes','no','maybe','yes','yes','yes','yes','yes','yes','yes','yes','yes','yes','yes','maybe','yes','yes','yes','yes','yes','yes','yes','yes','yes','yes'];
  var rsvpText = { yes: 'Подтвердил', no: 'Не придёт', maybe: 'Думает', waiting: 'Ждём ответ' };
  var rsvpTone = { yes: 'green', no: 'red', maybe: 'amber', waiting: 'gray' };

  function ensureData() {
    if (!T.data.guests) T.data.guests = names.map(function (pair, i) {
      return { id: 'g' + (i + 1), first: pair[0], last: pair[1], group: groupNames[i % groupNames.length], rsvp: seed[i], party: 1, note: i === 8 ? 'Без глютена' : '', tableId: i < 8 ? 't1' : i < 16 ? 't2' : i < 24 ? 't3' : i < 30 ? 't4' : null, seat: i < 30 ? (i % 8) + 1 : null };
    });
    if (!T.data.tables) T.data.tables = [
      { id: 't1', name: 'Стол 1', subtitle: 'Семья невесты', capacity: 8, x: 174, y: 295 },
      { id: 't2', name: 'Стол 2', subtitle: 'Семья жениха', capacity: 8, x: 416, y: 295 },
      { id: 't3', name: 'Стол 3', subtitle: 'Друзья пары', capacity: 8, x: 658, y: 295 },
      { id: 't4', name: 'Стол 4', subtitle: 'Коллеги', capacity: 8, x: 900, y: 295 }
    ];
    if (!T.data.eventZones) T.data.eventZones = [{ id: 'z1', name: 'Фотозона', x: 70, y: 54, width: 150, height: 96 }, { id: 'z2', name: 'Танцпол', x: 392, y: 456, width: 290, height: 115 }];
    if (!T.data.dayEvents) T.data.dayEvents = [
      { id: 'e1', time: '10:00', end: '11:00', title: 'Заезд команды и монтаж', place: 'Усадьба «Липы»', people: 'Организаторы · декор', type: 'team', note: 'Проверить зону welcome и готовность навигации.' },
      { id: 'e2', time: '13:30', end: '14:15', title: 'Сбор пары и first look', place: 'Сад у оранжереи', people: 'Алина · Даниил · фотограф', type: 'couple', note: 'Координатор встречает пару у главного входа.' },
      { id: 'e3', time: '15:00', end: '15:30', title: 'Сбор гостей', place: 'Welcome-зона', people: 'Все гости · хостес', type: 'team', note: 'Выдача карточек рассадки и приветственный бар.' },
      { id: 'e4', time: '15:30', end: '16:00', title: 'Церемония', place: 'Сад у арки', people: 'Пара · гости · ведущий', type: 'couple', note: 'Музыка включается по сигналу координатора.' },
      { id: 'e5', time: '17:00', end: '19:00', title: 'Ужин и тосты', place: 'Основной зал', people: 'Все гости · ведущий', type: 'couple', note: 'Рассадка открывается после церемонии.' },
      { id: 'e6', time: '20:30', end: '23:00', title: 'Танцы и вечерняя программа', place: 'Основной зал', people: 'Все гости · DJ', type: 'team', note: 'Световой сценарий и музыка по листу ведущего.' }
    ];
  }
  ensureData();

  function fullName(g) { return g.first + ' ' + g.last; }
  function guestsAt(table) { return T.data.guests.filter(function (g) { return g.tableId === table.id; }); }
  function seatingCount(table) { return guestsAt(table).reduce(function (sum, g) { return sum + Number(g.party || 1); }, 0); }
  function tableById(id) { return T.data.tables.find(function (table) { return table.id === id; }); }
  function stat(label, value, note) { return '<article class="stat-card ev-stat"><span>' + label + '</span><strong>' + value + '</strong><small>' + note + '</small></article>'; }
  function actions(label, action, kind, attrs) { return T.button(label, action, kind || 'secondary', attrs || ''); }
  function guestInitials(g) { return T.avatar(g.first + ' ' + g.last); }
  function title() { return T.heading('Гости', 'Приглашения, ответы и места за столами', actions(T.icon('plus') + ' Добавить гостя', 'ev-guest-create', 'primary')); }
  function visibleGuests() {
    return T.data.guests.filter(function (g) {
      var q = state.query.trim().toLowerCase();
      return (!q || fullName(g).toLowerCase().indexOf(q) > -1 || g.group.toLowerCase().indexOf(q) > -1) && (state.rsvp === 'all' || g.rsvp === state.rsvp) && (state.group === 'all' || g.group === state.group);
    });
  }
  function emptyOrIssues(screen, filled) {
    if (T.state.mode === 'empty') return T.empty(screen === 'guests' ? 'Список гостей пока пуст' : 'Тайминг ещё не собран', screen === 'guests' ? 'Добавьте первых приглашённых — ответы и рассадка появятся здесь.' : 'Добавьте ключевые моменты дня, чтобы вся команда работала по одному плану.', actions(screen === 'guests' ? 'Добавить гостя' : 'Добавить событие', screen === 'guests' ? 'ev-guest-create' : 'ev-day-create', 'primary'));
    var issue = T.state.mode === 'issues' ? '<div class="notice amber ev-issue"><strong>Нужно внимание.</strong> ' + (screen === 'guests' ? 'Два приглашения всё ещё ждут ответа.' : 'У церемонии не назначен ответственный от площадки.') + '</div>' : '';
    return issue + filled;
  }

  function guests() {
    var total = T.data.guests.length;
    var confirmed = T.data.guests.filter(function (g) { return g.rsvp === 'yes'; }).reduce(function (sum, g) { return sum + g.party; }, 0);
    var pending = T.data.guests.filter(function (g) { return g.rsvp === 'waiting' || g.rsvp === 'maybe'; }).length;
    var list = visibleGuests();
    var options = '<option value="all">Все группы</option>' + groupNames.map(function (name) { return '<option value="' + T.escape(name) + '">' + T.escape(name) + '</option>'; }).join('');
    var rows = list.map(function (g) {
      var table = tableById(g.tableId);
      return '<tr class="clickable-row" data-action="ev-guest-open" data-id="' + g.id + '"><td><div class="ev-guest-cell">' + guestInitials(g) + '<div><strong>' + T.escape(fullName(g)) + '</strong><small>' + T.escape(g.group) + (g.party > 1 ? ' · +1' : '') + '</small></div></div></td><td>' + T.badge(rsvpText[g.rsvp], rsvpTone[g.rsvp]) + '</td><td class="ev-desk-only">' + (table ? T.escape(table.name) + ' · ' + g.seat : '<span class="subtle">Не рассажен</span>') + '</td><td><button class="icon-btn" aria-label="Открыть гостя" data-action="ev-guest-open" data-id="' + g.id + '">' + T.icon('chevron', 16) + '</button></td></tr>';
    }).join('');
    var content = title() + '<div class="stat-grid ev-guest-stats">' + stat('Приглашено', total, 'в списке') + stat('Подтвердили', confirmed, 'с учётом спутников') + stat('Ждём ответа', pending, 'нужен контакт') + stat('Рассажены', T.data.guests.filter(function (g) { return g.tableId; }).length, 'по столам') + '</div><div class="panel ev-guests-panel"><div class="toolbar ev-guest-toolbar"><label class="search-input ev-search">' + T.icon('search', 16) + '<input data-ev-control="ev-guest-search" value="' + T.escape(state.query) + '" placeholder="Имя или группа"></label><div class="segmented ev-rsvp-filter">' + ['all','yes','maybe','no'].map(function (key) { return '<button class="' + (state.rsvp === key ? 'active' : '') + '" data-action="ev-guest-rsvp" data-value="' + key + '">' + (key === 'all' ? 'Все' : rsvpText[key]) + '</button>'; }).join('') + '</div><select class="ev-group-select" data-ev-control="ev-guest-group">' + options + '</select><span class="spacer"></span>' + actions('Пригласить', 'ev-guest-invite', 'secondary') + '</div><div class="table-wrap"><table class="data-table ev-guest-table"><thead><tr><th>Гость</th><th>Ответ</th><th class="ev-desk-only">Место</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="4">' + T.empty('Ничего не найдено', 'Измените поиск или фильтр.', '') + '</td></tr>') + '</tbody></table></div></div>';
    return emptyOrIssues('guests', content);
  }

  function guestDetail() {
    var guest = T.data.guests.find(function (item) { return item.id === T.state.detailId || item.id === state.selectedGuest; }) || T.data.guests[0];
    var table = tableById(guest.tableId);
    var options = ['yes','maybe','no','waiting'].map(function (value) { return '<option value="' + value + '"' + (guest.rsvp === value ? ' selected' : '') + '>' + rsvpText[value] + '</option>'; }).join('');
    var content = '<button class="link-button ev-back" data-action="ev-guest-back">' + T.icon('arrow', 16) + ' К списку гостей</button>' + T.heading(fullName(guest), guest.group, actions(T.icon('edit') + ' Редактировать', 'ev-guest-edit', 'primary', 'data-id="' + guest.id + '"')) + '<div class="two-col ev-detail-grid"><section class="panel panel-pad"><div class="ev-profile-head">' + guestInitials(guest) + '<div><span class="eyebrow">Приглашение</span><h3>' + T.escape(fullName(guest)) + '</h3><p class="subtle">' + T.escape(guest.group) + (guest.party > 1 ? ' · со спутником' : '') + '</p></div>' + T.badge(rsvpText[guest.rsvp], rsvpTone[guest.rsvp]) + '</div><div class="divider"></div><dl class="ev-detail-list"><div><dt>Ответ</dt><dd><select data-ev-control="ev-guest-status" data-id="' + guest.id + '">' + options + '</select></dd></div><div><dt>Стол</dt><dd>' + (table ? T.escape(table.name) + ' · место ' + guest.seat : 'Пока не выбран') + '</dd></div><div><dt>Питание</dt><dd>' + (guest.note || 'Без пожеланий') + '</dd></div></dl><div class="inline ev-detail-actions">' + actions('Открыть приглашение', 'ev-guest-invite', 'secondary', 'data-id="' + guest.id + '"') + actions('Удалить', 'ev-guest-remove', 'danger', 'data-id="' + guest.id + '"') + '</div></section><aside class="panel panel-pad ev-detail-side"><p class="eyebrow">Рассадка</p><h3>' + (table ? T.escape(table.name) : 'Свободный гость') + '</h3><p class="subtle">Назначьте место через план зала.</p>' + actions('Выбрать стол', 'ev-guest-seat', 'primary', 'data-id="' + guest.id + '"') + '</aside></div>';
    return emptyOrIssues('guests', content);
  }

  function seatCircle(table, i, count) { var angle = (Math.PI * 2 * i / table.capacity) - Math.PI / 2; var x = table.x + Math.cos(angle) * 85; var y = table.y + Math.sin(angle) * 85; return '<circle class="ev-seat ' + (i < count ? 'occupied' : '') + '" cx="' + x + '" cy="' + y + '" r="9"></circle>'; }
  function seatingSvg() {
    var zones = T.data.eventZones.map(function (zone) { return '<g><rect class="ev-zone" x="' + zone.x + '" y="' + zone.y + '" width="' + zone.width + '" height="' + zone.height + '" rx="10"></rect><text class="ev-zone-label" x="' + (zone.x + zone.width / 2) + '" y="' + (zone.y + zone.height / 2) + '">' + T.escape(zone.name) + '</text></g>'; }).join('');
    var tables = T.data.tables.map(function (table) { var count = seatingCount(table); return '<g class="ev-plan-table ' + (state.selectedTable === table.id ? 'selected' : '') + '" data-action="ev-seat-table" data-id="' + table.id + '" tabindex="0" role="button" aria-label="' + T.escape(table.name) + '">' + Array.from({ length: table.capacity }, function (_, i) { return seatCircle(table, i, count); }).join('') + '<circle class="ev-table-core" cx="' + table.x + '" cy="' + table.y + '" r="65"></circle><text class="ev-table-name" x="' + table.x + '" y="' + (table.y - 8) + '">' + T.escape(table.name) + '</text><text class="ev-table-meta" x="' + table.x + '" y="' + (table.y + 16) + '">' + count + ' из ' + table.capacity + '</text></g>'; }).join('');
    return '<svg viewBox="0 0 1070 620" role="img" aria-label="План рассадки">' + zones + '<g><rect class="ev-couple-table" x="421" y="72" width="228" height="76" rx="14"></rect><text class="ev-table-name" x="535" y="103">Стол пары</text><text class="ev-table-meta" x="535" y="124">Алина и Даниил</text></g>' + tables + '<text class="ev-entrance" x="74" y="578">Вход ↑</text></svg>';
  }
  function seating() {
    var selected = tableById(state.selectedTable) || T.data.tables[0];
    var waiting = T.data.guests.filter(function (g) { return !g.tableId; });
    var placed = guestsAt(selected);
    var side = '<aside class="panel ev-seat-sidebar"><div class="panel-pad"><div class="ev-side-title"><div><p class="eyebrow">Нерассаженные</p><h3>' + waiting.length + ' гостя</h3></div>' + actions('Добавить', 'ev-guest-create', 'ghost') + '</div><div class="ev-waiting-list">' + (waiting.length ? waiting.map(function (g) { return '<button class="ev-guest-chip ' + (state.selectedGuest === g.id ? 'active' : '') + '" data-action="ev-seat-guest" data-id="' + g.id + '">' + guestInitials(g) + '<span>' + T.escape(fullName(g)) + '<small>' + T.escape(g.group) + '</small></span></button>'; }).join('') : '<p class="subtle">Все гости рассажены.</p>') + '</div></div><div class="ev-table-properties"><p class="eyebrow">Выбранный стол</p><h3>' + T.escape(selected.name) + '</h3><p class="subtle">' + T.escape(selected.subtitle) + ' · ' + seatingCount(selected) + ' из ' + selected.capacity + ' мест</p><div class="ev-placed-list">' + placed.slice(0, 5).map(function (g) { return '<button data-action="ev-guest-open" data-id="' + g.id + '">' + guestInitials(g) + T.escape(fullName(g)) + '</button>'; }).join('') + (placed.length > 5 ? '<span class="subtle">ещё ' + (placed.length - 5) + '</span>' : '') + '</div>' + (state.selectedGuest ? actions('Посадить выбранного', 'ev-seat-assign', 'primary') : '<p class="ev-select-hint">Выберите гостя справа, затем стол на схеме.</p>') + '</div></aside>';
    var content = T.heading('Рассадка', 'Основной зал · выберите гостя и стол на схеме', actions(T.icon('plus') + ' Добавить стол', 'ev-seat-add-table', 'primary')) + '<div class="toolbar ev-seat-toolbar">' + actions('Добавить зону', 'ev-seat-add-zone', 'secondary') + actions(T.icon('download') + ' Печать', 'ev-seat-print', 'secondary') + '<span class="spacer"></span><span class="subtle">' + T.data.guests.filter(function (g) { return g.tableId; }).length + ' из ' + T.data.guests.length + ' рассажены</span></div><div class="ev-seating-layout"><section class="ev-plan-canvas">' + seatingSvg() + '</section>' + side + '</div>';
    return emptyOrIssues('seating', content);
  }

  function day() {
    var events = T.data.dayEvents.filter(function (event) { return state.dayFilter === 'all' || event.type === state.dayFilter; });
    var timeline = events.map(function (event) { return '<article class="ev-timeline-item" data-action="ev-day-open" data-id="' + event.id + '"><time>' + event.time + '<small>' + event.end + '</small></time><span class="ev-timeline-dot ' + event.type + '"></span><div class="ev-event-card"><div><span class="eyebrow">' + (event.type === 'couple' ? 'Пара' : 'Команда') + '</span><h3>' + T.escape(event.title) + '</h3><p>' + T.icon('calendar', 14) + ' ' + T.escape(event.place) + '</p></div><span class="ev-event-people">' + T.escape(event.people) + '</span>' + T.icon('chevron', 16) + '</div></article>'; }).join('');
    var content = T.heading('День свадьбы', 'Суббота, 19 сентября · весь день у команды перед глазами', actions(T.icon('plus') + ' Добавить событие', 'ev-day-create', 'primary')) + '<div class="panel ev-day-intro"><div><p class="eyebrow">До первого события</p><strong>2 ч 10 мин</strong><span>заезд команды в 10:00</span></div><div class="ev-day-people">' + T.avatar('М') + T.avatar('К') + T.avatar('А') + '<span>Команда на площадке</span></div></div><div class="toolbar ev-day-toolbar"><div class="segmented"><button class="' + (state.dayFilter === 'all' ? 'active' : '') + '" data-action="ev-day-filter" data-value="all">Все</button><button class="' + (state.dayFilter === 'couple' ? 'active' : '') + '" data-action="ev-day-filter" data-value="couple">Пара</button><button class="' + (state.dayFilter === 'team' ? 'active' : '') + '" data-action="ev-day-filter" data-value="team">Команда</button></div><span class="spacer"></span><button class="btn ghost" data-action="ev-day-print">Версия для печати</button></div><section class="ev-timeline">' + (timeline || T.empty('В этой части дня пока нет событий', 'Смените фильтр или добавьте событие.', actions('Добавить событие', 'ev-day-create', 'primary'))) + '</section>';
    return emptyOrIssues('day', content);
  }

  function guestForm(guest) {
    guest = guest || { first: '', last: '', group: groupNames[0], rsvp: 'waiting', party: 1, note: '' };
    return '<form class="form-grid ev-modal-form" data-form="guest"><label class="field">Имя' + T.input('first', guest.first, 'Например, Нина') + '</label><label class="field">Фамилия' + T.input('last', guest.last, 'Орлова') + '</label><label class="field">Группа' + T.select('group', groupNames, guest.group) + '</label><label class="field">Ответ' + T.select('rsvp', [['waiting','Ждём ответ'],['yes','Подтвердил'],['maybe','Думает'],['no','Не придёт']], guest.rsvp) + '</label><label class="field">Количество гостей' + T.input('party', String(guest.party), '', 'number') + '</label><label class="field full">Питание и пожелания<textarea name="note" rows="3" placeholder="Например, вегетарианское меню">' + T.escape(guest.note || '') + '</textarea></label></form>';
  }
  function openGuestModal(guest) { T.modal({ title: guest ? 'Редактировать гостя' : 'Новый гость', body: guestForm(guest), footer: actions('Сохранить', 'ev-guest-save', 'primary', guest ? 'data-id="' + guest.id + '"' : '') }); }
  function eventForm(event) { event = event || { time: '12:00', end: '12:30', title: '', place: '', people: '', type: 'team', note: '' }; return '<form class="form-grid ev-modal-form" data-form="event"><label class="field">Начало' + T.input('time', event.time, '', 'time') + '</label><label class="field">Окончание' + T.input('end', event.end, '', 'time') + '</label><label class="field full">Событие' + T.input('title', event.title, 'Например, вынос торта') + '</label><label class="field">Площадка' + T.input('place', event.place, 'Основной зал') + '</label><label class="field">Участники' + T.input('people', event.people, 'Пара · ведущий') + '</label><label class="field">Вид' + T.select('type', [['team','Команда'],['couple','Пара']], event.type) + '</label><label class="field full">Комментарий<textarea name="note" rows="3">' + T.escape(event.note || '') + '</textarea></label></form>'; }
  function openEventModal(event) { T.modal({ title: event ? 'Событие дня' : 'Новое событие', body: eventForm(event), footer: actions('Сохранить событие', 'ev-day-save', 'primary', event ? 'data-id="' + event.id + '"' : '') }); }
  function render() { T.render(); }

  T.registerActions({
    'ev-guest-search': function (el) { state.query = el.value; render(); },
    'ev-guest-rsvp': function (el) { state.rsvp = el.dataset.value; render(); },
    'ev-guest-group': function (el) { state.group = el.value; render(); },
    'ev-guest-open': function (el) { state.selectedGuest = el.dataset.id; T.state.detailId = el.dataset.id; T.go('guest-detail'); },
    'ev-guest-back': function () { T.go('guests'); },
    'ev-guest-create': function () { openGuestModal(); },
    'ev-guest-edit': function (el) { openGuestModal(T.data.guests.find(function (g) { return g.id === el.dataset.id; })); },
    'ev-guest-save': function (el) { var form = el.closest('[role="dialog"]') && el.closest('[role="dialog"]').querySelector('form'); if (!form) return; var values = T.formValues(form); if (!values.first || !values.last) { T.toast('Укажите имя и фамилию.'); return; } var id = el.dataset.id; var guest = id && T.data.guests.find(function (g) { return g.id === id; }); if (!guest) { guest = { id: 'g' + Date.now(), tableId: null, seat: null }; T.data.guests.push(guest); } Object.assign(guest, values, { party: Math.max(1, Number(values.party || 1)) }); T.closeModal(); render(); T.toast('Гость сохранён.'); },
    'ev-guest-status': function (el) { var guest = T.data.guests.find(function (g) { return g.id === el.dataset.id; }); guest.rsvp = el.value; render(); T.toast('Ответ обновлён.'); },
    'ev-guest-remove': function (el) { var guest = T.data.guests.find(function (g) { return g.id === el.dataset.id; }); T.modal({ title: 'Удалить гостя?', body: '<p>«' + T.escape(fullName(guest)) + '» исчезнет из списка и плана рассадки.</p>', footer: actions('Удалить', 'ev-guest-confirm-remove', 'danger', 'data-id="' + guest.id + '"') }); },
    'ev-guest-confirm-remove': function (el) { T.data.guests = T.data.guests.filter(function (g) { return g.id !== el.dataset.id; }); T.closeModal(); T.go('guests'); T.toast('Гость удалён.'); },
    'ev-guest-seat': function (el) { state.selectedGuest = el.dataset.id; T.go('seating'); },
    'ev-guest-invite': function (el) { var guest = T.data.guests.find(function (g) { return g.id === el.dataset.id; }) || T.data.guests[0]; T.state.guestName=guest.first;T.state.guestId=guest.id;T.state.guestRsvp={answer:guest.rsvp==='waiting'?'':guest.rsvp,note:guest.note||'',food:guest.food||'regular',transfer:guest.transfer||'no'}; T.modal({ title: 'Приглашение · ' + T.escape(guest.first), body: '<div class="ev-invite-preview"><span class="eyebrow">Алина и Даниил · 19 сентября</span><h2>Будем рады видеть вас</h2><p>Персональная страница с ответом, программой дня и схемой проезда уже готова.</p></div>', footer: '<a class="btn primary" href="#guest" data-go="guest">Открыть приглашение</a>' }); },
    'ev-seat-guest': function (el) { state.selectedGuest = el.dataset.id; render(); },
    'ev-seat-table': function (el) { state.selectedTable = el.dataset.id; render(); },
    'ev-seat-assign': function () { var guest = T.data.guests.find(function (g) { return g.id === state.selectedGuest; }); var table = tableById(state.selectedTable); if (!guest || !table) return; var occupied = seatingCount(table); if (occupied + guest.party > table.capacity) { T.toast('За этим столом недостаточно мест.'); return; } guest.tableId = table.id; guest.seat = occupied + 1; state.selectedGuest = null; render(); T.toast(fullName(guest) + ' теперь за ' + table.name + '.'); },
    'ev-seat-add-table': function () { T.modal({ title: 'Добавить стол', body: '<form class="form-grid ev-modal-form" data-form="table"><label class="field full">Название' + T.input('name', 'Стол ' + (T.data.tables.length + 1)) + '</label><label class="field">Вместимость' + T.input('capacity', '8', '', 'number') + '</label><label class="field">Группа гостей' + T.input('subtitle', 'Новая группа') + '</label></form>', footer: actions('Добавить стол', 'ev-seat-save-table', 'primary') }); },
    'ev-seat-save-table': function (el) { var values = T.formValues(el.closest('[role="dialog"]').querySelector('form')); T.data.tables.push({ id: 't' + Date.now(), name: values.name || 'Новый стол', subtitle: values.subtitle || 'Гости', capacity: Math.max(2, Number(values.capacity || 8)), x: 160 + (T.data.tables.length % 4) * 245, y: 450 }); T.closeModal(); render(); T.toast('Стол добавлен на план.'); },
    'ev-seat-add-zone': function () { T.modal({ title: 'Добавить зону', body: '<form class="form-grid ev-modal-form"><label class="field full">Название зоны' + T.input('name', 'Welcome-зона') + '</label></form>', footer: actions('Добавить зону', 'ev-seat-save-zone', 'primary') }); },
    'ev-seat-save-zone': function (el) { var values = T.formValues(el.closest('[role="dialog"]').querySelector('form')); T.data.eventZones.push({ id: 'z' + Date.now(), name: values.name || 'Новая зона', x: 760, y: 70, width: 200, height: 100 }); T.closeModal(); render(); T.toast('Зона добавлена на план.'); },
    'ev-seat-print': function () { T.modal({ title: 'Предпросмотр печати', wide: true, body: '<div class="ev-print-preview"><h2>Рассадка · Алина и Даниил</h2><p>19 сентября 2026 · Усадьба «Липы»</p>' + T.data.tables.map(function (table) { return '<div><strong>' + T.escape(table.name) + '</strong><span>' + guestsAt(table).map(fullName).join(' · ') + '</span></div>'; }).join('') + '</div>', footer: actions(T.icon('download') + ' Открыть печать', 'ev-seat-do-print', 'primary') }); },
    'ev-seat-do-print': function () { window.print(); },
    'ev-day-filter': function (el) { state.dayFilter = el.dataset.value; render(); },
    'ev-day-open': function (el) { openEventModal(T.data.dayEvents.find(function (event) { return event.id === el.dataset.id; })); },
    'ev-day-create': function () { openEventModal(); },
    'ev-day-save': function (el) { var form = el.closest('[role="dialog"]').querySelector('form'); var values = T.formValues(form); if (!values.title) { T.toast('Назовите событие.'); return; } var existing = el.dataset.id && T.data.dayEvents.find(function (event) { return event.id === el.dataset.id; }); if (existing) Object.assign(existing, values); else T.data.dayEvents.push(Object.assign({ id: 'e' + Date.now() }, values)); T.data.dayEvents.sort(function (a, b) { return a.time.localeCompare(b.time); }); T.closeModal(); render(); T.toast('Событие сохранено в тайминге.'); },
    'ev-day-print': function () { T.modal({ title: 'Версия для печати', body: '<div class="ev-print-preview"><h2>Тайминг дня</h2>' + T.data.dayEvents.map(function (event) { return '<div><strong>' + event.time + ' · ' + T.escape(event.title) + '</strong><span>' + T.escape(event.place) + '</span></div>'; }).join('') + '</div>', footer: actions('Печать', 'ev-seat-do-print', 'primary') }); }
  });

  document.addEventListener('input', function (event) {
    if (event.target.dataset.evControl === 'ev-guest-search') { state.query = event.target.value; render(); }
  });
  document.addEventListener('change', function (event) {
    var el = event.target;
    if (el.dataset.evControl === 'ev-guest-group') { state.group = el.value; render(); }
    if (el.dataset.evControl === 'ev-guest-status') { var guest = T.data.guests.find(function (g) { return g.id === el.dataset.id; }); if (guest) { guest.rsvp = el.value; render(); T.toast('Ответ обновлён.'); } }
  });
  document.addEventListener('keydown', function (event) {
    var table = event.target.closest && event.target.closest('.ev-plan-table');
    if (table && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); state.selectedTable = table.dataset.id; render(); }
  });

  T.register({
    guests: { title: 'Гости', scope: 'project', tab: 'guests', render: guests },
    'guest-detail': { title: 'Гость', scope: 'project', tab: 'guests', render: guestDetail },
    seating: { title: 'Рассадка', scope: 'project', tab: 'seating', render: seating },
    day: { title: 'День свадьбы', scope: 'project', tab: 'day', render: day }
  });
})(window.Tie);
