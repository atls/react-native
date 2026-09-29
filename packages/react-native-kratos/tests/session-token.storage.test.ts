import assert                        from 'node:assert/strict'
import { test }                      from 'node:test'

import { createSessionTokenStorage } from '../src/providers/session-token.storage.js'

interface Calls {
  async: Array<Array<string>>
  secure: Array<Array<string>>
}

interface TestStores {
  asyncStorage: {
    getItem: (key: string) => Promise<string>
    removeItem: (key: string) => Promise<void>
    setItem: (key: string, value: string) => Promise<void>
  }
  calls: Calls
  secureStore: {
    deleteItemAsync: (key: string) => Promise<void>
    getItemAsync: (key: string) => Promise<string>
    setItemAsync: (key: string, value: string) => Promise<void>
  }
}

const createStores = (): TestStores => {
  const calls: Calls = {
    async: [],
    secure: [],
  }
  const secureStore = {
    deleteItemAsync: async (key: string): Promise<void> => {
      calls.secure.push(['delete', key])
    },
    getItemAsync: async (key: string): Promise<string> => {
      calls.secure.push(['read', key])

      return 'native-token'
    },
    setItemAsync: async (key: string, value: string): Promise<void> => {
      calls.secure.push(['write', key, value])
    },
  }
  const asyncStorage = {
    getItem: async (key: string): Promise<string> => {
      calls.async.push(['read', key])

      return 'web-token'
    },
    removeItem: async (key: string): Promise<void> => {
      calls.async.push(['delete', key])
    },
    setItem: async (key: string, value: string): Promise<void> => {
      calls.async.push(['write', key, value])
    },
  }

  return { asyncStorage, calls, secureStore }
}

test('stores only the raw session token in SecureStore on native platforms', async () => {
  const { asyncStorage, calls, secureStore } = createStores()
  const storage = createSessionTokenStorage('ios', secureStore, asyncStorage)

  assert.equal(await storage.read(), 'native-token')
  await storage.write('next-native-token')
  await storage.delete()

  assert.deepEqual(calls.secure, [
    ['read', 'session_token'],
    ['write', 'session_token', 'next-native-token'],
    ['delete', 'session_token'],
  ])
  assert.deepEqual(calls.async, [])
})

test('stores only the raw session token in AsyncStorage on web', async () => {
  const { asyncStorage, calls, secureStore } = createStores()
  const storage = createSessionTokenStorage('web', secureStore, asyncStorage)

  assert.equal(await storage.read(), 'web-token')
  await storage.write('next-web-token')
  await storage.delete()

  assert.deepEqual(calls.async, [
    ['read', 'session_token'],
    ['write', 'session_token', 'next-web-token'],
    ['delete', 'session_token'],
  ])
  assert.deepEqual(calls.secure, [])
})
