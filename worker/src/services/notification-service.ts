import { Env } from '../types';

export type NotificationChannel = 'email' | 'wechat_work' | 'none';

export type SendNotificationParams = {
  channel: NotificationChannel;
  target?: string;
  content: string;
  userId: string;
};

export type SendNotificationResult = {
  sent: boolean;
  error?: string;
};

function sanitizeContent(raw: unknown) {
  const text = String(raw || '').trim();
  if (!text) return '';
  return text.slice(0, 1000);
}

function isHttpsUrl(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isAllowedWechatWorkWebhook(urlLike: string) {
  try {
    const url = new URL(urlLike);
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'qyapi.weixin.qq.com';
  } catch {
    return false;
  }
}

async function sendEmail(env: Env, target: string, content: string): Promise<SendNotificationResult> {
  const apiKey = String(env.EMAIL_API_KEY || '').trim();
  if (!apiKey) {
    return { sent: false, error: 'EMAIL_API_KEY missing' };
  }

  const body = {
    from: String(env.EMAIL_FROM || 'ATRI <atri@your-domain.com>').trim(),
    to: target,
    subject: '亚托莉给你发了一条消息',
    text: `「${content}」\n\n——亚托莉\n\n打开 ATRI 查看完整对话`
  };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { sent: false, error: `resend_failed:${res.status}:${text.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (error: any) {
    return { sent: false, error: `resend_error:${String(error?.message || error)}` };
  }
}

async function sendWechatWork(target: string, content: string): Promise<SendNotificationResult> {
  if (!isAllowedWechatWorkWebhook(target)) {
    return { sent: false, error: 'invalid_wechat_webhook' };
  }

  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'text',
        text: { content: `亚托莉：${content}` }
      })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { sent: false, error: `wechat_failed:${res.status}:${text.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (error: any) {
    return { sent: false, error: `wechat_error:${String(error?.message || error)}` };
  }
}

export async function sendNotification(env: Env, params: SendNotificationParams): Promise<SendNotificationResult> {
  const channel = params.channel;
  const content = sanitizeContent(params.content);
  const target = String(params.target || '').trim();

  if (!content) {
    return { sent: false, error: 'empty_content' };
  }

  if (channel === 'none') {
    return { sent: false, error: 'channel_none' };
  }

  if (!target) {
    return { sent: false, error: 'missing_target' };
  }

  if (channel === 'email') {
    const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target);
    if (!isEmail) {
      return { sent: false, error: 'invalid_email_target' };
    }
    return sendEmail(env, target, content);
  }

  if (channel === 'wechat_work') {
    if (!isHttpsUrl(target)) {
      return { sent: false, error: 'invalid_target_url' };
    }
    return sendWechatWork(target, content);
  }

  return { sent: false, error: 'unknown_channel' };
}
