import type { Session } from '@ory/kratos-client-fetch'

const SESSION_KEY = 'user_session'

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
  write: (sessionToken: string, session: Session) => Promise<void>
}

export interface StoredSessionToken {
  requiresMigration: boolean
  sessionToken: string
}

const parseStoredSessionToken = (
  value: string | null,
  requiresLegacyMigration: boolean
): StoredSessionToken | undefined => {
  if (!value) {
    return undefined
  }

  try {
    const storedSession = JSON.parse(value) as unknown

    if (typeof storedSession === 'object' && storedSession !== null) {
      if ('sessionToken' in storedSession && typeof storedSession.sessionToken === 'string') {
        return {
          requiresMigration: requiresLegacyMigration,
          sessionToken: storedSession.sessionToken,
        }
      }

      return undefined
    }

    return {
      requiresMigration: false,
      sessionToken: value,
    }
  } catch {
    return {
      requiresMigration: false,
      sessionToken: value,
    }
  }
}

export const createSessionTokenStorage = (
  platform: string,
  secureStore: SecureStoreAdapter,
  asyncStorage: AsyncStorageAdapter
): SessionTokenStorage => {
  const web = platform === 'web'
  const deleteItem = async (): Promise<void> =>
    web ? asyncStorage.removeItem(SESSION_KEY) : secureStore.deleteItemAsync(SESSION_KEY)
  const readItem = async (): Promise<string | null> =>
    web ? asyncStorage.getItem(SESSION_KEY) : secureStore.getItemAsync(SESSION_KEY)
  const writeItem = async (value: string): Promise<void> =>
    web ? asyncStorage.setItem(SESSION_KEY, value) : secureStore.setItemAsync(SESSION_KEY, value)

  return {
    delete: deleteItem,
    read: async () => parseStoredSessionToken(await readItem(), !web),
    write: async (sessionToken, session) => {
      await writeItem(web ? JSON.stringify({ session, sessionToken }) : sessionToken)
    },
  }
}
