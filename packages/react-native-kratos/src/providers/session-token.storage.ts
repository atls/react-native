import type { Session } from '@ory/kratos-client-fetch'

const SESSION_KEY = 'user_session'

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

const parseStoredSessionToken = (value: string | null): StoredSessionToken | undefined => {
  if (!value) {
    return undefined
  }

  try {
    const storedSession = JSON.parse(value) as unknown

    if (typeof storedSession === 'object' && storedSession !== null) {
      if ('sessionToken' in storedSession && typeof storedSession.sessionToken === 'string') {
        return {
          requiresMigration: true,
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
  secureStore: SecureStoreAdapter
): SessionTokenStorage => ({
  delete: async () => secureStore.deleteItemAsync(SESSION_KEY),
  read: async () => parseStoredSessionToken(await secureStore.getItemAsync(SESSION_KEY)),
  write: async (sessionToken) => secureStore.setItemAsync(SESSION_KEY, sessionToken),
})
