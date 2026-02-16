export interface Env {
  ATRI_DB: D1Database;
  VECTORIZE: VectorizeIndex;
  MEDIA_BUCKET: R2Bucket;
  OPENAI_API_KEY: string;
  OPENAI_API_URL: string;
  CHAT_API_FORMAT?: 'openai' | 'anthropic' | 'gemini';
  DEFAULT_CHAT_MODEL?: string;
  // Tavily 搜索（可选，不配则不启用 web_search）
  TAVILY_API_KEY?: string;
  // 媒体签名密钥（可选，不配则回退用 APP_TOKEN）
  MEDIA_SIGNING_KEY?: string;
  // 日记/用户档案专用上游（可选，不配则走默认聊天上游）
  DIARY_API_KEY?: string;
  DIARY_API_URL?: string;
  DIARY_MODEL?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  EMBEDDINGS_API_KEY: string;
  EMBEDDINGS_API_URL: string;
  EMBEDDINGS_MODEL: string;
  ADMIN_API_KEY?: string;
  ADMIN_CONFIG_ENCRYPTION_KEY?: string;
  APP_TOKEN?: string;
  COMPAT_API_KEY?: string;

  // 主动消息（可选）
  PROACTIVE_ENABLED?: string;
  PROACTIVE_TIME_ZONE?: string;
  PROACTIVE_QUIET_START_HOUR?: string;
  PROACTIVE_QUIET_END_HOUR?: string;
  PROACTIVE_MAX_DAILY?: string;
  PROACTIVE_COOLDOWN_HOURS?: string;
  PROACTIVE_INTIMACY_THRESHOLD?: string;
  PROACTIVE_RECENT_ACTIVE_MINUTES?: string;
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

// Memory 相关类型
export interface MemoryMatch {
  id: string;
  score: number;
  metadata?: {
    u?: string;
    text?: string;
    cat?: string;
    key?: string;
    ts?: number;
  };
}

export interface VectorQueryResult {
  matches: MemoryMatch[];
  count: number;
}

// Diary 相关类型
export interface DiaryEntry {
  id: string;
  userId: string;
  date: string;
  content: string;
  mood?: string;
  status: 'pending' | 'generated' | 'failed';
  createdAt: number;
  updatedAt: number;
}

// Conversation 相关类型
export interface ConversationLog {
  id: string;
  userId: string;
  role: 'user' | 'atri';
  content: string;
  attachments?: AttachmentPayload[];
  timestamp: number;
  userName?: string;
  timeZone?: string;
  date: string;
}
