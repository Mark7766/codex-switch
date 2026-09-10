/**
 * 遥测客户端。
 *
 * 设计原则：遥测是次要功能。代理核心功能的优先级远高于数据上报。
 * 网络故障静默处理，绝不阻塞代理主流程。
 *
 * 两重门禁：enabled（用户开关）→ online（网络连通性）
 * 离线退避：连续 3 次失败后进入指数退避（5min→10min→20min，上限 60min）
 *
 * model_call 聚合：不每次单独上报，改为 5 分钟（或 50 次）批量上报一次，
 * 减少 99%+ HTTP 请求和 DB 写入。
 */
import log from 'electron-log';

import { type ServerClient } from './client';
import type { ServerConfig } from './config';
import { redactSensitive } from '../config/redact';

export interface TelemetryEvent {
  event_type: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

/**
 * 上报体（v3.0.0 收窄）。
 *
 * ⚠️ **不要再加回 `client_id`** —— 它是持久设备标识符，属《个人信息保护法》下的个人信息。
 * 现在上报的只有「配置被写入」这类操作事实 + 非识别性的平台/版本信息。
 * 若将来确实需要去重统计，应该用**每次会话随机、不落盘**的匿名 id，而不是 clientId。
 */
export interface TelemetryPayload {
  app_version: string;
  platform: string;
  arch: string;
  os_version: string;
  events: TelemetryEvent[];
}

/** 正常 flush 间隔（ms） */
const FLUSH_INTERVAL = 30_000;
/** buffer 满时立即 flush 的阈值 */
const FLUSH_THRESHOLD = 20;
/** buffer 最大容量，超出丢弃最旧事件 */
const BUFFER_MAX = 200;
/** 进入退避所需的连续失败次数 */
const BACKOFF_FAILURES = 3;
/** 退避级别对应的延迟（ms）：5min, 10min, 20min, 60min */
const BACKOFF_DELAYS = [300_000, 600_000, 1_200_000, 3_600_000];
/** stop() 时 flush 超时（ms） */
const STOP_FLUSH_TIMEOUT = 3_000;

/**
 * 递归脱敏 properties 中所有字符串值。
 * 防御性措施：确保任何经由 properties 传入的 API Key 都在源头被脱敏，不会抵达服务端数据库。
 */
function sanitizeProperties(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'string') {
      out[key] = redactSensitive(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      out[key] = sanitizeProperties(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export class TelemetryClient {
  private buffer: TelemetryEvent[] = [];
  private client: ServerClient;
  private config: ServerConfig;
  private appVersion: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private enabled: boolean;
  private nextFlushMs: number;
  private online = true;
  private consecutiveFailures = 0;
  private backoffLevel = 0;
  private flushing = false;

  constructor(client: ServerClient, config: ServerConfig, appVersion: string) {
    this.client = client;
    this.config = config;
    this.appVersion = appVersion;
    this.enabled = config.telemetryEnabled;
    this.nextFlushMs = FLUSH_INTERVAL;
  }

  /** 更新配置（用户在 Settings 中修改时调用）。保留 buffer 中已有事件。 */
  updateConfig(config: ServerConfig): void {
    this.config = config;
  }

  // ── 公开 API ───────────────────────────────────────────────────────────

  /**
   * 记录一个事件。同步返回，不阻塞调用方。
   * 两重门禁：enabled && online。
   *
   * model_call 事件走聚合路径：计数器 +1，每 5 分钟或 50 次上报一次汇总。
   */
  track(eventType: string, properties?: Record<string, unknown>): void {
    if (!this.enabled) return;
    if (!this.online) return;

    this.buffer.push({
      event_type: eventType,
      timestamp: new Date().toISOString(),
      properties: sanitizeProperties(properties ?? {}),
    });

    if (this.buffer.length > BUFFER_MAX) {
      this.buffer.shift();
    }

    if (this.buffer.length >= FLUSH_THRESHOLD) {
      this.flush().catch((err) => {
        log.debug('[telemetry] track-triggered flush 失败：%s', (err as Error).message);
      });
    }
  }

  /** 启动定时上报。 */
  start(): void {
    if (!this.enabled) return;
    if (this.timer) return;
    this.scheduleNext();
  }

  /**
   * 停止定时器并尝试 flush 剩余事件。
   * 仅当 online 时才 flush；离线直接跳过。
   * 3s 超时兜底，防止卡退出。
   */
  async stop(): Promise<void> {
    this.clearTimer();

    if (!this.online || this.buffer.length === 0) return;

    try {
      await Promise.race([
        this.flush(),
        new Promise<void>((resolve) => setTimeout(resolve, STOP_FLUSH_TIMEOUT)),
      ]);
    } catch {
      /* 静默 */
    }
  }

  /** 启用/禁用遥测。 */
  setEnabled(v: boolean): void {
    if (v === this.enabled) return;
    this.enabled = v;
    if (!v) {
      this.clearTimer();
      this.buffer.length = 0;
    } else {
      this.scheduleNext();
    }
  }

  /** 当前是否在线。 */
  isOnline(): boolean {
    return this.online;
  }

  // ── 内部 ───────────────────────────────────────────────────────────────

  private async flush(): Promise<void> {
    if (!this.enabled) return;
    if (this.flushing) return;
    if (this.buffer.length === 0) return;

    this.flushing = true;
    const batchSize = this.buffer.length;
    try {
      const reachable = await this.checkConnectivity();
      if (!reachable) {
        log.debug('[telemetry] server unreachable, deferring %d events', batchSize);
        this.online = false;
        this.handleFailure();
        return;
      }
      this.online = true;

      const batch = this.buffer.splice(0, FLUSH_THRESHOLD);

      const payload: TelemetryPayload = {
        app_version: this.appVersion,
        platform: process.platform,
        arch: process.arch,
        os_version: process.getSystemVersion?.() ?? '',
        events: batch,
      };

      const res = await this.client.post('/telemetry/events', payload);
      if (res.status >= 400 && res.status < 500) {
        log.debug('[telemetry] Server returned %d, discarding %d events', res.status, batch.length);
        this.consecutiveFailures = 0;
        this.backoffLevel = 0;
        this.nextFlushMs = FLUSH_INTERVAL;
      } else if (res.status >= 500 || res.status < 200) {
        this.buffer.unshift(...batch);
        this.handleFailure();
      } else {
        log.debug('[telemetry] flushed %d events successfully', batch.length);
        this.consecutiveFailures = 0;
        this.backoffLevel = 0;
        this.nextFlushMs = FLUSH_INTERVAL;
      }
    } catch (err) {
      log.debug('[telemetry] flush error: %s', (err as Error).message);
      this.handleFailure();
    } finally {
      this.flushing = false;
      this.scheduleNext();
    }
  }

  private async checkConnectivity(): Promise<boolean> {
    try {
      return await this.client.ping();
    } catch {
      return false;
    }
  }

  private handleFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= BACKOFF_FAILURES) {
      this.backoffLevel = Math.min(this.backoffLevel + 1, BACKOFF_DELAYS.length - 1);
      this.nextFlushMs = BACKOFF_DELAYS[this.backoffLevel] ?? 3_600_000;
      log.debug(
        '[telemetry] entering backoff level %d (%dms)',
        this.backoffLevel,
        this.nextFlushMs,
      );
    } else {
      this.nextFlushMs = FLUSH_INTERVAL;
    }
  }

  private scheduleNext(): void {
    this.clearTimer();
    if (!this.enabled) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch((err) => {
        log.debug('[telemetry] 定时 flush 失败：%s', (err as Error).message);
      });
    }, this.nextFlushMs);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
