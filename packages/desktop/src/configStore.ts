import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { DesktopConfig, getDefaultConfig } from './config';

/**
 * 配置持久化
 *
 * 将配置序列化为 JSON 存入 userData 目录，启动时读取；
 * 读取失败或首次启动时回退到默认配置。
 */
export class ConfigStore {
  private filePath: string;

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'config.json');
  }

  load(): DesktopConfig {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<DesktopConfig>;
      const defaults = getDefaultConfig();
      // 浅合并：缺失字段用默认值补齐
      return {
        targets: parsed.targets ?? defaults.targets,
        windowSize: parsed.windowSize ?? defaults.windowSize,
        activityThreshold: parsed.activityThreshold ?? defaults.activityThreshold,
        silenceTimeout: parsed.silenceTimeout ?? defaults.silenceTimeout,
        shellHook: {
          ...defaults.shellHook,
          ...(parsed.shellHook ?? {}),
        },
        codex: {
          ...defaults.codex,
          ...(parsed.codex ?? {}),
        },
        claude: {
          ...defaults.claude,
          ...(parsed.claude ?? {}),
        },
        companion: {
          ...defaults.companion,
          ...(parsed.companion ?? {}),
        },
      };
    } catch {
      return getDefaultConfig();
    }
  }

  save(config: DesktopConfig): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (err) {
      // 写入失败不阻断运行，仅记录
      console.error('[configStore] failed to save config:', err);
    }
  }
}
