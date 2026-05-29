import Store from 'electron-store';

export interface UserPreferences {
  proxyPort: number;
  defaultModel: 'deepseek-v4-flash' | 'deepseek-v4-pro';
  modelMapping: Record<string, string>;
  autoStartProxy: boolean;
  hasCompletedSetup: boolean;
}

const DEFAULTS: UserPreferences = {
  proxyPort: 11435,
  defaultModel: 'deepseek-v4-flash',
  modelMapping: {
    'gpt-5-codex': 'deepseek-v4-flash',
    'gpt-4o': 'deepseek-v4-flash',
    'o1': 'deepseek-v4-pro',
    'o1-mini': 'deepseek-v4-pro',
  },
  autoStartProxy: true,
  hasCompletedSetup: false,
};

let store: Store<UserPreferences> | null = null;

function getStore(): Store<UserPreferences> {
  if (!store) {
    store = new Store<UserPreferences>({
      name: 'preferences',
      defaults: DEFAULTS,
    });
  }
  return store;
}

export function getPreferences(): UserPreferences {
  return getStore().store;
}

export function setPreferences(patch: Partial<UserPreferences>): UserPreferences {
  const s = getStore();
  const next = { ...s.store, ...patch };
  s.store = next;
  return next;
}

export function resetPreferences(): void {
  getStore().clear();
}
