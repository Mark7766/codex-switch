/**
 * 供应商 API Key 安全存储（OS keychain via keytar）。
 * 失败时回退到 electron-store 加密字段（避免完全不可用）。
 *
 * v3.0.0: 原本 4 组 `get/set/clear` 三件套（约 200 行）只差 keytar account 名与回退字段名，
 * 现收敛为对供应商描述符的三个泛型函数，账户/字段名全部来自注册表。
 */
import Store from 'electron-store';
import {
  getProvider,
  type KeyFallbackField,
  type ProviderDescriptor,
  type ProviderId,
} from './providers';

const SERVICE = 'codex-switch';

/**
 * ⚠️ v3.0.0 已移除 Agnes 供应商，但**不要**删除 keytar 里 `agnes-api-key` 那条记录。
 * 用户明确选择对此「不做任何处理」；凭据留在系统钥匙串里比悄悄删掉更安全。
 */
type FallbackShape = Record<KeyFallbackField, string>;

let fallbackStore: Store<FallbackShape> | null = null;

function getFallback(): Store<FallbackShape> {
  if (!fallbackStore) {
    fallbackStore = new Store<FallbackShape>({
      name: 'secrets',
      defaults: { apiKey: '', glmApiKey: '', customApiKey: '' },
      encryptionKey: 'codex-switch-local-only',
    });
  }
  return fallbackStore;
}

async function loadKeytar(): Promise<typeof import('keytar') | null> {
  try {
    return await import('keytar');
  } catch {
    return null;
  }
}

/** 读取指定供应商的 API Key（keytar 优先，失败回退加密存储）。 */
export async function getKey(provider: ProviderId | ProviderDescriptor): Promise<string> {
  const d = typeof provider === 'string' ? getProvider(provider) : provider;
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      const v = await keytar.getPassword(SERVICE, d.key.account);
      if (v) return v;
    } catch {
      /* fall through */
    }
  }
  return getFallback().get(d.key.fallbackField, '');
}

/** 写入指定供应商的 API Key；成功写入 keytar 后清空回退字段，避免明文残留。 */
export async function setKey(
  provider: ProviderId | ProviderDescriptor,
  apiKey: string,
): Promise<void> {
  const d = typeof provider === 'string' ? getProvider(provider) : provider;
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      await keytar.setPassword(SERVICE, d.key.account, apiKey);
      getFallback().set(d.key.fallbackField, '');
      return;
    } catch {
      /* fall through */
    }
  }
  getFallback().set(d.key.fallbackField, apiKey);
}

/** 清除指定供应商的 API Key（keytar 与回退字段都清）。 */
export async function clearKey(provider: ProviderId | ProviderDescriptor): Promise<void> {
  const d = typeof provider === 'string' ? getProvider(provider) : provider;
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      await keytar.deletePassword(SERVICE, d.key.account);
    } catch {
      /* ignore */
    }
  }
  // 顺带修掉旧版的不一致：原先 clearApiKey / clearAgnesKey 漏清回退字段
  getFallback().set(d.key.fallbackField, '');
}

/** 掩码展示：前 4 后 4。 */
export function maskKey(key: string): string {
  if (!key) return '';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
