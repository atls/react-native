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
  getSnapshot: () => AuthSessionSnapshot
  initialize: () => Promise<void>
  logout: (expectedGeneration?: number) => Promise<void>
  refreshSession: () => Promise<Session | undefined>
  subscribe: (listener: () => void) => () => void
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

  const enqueueStorageMutation = async (mutation: () => Promise<void>): Promise<void> => {
    const operation = storageQueue.then(mutation, mutation)

    storageQueue = operation.catch(() => undefined)

    return operation
  }

  const clearInactiveSession = async (expectedGeneration: number): Promise<void> => {
    if (snapshot.generation !== expectedGeneration) {
      return
    }

    emit({
      generation: expectedGeneration + 1,
      initialized: true,
    })

    await enqueueStorageMutation(async () => storage.delete())
  }

  const restoreSession = async (
    sessionToken: string,
    expectedGeneration: number
  ): Promise<Session | undefined> => {
    try {
      const session = await sdk.toSession({ xSessionToken: sessionToken })

      if (snapshot.generation !== expectedGeneration) {
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
      if (snapshot.generation !== expectedGeneration) {
        return undefined
      }

      if (isInactiveSessionError(error)) {
        await clearInactiveSession(expectedGeneration)

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

  return {
    acceptSession: async ({ session, sessionToken }, expectedGeneration): Promise<void> => {
      if (!sessionToken) {
        throw new Error('Missing session token')
      }

      if (snapshot.generation !== expectedGeneration) {
        return
      }

      await enqueueStorageMutation(async () => {
        if (snapshot.generation !== expectedGeneration) {
          return
        }

        await storage.write(sessionToken)

        if (snapshot.generation !== expectedGeneration) {
          return
        }

        emit({
          generation: expectedGeneration + 1,
          initialized: true,
          session,
          sessionToken,
        })
      })
    },
    getSnapshot: (): AuthSessionSnapshot => snapshot,
    initialize: async (): Promise<void> => {
      const expectedGeneration = snapshot.generation
      let storedSessionToken: StoredSessionToken | undefined

      try {
        storedSessionToken = await storage.read()
      } catch (error) {
        if (snapshot.generation === expectedGeneration) {
          emit({
            error,
            generation: expectedGeneration,
            initialized: true,
          })
        }

        return
      }

      if (snapshot.generation !== expectedGeneration) {
        return
      }

      if (!storedSessionToken) {
        emit({
          generation: expectedGeneration,
          initialized: true,
        })

        return
      }

      const { requiresMigration, sessionToken } = storedSessionToken
      const [restoration] = await Promise.allSettled([
        restoreSession(sessionToken, expectedGeneration),
      ])

      if (
        !requiresMigration ||
        restoration.status === 'rejected' ||
        !restoration.value ||
        snapshot.generation !== expectedGeneration
      ) {
        return
      }

      try {
        await enqueueStorageMutation(async () => {
          if (snapshot.generation !== expectedGeneration) {
            return
          }

          await storage.write(sessionToken)
        })
      } catch (error) {
        if (snapshot.generation === expectedGeneration) {
          emit({
            ...snapshot,
            error,
          })
        }
      }
    },
    logout: async (expectedGeneration): Promise<void> => {
      if (typeof expectedGeneration !== 'undefined' && snapshot.generation !== expectedGeneration) {
        return
      }

      const { sessionToken } = snapshot

      emit({
        generation: snapshot.generation + 1,
        initialized: true,
      })

      const operations: Array<Promise<void>> = [
        enqueueStorageMutation(async () => storage.delete()),
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
    refreshSession: async (): Promise<Session | undefined> => {
      const { generation, sessionToken } = snapshot

      if (!sessionToken) {
        return undefined
      }

      return restoreSession(sessionToken, generation)
    },
    subscribe: (listener): (() => void) => {
      listeners.add(listener)

      return (): void => {
        listeners.delete(listener)
      }
    },
  }
}
