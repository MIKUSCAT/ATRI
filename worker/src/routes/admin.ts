import type { Router } from 'itty-router';
import { Env } from '../types';
import { jsonResponse } from '../utils/json-response';
import {
  deleteConversationLogsByUser,
  deleteDiaryEntriesByUser,
  deleteFactMemoriesByUser,
  deleteUserProfileByUser,
  deleteUserSettingsByUser,
  deleteUserStateByUser,
  listDiaryDatesByUser
} from '../services/data-service';
import { deleteDiaryVectors } from '../services/memory-service';
import { sanitizeFileName } from '../utils/file';

function extractToken(value: string | null) {
  if (!value) return '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : value.trim();
}

export function registerAdminRoutes(router: Router) {
  router.post('/admin/clear-user', async (request, env: Env) => {
    const adminKey = (env.ADMIN_API_KEY || '').trim();
    if (!adminKey) {
      return jsonResponse({ error: 'admin_disabled' }, 503);
    }
    const providedKey = extractToken(request.headers.get('Authorization'));
    if (providedKey !== adminKey) {
      return jsonResponse({ error: 'forbidden' }, 403);
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400);
    }
    const userId = String(body?.userId || '').trim();
    if (!userId) {
      return jsonResponse({ error: 'missing_user' }, 400);
    }

    try {
      const diaryDates = await listDiaryDatesByUser(env, userId);
      const diaryDeleted = await deleteDiaryEntriesByUser(env, userId);
      const logDeleted = await deleteConversationLogsByUser(env, userId);
      const vectorIds = buildUserMemoryVectorIds(userId, diaryDates);
      const vectorDeleted = vectorIds.length ? await deleteDiaryVectors(env, vectorIds) : 0;
      const mediaDeleted = await deleteUserMediaObjects(env, userId);
      const settingsDeleted = await deleteUserSettingsByUser(env, userId);
      const profileDeleted = await deleteUserProfileByUser(env, userId);
      const factDeleted = await deleteFactMemoriesByUser(env, userId);
      const userStateDeleted = await deleteUserStateByUser(env, userId);

      return jsonResponse({
        ok: true,
        userId,
        stats: {
          diaries: diaryDeleted,
          diaryVectors: vectorDeleted,
          conversationLogs: logDeleted,
          mediaObjects: mediaDeleted,
          userSettings: settingsDeleted,
          userProfiles: profileDeleted,
          factMemories: factDeleted,
          userStates: userStateDeleted
        }
      });
    } catch (error: any) {
      console.error('[ATRI] Failed to clear user data:', userId, error);
      return jsonResponse({ error: 'clear_failed', details: String(error?.message || error) }, 500);
    }
  });
}

function buildUserMemoryVectorIds(userId: string, dates: string[]) {
  const safeUserId = String(userId || '').trim();
  const safeDates = Array.isArray(dates) ? dates : [];
  const MAX_HIGHLIGHTS_PER_DAY = 10;
  const ids: string[] = [];

  for (const date of safeDates) {
    const d = String(date || '').trim();
    if (!d) continue;

    // 新实现：highlight 向量（按固定上限枚举）
    for (let i = 0; i < MAX_HIGHLIGHTS_PER_DAY; i++) {
      ids.push(`hl:${safeUserId}:${d}:${i}`);
    }
  }

  return ids;
}

async function deleteUserMediaObjects(env: Env, userId: string) {
  if (!env.MEDIA_BUCKET) {
    return 0;
  }
  const safeUser = sanitizeFileName(userId) || 'anon';
  const prefix = `u/${safeUser}/`;
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const list = await env.MEDIA_BUCKET.list({ prefix, cursor, limit: 1000 });
    for (const obj of list.objects || []) {
      try {
        await env.MEDIA_BUCKET.delete(obj.key);
        deleted++;
      } catch (error) {
        console.warn('[ATRI] Failed to delete media object', obj.key, error);
      }
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return deleted;
}
