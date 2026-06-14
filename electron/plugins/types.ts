/**
 * Plugin offline pack types — v1.10.0.
 *
 * Matches Server GET /api/v1/plugins/pack response.
 */

export interface PluginPackInfo {
  version: string;
  filename: string;
  /** File size in bytes */
  size: number;
  /** Human-readable size in MB */
  size_mb: number;
  /** Number of bundled plugins */
  plugin_count: number;
  /** Chinese description of pack contents */
  description: string;
  /** ISO date string */
  updated_at: string;
  /** Relative download path on the server, e.g. /api/v1/plugins/pack/download */
  download_url: string;
}

export interface ServerPackResponse {
  code: number;
  data: PluginPackInfo;
}

export interface DownloadProgress {
  bytesDownloaded: number;
  totalBytes: number;
  /** 0–100 */
  percent: number;
  /** Bytes per second, averaged over the last interval */
  speedBytesPerSec: number;
  /** Estimated remaining seconds */
  remainingSeconds: number;
}

export type PluginPagePhase = 'loading' | 'info' | 'downloading' | 'complete' | 'error';

export interface PluginPageState {
  phase: PluginPagePhase;
  packInfo: PluginPackInfo | null;
  progress: DownloadProgress | null;
  filePath: string | null;
  error: string | null;
}
