import { MonitorSource } from '@ai-watchdog/core';

/**
 * ntfy.sh 远程通知
 *
 * 开源推送服务，用户在手机装 ntfy app 并订阅同一个 topic 即可收到推送。
 * 默认用官方 ntfy.sh，也可配置自建服务器。
 */
const DEFAULT_SERVER = 'https://ntfy.sh';

export async function sendNtfy(
  topic: string,
  title: string,
  body: string,
  type: 'done' | 'waiting',
  server: string = DEFAULT_SERVER
): Promise<void> {
  if (!topic) return;
  const url = `${server.replace(/\/$/, '')}/${topic}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Title: title,
        Tags: type === 'done' ? 'white_check_mark' : 'hourglass_flowing_sand',
        Priority: type === 'waiting' ? 'high' : 'default',
      },
      body,
    });
    if (!res.ok) {
      console.error(`[ntfy] failed: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error('[ntfy] error:', err);
  }
}
