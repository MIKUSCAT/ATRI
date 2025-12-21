import type { Router } from 'itty-router';
import { Env } from '../types';
import { jsonResponse } from '../utils/json-response';
import {
  deleteConversationLogsByUser,
  deleteDiaryEntriesByUser,
  deleteUserSettingsByUser,
  listDiaryIdsByUser
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
      const diaryIds = await listDiaryIdsByUser(env, userId);
      const diaryDeleted = await deleteDiaryEntriesByUser(env, userId);
      const logDeleted = await deleteConversationLogsByUser(env, userId);
      const vectorDeleted = diaryIds.length ? await deleteDiaryVectors(env, diaryIds) : 0;
      const mediaDeleted = await deleteUserMediaObjects(env, userId);
      const settingsDeleted = await deleteUserSettingsByUser(env, userId);

      return jsonResponse({
        ok: true,
        userId,
        stats: {
          diaries: diaryDeleted,
          diaryVectors: vectorDeleted,
          conversationLogs: logDeleted,
          mediaObjects: mediaDeleted,
          userSettings: settingsDeleted
        }
      });
    } catch (error: any) {
      console.error('[ATRI] Failed to clear user data:', userId, error);
      return jsonResponse({ error: 'clear_failed', details: String(error?.message || error) }, 500);
    }
  });
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
