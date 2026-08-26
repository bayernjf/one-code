import { MonitorSource } from '@ai-watchdog/core';

/**
 * Webhook 远程通知
 *
 * 用户配置一个 URL，done/waiting 事件时 POST JSON。
 * 兼容飞书/钉钉/企微自定义机器人（它们都接受 JSON body，字段名可能不同，
 * 这里发通用字段，用户可用中间件转换）。
 */
export interface WebhookPayload {
  type: 'done' | 'waiting';
  source: MonitorSource;
  timestamp: number;
  durationMs: number;
  fileCount: number;
  title: string;
  body: string;
}

export async function sendWebhook(url: string, payload: WebhookPayload): Promise<void> {
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`[webhook] failed: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error('[webhook] error:', err);
  }
}
