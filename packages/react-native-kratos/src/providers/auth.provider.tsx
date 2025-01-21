/* eslint-disable react/jsx-no-constructed-context-values */

import type { Session }      from '@atls/react-kratos'
import type { ReactElement } from 'react'
import type { ReactNode }    from 'react'

import { useSdk }            from '@atls/react-kratos'
import AsyncStore            from '@react-native-async-storage/async-storage'
import * as SecureStore      from 'expo-secure-store'
import { Platform }          from 'react-native'
import { createContext }     from 'react'
import { useCallback }       from 'react'
import { useEffect }         from 'react'
import { useState }          from 'react'
import React                 from 'react'

const USER_SESSION_NAME = 'user_session'

export type SessionContext =
  | {
      sessionToken?: string
      session: Session
    }
  | undefined

export interface ContextAuth {
  session?: Session
  sessionToken?: string
  isAuthenticated: boolean
  setSession: (session: SessionContext) => Promise<void>
}

export const AuthContext = createContext<ContextAuth>({
  isAuthenticated: false,
  setSession: async () => Promise.resolve(),
})

interface AuthProviderProps {
  children: ReactNode
}

export const AuthProvider = ({ children }: AuthProviderProps): ReactElement | null => {
  const [sessionContext, setSessionContext] = useState<SessionContext | undefined>(undefined)
  const [initialized, setInitialized] = useState<boolean>(false)
  const sdk = useSdk()

  const setSession = useCallback(
    async (session: SessionContext) => {
      if (Platform.OS !== 'web') {
        await SecureStore.setItemAsync(USER_SESSION_NAME, JSON.stringify(session))
      } else {
        await AsyncStore.setItem(USER_SESSION_NAME, JSON.stringify(session))
      }

      setSessionContext(session)
    },
    [setSessionContext]
  )

  useEffect(() => {
    const getAuthenticatedSession = async (): Promise<void> => {
      const userSession =
        Platform.OS !== 'web'
          ? await SecureStore.getItemAsync(USER_SESSION_NAME)
          : await AsyncStore.getItem(USER_SESSION_NAME)

      const auth: SessionContext = userSession ? JSON.parse(userSession) : undefined

      if (auth?.sessionToken) {
        try {
          const { data: session } = await sdk.toSession({ xSessionToken: auth.sessionToken })

          setSessionContext({ session, sessionToken: auth.sessionToken })
        } catch (error) {
          // eslint-disable-next-line no-console
          console.log(error)

          setSessionContext(undefined)
        }
      }

      setInitialized(true)
    }

    getAuthenticatedSession()
  }, [sdk])

  if (!initialized) {
    return null
  }

  return (
    <AuthContext.Provider
      value={{
        session: sessionContext?.session,
        sessionToken: sessionContext?.sessionToken,
        isAuthenticated: Boolean(sessionContext?.sessionToken),
        setSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
