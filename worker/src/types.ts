export interface Env {
  ATRI_DB: D1Database;
  VECTORIZE: VectorizeIndex;
  MEDIA_BUCKET: R2Bucket;
  OPENAI_API_KEY: string;
  OPENAI_API_URL: string;
  EMBEDDINGS_API_KEY: string;
  EMBEDDINGS_API_URL: string;
  EMBEDDINGS_MODEL: string;
  ADMIN_API_KEY?: string;
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

export type RouterRequest = Request & { params?: Record<string, string> };
