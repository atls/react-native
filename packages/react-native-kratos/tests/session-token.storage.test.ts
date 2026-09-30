import assert                        from 'node:assert/strict'
import { test }                      from 'node:test'

import { createSessionTokenStorage } from '../src/providers/session-token.storage.js'

interface Calls {
  async: Array<Array<string>>
  secure: Array<Array<string>>
}

interface TestStores {
  asyncStorage: {
    getItem: (key: string) => Promise<string | null>
    removeItem: (key: string) => Promise<void>
    setItem: (key: string, value: string) => Promise<void>
  }
  calls: Calls
  secureStore: {
    deleteItemAsync: (key: string) => Promise<void>
    getItemAsync: (key: string) => Promise<string | null>
    setItemAsync: (key: string, value: string) => Promise<void>
  }
}

interface CreateStoresOptions {
  asyncValues?: Record<string, string>
  secureValues?: Record<string, string>
}

const createStores = ({
  asyncValues: initialAsyncValues = { session_token: 'web-token' },
  secureValues: initialSecureValues = { session_token: 'native-token' },
}: CreateStoresOptions = {}): TestStores => {
  const calls: Calls = {
    async: [],
    secure: [],
  }
  const asyncValues = new Map(Object.entries(initialAsyncValues))
  const secureValues = new Map(Object.entries(initialSecureValues))
  const secureStore = {
    deleteItemAsync: async (key: string): Promise<void> => {
      calls.secure.push(['delete', key])
      secureValues.delete(key)
    },
    getItemAsync: async (key: string): Promise<string | null> => {
      calls.secure.push(['read', key])

      return secureValues.get(key) ?? null
    },
    setItemAsync: async (key: string, value: string): Promise<void> => {
      calls.secure.push(['write', key, value])
      secureValues.set(key, value)
    },
  }
  const asyncStorage = {
    getItem: async (key: string): Promise<string | null> => {
      calls.async.push(['read', key])

      return asyncValues.get(key) ?? null
    },
    removeItem: async (key: string): Promise<void> => {
      calls.async.push(['delete', key])
      asyncValues.delete(key)
    },
    setItem: async (key: string, value: string): Promise<void> => {
      calls.async.push(['write', key, value])
      asyncValues.set(key, value)
    },
  }

  return { asyncStorage, calls, secureStore }
}

test('stores only the raw session token in SecureStore on native platforms', async () => {
  const { asyncStorage, calls, secureStore } = createStores()
  const storage = createSessionTokenStorage('ios', secureStore, asyncStorage)

  assert.deepEqual(await storage.read(), {
    requiresMigration: false,
    sessionToken: 'native-token',
  })
  await storage.write('next-native-token')
  await storage.delete()

  assert.deepEqual(calls.secure, [
    ['read', 'session_token'],
    ['write', 'session_token', 'next-native-token'],
    ['delete', 'user_session'],
    ['delete', 'user_session'],
    ['delete', 'session_token'],
  ])
  assert.deepEqual(calls.async, [])
})

test('stores only the raw session token in AsyncStorage on web', async () => {
  const { asyncStorage, calls, secureStore } = createStores()
  const storage = createSessionTokenStorage('web', secureStore, asyncStorage)

  assert.deepEqual(await storage.read(), {
    requiresMigration: false,
    sessionToken: 'web-token',
  })
  await storage.write('next-web-token')
  await storage.delete()

  assert.deepEqual(calls.async, [
    ['read', 'session_token'],
    ['write', 'session_token', 'next-web-token'],
    ['delete', 'user_session'],
    ['delete', 'user_session'],
    ['delete', 'session_token'],
  ])
  assert.deepEqual(calls.secure, [])
})

test('migrates a legacy session only after persisting its token', async () => {
  const { asyncStorage, calls, secureStore } = createStores({
    secureValues: {
      user_session: JSON.stringify({ session: { id: 'legacy' }, sessionToken: 'legacy-token' }),
    },
  })
  const storage = createSessionTokenStorage('ios', secureStore, asyncStorage)

  assert.deepEqual(await storage.read(), {
    requiresMigration: true,
    sessionToken: 'legacy-token',
  })
  await storage.write('legacy-token')

  assert.deepEqual(calls.secure, [
    ['read', 'session_token'],
    ['read', 'user_session'],
    ['write', 'session_token', 'legacy-token'],
    ['delete', 'user_session'],
  ])
})

test('retains the legacy session when persisting its token fails', async () => {
  const legacySession = JSON.stringify({ session: { id: 'legacy' }, sessionToken: 'legacy-token' })
  const { asyncStorage, calls, secureStore } = createStores({
    secureValues: { user_session: legacySession },
  })
  const storageError = new Error('secure storage unavailable')
  const storage = createSessionTokenStorage(
    'ios',
    {
      ...secureStore,
      setItemAsync: async (key, value): Promise<void> => {
        calls.secure.push(['write', key, value])
        throw storageError
      },
    },
    asyncStorage
  )

  await assert.rejects(storage.write('legacy-token'), (error) => error === storageError)
  assert.deepEqual(calls.secure, [['write', 'session_token', 'legacy-token']])
})
