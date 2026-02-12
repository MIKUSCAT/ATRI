import 'dotenv/config';
import fs from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { loadEnv } from '../runtime/env';
import { upsertDiaryHighlightsMemory } from '../services/memory-service';
import { getEffectiveRuntimeSettings } from '../services/runtime-settings';

function pickArg(name: string) {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length).trim();
  }
  return '';
}

function safeInt(value: any, fallback: number) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function safeText(value: any) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

async function main() {
  const sqlitePath = String(process.env.SQLITE_PATH || pickArg('sqlite') || '').trim();
  if (!sqlitePath) {
    throw new Error('missing SQLITE_PATH (or --sqlite=...)');
  }

  const env = loadEnv(process.env);

  const SQL = await initSqlJs({
    locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`)
  });

  const fileBytes = await fs.readFile(sqlitePath);
  const sqliteDb = new SQL.Database(new Uint8Array(fileBytes));

  const tableExists = (name: string) => {
    const stmt = sqliteDb.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=$name LIMIT 1`);
    try {
      stmt.bind({ $name: name });
      return stmt.step();
    } finally {
      stmt.free();
    }
  };

  const readAll = (sql: string, params?: Record<string, any>) => {
    const stmt = sqliteDb.prepare(sql);
    try {
      if (params) stmt.bind(params);
      const rows: any[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      stmt.free();
    }
  };

  const imported = {
    conversationLogs: 0,
    diaryEntries: 0,
    userStates: 0,
    userSettings: 0,
    userProfiles: 0
  };

  const client = await env.db.connect();
  try {
    await client.query('BEGIN');

    if (tableExists('conversation_logs')) {
      const rows = readAll(
        `SELECT id, user_id, date, role, content, attachments, timestamp, user_name, time_zone, created_at
           FROM conversation_logs`
      );
      for (const row of rows) {
        await client.query(
          `INSERT INTO conversation_logs
              (id, user_id, date, role, content, attachments, timestamp, user_name, time_zone, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (id) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             date = EXCLUDED.date,
             role = EXCLUDED.role,
             content = EXCLUDED.content,
             attachments = EXCLUDED.attachments,
             timestamp = EXCLUDED.timestamp,
             user_name = EXCLUDED.user_name,
             time_zone = EXCLUDED.time_zone`,
          [
            safeText(row.id),
            safeText(row.user_id),
            safeText(row.date),
            safeText(row.role),
            safeText(row.content),
            safeText(row.attachments),
            safeInt(row.timestamp, Date.now()),
            safeText(row.user_name) || null,
            safeText(row.time_zone) || null,
            safeInt(row.created_at, Date.now())
          ]
        );
        imported.conversationLogs++;
      }
    }

    if (tableExists('diary_entries')) {
      const rows = readAll(
        `SELECT id, user_id, date, summary, content, mood, status, created_at, updated_at
           FROM diary_entries`
      );
      for (const row of rows) {
        await client.query(
          `INSERT INTO diary_entries
              (id, user_id, date, summary, content, mood, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             date = EXCLUDED.date,
             summary = EXCLUDED.summary,
             content = EXCLUDED.content,
             mood = EXCLUDED.mood,
             status = EXCLUDED.status,
             updated_at = EXCLUDED.updated_at`,
          [
            safeText(row.id),
            safeText(row.user_id),
            safeText(row.date),
            safeText(row.summary) || null,
            safeText(row.content) || null,
            safeText(row.mood) || null,
            safeText(row.status) || 'pending',
            safeInt(row.created_at, Date.now()),
            safeInt(row.updated_at, Date.now())
          ]
        );
        imported.diaryEntries++;
      }
    }

    if (tableExists('user_states')) {
      const rows = readAll(
        `SELECT user_id, intimacy, last_interaction_at, updated_at
           FROM user_states`
      );
      for (const row of rows) {
        await client.query(
          `INSERT INTO user_states
              (user_id, status_label, status_pill_color, status_text_color, status_reason, status_updated_at, intimacy, last_interaction_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (user_id) DO UPDATE SET
             status_label = EXCLUDED.status_label,
             status_pill_color = EXCLUDED.status_pill_color,
             status_text_color = EXCLUDED.status_text_color,
             status_reason = EXCLUDED.status_reason,
             status_updated_at = EXCLUDED.status_updated_at,
             intimacy = EXCLUDED.intimacy,
             last_interaction_at = EXCLUDED.last_interaction_at,
             updated_at = EXCLUDED.updated_at`,
          [
            safeText(row.user_id),
            '陪着你',
            '#7E8EA3',
            '#FFFFFF',
            null,
            safeInt(row.updated_at, Date.now()),
            safeInt(row.intimacy, 0),
            safeInt(row.last_interaction_at, Date.now()),
            safeInt(row.updated_at, Date.now())
          ]
        );
        imported.userStates++;
      }
    }

    if (tableExists('user_settings')) {
      const rows = readAll(
        `SELECT user_id, model_key, created_at, updated_at
           FROM user_settings`
      );
      for (const row of rows) {
        await client.query(
          `INSERT INTO user_settings
              (user_id, model_key, created_at, updated_at)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (user_id) DO UPDATE SET
             model_key = EXCLUDED.model_key,
             updated_at = EXCLUDED.updated_at`,
          [
            safeText(row.user_id),
            safeText(row.model_key) || null,
            safeInt(row.created_at, Date.now()),
            safeInt(row.updated_at, Date.now())
          ]
        );
        imported.userSettings++;
      }
    }

    if (tableExists('user_profiles')) {
      const rows = readAll(
        `SELECT user_id, content, created_at, updated_at
           FROM user_profiles`
      );
      for (const row of rows) {
        await client.query(
          `INSERT INTO user_profiles
              (user_id, content, created_at, updated_at)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (user_id) DO UPDATE SET
             content = EXCLUDED.content,
             updated_at = EXCLUDED.updated_at`,
          [
            safeText(row.user_id),
            safeText(row.content) || null,
            safeInt(row.created_at, Date.now()),
            safeInt(row.updated_at, Date.now())
          ]
        );
        imported.userProfiles++;
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  console.log('[ATRI] import done', imported);

  const skipVectors = String(process.env.SKIP_VECTORS || '').trim() === '1';
  const settings = await getEffectiveRuntimeSettings(env);
  const hasEmbeddings =
    String(settings.embeddingsApiUrl || '').trim() &&
    String(settings.embeddingsApiKey || '').trim() &&
    String(settings.embeddingsModel || '').trim();

  if (skipVectors) {
    console.log('[ATRI] SKIP_VECTORS=1, skip rebuilding vectors');
  } else if (!hasEmbeddings) {
    console.log('[ATRI] embeddings config missing, skip rebuilding vectors');
  } else {
    console.log('[ATRI] rebuilding vectors from diary entries...');
    await env.db.query('TRUNCATE memory_vectors');
    const diaries = await env.db.query(
      `SELECT user_id as "userId", date, summary, content, mood, updated_at as "updatedAt"
         FROM diary_entries
        ORDER BY date ASC`
    );
    let rebuilt = 0;
    for (const row of diaries.rows || []) {
      const userId = safeText((row as any).userId);
      const date = safeText((row as any).date);
      const mood = safeText((row as any).mood);
      const summary = safeText((row as any).summary);
      const content = safeText((row as any).content);
      const updatedAt = safeInt((row as any).updatedAt, Date.now());

      const rawHighlights = summary
        ? summary.split('；').map(s => s.trim()).filter(Boolean)
        : [];
      const highlights = rawHighlights.length
        ? rawHighlights.slice(0, 10)
        : content
          ? [content.slice(0, 800)]
          : [];
      if (!userId || !date || !highlights.length) continue;

      await upsertDiaryHighlightsMemory(env, {
        userId,
        date,
        mood,
        highlights,
        timestamp: updatedAt
      });
      rebuilt++;
      if (rebuilt % 10 === 0) {
        console.log('[ATRI] rebuilt vectors:', rebuilt);
      }
    }
    console.log('[ATRI] rebuild vectors done:', rebuilt);
  }

  await env.db.end();
}

main().catch((err) => {
  console.error('[ATRI] import failed', err);
  process.exit(1);
});
