import type { Session }              from '@ory/kratos-client-fetch'

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
  getAsyncValue: () => string | undefined
  getSecureValue: () => string | undefined
  secureStore: {
    deleteItemAsync: (key: string) => Promise<void>
    getItemAsync: (key: string) => Promise<string | null>
    setItemAsync: (key: string, value: string) => Promise<void>
  }
}

interface CreateStoresOptions {
  asyncValue?: string
  secureValue?: string
}

const session = { id: 'session-id', active: true } as Session

const createStores = ({ asyncValue, secureValue }: CreateStoresOptions = {}): TestStores => {
  const calls: Calls = {
    async: [],
    secure: [],
  }
  const asyncValues = new Map<string, string>()
  const secureValues = new Map<string, string>()

  if (asyncValue) {
    asyncValues.set('user_session', asyncValue)
  }

  if (secureValue) {
    secureValues.set('user_session', secureValue)
  }

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

  return {
    asyncStorage,
    calls,
    getAsyncValue: () => asyncValues.get('user_session'),
    getSecureValue: () => secureValues.get('user_session'),
    secureStore,
  }
}

test('stores the raw native token under the released user_session key', async () => {
  const stores = createStores({ secureValue: 'native-token' })
  const storage = createSessionTokenStorage('ios', stores.secureStore, stores.asyncStorage)

  assert.deepEqual(await storage.read(), {
    requiresMigration: false,
    sessionToken: 'native-token',
  })
  await storage.write('next-native-token', session)
  await storage.delete()

  assert.deepEqual(stores.calls.secure, [
    ['read', 'user_session'],
    ['write', 'user_session', 'next-native-token'],
    ['delete', 'user_session'],
  ])
  assert.deepEqual(stores.calls.async, [])
})

test('marks the released native JSON value for in-place migration', async () => {
  const legacyValue = JSON.stringify({ session: { id: 'legacy' }, sessionToken: 'legacy-token' })
  const stores = createStores({ secureValue: legacyValue })
  const storage = createSessionTokenStorage('android', stores.secureStore, stores.asyncStorage)

  assert.deepEqual(await storage.read(), {
    requiresMigration: true,
    sessionToken: 'legacy-token',
  })
  await storage.write('legacy-token', session)

  assert.equal(stores.getSecureValue(), 'legacy-token')
  assert.deepEqual(stores.calls.secure, [
    ['read', 'user_session'],
    ['write', 'user_session', 'legacy-token'],
  ])
})

test('retains the released native JSON value when migration cannot be persisted', async () => {
  const legacyValue = JSON.stringify({ session: { id: 'legacy' }, sessionToken: 'legacy-token' })
  const stores = createStores({ secureValue: legacyValue })
  const storageError = new Error('secure storage unavailable')
  const storage = createSessionTokenStorage(
    'ios',
    {
      ...stores.secureStore,
      setItemAsync: async (key, value): Promise<void> => {
        stores.calls.secure.push(['write', key, value])
        throw storageError
      },
    },
    stores.asyncStorage
  )

  await assert.rejects(storage.write('legacy-token', session), (error) => error === storageError)

  assert.equal(stores.getSecureValue(), legacyValue)
})

test('preserves the released JSON fallback in AsyncStorage on web', async () => {
  const previousValue = JSON.stringify({ session: { id: 'previous' }, sessionToken: 'web-token' })
  const stores = createStores({ asyncValue: previousValue })
  const storage = createSessionTokenStorage('web', stores.secureStore, stores.asyncStorage)

  assert.deepEqual(await storage.read(), {
    requiresMigration: false,
    sessionToken: 'web-token',
  })
  await storage.write('next-web-token', session)

  assert.deepEqual(JSON.parse(stores.getAsyncValue()!), {
    session,
    sessionToken: 'next-web-token',
  })
  assert.deepEqual(stores.calls.secure, [])
})
