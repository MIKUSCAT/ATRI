import { Pool } from 'pg';
import { Env } from './types';

function readText(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : '';
}

function readOptionalText(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : undefined;
}

function readBool(value: unknown) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!text) return false;
  return ['1', 'true', 'yes', 'y', 'on'].includes(text);
}

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function buildDatabaseUrlFromParts(source: NodeJS.ProcessEnv) {
  const explicitHost = readOptionalText(source.POSTGRES_HOST) || readOptionalText(source.PGHOST);
  const zeaburHost = readOptionalText(source.DB_HOST);
  const host = explicitHost || zeaburHost;

  const user =
    readOptionalText(source.POSTGRES_USER)
    || readOptionalText(source.PGUSER)
    || readOptionalText(source.DB_USER)
    || readOptionalText(source.DB_USERNAME);

  const password =
    readOptionalText(source.POSTGRES_PASSWORD)
    || readOptionalText(source.PGPASSWORD)
    || readOptionalText(source.DB_PASSWORD);

  const database =
    readOptionalText(source.POSTGRES_DB)
    || readOptionalText(source.PGDATABASE)
    || readOptionalText(source.DB_NAME)
    || readOptionalText(source.DB_DATABASE);

  const port =
    readNumber(source.POSTGRES_PORT)
    ?? readNumber(source.PGPORT)
    ?? readNumber(source.DB_PORT);

  if (!host || !user || !database) return null;

  const url = new URL('postgres://localhost');
  url.host = host;
  if (typeof port === 'number') url.port = String(port);
  if (!url.port) url.port = '5432';
  url.username = user;
  if (typeof password === 'string') url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

export function loadEnv(source: NodeJS.ProcessEnv): Env {
  const databaseUrl =
    readText(source.DATABASE_URL)
    || buildDatabaseUrlFromParts(source)
    || '';
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is missing (or set POSTGRES_HOST/POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB, or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME)'
    );
  }

  const db = new Pool({ connectionString: databaseUrl });

  const env: Env = {
    db,
    MEDIA_ROOT: readText(source.MEDIA_ROOT) || '/data/media',
    PUBLIC_BASE_URL: readOptionalText(source.PUBLIC_BASE_URL),

    HOST: readOptionalText(source.HOST),
    PORT: readNumber(source.PORT),

    OPENAI_API_KEY: readText(source.OPENAI_API_KEY),
    OPENAI_API_URL: readText(source.OPENAI_API_URL),

    TAVILY_API_KEY: readOptionalText(source.TAVILY_API_KEY),
    MEDIA_SIGNING_KEY: readOptionalText(source.MEDIA_SIGNING_KEY),
    DIARY_API_KEY: readOptionalText(source.DIARY_API_KEY),
    DIARY_API_URL: readOptionalText(source.DIARY_API_URL),
    DIARY_MODEL: readOptionalText(source.DIARY_MODEL),

    EMBEDDINGS_API_KEY: readText(source.EMBEDDINGS_API_KEY),
    EMBEDDINGS_API_URL: readText(source.EMBEDDINGS_API_URL),
    EMBEDDINGS_MODEL: readText(source.EMBEDDINGS_MODEL),

    ADMIN_API_KEY: readOptionalText(source.ADMIN_API_KEY),
    ADMIN_PUBLIC: readBool(source.ADMIN_PUBLIC),
    ADMIN_ALLOWED_ORIGINS: readOptionalText(source.ADMIN_ALLOWED_ORIGINS),
    ADMIN_CONFIG_ENCRYPTION_KEY: readOptionalText(source.ADMIN_CONFIG_ENCRYPTION_KEY),
    ADMIN_ALLOWED_IPS: readOptionalText(source.ADMIN_ALLOWED_IPS),
    APP_TOKEN: readOptionalText(source.APP_TOKEN),
    COMPAT_API_KEY: readOptionalText(source.COMPAT_API_KEY)
  };

  return env;
}
