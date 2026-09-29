import type { Session }             from '@ory/kratos-client-fetch'
import type { ReactElement }        from 'react'
import type { ReactNode }           from 'react'

import type { NativeSession }       from './auth-session.store.js'
import type { SessionTokenStorage } from './session-token.storage.js'

import { useSdk }                   from '@atls/react-kratos'
import { createContext }            from 'react'
import { useEffect }                from 'react'
import { useMemo }                  from 'react'
import { useSyncExternalStore }     from 'react'
import React                        from 'react'

import { createAuthSessionStore }   from './auth-session.store.js'

export interface ContextAuth {
  error?: unknown
  isAuthenticated: boolean
  logout: () => Promise<void>
  refreshSession: () => Promise<Session | undefined>
  session?: Session
  sessionToken?: string
  setSession: (session: SessionContext) => Promise<void>
  retrySessionRestore: () => Promise<void>
}

export type SessionContext = NativeSession | undefined

export const AuthContext = createContext<ContextAuth | undefined>(undefined)

export interface AuthProviderProps {
  children: ReactNode
  storage: SessionTokenStorage
}

export const AuthProvider = ({ children, storage }: AuthProviderProps): ReactElement | null => {
  const sdk = useSdk()
  const store = useMemo(() => createAuthSessionStore({ sdk, storage }), [sdk, storage])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  useEffect(() => {
    store.initialize().catch(() => undefined)
  }, [store])

  const value = useMemo<ContextAuth>(
    () => ({
      error: snapshot.error,
      isAuthenticated: Boolean(snapshot.session),
      logout: store.logout,
      refreshSession: store.refreshSession,
      retrySessionRestore: store.initialize,
      session: snapshot.session,
      sessionToken: snapshot.sessionToken,
      setSession: async (session): Promise<void> =>
        session
          ? store.acceptSession(session, snapshot.generation)
          : store.logout(snapshot.generation),
    }),
    [snapshot, store]
  )

  if (!snapshot.initialized) {
    return null
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
