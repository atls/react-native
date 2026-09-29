import type { FrontendApi }      from '@ory/kratos-client-fetch'
import type { LoginFlow }        from '@ory/kratos-client-fetch'
import type { RegistrationFlow } from '@ory/kratos-client-fetch'
import type { ReactElement }     from 'react'
import type { ReactNode }        from 'react'

import type { SessionContext }   from '../providers/index.js'

import { useFlow }               from '@atls/react-kratos'
import { useEffect }             from 'react'
import React                     from 'react'

type SessionExchangeSdk = Pick<FrontendApi, 'exchangeSessionToken'>

interface BrowserResult {
  type: string
  url?: string
}

interface NativeRedirectHandlerOptions {
  getInitCode: () => string | undefined
  openAuthSession: (url: string, returnTo: string) => Promise<BrowserResult>
  returnTo: string
  sdk: SessionExchangeSdk
  setSession: (session: SessionContext) => Promise<void>
}

export const createNativeRedirectHandler = ({
    getInitCode,
    openAuthSession,
    returnTo,
    sdk,
    setSession,
  }: NativeRedirectHandlerOptions) =>
  async (url: string, external: boolean): Promise<void> => {
    if (!external) {
      throw new Error('Missing native route adapter')
    }

    const initCode = getInitCode()

    if (!initCode) {
      throw new Error('Missing session token exchange init code')
    }

    const result = await openAuthSession(url, returnTo)

    if (result.type !== 'success') {
      return
    }

    const returnToCode = result.url
      ? (new URL(result.url).searchParams.get('code') ?? undefined)
      : undefined

    if (!returnToCode) {
      throw new Error('Missing session token exchange return code')
    }

    const resultSession = await sdk.exchangeSessionToken({ initCode, returnToCode })

    if (!resultSession.session_token) {
      throw new Error('Missing session token in exchange response')
    }

    await setSession({
      session: resultSession.session,
      sessionToken: resultSession.session_token,
    })
  }

interface SessionTokenExchangeCodeCaptureProps {
  children: ReactNode
  onCode: (code: string) => void
}

export const SessionTokenExchangeCodeCapture = ({
  children,
  onCode,
}: SessionTokenExchangeCodeCaptureProps): ReactElement => {
  const { flow } = useFlow()
  const sessionTokenExchangeCode = (flow as LoginFlow | RegistrationFlow | undefined)
    ?.session_token_exchange_code

  useEffect(() => {
    if (sessionTokenExchangeCode) {
      onCode(sessionTokenExchangeCode)
    }
  }, [onCode, sessionTokenExchangeCode])

  return React.createElement(React.Fragment, null, children)
}
