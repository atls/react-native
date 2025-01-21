import type { ReactNode }    from 'react'
import type { ReactElement } from 'react'

import { LoginNativeFlow }   from '@atls/react-kratos'
import { makeRedirectUri }   from 'expo-auth-session'
import React                 from 'react'

import { useAuth }           from '../hooks'

export interface ReactNativeLoginFlowProps {
  route: { params?: { aal?: 'aal1' | 'aal2'; refresh?: boolean } }
  children: ReactNode
}

export const ReactNativeLoginFlow = ({
  children,
  route,
}: ReactNativeLoginFlowProps): ReactElement => {
  const { sessionToken, setSession } = useAuth()

  return (
    <LoginNativeFlow
      aal={route.params?.aal}
      refresh={route.params?.refresh}
      sessionToken={sessionToken}
      returnTo={makeRedirectUri({
        preferLocalhost: true,
        path: '/Callback',
      })}
      onSession={setSession}
    >
      {children}
    </LoginNativeFlow>
  )
}
