import type { Session }              from '@ory/kratos-client-fetch'

import assert                        from 'node:assert/strict'
import { test }                      from 'node:test'

import { createSessionTokenStorage } from '../src/providers/session-token.storage.js'

const session = { id: 'session-id', active: true } as Session

const createStore = (initialValue: string) => {
  let value: string | undefined = initialValue
  const calls: Array<Array<string>> = []
  const secureStore = {
    deleteItemAsync: async (key: string): Promise<void> => {
      calls.push(['delete', key])
      value = undefined
    },
    getItemAsync: async (key: string): Promise<string | null> => {
      calls.push(['read', key])

      return value ?? null
    },
    setItemAsync: async (key: string, nextValue: string): Promise<void> => {
      calls.push(['write', key, nextValue])
      value = nextValue
    },
  }

  return { calls, getValue: () => value, secureStore }
}

test('stores the raw native token under the released user_session key', async () => {
  const store = createStore('native-token')
  const storage = createSessionTokenStorage(store.secureStore)

  assert.deepEqual(await storage.read(), {
    requiresMigration: false,
    sessionToken: 'native-token',
  })
  await storage.write('next-native-token', session)
  await storage.delete()

  assert.equal(store.getValue(), undefined)
  assert.deepEqual(store.calls, [
    ['read', 'user_session'],
    ['write', 'user_session', 'next-native-token'],
    ['delete', 'user_session'],
  ])
})

test('marks the released native JSON value for in-place migration', async () => {
  const legacyValue = JSON.stringify({ session: { id: 'legacy' }, sessionToken: 'legacy-token' })
  const store = createStore(legacyValue)
  const storage = createSessionTokenStorage(store.secureStore)

  assert.deepEqual(await storage.read(), {
    requiresMigration: true,
    sessionToken: 'legacy-token',
  })
  await storage.write('legacy-token', session)

  assert.equal(store.getValue(), 'legacy-token')
  assert.deepEqual(store.calls, [
    ['read', 'user_session'],
    ['write', 'user_session', 'legacy-token'],
  ])
})

test('retains the released native JSON value when migration cannot be persisted', async () => {
  const legacyValue = JSON.stringify({ session: { id: 'legacy' }, sessionToken: 'legacy-token' })
  const store = createStore(legacyValue)
  const storageError = new Error('secure storage unavailable')
  const storage = createSessionTokenStorage({
    ...store.secureStore,
    setItemAsync: async (): Promise<void> => {
      throw storageError
    },
  })

  await assert.rejects(storage.write('legacy-token', session), (error) => error === storageError)

  assert.equal(store.getValue(), legacyValue)
})
