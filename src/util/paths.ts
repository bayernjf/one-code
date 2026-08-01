/**
 * 文件路径过滤（纯逻辑，不依赖 vscode）
 *
 * 复用文件监控器的忽略规则匹配算法，提取为独立函数以便单元测试。
 */
export function shouldIgnorePath(filePath: string, ignorePatterns: string[]): boolean {
  for (const pattern of ignorePatterns) {
    // 宽松匹配：去掉通配符后做子串匹配
    const cleanPattern = pattern.replace(/\*\*/g, '').replace(/\*/g, '');
    if (filePath.includes(cleanPattern.replace(/\//g, ''))) {
      return true;
    }
    // 更精确的目录匹配
    const dirPattern = pattern.replace(/\*\*\//g, '').replace(/\/\*\*/g, '');
    if (filePath.includes(dirPattern)) {
      return true;
    }
  }
  return false;
}
