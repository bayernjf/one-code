/**
 * 滑动窗口快速编辑检测器（纯逻辑，不依赖 vscode）
 *
 * 通过记录每次文件变更的时间戳，在固定时间窗口内统计变更次数，
 * 当次数达到阈值时判定为「AI 正在批量修改文件」。
 * 提取为独立模块以便单元测试。
 */
export class RapidEditDetector {
  private timestamps: number[] = [];

  constructor(
    private windowMs: number,
    private threshold: number
  ) {}

  /** 记录一次变更，返回窗口内累计次数是否达到阈值 */
  record(now: number): boolean {
    this.timestamps.push(now);
    const cutoff = now - this.windowMs;
    this.timestamps = this.timestamps.filter((t) => t >= cutoff);
    return this.timestamps.length >= this.threshold;
  }

  /** 清空所有记录 */
  reset(): void {
    this.timestamps = [];
  }

  /** 当前窗口内的变更次数 */
  get count(): number {
    return this.timestamps.length;
  }

  /** 判定阈值 */
  get thresholdValue(): number {
    return this.threshold;
  }
}
