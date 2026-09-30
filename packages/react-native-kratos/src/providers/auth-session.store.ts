import type { FrontendApi }         from '@ory/kratos-client-fetch'
import type { Session }             from '@ory/kratos-client-fetch'

import type { SessionTokenStorage } from './session-token.storage.js'
import type { StoredSessionToken }  from './session-token.storage.js'

import { ResponseError }            from '@ory/kratos-client-fetch'

export interface NativeSession {
  session: Session
  sessionToken?: string
}

export interface AuthSessionSnapshot {
  error?: unknown
  generation: number
  initialized: boolean
  session?: Session
  sessionToken?: string
}

export interface AuthSessionStore {
  acceptSession: (session: NativeSession, expectedGeneration: number) => Promise<void>
  clearSession: (expectedGeneration: number) => Promise<void>
  getSnapshot: () => AuthSessionSnapshot
  initialize: () => Promise<void>
  logout: () => Promise<void>
  subscribe: (listener: () => void) => () => void
  syncSession: () => Promise<void>
}

export type AuthSessionSdk = Pick<FrontendApi, 'performNativeLogout' | 'toSession'>

interface AuthSessionStoreOptions {
  sdk: AuthSessionSdk
  storage: SessionTokenStorage
}

const isInactiveSessionError = (error: unknown): error is ResponseError =>
  error instanceof ResponseError && error.response.status === 401

export const createAuthSessionStore = ({
  sdk,
  storage,
}: AuthSessionStoreOptions): AuthSessionStore => {
  const listeners = new Set<() => void>()
  let pendingAcceptanceGeneration: number | undefined
  let snapshot: AuthSessionSnapshot = {
    generation: 0,
    initialized: false,
  }
  let storageQueue = Promise.resolve()

  const emit = (nextSnapshot: AuthSessionSnapshot): void => {
    snapshot = nextSnapshot

    for (const listener of listeners) {
      listener()
    }
  }

  const enqueueStorageOperation = async <Result>(
    operation: () => Promise<Result>
  ): Promise<Result> => {
    const result = storageQueue.then(operation, operation)

    storageQueue = result.then(
      () => undefined,
      () => undefined
    )

    return result
  }

  const clearInactiveSession = async (
    sessionToken: string,
    expectedGeneration: number
  ): Promise<void> => {
    if (
      snapshot.generation !== expectedGeneration ||
      (snapshot.sessionToken && snapshot.sessionToken !== sessionToken)
    ) {
      return
    }

    const clearedGeneration = expectedGeneration + 1

    pendingAcceptanceGeneration = undefined
    emit({
      generation: clearedGeneration,
      initialized: true,
    })

    try {
      await enqueueStorageOperation(async () => {
        const storedSession = await storage.read()

        if (storedSession?.sessionToken === sessionToken) {
          await storage.delete()
        }
      })
    } catch (error) {
      if (snapshot.generation === clearedGeneration) {
        emit({
          ...snapshot,
          error,
        })
      }

      throw error
    }
  }

  const validateSession = async (
    sessionToken: string,
    expectedGeneration: number
  ): Promise<Session | undefined> => {
    try {
      const session = await sdk.toSession({ xSessionToken: sessionToken })

      if (
        snapshot.generation !== expectedGeneration ||
        (snapshot.sessionToken && snapshot.sessionToken !== sessionToken)
      ) {
        return undefined
      }

      emit({
        generation: expectedGeneration,
        initialized: true,
        session,
        sessionToken,
      })

      return session
    } catch (error) {
      if (
        snapshot.generation !== expectedGeneration ||
        (snapshot.sessionToken && snapshot.sessionToken !== sessionToken)
      ) {
        return undefined
      }

      if (isInactiveSessionError(error)) {
        await clearInactiveSession(sessionToken, expectedGeneration)

        return undefined
      }

      emit({
        ...snapshot,
        error,
        initialized: true,
        sessionToken,
      })

      throw error
    }
  }

  const restoreStoredSession = async (propagateError: boolean): Promise<Session | undefined> => {
    const expectedGeneration = snapshot.generation
    let storedSession: StoredSessionToken | undefined

    try {
      storedSession = await enqueueStorageOperation(async () => storage.read())
    } catch (error) {
      if (snapshot.generation === expectedGeneration) {
        emit({
          ...snapshot,
          error,
          initialized: true,
        })
      }

      if (propagateError) {
        throw error
      }

      return undefined
    }

    if (snapshot.generation !== expectedGeneration) {
      return undefined
    }

    if (!storedSession) {
      emit({
        ...snapshot,
        error: undefined,
        initialized: true,
      })

      return undefined
    }

    let session: Session | undefined

    try {
      session = await validateSession(storedSession.sessionToken, expectedGeneration)
    } catch (error) {
      if (propagateError) {
        throw error
      }

      return undefined
    }

    if (
      !session ||
      !storedSession.requiresMigration ||
      snapshot.generation !== expectedGeneration ||
      snapshot.sessionToken !== storedSession.sessionToken
    ) {
      return session
    }

    try {
      await enqueueStorageOperation(async () => storage.write(storedSession.sessionToken, session))
    } catch (error) {
      if (
        snapshot.generation === expectedGeneration &&
        snapshot.sessionToken === storedSession.sessionToken
      ) {
        emit({
          ...snapshot,
          error,
        })
      }

      if (propagateError) {
        throw error
      }
    }

    return session
  }

  return {
    acceptSession: async ({ session, sessionToken }, expectedGeneration): Promise<void> => {
      if (!sessionToken) {
        throw new Error('Missing session token')
      }

      if (snapshot.generation !== expectedGeneration) {
        return
      }

      const previousSnapshot = snapshot
      const reservedGeneration = expectedGeneration + 1

      pendingAcceptanceGeneration = reservedGeneration
      emit({
        ...previousSnapshot,
        generation: reservedGeneration,
      })

      try {
        await enqueueStorageOperation(async () => storage.write(sessionToken, session))

        if (
          snapshot.generation === reservedGeneration &&
          pendingAcceptanceGeneration === reservedGeneration
        ) {
          emit({
            generation: reservedGeneration,
            initialized: true,
            session,
            sessionToken,
          })
        }
      } catch (error) {
        if (
          snapshot.generation === reservedGeneration &&
          pendingAcceptanceGeneration === reservedGeneration
        ) {
          emit({
            ...previousSnapshot,
            error,
            generation: reservedGeneration,
            initialized: true,
          })
        }

        throw error
      } finally {
        if (pendingAcceptanceGeneration === reservedGeneration) {
          pendingAcceptanceGeneration = undefined
        }
      }
    },
    clearSession: async (expectedGeneration): Promise<void> => {
      if (snapshot.generation !== expectedGeneration) {
        return
      }

      const clearedGeneration = expectedGeneration + 1

      pendingAcceptanceGeneration = undefined
      emit({
        generation: clearedGeneration,
        initialized: true,
      })

      try {
        await enqueueStorageOperation(async () => storage.delete())
      } catch (error) {
        if (snapshot.generation === clearedGeneration) {
          emit({
            ...snapshot,
            error,
          })
        }

        throw error
      }
    },
    getSnapshot: (): AuthSessionSnapshot => snapshot,
    initialize: async (): Promise<void> => {
      await restoreStoredSession(false)
    },
    logout: async (): Promise<void> => {
      const { sessionToken } = snapshot

      pendingAcceptanceGeneration = undefined
      emit({
        generation: snapshot.generation + 1,
        initialized: true,
      })

      const operations: Array<Promise<void>> = [
        enqueueStorageOperation(async () => storage.delete()),
      ]

      if (sessionToken) {
        operations.push(
          sdk.performNativeLogout({
            performNativeLogoutBody: {
              session_token: sessionToken,
            },
          })
        )
      }

      const results = await Promise.allSettled(operations)
      const errors = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason as unknown] : [])

      if (errors.length === 1) {
        throw errors[0]
      }

      if (errors.length > 1) {
        throw new AggregateError(errors, 'Logout failed')
      }
    },
    subscribe: (listener): (() => void) => {
      listeners.add(listener)

      return (): void => {
        listeners.delete(listener)
      }
    },
    syncSession: async (): Promise<void> => {
      const { generation, sessionToken } = snapshot

      if (pendingAcceptanceGeneration === generation) {
        return
      }

      if (!sessionToken) {
        await restoreStoredSession(true)

        return
      }

      await validateSession(sessionToken, generation)
    },
  }
}
