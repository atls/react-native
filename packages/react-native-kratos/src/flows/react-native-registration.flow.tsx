import type { ReactNode }                  from 'react'
import type { ReactElement }               from 'react'

import { RegistrationNativeFlow }          from '@atls/react-kratos'
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

export interface ReactNativeRegistrationFlowProps {
  children: ReactNode
  onError?: (error: unknown) => void
  returnTo?: string
}

export const ReactNativeRegistrationFlow = ({
  children,
  onError,
  returnTo: configuredReturnTo,
}: ReactNativeRegistrationFlowProps): ReactElement => {
  const { setSession } = useAuth()
  const sdk = useSdk()
  const exchangeCode = useRef<string>()
  const [redirectError, setRedirectError] = useState<unknown>()
  const returnTo =
    configuredReturnTo ??
    makeRedirectUri({
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
    <RegistrationNativeFlow
      returnTo={returnTo}
      onError={onError}
      onRedirect={onRedirect}
      onSession={setSession}
    >
      <SessionTokenExchangeCodeCapture onCode={onCode}>{children}</SessionTokenExchangeCodeCapture>
    </RegistrationNativeFlow>
  )
}
