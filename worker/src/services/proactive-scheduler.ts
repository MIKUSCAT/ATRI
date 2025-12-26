import { Env } from '../types';
import { formatDateInZone } from '../utils/date';

interface TimeSlot {
  start: number;
  end: number;
  weight: number;
}

interface ScheduledTime {
  hour: number;
  minute: number;
  slot: number;
}

const DEFAULT_TIME_SLOTS: TimeSlot[] = [
  { start: 9, end: 12, weight: 2 },
  { start: 12, end: 14, weight: 1 },
  { start: 14, end: 18, weight: 3 },
  { start: 18, end: 21, weight: 2 },
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function weightedRandomSelect(slots: TimeSlot[]): TimeSlot {
  const totalWeight = slots.reduce((sum, slot) => sum + slot.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const slot of slots) {
    random -= slot.weight;
    if (random <= 0) return slot;
  }
  
  return slots[slots.length - 1];
}

function isQuietHour(hour: number, quietStart: number, quietEnd: number): boolean {
  if (quietStart < quietEnd) {
    return hour >= quietStart || hour < quietEnd;
  }
  return hour >= quietStart && hour < quietEnd;
}

function filterQuietHours(slots: TimeSlot[], quietStart: number, quietEnd: number): TimeSlot[] {
  return slots.filter(slot => {
    for (let h = slot.start; h < slot.end; h++) {
      if (!isQuietHour(h, quietStart, quietEnd)) return true;
    }
    return false;
  });
}

function hasConflict(times: ScheduledTime[], hour: number, minGapHours: number): boolean {
  return times.some(t => Math.abs(t.hour - hour) < minGapHours);
}

export function generateDailySchedule(
  dailyCount: number,
  quietStart: number,
  quietEnd: number
): ScheduledTime[] {
  const availableSlots = filterQuietHours(DEFAULT_TIME_SLOTS, quietStart, quietEnd);
  if (availableSlots.length === 0) return [];
  
  const selectedTimes: ScheduledTime[] = [];
  let attempts = 0;
  const maxAttempts = dailyCount * 10;
  
  while (selectedTimes.length < dailyCount && attempts < maxAttempts) {
    attempts++;
    const slot = weightedRandomSelect(availableSlots);
    const hour = randomInt(slot.start, slot.end - 1);
    
    if (isQuietHour(hour, quietStart, quietEnd)) continue;
    if (hasConflict(selectedTimes, hour, 2)) continue;
    
    const minute = randomInt(0, 59);
    selectedTimes.push({ hour, minute, slot: selectedTimes.length + 1 });
  }
  
  return selectedTimes.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
}

export async function createDailySchedules(env: Env, userId: string, date: string, timeZone: string) {
  const settings = await getProactiveSettings(env, userId);
  if (!settings.enabled) return;
  
  const schedules = generateDailySchedule(settings.daily_count, settings.quiet_start, settings.quiet_end);
  const now = Date.now();
  
  for (const schedule of schedules) {
    const id = `schedule:${userId}:${date}:${schedule.slot}`;
    await env.ATRI_DB.prepare(
      `INSERT OR IGNORE INTO proactive_schedules 
       (id, user_id, date, slot, scheduled_hour, scheduled_minute, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).bind(id, userId, date, schedule.slot, schedule.hour, schedule.minute, now).run();
  }
}

export async function getProactiveSettings(env: Env, userId: string) {
  const result = await env.ATRI_DB.prepare(
    'SELECT * FROM proactive_settings WHERE user_id = ?'
  ).bind(userId).first();
  
  if (!result) {
    return {
      enabled: 1,
      daily_count: 2,
      quiet_start: 22,
      quiet_end: 8
    };
  }
  
  return {
    enabled: result.enabled as number,
    daily_count: result.daily_count as number,
    quiet_start: result.quiet_start as number,
    quiet_end: result.quiet_end as number
  };
}

export async function updateProactiveSettings(env: Env, userId: string, settings: any) {
  const now = Date.now();
  await env.ATRI_DB.prepare(
    `INSERT INTO proactive_settings (user_id, enabled, daily_count, quiet_start, quiet_end, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       enabled = excluded.enabled,
       daily_count = excluded.daily_count,
       quiet_start = excluded.quiet_start,
       quiet_end = excluded.quiet_end,
       updated_at = excluded.updated_at`
  ).bind(
    userId,
    settings.enabled ? 1 : 0,
    settings.dailyCount || 2,
    settings.quietStart || 22,
    settings.quietEnd || 8,
    now,
    now
  ).run();
}

export async function getTodayPendingSchedule(env: Env, userId: string, date: string, currentHour: number, currentMinute: number) {
  const result = await env.ATRI_DB.prepare(
    `SELECT * FROM proactive_schedules 
     WHERE user_id = ? AND date = ? AND status = 'pending'
     AND (scheduled_hour < ? OR (scheduled_hour = ? AND scheduled_minute <= ?))
     ORDER BY scheduled_hour, scheduled_minute
     LIMIT 1`
  ).bind(userId, date, currentHour, currentHour, currentMinute).first();
  
  return result;
}

export async function markScheduleSent(env: Env, scheduleId: string) {
  await env.ATRI_DB.prepare(
    `UPDATE proactive_schedules SET status = 'sent', sent_at = ? WHERE id = ?`
  ).bind(Date.now(), scheduleId).run();
}

export async function saveProactiveMessage(env: Env, userId: string, scheduleId: string, content: string, contextType: string) {
  const id = `msg:${userId}:${Date.now()}`;
  const now = Date.now();
  
  await env.ATRI_DB.prepare(
    `INSERT INTO proactive_messages (id, user_id, schedule_id, content, context_type, timestamp, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, userId, scheduleId, content, contextType, now, now).run();
  
  return { id, content, contextType, timestamp: now };
}