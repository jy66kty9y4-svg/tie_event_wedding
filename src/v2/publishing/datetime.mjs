const LOCAL_VALUE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

function formatter(timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function partsAt(instant, timeZone) {
  return Object.fromEntries(formatter(timeZone).formatToParts(new Date(instant))
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, part.value]));
}

export function instantToZonedInput(value, timeZone = 'Europe/Moscow') {
  if (!value) return '';
  const instant = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(instant)) throw new Error('Проверьте дату закрытия сайта');
  const parts = partsAt(instant, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function zonedInputToInstant(value, timeZone = 'Europe/Moscow', preferredInstant = '') {
  if (!value) return '';
  const match = LOCAL_VALUE.exec(value);
  if (!match) throw new Error('Проверьте дату закрытия сайта');
  const [, year, month, day, hour, minute] = match;
  const target = `${year}-${month}-${day}T${hour}:${minute}`;

  if (preferredInstant && instantToZonedInput(preferredInstant, timeZone) === target) {
    return new Date(preferredInstant).toISOString();
  }

  const center = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const offsets = new Set();
  for (const delta of [-172800000, -86400000, 0, 86400000, 172800000]) {
    const instant = center + delta;
    const parts = partsAt(instant, timeZone);
    offsets.add(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) - instant);
  }
  const candidates = [...offsets]
    .map(offset => center - offset)
    .filter(instant => instantToZonedInput(instant, timeZone) === target)
    .sort((a, b) => a - b);
  if (!candidates.length) throw new Error('Это местное время не существует из-за перевода часов');
  return new Date(candidates[0]).toISOString();
}
