import * as vscode from 'vscode';
import { ActivityLog, formatDuration, formatTime, getSourceName, getStatusIcon } from '../state/activityLog';
import { ActivityEvent, AIStatus } from '../monitors/types';

/**
 * 侧边栏活动面板
 * 
 * 以 TreeView 展示 AI 活动历史时间线
 */
export class ActivityPanel implements vscode.TreeDataProvider<ActivityTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ActivityTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private activityLog: ActivityLog) {
    // 日志变化时刷新视图
    activityLog.onDidChange(() => {
      this._onDidChangeTreeData.fire(undefined);
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ActivityTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ActivityTreeItem): ActivityTreeItem[] {
    if (element) {
      // 子节点：展示涉及的文件
      if (element.event && element.event.files.length > 0) {
        return element.event.files.map(
          (file) => new ActivityTreeItem(undefined, file, vscode.TreeItemCollapsibleState.None)
        );
      }
      return [];
    }

    // 根节点：活动历史列表
    const events = this.activityLog.getEvents();
    if (events.length === 0) {
      return [
        new ActivityTreeItem(undefined, '暂无活动记录', vscode.TreeItemCollapsibleState.None),
      ];
    }

    return events.map((event) => this.createEventItem(event));
  }

  private createEventItem(event: ActivityEvent): ActivityTreeItem {
    const icon = getStatusIcon(event.status);
    const time = formatTime(event.timestamp);
    const source = getSourceName(event.source);
    const duration = event.duration ? ` | ${formatDuration(event.duration)}` : '';
    const label = `${icon} ${time} [${source}]${duration}`;

    const hasChildren = event.files.length > 0;
    const item = new ActivityTreeItem(
      event,
      label,
      hasChildren
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    item.tooltip = this.buildTooltip(event);
    item.description = event.message || '';
    item.iconPath = this.getIconPath(event.status);
    item.contextValue = event.status;

    return item;
  }

  private buildTooltip(event: ActivityEvent): string {
    const lines = [
      `状态: ${this.getStatusText(event.status)}`,
      `来源: ${getSourceName(event.source)}`,
      `时间: ${event.timestamp.toLocaleString('zh-CN')}`,
    ];

    if (event.duration) {
      lines.push(`持续: ${formatDuration(event.duration)}`);
    }
    if (event.files.length > 0) {
      lines.push(`文件: ${event.files.length} 个`);
    }
    if (event.message) {
      lines.push(`信息: ${event.message}`);
    }

    return lines.join('\n');
  }

  private getIconPath(status: AIStatus): vscode.ThemeIcon {
    switch (status) {
      case AIStatus.Idle:
        return new vscode.ThemeIcon('circle-outline');
      case AIStatus.Working:
        return new vscode.ThemeIcon('sync', new vscode.ThemeColor('charts.yellow'));
      case AIStatus.Done:
        return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
      case AIStatus.Waiting:
        return new vscode.ThemeIcon('comment-discussion', new vscode.ThemeColor('charts.orange'));
    }
  }

  private getStatusText(status: AIStatus): string {
    switch (status) {
      case AIStatus.Idle:
        return '空闲';
      case AIStatus.Working:
        return '工作中';
      case AIStatus.Done:
        return '已完成';
      case AIStatus.Waiting:
        return '等待输入';
    }
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

/** TreeView 节点 */
export class ActivityTreeItem extends vscode.TreeItem {
  constructor(
    public readonly event: ActivityEvent | undefined,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);

    // 文件节点设置图标
    if (!event) {
      this.iconPath = new vscode.ThemeIcon('file');
    }
  }
}
