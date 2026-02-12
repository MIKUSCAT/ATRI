import type { Pool } from 'pg';

export interface Env {
  db: Pool;
  MEDIA_ROOT: string;
  PUBLIC_BASE_URL?: string;

  HOST?: string;
  PORT?: number;

  OPENAI_API_KEY: string;
  OPENAI_API_URL: string;

  TAVILY_API_KEY?: string;
  MEDIA_SIGNING_KEY?: string;
  DIARY_API_KEY?: string;
  DIARY_API_URL?: string;
  DIARY_MODEL?: string;

  EMBEDDINGS_API_KEY: string;
  EMBEDDINGS_API_URL: string;
  EMBEDDINGS_MODEL: string;

  ADMIN_API_KEY?: string;
  ADMIN_PUBLIC?: boolean;
  ADMIN_ALLOWED_ORIGINS?: string;
  ADMIN_CONFIG_ENCRYPTION_KEY?: string;
  ADMIN_ALLOWED_IPS?: string;
  UPDATE_CHECK_IMAGE?: string;
  UPDATE_CHECK_TAG?: string;
  CURRENT_IMAGE_DIGEST?: string;
  APP_TOKEN?: string;
  COMPAT_API_KEY?: string;
}

export const CHAT_MODEL = 'openai.gpt-5-chat';
export const ATTACHMENT_TYPES = ['image', 'document'] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

export type AttachmentPayload = {
  type: AttachmentType;
  url: string;
  mime?: string;
  name?: string;
  sizeBytes?: number;
};

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface BioChatRequest {
  userId: string;
  userName?: string;
  userBirthday?: string;
  content: string;
  logId?: string;
  attachments?: AttachmentPayload[];
  modelKey?: string;
  timeZone?: string;
}

export interface BioChatResponse {
  reply: string;
  status: { label: string; pillColor: string; textColor: string };
  action: string | null;
  intimacy: number;
  replyLogId?: string;
  replyTimestamp?: number;
  replyTo?: string;
}
