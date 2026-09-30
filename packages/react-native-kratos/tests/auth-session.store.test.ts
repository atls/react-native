import type { Session }             from '@ory/kratos-client-fetch'

import type { AuthSessionSdk }      from '../src/providers/auth-session.store.js'
import type { SessionTokenStorage } from '../src/providers/session-token.storage.js'
import type { StoredSessionToken }  from '../src/providers/session-token.storage.js'

import assert                       from 'node:assert/strict'
import { test }                     from 'node:test'

import { ResponseError }            from '@ory/kratos-client-fetch'

import { createAuthSessionStore }   from '../src/providers/auth-session.store.js'

const session = (id: string): Session => ({ id, active: true }) as Session

const storedSession = (sessionToken: string, requiresMigration = false): StoredSessionToken => ({
  requiresMigration,
  sessionToken,
})

const responseError = (status: number): ResponseError =>
  new ResponseError(new Response(undefined, { status }))

interface Deferred<T> {
  promise: Promise<T>
  reject: (error: unknown) => void
  resolve: (value: PromiseLike<T> | T) => void
}

interface TestStorage {
  calls: Array<string>
  getStoredSession: () => StoredSessionToken | undefined
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

const createStorage = (initialSession?: StoredSessionToken): TestStorage => {
  const calls: Array<string> = []
  let currentSession = initialSession
  const storage: SessionTokenStorage = {
    delete: async () => {
      calls.push('delete')
      currentSession = undefined
    },
    read: async () => {
      calls.push('read')

      return currentSession
    },
    write: async (sessionToken) => {
      calls.push(`write:${sessionToken}`)
      currentSession = storedSession(sessionToken)
    },
  }

  return {
    calls,
    getStoredSession: () => currentSession,
    storage,
  }
}

test('restores and migrates a released native session after Kratos validation', async () => {
  const persisted = createStorage(storedSession('legacy-token', true))
  const restored = session('restored')
  const sdk = {
    toSession: async ({ xSessionToken }: { xSessionToken?: string }): Promise<Session> => {
      assert.equal(xSessionToken, 'legacy-token')

      return restored
    },
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage: persisted.storage })

  await store.initialize()

  assert.deepEqual(store.getSnapshot(), {
    generation: 0,
    initialized: true,
    session: restored,
    sessionToken: 'legacy-token',
  })
  assert.deepEqual(persisted.calls, ['read', 'write:legacy-token'])
  assert.deepEqual(persisted.getStoredSession(), storedSession('legacy-token'))
})

test('keeps a validated legacy session retryable when migration write fails', async () => {
  const migrationError = new Error('secure storage unavailable')
  const restored = session('restored')
  const storage: SessionTokenStorage = {
    delete: async (): Promise<void> => undefined,
    read: async (): Promise<StoredSessionToken> => storedSession('legacy-token', true),
    write: async (): Promise<void> => {
      throw migrationError
    },
  }
  const sdk = {
    toSession: async (): Promise<Session> => restored,
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage })

  await store.initialize()

  assert.deepEqual(store.getSnapshot(), {
    error: migrationError,
    generation: 0,
    initialized: true,
    session: restored,
    sessionToken: 'legacy-token',
  })
})

test('clears only a credential confirmed inactive by Kratos', async () => {
  const persisted = createStorage(storedSession('inactive-token'))
  const sdk = {
    toSession: async (): Promise<Session> => {
      throw responseError(401)
    },
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage: persisted.storage })

  await store.initialize()

  assert.deepEqual(store.getSnapshot(), {
    generation: 1,
    initialized: true,
  })
  assert.equal(persisted.getStoredSession(), undefined)
  assert.deepEqual(persisted.calls, ['read', 'read', 'delete'])
})

test('surfaces a failed inactive credential cleanup', async () => {
  const cleanupError = new Error('secure storage unavailable')
  const storage: SessionTokenStorage = {
    delete: async (): Promise<void> => {
      throw cleanupError
    },
    read: async (): Promise<StoredSessionToken> => storedSession('inactive-token'),
    write: async (): Promise<void> => undefined,
  }
  const sdk = {
    toSession: async (): Promise<Session> => {
      throw responseError(401)
    },
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage })

  await store.initialize()

  assert.deepEqual(store.getSnapshot(), {
    error: cleanupError,
    generation: 1,
    initialized: true,
  })
})

test('retains a credential after a retryable startup failure and syncs it later', async () => {
  const persisted = createStorage(storedSession('active-token'))
  const offline = new TypeError('offline')
  let calls = 0
  const sdk = {
    toSession: async (): Promise<Session> => {
      calls += 1

      if (calls === 1) {
        throw offline
      }

      return session('restored')
    },
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage: persisted.storage })

  await store.initialize()
  assert.deepEqual(store.getSnapshot(), {
    error: offline,
    generation: 0,
    initialized: true,
    sessionToken: 'active-token',
  })

  await store.syncSession()

  assert.deepEqual(store.getSnapshot(), {
    generation: 0,
    initialized: true,
    session: session('restored'),
    sessionToken: 'active-token',
  })
  assert.deepEqual(persisted.getStoredSession(), storedSession('active-token'))
})

test('preserves a confirmed session when an AAL sync fails', async () => {
  const persisted = createStorage(storedSession('active-token'))
  const aalError = responseError(403)
  let calls = 0
  const sdk = {
    toSession: async (): Promise<Session> => {
      calls += 1

      if (calls === 1) {
        return session('confirmed')
      }

      throw aalError
    },
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage: persisted.storage })

  await store.initialize()
  await assert.rejects(store.syncSession(), (error) => error === aalError)

  assert.deepEqual(store.getSnapshot(), {
    error: aalError,
    generation: 0,
    initialized: true,
    session: session('confirmed'),
    sessionToken: 'active-token',
  })
})

test('retries a failed storage read through syncSession', async () => {
  const readError = new Error('secure storage unavailable')
  let reads = 0
  const storage: SessionTokenStorage = {
    delete: async (): Promise<void> => undefined,
    read: async (): Promise<StoredSessionToken> => {
      reads += 1

      if (reads === 1) {
        throw readError
      }

      return storedSession('active-token')
    },
    write: async (): Promise<void> => undefined,
  }
  const sdk = {
    toSession: async (): Promise<Session> => session('restored'),
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage })

  await store.initialize()
  assert.equal(store.getSnapshot().error, readError)

  await store.syncSession()

  assert.deepEqual(store.getSnapshot(), {
    generation: 0,
    initialized: true,
    session: session('restored'),
    sessionToken: 'active-token',
  })
})

test('account switching replaces local state without revoking other sessions', async () => {
  const persisted = createStorage()
  const revokedTokens: Array<string> = []
  const sdk = {
    performNativeLogout: async ({
      performNativeLogoutBody,
    }: {
      performNativeLogoutBody: { session_token: string }
    }): Promise<void> => {
      revokedTokens.push(performNativeLogoutBody.session_token)
    },
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage: persisted.storage })

  await store.initialize()
  await store.acceptSession(
    { session: session('account-a'), sessionToken: 'token-a' },
    store.getSnapshot().generation
  )
  await store.acceptSession(
    { session: session('account-b'), sessionToken: 'token-b' },
    store.getSnapshot().generation
  )

  assert.deepEqual(store.getSnapshot(), {
    generation: 2,
    initialized: true,
    session: session('account-b'),
    sessionToken: 'token-b',
  })
  assert.deepEqual(persisted.getStoredSession(), storedSession('token-b'))
  assert.deepEqual(revokedTokens, [])
})

test('a failed account replacement preserves the last confirmed session', async () => {
  const writeError = new Error('secure storage unavailable')
  let currentSession: StoredSessionToken | undefined = storedSession('token-a')
  const storage: SessionTokenStorage = {
    delete: async (): Promise<void> => {
      currentSession = undefined
    },
    read: async (): Promise<StoredSessionToken | undefined> => currentSession,
    write: async (): Promise<void> => {
      throw writeError
    },
  }
  const sdk = {
    toSession: async (): Promise<Session> => session('account-a'),
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage })

  await store.initialize()
  await assert.rejects(
    store.acceptSession(
      { session: session('account-b'), sessionToken: 'token-b' },
      store.getSnapshot().generation
    ),
    (error) => error === writeError
  )

  assert.deepEqual(store.getSnapshot(), {
    error: writeError,
    generation: 1,
    initialized: true,
    session: session('account-a'),
    sessionToken: 'token-a',
  })
  assert.deepEqual(currentSession, storedSession('token-a'))
})

test('local clear deletes the credential without remote logout', async () => {
  const persisted = createStorage(storedSession('active-token'))
  const revokedTokens: Array<string> = []
  const sdk = {
    performNativeLogout: async ({
      performNativeLogoutBody,
    }: {
      performNativeLogoutBody: { session_token: string }
    }): Promise<void> => {
      revokedTokens.push(performNativeLogoutBody.session_token)
    },
    toSession: async (): Promise<Session> => session('active'),
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage: persisted.storage })

  await store.initialize()
  await store.clearSession(store.getSnapshot().generation)

  assert.deepEqual(store.getSnapshot(), {
    generation: 1,
    initialized: true,
  })
  assert.equal(persisted.getStoredSession(), undefined)
  assert.deepEqual(revokedTokens, [])
})

test('explicit logout removes and revokes the captured credential', async () => {
  const persisted = createStorage(storedSession('active-token'))
  const revokedTokens: Array<string> = []
  const sdk = {
    performNativeLogout: async ({
      performNativeLogoutBody,
    }: {
      performNativeLogoutBody: { session_token: string }
    }): Promise<void> => {
      revokedTokens.push(performNativeLogoutBody.session_token)
    },
    toSession: async (): Promise<Session> => session('active'),
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage: persisted.storage })

  await store.initialize()
  await store.logout()

  assert.deepEqual(store.getSnapshot(), {
    generation: 1,
    initialized: true,
  })
  assert.equal(persisted.getStoredSession(), undefined)
  assert.deepEqual(revokedTokens, ['active-token'])
})

test('explicit logout reports both local and remote failures', async () => {
  const deleteError = new Error('secure storage unavailable')
  const revokeError = new Error('Kratos unavailable')
  const storage: SessionTokenStorage = {
    delete: async (): Promise<void> => {
      throw deleteError
    },
    read: async (): Promise<StoredSessionToken> => storedSession('active-token'),
    write: async (): Promise<void> => undefined,
  }
  const sdk = {
    performNativeLogout: async (): Promise<void> => {
      throw revokeError
    },
    toSession: async (): Promise<Session> => session('active'),
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage })

  await store.initialize()
  await assert.rejects(store.logout(), (error) => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors, [deleteError, revokeError])

    return true
  })

  assert.deepEqual(store.getSnapshot(), {
    generation: 1,
    initialized: true,
  })
})

test('late login and restore results cannot replace newer local state', async () => {
  const restoration = deferred<Session>()
  const persisted = createStorage(storedSession('token-a'))
  const sdk = {
    toSession: async (): Promise<Session> => restoration.promise,
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage: persisted.storage })
  const initialization = store.initialize()

  await Promise.resolve()
  const staleGeneration = store.getSnapshot().generation
  await store.clearSession(staleGeneration)
  await store.acceptSession(
    { session: session('late-login'), sessionToken: 'late-token' },
    staleGeneration
  )
  restoration.resolve(session('late-restore'))
  await initialization

  assert.deepEqual(store.getSnapshot(), {
    generation: 1,
    initialized: true,
  })
  assert.equal(persisted.getStoredSession(), undefined)
})

test('a sync result cannot overwrite a newer accepted account', async () => {
  const synchronization = deferred<Session>()
  const persisted = createStorage(storedSession('token-a'))
  let calls = 0
  const sdk = {
    toSession: async (): Promise<Session> => {
      calls += 1

      return calls === 1 ? session('account-a') : synchronization.promise
    },
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage: persisted.storage })

  await store.initialize()
  const pendingSynchronization = store.syncSession()
  await store.acceptSession(
    { session: session('account-b'), sessionToken: 'token-b' },
    store.getSnapshot().generation
  )
  synchronization.resolve(session('stale-account-a'))
  await pendingSynchronization

  assert.deepEqual(store.getSnapshot(), {
    generation: 1,
    initialized: true,
    session: session('account-b'),
    sessionToken: 'token-b',
  })
})

test('sync waits for an accepted session instead of validating its predecessor', async () => {
  const write = deferred<undefined>()
  const writeStarted = deferred<undefined>()
  let currentSession: StoredSessionToken | undefined = storedSession('token-a')
  let sessionCalls = 0
  const storage: SessionTokenStorage = {
    delete: async (): Promise<void> => {
      currentSession = undefined
    },
    read: async (): Promise<StoredSessionToken | undefined> => currentSession,
    write: async (sessionToken): Promise<void> => {
      writeStarted.resolve(undefined)
      await write.promise
      currentSession = storedSession(sessionToken)
    },
  }
  const sdk = {
    toSession: async (): Promise<Session> => {
      sessionCalls += 1

      return session('account-a')
    },
  } as AuthSessionSdk
  const store = createAuthSessionStore({ sdk, storage })

  await store.initialize()
  const acceptance = store.acceptSession(
    { session: session('account-b'), sessionToken: 'token-b' },
    store.getSnapshot().generation
  )
  await writeStarted.promise

  await store.syncSession()

  write.resolve(undefined)
  await acceptance

  assert.equal(sessionCalls, 1)
  assert.deepEqual(store.getSnapshot(), {
    generation: 1,
    initialized: true,
    session: session('account-b'),
    sessionToken: 'token-b',
  })
})

test('rejects native flow results without a session token', async () => {
  const store = createAuthSessionStore({
    sdk: {} as AuthSessionSdk,
    storage: createStorage().storage,
  })

  await assert.rejects(
    store.acceptSession({ session: session('missing-token') }, 0),
    /Missing session token/
  )
})
