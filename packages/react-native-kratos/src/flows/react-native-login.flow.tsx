import type { ReactNode }    from 'react'
import type { ReactElement } from 'react'

import { LoginNativeFlow }   from '@atls/react-kratos'
import React                 from 'react'

import { useAuth }           from '../hooks/index.js'

export interface ReactNativeLoginFlowProps {
  route: { params?: { aal?: 'aal1' | 'aal2'; refresh?: boolean } }
  children: ReactNode
  onError?: (error: unknown) => void
}

export const ReactNativeLoginFlow = ({
  children,
  onError,
  route,
}: ReactNativeLoginFlowProps): ReactElement => {
  const { sessionToken, setSession } = useAuth()

  return (
    <LoginNativeFlow
      aal={route.params?.aal}
      refresh={route.params?.refresh}
      sessionToken={sessionToken}
      onError={onError}
      onGenericError={onError}
      onSession={setSession}
    >
      {children}
    </LoginNativeFlow>
  )
}
