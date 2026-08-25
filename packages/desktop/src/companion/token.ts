import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 伴侣鉴权 token
 *
 * 首次调用生成 32 字节随机 token 写入文件（0600），之后读取复用。
 * 同机同用户的伴侣直接读该文件完成鉴权，无需配对 UI。
 */
export function ensureToken(tokenPath: string): string {
  try {
    const existing = fs.readFileSync(tokenPath, 'utf-8').trim();
    if (existing.length > 0) {
      return existing;
    }
  } catch {
    // 文件不存在或不可读：往下生成
  }

  const token = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(tokenPath, `${token}\n`, { encoding: 'utf-8', mode: 0o600 });
  return token;
}
