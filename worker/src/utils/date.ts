const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

export function formatDateInZone(timestamp: number, timeZone = DEFAULT_TIME_ZONE): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(new Date(timestamp));
}

export function formatDateTimeInZone(timestamp: number, timeZone = DEFAULT_TIME_ZONE): string {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  return formatter.format(new Date(timestamp));
}

export function formatTimeInZone(timestamp: number, timeZone = DEFAULT_TIME_ZONE): string {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return formatter.format(new Date(timestamp));
}

export function resolveTimestamp(value?: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return Date.now();
}

export function getLocalDateInfo(timeZone = DEFAULT_TIME_ZONE) {
  const now = Date.now();
  return {
    timestamp: now,
    date: formatDateInZone(now, timeZone),
    dateTime: formatDateTimeInZone(now, timeZone)
  };
}

export function resolveDayStartTimestamp(clientTimeIso?: string) {
  const fallbackDate = formatDateInZone(Date.now(), DEFAULT_TIME_ZONE);
  const fallbackOffset = minutesToOffsetString(-new Date().getTimezoneOffset());
  const fallbackTimestamp = Date.parse(`${fallbackDate}T00:00:00${fallbackOffset}`) || Date.now();
  const fallback = {
    dayStart: fallbackTimestamp,
    localDate: fallbackDate,
    timeZoneOffset: fallbackOffset
  };

  if (!clientTimeIso) {
    return fallback;
  }

  const match = clientTimeIso.match(/^(\d{4}-\d{2}-\d{2})T.*([+-]\d{2}):?(\d{2})$/);
  if (!match) {
    return fallback;
  }

  const [, datePart, hourPart, minutePart] = match;
  const offset = `${hourPart}:${minutePart}`;
  const timestamp = Date.parse(`${datePart}T00:00:00${offset}`);
  if (Number.isNaN(timestamp)) {
    return fallback;
  }

  return {
    dayStart: timestamp,
    localDate: datePart,
    timeZoneOffset: offset
  };
}

export const DEFAULT_TIMEZONE = DEFAULT_TIME_ZONE;

function minutesToOffsetString(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const mins = String(abs % 60).padStart(2, '0');
  return `${sign}${hours}:${mins}`;
}
