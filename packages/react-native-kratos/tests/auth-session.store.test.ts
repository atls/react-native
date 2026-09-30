import type { Session }             from '@ory/kratos-client-fetch'

import type { AuthSessionSdk }      from '../src/providers/auth-session.store.js'
import type { SessionTokenStorage } from '../src/providers/session-token.storage.js'
import type { StoredSessionToken }  from '../src/providers/session-token.storage.js'

import assert                       from 'node:assert/strict'
import { test }                     from 'node:test'

import { ResponseError }            from '@ory/kratos-client-fetch'

import { createAuthSessionStore }   from '../src/providers/auth-session.store.js'

const session = (id: string): Session => ({ id, active: true }) as Session

const storedSessionToken = (
  sessionToken: string,
  requiresMigration = false
): StoredSessionToken => ({ requiresMigration, sessionToken })

interface Deferred<T> {
  promise: Promise<T>
  reject: (error: unknown) => void
  resolve: (value: PromiseLike<T> | T) => void
}

interface TestStorage {
  calls: Array<string>
  getToken: () => string | undefined
  storage: SessionTokenStorage
}

const deferred = <T>(): Deferred<T> => {
  let resolve: (value: PromiseLike<T> | T) => void = (): void => undefined
  let reject: (error: unknown) => void = (): void => undefined
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

const createStorage = (initialToken?: string): TestStorage => {
  const calls: Array<string> = []
  let token = initialToken
  const storage: SessionTokenStorage = {
    delete: async () => {
      calls.push('delete')
      token = undefined
    },
    read: async () => {
      calls.push('read')

      return token ? storedSessionToken(token) : undefined
    },
    write: async (nextToken) => {
      calls.push(`write:${nextToken}`)
      token = nextToken
    },
  }

  return {
    calls,
    getToken: (): string | undefined => token,
    storage,
  }
}

test('restores an active session from the persisted token', async () => {
  const persisted = createStorage('persisted-token')
  const restored = session('restored')
  const sdk = {
    toSession: async ({ xSessionToken }: { xSessionToken?: string }) => {
      assert.equal(xSessionToken, 'persisted-token')

      return restored
    },
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage: persisted.storage })

  await store.initialize()

  assert.deepEqual(store.getSnapshot(), {
    generation: 0,
    initialized: true,
    session: restored,
    sessionToken: 'persisted-token',
  })
  assert.deepEqual(persisted.calls, ['read'])
})

test('deletes a token only when the SDK confirms an inactive session', async () => {
  const persisted = createStorage('inactive-token')
  const sdk = {
    performNativeLogout: async (): Promise<void> => undefined,
    toSession: async () => {
      throw new ResponseError(new Response(undefined, { status: 401 }))
    },
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage: persisted.storage })

  await store.initialize()

  assert.deepEqual(store.getSnapshot(), {
    generation: 1,
    initialized: true,
  })
  assert.equal(persisted.getToken(), undefined)
  assert.deepEqual(persisted.calls, ['read', 'delete'])
})

test('retains the token after network and server failures', async () => {
  await Promise.all(
    [
      new TypeError('offline'),
      new ResponseError(new Response(undefined, { status: 500 })),
      new ResponseError(new Response(undefined, { status: 403 })),
    ].map(async (error) => {
      const persisted = createStorage('retryable-token')
      const sdk = {
        performNativeLogout: async (): Promise<void> => undefined,
        toSession: async () => {
          throw error
        },
      } as AuthSessionSdk
      const store = createAuthSessionStore({ sdk, storage: persisted.storage })

      await store.initialize()

      assert.deepEqual(store.getSnapshot(), {
        error,
        generation: 0,
        initialized: true,
        sessionToken: 'retryable-token',
      })
      assert.equal(persisted.getToken(), 'retryable-token')
      assert.deepEqual(persisted.calls, ['read'])
    })
  )
})

test('retains the confirmed session after a retryable refresh failure', async () => {
  const refreshError = new TypeError('offline')
  const persisted = createStorage('active-token')
  const activeSession = session('active-account')
  let calls = 0
  const sdk = {
    toSession: async () => {
      calls += 1

      if (calls === 1) {
        return activeSession
      }

      throw refreshError
    },
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage: persisted.storage })

  await store.initialize()
  await assert.rejects(store.refreshSession(), (error) => error === refreshError)

  assert.deepEqual(store.getSnapshot(), {
    error: refreshError,
    generation: 0,
    initialized: true,
    session: activeSession,
    sessionToken: 'active-token',
  })
})

test('a retryable refresh failure cannot replace a newer account', async () => {
  const refresh = deferred<Session>()
  const persisted = createStorage('active-token')
  let calls = 0
  const sdk = {
    toSession: async () => {
      calls += 1

      return calls === 1 ? session('initial-account') : refresh.promise
    },
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage: persisted.storage })

  await store.initialize()
  const pendingRefresh = store.refreshSession()
  await store.acceptSession({ session: session('next-account'), sessionToken: 'next-token' }, 0)

  refresh.reject(new TypeError('offline'))
  await pendingRefresh

  assert.deepEqual(store.getSnapshot(), {
    generation: 1,
    initialized: true,
    session: session('next-account'),
    sessionToken: 'next-token',
  })
})

test('surfaces a storage read failure and allows a later restore retry', async () => {
  const storageError = new Error('secure storage unavailable')
  let reads = 0
  const restored = session('restored-after-storage-recovery')
  const storage: SessionTokenStorage = {
    delete: async (): Promise<void> => undefined,
    read: async (): Promise<StoredSessionToken> => {
      reads += 1

      if (reads === 1) {
        throw storageError
      }

      return storedSessionToken('persisted-token')
    },
    write: async (): Promise<void> => undefined,
  }
  const sdk = {
    toSession: async (): Promise<Session> => restored,
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage })

  await store.initialize()

  assert.deepEqual(store.getSnapshot(), {
    error: storageError,
    generation: 0,
    initialized: true,
  })

  await store.initialize()

  assert.deepEqual(store.getSnapshot(), {
    generation: 0,
    initialized: true,
    session: restored,
    sessionToken: 'persisted-token',
  })
})

test('logout clears local state and revokes the captured token', async () => {
  const persisted = createStorage('captured-token')
  const remoteTokens: Array<string> = []
  const sdk = {
    performNativeLogout: async ({
      performNativeLogoutBody,
    }: {
      performNativeLogoutBody: { session_token: string }
    }) => {
      remoteTokens.push(performNativeLogoutBody.session_token)
    },
    toSession: async () => session('active'),
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage: persisted.storage })

  await store.initialize()
  const logout = store.logout()

  assert.deepEqual(store.getSnapshot(), {
    generation: 1,
    initialized: true,
  })

  await logout

  assert.deepEqual(remoteTokens, ['captured-token'])
  assert.equal(persisted.getToken(), undefined)
  assert.deepEqual(persisted.calls, ['read', 'delete'])
})

test('logout still revokes the captured token when local deletion fails', async () => {
  const localError = new Error('secure storage unavailable')
  const remoteTokens: Array<string> = []
  const storage: SessionTokenStorage = {
    delete: async (): Promise<void> => {
      throw localError
    },
    read: async (): Promise<StoredSessionToken> => storedSessionToken('captured-token'),
    write: async (): Promise<void> => undefined,
  }
  const sdk = {
    performNativeLogout: async ({
      performNativeLogoutBody,
    }: {
      performNativeLogoutBody: { session_token: string }
    }): Promise<void> => {
      remoteTokens.push(performNativeLogoutBody.session_token)
    },
    toSession: async (): Promise<Session> => session('active'),
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage })

  await store.initialize()

  await assert.rejects(store.logout(), (error) => error === localError)
  assert.deepEqual(remoteTokens, ['captured-token'])
  assert.deepEqual(store.getSnapshot(), {
    generation: 1,
    initialized: true,
  })
})

test('account switching replaces the token used by the next logout', async () => {
  const persisted = createStorage()
  const remoteTokens: Array<string> = []
  const sdk = {
    performNativeLogout: async ({
      performNativeLogoutBody,
    }: {
      performNativeLogoutBody: { session_token: string }
    }): Promise<void> => {
      remoteTokens.push(performNativeLogoutBody.session_token)
    },
    toSession: async (): Promise<Session> => session('unused'),
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage: persisted.storage })

  await store.initialize()
  await store.acceptSession({ session: session('first-account'), sessionToken: 'first-token' }, 0)
  await store.acceptSession({ session: session('second-account'), sessionToken: 'second-token' }, 1)
  await store.logout()

  assert.deepEqual(remoteTokens, ['second-token'])
  assert.equal(persisted.getToken(), undefined)
  assert.deepEqual(persisted.calls, ['read', 'write:first-token', 'write:second-token', 'delete'])
})

test('accepts only the first concurrent result from one generation', async () => {
  const persisted = createStorage()
  const store = createAuthSessionStore({
    sdk: {} as AuthSessionSdk,
    storage: persisted.storage,
  })

  await store.initialize()
  await Promise.all([
    store.acceptSession({ session: session('account-a'), sessionToken: 'token-a' }, 0),
    store.acceptSession({ session: session('account-b'), sessionToken: 'token-b' }, 0),
  ])

  assert.deepEqual(store.getSnapshot(), {
    generation: 1,
    initialized: true,
    session: session('account-a'),
    sessionToken: 'token-a',
  })
  assert.equal(persisted.getToken(), 'token-a')
  assert.deepEqual(persisted.calls, ['read', 'write:token-a'])
})

test('keeps acceptance retryable after a storage write failure', async () => {
  const storageError = new Error('secure storage unavailable')
  let shouldFail = true
  let token: string | undefined
  const storage: SessionTokenStorage = {
    delete: async (): Promise<void> => {
      token = undefined
    },
    read: async (): Promise<undefined> => undefined,
    write: async (nextToken): Promise<void> => {
      if (shouldFail) {
        shouldFail = false

        throw storageError
      }

      token = nextToken
    },
  }
  const store = createAuthSessionStore({ sdk: {} as AuthSessionSdk, storage })

  await store.initialize()
  await assert.rejects(
    store.acceptSession({ session: session('failed-account'), sessionToken: 'failed-token' }, 0),
    (error) => error === storageError
  )

  assert.deepEqual(store.getSnapshot(), {
    generation: 0,
    initialized: true,
  })
  assert.equal(token, undefined)

  await store.acceptSession({ session: session('recovered-account'), sessionToken: 'token' }, 0)

  assert.deepEqual(store.getSnapshot(), {
    generation: 1,
    initialized: true,
    session: session('recovered-account'),
    sessionToken: 'token',
  })
  assert.equal(token, 'token')
})

test('a late login result cannot recreate a logged-out session or token', async () => {
  const write = deferred<undefined>()
  let token: string | undefined
  const calls: Array<string> = []
  const storage: SessionTokenStorage = {
    delete: async () => {
      calls.push('delete')
      token = undefined
    },
    read: async () => undefined,
    write: async (nextToken) => {
      calls.push(`write:${nextToken}`)
      await write.promise
      token = nextToken
    },
  }
  const sdk = {} as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage })

  await store.initialize()
  const { generation } = store.getSnapshot()
  const accept = store.acceptSession(
    { session: session('late-login'), sessionToken: 'late-token' },
    generation
  )

  await Promise.resolve()
  const logout = store.logout()

  assert.deepEqual(store.getSnapshot(), {
    generation: 1,
    initialized: true,
  })
  const nextLogin = store.acceptSession(
    { session: session('next-login'), sessionToken: 'next-token' },
    store.getSnapshot().generation
  )

  write.resolve(undefined)
  await Promise.all([accept, logout, nextLogin])

  assert.deepEqual(store.getSnapshot(), {
    generation: 2,
    initialized: true,
    session: session('next-login'),
    sessionToken: 'next-token',
  })
  assert.equal(token, 'next-token')
  assert.deepEqual(calls, ['write:late-token', 'delete', 'write:next-token'])
})

test('late restore and refresh results cannot reauthorize after logout', async () => {
  const restore = deferred<Session>()
  const persisted = createStorage('persisted-token')
  const sdk = {
    performNativeLogout: async () => undefined,
    toSession: async () => restore.promise,
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage: persisted.storage })
  const initialization = store.initialize()

  await Promise.resolve()
  const logout = store.logout()

  restore.resolve(session('late-restore'))
  await Promise.all([initialization, logout])

  assert.deepEqual(store.getSnapshot(), {
    generation: 1,
    initialized: true,
  })

  const activeStorage = createStorage('active-token')
  let calls = 0
  const refresh = deferred<Session>()
  const refreshSdk = {
    performNativeLogout: async () => undefined,
    toSession: async () => {
      calls += 1

      return calls === 1 ? session('initial') : refresh.promise
    },
  } as AuthSessionSdk
  const refreshStore = createAuthSessionStore({
    sdk: refreshSdk,
    storage: activeStorage.storage,
  })

  await refreshStore.initialize()
  const pendingRefresh = refreshStore.refreshSession()
  const refreshLogout = refreshStore.logout()

  refresh.resolve(session('late-refresh'))
  await Promise.all([pendingRefresh, refreshLogout])

  assert.deepEqual(refreshStore.getSnapshot(), {
    generation: 1,
    initialized: true,
  })
})

test('logout removes a token written by an in-flight legacy migration', async () => {
  const migration = deferred<undefined>()
  const migrationStarted = deferred<undefined>()
  const calls: Array<string> = []
  let token: string | undefined
  const storage: SessionTokenStorage = {
    delete: async () => {
      calls.push('delete')
      token = undefined
    },
    read: async () => {
      calls.push('read')

      return storedSessionToken('legacy-token', true)
    },
    write: async (nextToken) => {
      calls.push(`write:${nextToken}`)
      migrationStarted.resolve(undefined)
      await migration.promise
      token = nextToken
    },
  }
  const revokedTokens: Array<string> = []
  const sdk = {
    performNativeLogout: async ({
      performNativeLogoutBody,
    }: {
      performNativeLogoutBody: { session_token: string }
    }) => {
      revokedTokens.push(performNativeLogoutBody.session_token)
    },
    toSession: async () => session('legacy-account'),
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage })
  const initialization = store.initialize()

  await migrationStarted.promise

  const logout = store.logout()

  migration.resolve(undefined)
  await Promise.all([initialization, logout])

  assert.deepEqual(store.getSnapshot(), {
    generation: 1,
    initialized: true,
  })
  assert.equal(token, undefined)
  assert.deepEqual(calls, ['read', 'write:legacy-token', 'delete'])
  assert.deepEqual(revokedTokens, ['legacy-token'])
})

test('account switching supersedes an in-flight legacy migration', async () => {
  const migration = deferred<undefined>()
  const migrationStarted = deferred<undefined>()
  const calls: Array<string> = []
  let token: string | undefined
  let writes = 0
  const storage: SessionTokenStorage = {
    delete: async () => {
      token = undefined
    },
    read: async () => storedSessionToken('legacy-token', true),
    write: async (nextToken) => {
      writes += 1
      calls.push(`write:${nextToken}`)

      if (writes === 1) {
        migrationStarted.resolve(undefined)
        await migration.promise
      }

      token = nextToken
    },
  }
  const sdk = {
    toSession: async () => session('legacy-account'),
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage })
  const initialization = store.initialize()

  await migrationStarted.promise

  const accountSwitch = store.acceptSession(
    { session: session('next-account'), sessionToken: 'next-token' },
    store.getSnapshot().generation
  )

  migration.resolve(undefined)
  await Promise.all([initialization, accountSwitch])

  assert.deepEqual(store.getSnapshot(), {
    generation: 1,
    initialized: true,
    session: session('next-account'),
    sessionToken: 'next-token',
  })
  assert.equal(token, 'next-token')
  assert.deepEqual(calls, ['write:legacy-token', 'write:next-token'])
})

test('rejects native flow results without a session token', async () => {
  const persisted = createStorage()
  const store = createAuthSessionStore({
    sdk: {} as AuthSessionSdk,
    storage: persisted.storage,
  })

  await store.initialize()

  await assert.rejects(
    store.acceptSession({ session: session('missing-token') }, 0),
    /Missing session token/
  )
  assert.deepEqual(persisted.calls, ['read'])
})
