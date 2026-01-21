import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Env } from '../runtime/types';
import { sendJson } from '../utils/reply';
import { timingSafeEqual } from '../utils/auth';
import { sanitizeFileName } from '../utils/file';
import {
  deleteConversationLogsByUser,
  deleteDiaryEntriesByUser,
  deleteUserSettingsByUser,
  listDiaryDatesByUser
} from '../services/data-service';
import { deleteDiaryVectors } from '../services/memory-service';

function extractToken(value: string | undefined) {
  const raw = String(value || '').trim();
  return raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw;
}

function buildUserMemoryVectorIds(userId: string, dates: string[]) {
  const safeUserId = String(userId || '').trim();
  const safeDates = Array.isArray(dates) ? dates : [];
  const MAX_HIGHLIGHTS_PER_DAY = 10;
  const ids: string[] = [];

  for (const date of safeDates) {
    const d = String(date || '').trim();
    if (!d) continue;
    for (let i = 0; i < MAX_HIGHLIGHTS_PER_DAY; i++) {
      ids.push(`hl:${safeUserId}:${d}:${i}`);
    }
  }

  return ids;
}

async function deleteUserMediaObjects(env: Env, userId: string) {
  const safeUser = sanitizeFileName(userId) || 'anon';
  const userDir = path.join(env.MEDIA_ROOT, 'u', safeUser);

  try {
    await fs.access(userDir);
  } catch {
    return 0;
  }

  let deleted = 0;
  const walk = async (dir: string) => {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        await walk(full);
      } else {
        try {
          await fs.rm(full, { force: true });
          deleted++;
        } catch {
          // ignore
        }
      }
    }
  };

  await walk(userDir);
  await fs.rm(userDir, { recursive: true, force: true });
  return deleted;
}

export function registerAdminRoutes(app: FastifyInstance, env: Env) {
  app.post('/admin/clear-user', async (request, reply) => {
    const adminKey = String(env.ADMIN_API_KEY || '').trim();
    if (!adminKey) {
      return sendJson(reply, { error: 'admin_disabled' }, 503);
    }
    const providedKey = extractToken(String(request.headers['authorization'] || ''));
    if (!timingSafeEqual(providedKey, adminKey)) {
      return sendJson(reply, { error: 'forbidden' }, 403);
    }

    const body = request.body as any;
    const userId = String(body?.userId || '').trim();
    if (!userId) {
      return sendJson(reply, { error: 'missing_user' }, 400);
    }

    try {
      const diaryDates = await listDiaryDatesByUser(env, userId);
      const diaryDeleted = await deleteDiaryEntriesByUser(env, userId);
      const logDeleted = await deleteConversationLogsByUser(env, userId);
      const vectorIds = buildUserMemoryVectorIds(userId, diaryDates);
      const vectorDeleted = vectorIds.length ? await deleteDiaryVectors(env, vectorIds) : 0;
      const mediaDeleted = await deleteUserMediaObjects(env, userId);
      const settingsDeleted = await deleteUserSettingsByUser(env, userId);

      return sendJson(reply, {
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
      request.log.error({ error, userId }, '[ATRI] Failed to clear user data');
      return sendJson(reply, { error: 'clear_failed', details: String(error?.message || error) }, 500);
    }
  });
}
