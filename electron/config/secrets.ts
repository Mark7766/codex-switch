/**
 * DeepSeek API Key 安全存储（OS keychain via keytar）。
 * 失败时回退到 electron-store 加密字段（避免完全不可用）。
 */
import Store from 'electron-store';

const SERVICE = 'codex-switch';
const ACCOUNT = 'deepseek-api-key';
const AGNES_ACCOUNT = 'agnes-api-key';

interface FallbackShape {
  apiKey: string;
  agnesApiKey: string;
  glmApiKey: string;
}

let fallbackStore: Store<FallbackShape> | null = null;

function getFallback(): Store<FallbackShape> {
  if (!fallbackStore) {
    fallbackStore = new Store<FallbackShape>({
      name: 'secrets',
      defaults: { apiKey: '', agnesApiKey: '', glmApiKey: '' },
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

export async function getApiKey(): Promise<string> {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      const v = await keytar.getPassword(SERVICE, ACCOUNT);
      if (v) return v;
    } catch {
      /* fall through */
    }
  }
  return getFallback().get('apiKey', '');
}

export async function setApiKey(apiKey: string): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      await keytar.setPassword(SERVICE, ACCOUNT, apiKey);
      // 同步清空 fallback，避免明文残留
      getFallback().set('apiKey', '');
      return;
    } catch {
      /* fall through */
    }
  }
  getFallback().set('apiKey', apiKey);
}

export async function clearApiKey(): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      await keytar.deletePassword(SERVICE, ACCOUNT);
    } catch {
      /* ignore */
    }
  }
  getFallback().set('apiKey', '');
}

// ── Agnes AI Key ───────────────────────────────────────────────────────

export async function getAgnesKey(): Promise<string> {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      const v = await keytar.getPassword(SERVICE, AGNES_ACCOUNT);
      if (v) return v;
    } catch {
      /* fall through */
    }
  }
  return getFallback().get('agnesApiKey', '');
}

export async function setAgnesKey(apiKey: string): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      await keytar.setPassword(SERVICE, AGNES_ACCOUNT, apiKey);
      getFallback().set('agnesApiKey', '');
      return;
    } catch {
      /* fall through */
    }
  }
  getFallback().set('agnesApiKey', apiKey);
}

export async function clearAgnesKey(): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      await keytar.deletePassword(SERVICE, AGNES_ACCOUNT);
    } catch {
      /* ignore */
    }
  }
}
// GLM key

// ── GLM Key ───────────────────────────────────────────────────────

const GLM_ACCOUNT = 'glm-api-key';

export async function getGlmKey(): Promise<string> {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      const v = await keytar.getPassword(SERVICE, GLM_ACCOUNT);
      if (v) return v;
    } catch {
      /* keytar unavailable — fall through to fallback */
    }
  }
  return getFallback().get('glmApiKey', '');
}

export async function setGlmKey(apiKey: string): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      await keytar.setPassword(SERVICE, GLM_ACCOUNT, apiKey);
      getFallback().set('glmApiKey', '');
      return;
    } catch {
      /* keytar unavailable — fall through to fallback */
    }
  }
  getFallback().set('glmApiKey', apiKey);
}

export async function clearGlmKey(): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      await keytar.deletePassword(SERVICE, GLM_ACCOUNT);
    } catch {
      /* keytar unavailable — fall through to fallback */
    }
  }
  getFallback().set('glmApiKey', '');
}
