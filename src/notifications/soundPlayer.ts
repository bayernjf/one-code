import { execFile } from 'child_process';
import * as os from 'os';
import { getConfig } from '../config';

/**
 * 声音提示播放器
 * 
 * 跨平台支持：
 * - macOS: afplay
 * - Linux: paplay / aplay
 * - Windows: PowerShell
 */
export class SoundPlayer {
  private platform = os.platform();

  /** 播放完成提示音 */
  playDone(): void {
    const config = getConfig();
    if (!config.sound.enabled) {
      return;
    }
    this.play('done', config.sound.volume);
  }

  /** 播放等待输入提示音 */
  playWaiting(): void {
    const config = getConfig();
    if (!config.sound.enabled) {
      return;
    }
    this.play('waiting', config.sound.volume);
  }

  private play(type: 'done' | 'waiting', volume: number): void {
    switch (this.platform) {
      case 'darwin':
        this.playMac(type, volume);
        break;
      case 'linux':
        this.playLinux(type, volume);
        break;
      case 'win32':
        this.playWindows(type);
        break;
    }
  }

  private playMac(type: 'done' | 'waiting', volume: number): void {
    // macOS 系统声音（固定路径，无用户输入）
    const sounds: Record<string, string> = {
      done: '/System/Library/Sounds/Glass.aiff',
      waiting: '/System/Library/Sounds/Ping.aiff',
    };

    const soundFile = sounds[type] || sounds.done;
    execFile('afplay', ['-v', volume.toFixed(2), soundFile], () => {});
  }

  private playLinux(type: 'done' | 'waiting', volume: number): void {
    // 使用 paplay (PulseAudio)，固定系统声音路径
    const sounds: Record<string, string> = {
      done: '/usr/share/sounds/freedesktop/stereo/complete.oga',
      waiting: '/usr/share/sounds/freedesktop/stereo/message.oga',
    };

    const soundFile = sounds[type] || sounds.done;
    const vol = Math.round(volume * 65536); // PulseAudio 音量范围 0-65536
    execFile('paplay', [`--volume=${vol}`, soundFile], () => {});
  }

  private playWindows(type: 'done' | 'waiting'): void {
    // Windows 使用 PowerShell 播放系统声音（固定脚本，无用户输入）
    const soundType = type === 'done' ? 'Asterisk' : 'Exclamation';
    const script = `[System.Media.SystemSounds]::${soundType}.Play()`;
    execFile('powershell', ['-NoProfile', '-Command', script], () => {});
  }

  dispose(): void {
    // 无需清理
  }
}
