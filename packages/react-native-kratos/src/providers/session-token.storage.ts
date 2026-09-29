const SESSION_TOKEN_KEY = 'session_token'

interface AsyncStorageAdapter {
  getItem: (key: string) => Promise<string | null>
  removeItem: (key: string) => Promise<void>
  setItem: (key: string, value: string) => Promise<void>
}

interface SecureStoreAdapter {
  deleteItemAsync: (key: string) => Promise<void>
  getItemAsync: (key: string) => Promise<string | null>
  setItemAsync: (key: string, value: string) => Promise<void>
}

export interface SessionTokenStorage {
  delete: () => Promise<void>
  read: () => Promise<string | undefined>
  write: (sessionToken: string) => Promise<void>
}

export const createSessionTokenStorage = (
  platform: string,
  secureStore: SecureStoreAdapter,
  asyncStorage: AsyncStorageAdapter
): SessionTokenStorage => {
  if (platform === 'web') {
    return {
      delete: async () => asyncStorage.removeItem(SESSION_TOKEN_KEY),
      read: async () => (await asyncStorage.getItem(SESSION_TOKEN_KEY)) ?? undefined,
      write: async (sessionToken) => asyncStorage.setItem(SESSION_TOKEN_KEY, sessionToken),
    }
  }

  return {
    delete: async () => secureStore.deleteItemAsync(SESSION_TOKEN_KEY),
    read: async () => (await secureStore.getItemAsync(SESSION_TOKEN_KEY)) ?? undefined,
    write: async (sessionToken) => secureStore.setItemAsync(SESSION_TOKEN_KEY, sessionToken),
  }
}
