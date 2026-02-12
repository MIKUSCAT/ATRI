import type { FastifyInstance } from 'fastify';
import { Env } from '../runtime/types';
import { requireAppToken } from '../utils/auth';
import { sendJson } from '../utils/reply';
import { sanitizeText } from '../utils/sanitize';
import {
  calculateDaysBetween,
  deleteConversationLogsByIds,
  fetchConversationLogsAfter,
  fetchTombstonesAfter,
  getLastConversationDate,
  isConversationLogDeleted,
  saveConversationLog,
  markDiaryPending
} from '../services/data-service';
import { deleteDiaryVectors } from '../services/memory-service';
import { DEFAULT_TIMEZONE, formatDateInZone } from '../utils/date';

const VALID_ROLES = new Set(['user', 'atri']);

export function registerConversationRoutes(app: FastifyInstance, env: Env) {
  app.post('/conversation/log', async (request, reply) => {
    try {
      const auth = requireAppToken(request, env);
      if (auth) return sendJson(reply, auth.body, auth.status);

      const body = request.body as any;
      const userId = String(body?.userId || '').trim();
      const role = String(body?.role || '').trim();
      const logId = typeof body?.logId === 'string' ? body.logId.trim() : undefined;
      const replyToRaw =
        typeof body?.replyTo === 'string'
          ? body.replyTo
          : typeof body?.reply_to === 'string'
            ? body.reply_to
            : undefined;
      const replyTo = typeof replyToRaw === 'string' ? replyToRaw.trim() : undefined;
      if (!userId || !VALID_ROLES.has(role)) {
        return sendJson(reply, { error: 'invalid_params' }, 400);
      }

      const cleanedContent = sanitizeText(String(body?.content || ''));
      if (!cleanedContent) {
        return sendJson(reply, { error: 'empty_content' }, 400);
      }

      if (logId && await isConversationLogDeleted(env, userId, logId)) {
        return sendJson(reply, { ok: true, ignored: true });
      }
      if (replyTo && await isConversationLogDeleted(env, userId, replyTo)) {
        return sendJson(reply, { ok: true, ignored: true });
      }

      const result = await saveConversationLog(env, {
        id: logId,
        userId,
        role: role as 'user' | 'atri',
        content: cleanedContent,
        attachments: Array.isArray(body?.attachments) ? body.attachments : undefined,
        replyTo,
        timestamp: typeof body?.timestamp === 'number' ? body.timestamp : undefined,
        userName: typeof body?.userName === 'string' ? body.userName : undefined,
        timeZone: typeof body?.timeZone === 'string' ? body.timeZone : undefined,
        date: typeof body?.date === 'string' ? body.date : undefined
      });

      return sendJson(reply, { ok: true, id: result.id, date: result.date });
    } catch (error: unknown) {
      request.log.error({ error }, '[ATRI] conversation log error');
      return sendJson(reply, { error: 'log_failed' }, 500);
    }
  });

  app.post('/conversation/delete', async (request, reply) => {
    try {
      const auth = requireAppToken(request, env);
      if (auth) return sendJson(reply, auth.body, auth.status);

      const body = request.body as any;
      const userId = String(body?.userId || '').trim();
      const ids = Array.isArray(body?.ids)
        ? body.ids.map((item: any) => String(item || '').trim()).filter(Boolean)
        : [];
      if (!userId || !ids.length) {
        return sendJson(reply, { error: 'invalid_params' }, 400);
      }

      const changes = await deleteConversationLogsByIds(env, userId, ids);
      return sendJson(reply, { ok: true, deleted: changes });
    } catch (error: unknown) {
      request.log.error({ error }, '[ATRI] conversation delete error');
      return sendJson(reply, { error: 'delete_failed' }, 500);
    }
  });

  app.get('/conversation/last', async (request, reply) => {
    const auth = requireAppToken(request, env);
    if (auth) return sendJson(reply, auth.body, auth.status);

    const userId = String((request.query as any)?.userId || '').trim();
    const timeZone = String((request.query as any)?.timeZone || DEFAULT_TIMEZONE).trim();
    const anchorDate = String((request.query as any)?.date || formatDateInZone(Date.now(), timeZone)).trim();

    if (!userId) {
      return sendJson(reply, { error: 'missing_user' }, 400);
    }

    try {
      const lastDate = await getLastConversationDate(env, userId, anchorDate);
      if (!lastDate) {
        return sendJson(reply, { status: 'missing' });
      }
      const daysSince = calculateDaysBetween(lastDate, anchorDate);
      return sendJson(reply, { status: 'ok', date: lastDate, daysSince });
    } catch (error: unknown) {
      request.log.error({ error }, '[ATRI] conversation last error');
      return sendJson(reply, { error: 'lookup_failed' }, 500);
    }
  });

  app.get('/conversation/pull', async (request, reply) => {
    const auth = requireAppToken(request, env);
    if (auth) return sendJson(reply, auth.body, auth.status);

    const userId = String((request.query as any)?.userId || '').trim();
    if (!userId) {
      return sendJson(reply, { error: 'missing_user' }, 400);
    }

    const afterRaw = Number((request.query as any)?.after || '0');
    const limitRaw = Number((request.query as any)?.limit || '50');
    const roleParam = String((request.query as any)?.role || '').trim();
    const includeTombstones = String((request.query as any)?.tombstones || '').trim() === 'true';
    const roles = roleParam
      ? roleParam.split(',').map((item: string) => item.trim()).filter((r) => VALID_ROLES.has(r))
      : [];

    try {
      const logs = await fetchConversationLogsAfter(env, {
        userId,
        after: Number.isFinite(afterRaw) ? afterRaw : 0,
        limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
        roles: roles as Array<'user' | 'atri'>
      });

      if (includeTombstones) {
        const tombstones = await fetchTombstonesAfter(env, {
          userId,
          after: Number.isFinite(afterRaw) ? afterRaw : 0,
          limit: 100
        });
        return sendJson(reply, { logs, tombstones });
      }

      return sendJson(reply, { logs });
    } catch (error: unknown) {
      request.log.error({ error }, '[ATRI] conversation pull error');
      return sendJson(reply, { error: 'pull_failed' }, 500);
    }
  });

  app.post('/conversation/invalidate-memory', async (request, reply) => {
    try {
      const auth = requireAppToken(request, env);
      if (auth) return sendJson(reply, auth.body, auth.status);

      const body = request.body as any;
      const userId = String(body?.userId || '').trim();
      const date = String(body?.date || '').trim();

      if (!userId || !date) {
        return sendJson(reply, { error: 'invalid_params' }, 400);
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return sendJson(reply, { error: 'invalid_date_format' }, 400);
      }

      const MAX_HIGHLIGHTS_PER_DAY = 10;
      const idsToDelete: string[] = [];
      for (let i = 0; i < MAX_HIGHLIGHTS_PER_DAY; i++) {
        idsToDelete.push(`hl:${userId}:${date}:${i}`);
      }

      const deleted = await deleteDiaryVectors(env, idsToDelete);
      await markDiaryPending(env, userId, date);

      return sendJson(reply, { ok: true, deleted, date });
    } catch (error: unknown) {
      request.log.error({ error }, '[ATRI] conversation invalidate-memory error');
      return sendJson(reply, { error: 'invalidate_failed' }, 500);
    }
  });
}
