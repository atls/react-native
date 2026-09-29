import type { ReactNode }                  from 'react'
import type { ReactElement }               from 'react'

import { LoginNativeFlow }                 from '@atls/react-kratos'
import { useSdk }                          from '@atls/react-kratos'
import * as WebBrowser                     from 'expo-web-browser'
import { makeRedirectUri }                 from 'expo-auth-session'
import { useCallback }                     from 'react'
import { useRef }                          from 'react'
import { useState }                        from 'react'
import React                               from 'react'

import { SessionTokenExchangeCodeCapture } from './session-token-exchange.js'
import { useAuth }                         from '../hooks/index.js'
import { createNativeRedirectHandler }     from './session-token-exchange.js'

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
  const sdk = useSdk()
  const exchangeCode = useRef<string>()
  const [redirectError, setRedirectError] = useState<unknown>()
  const returnTo = makeRedirectUri({
    preferLocalhost: true,
    path: '/Callback',
  })
  const onCode = useCallback((code: string) => {
    exchangeCode.current = code
  }, [])
  const redirect = createNativeRedirectHandler({
    getInitCode: () => exchangeCode.current,
    openAuthSession: WebBrowser.openAuthSessionAsync,
    returnTo,
    sdk,
    setSession,
  })
  const onRedirect = useCallback(
    (url: string, external: boolean) => {
      redirect(url, external).catch((error: unknown) => {
        if (onError) {
          onError(error)
        } else {
          setRedirectError(error)
        }
      })
    },
    [onError, redirect]
  )

  if (redirectError) {
    throw redirectError
  }

  return (
    <LoginNativeFlow
      aal={route.params?.aal}
      refresh={route.params?.refresh}
      sessionToken={sessionToken}
      returnTo={returnTo}
      onError={onError}
      onRedirect={onRedirect}
      onSession={setSession}
    >
      <SessionTokenExchangeCodeCapture onCode={onCode}>{children}</SessionTokenExchangeCodeCapture>
    </LoginNativeFlow>
  )
}
