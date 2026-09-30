const LEGACY_SESSION_KEY = 'user_session'
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
  read: () => Promise<StoredSessionToken | undefined>
  write: (sessionToken: string) => Promise<void>
}

export interface StoredSessionToken {
  requiresMigration: boolean
  sessionToken: string
}

const parseLegacySessionToken = (value: string | null): string | undefined => {
  if (!value) {
    return undefined
  }

  try {
    const session = JSON.parse(value) as unknown

    if (
      typeof session === 'object' &&
      session !== null &&
      'sessionToken' in session &&
      typeof session.sessionToken === 'string'
    ) {
      return session.sessionToken
    }
  } catch {
    return undefined
  }

  return undefined
}

export const createSessionTokenStorage = (
  platform: string,
  secureStore: SecureStoreAdapter,
  asyncStorage: AsyncStorageAdapter
): SessionTokenStorage => {
  const deleteItem = async (key: string): Promise<void> =>
    platform === 'web' ? asyncStorage.removeItem(key) : secureStore.deleteItemAsync(key)
  const readItem = async (key: string): Promise<string | null> =>
    platform === 'web' ? asyncStorage.getItem(key) : secureStore.getItemAsync(key)
  const writeItem = async (key: string, value: string): Promise<void> =>
    platform === 'web' ? asyncStorage.setItem(key, value) : secureStore.setItemAsync(key, value)

  return {
    delete: async () => {
      await Promise.all([deleteItem(SESSION_TOKEN_KEY), deleteItem(LEGACY_SESSION_KEY)])
    },
    read: async () => {
      const sessionToken = await readItem(SESSION_TOKEN_KEY)

      if (sessionToken) {
        return {
          requiresMigration: false,
          sessionToken,
        }
      }

      const legacySessionToken = parseLegacySessionToken(await readItem(LEGACY_SESSION_KEY))

      return legacySessionToken
        ? {
            requiresMigration: true,
            sessionToken: legacySessionToken,
          }
        : undefined
    },
    write: async (sessionToken) => {
      await writeItem(SESSION_TOKEN_KEY, sessionToken)
      await deleteItem(LEGACY_SESSION_KEY)
    },
  }
}
