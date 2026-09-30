import 'global-jsdom/register'

import type { FrontendApi }         from '@ory/kratos-client-fetch'
import type { Session }             from '@ory/kratos-client-fetch'
import type { ReactElement }        from 'react'

import type { ContextAuth }         from '../src/providers/index.js'
import type { SessionTokenStorage } from '../src/providers/session-token.storage.js'
import type { StoredSessionToken }  from '../src/providers/session-token.storage.js'

import assert                       from 'node:assert/strict'
import { afterEach }                from 'node:test'
import { test }                     from 'node:test'

import { SdkProvider }              from '@atls/react-kratos'
import { act }                      from '@testing-library/react'
import { cleanup }                  from '@testing-library/react'
import { render }                   from '@testing-library/react'
import { screen }                   from '@testing-library/react'
import React                        from 'react'

import { AuthProvider }             from '../src/providers/auth.provider.js'
import { useAuth }                  from '../src/hooks/index.js'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: PromiseLike<T> | T) => void
}

const deferred = <T,>(): Deferred<T> => {
  let resolve: (value: PromiseLike<T> | T) => void = (): void => undefined
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

const session = (id: string): Session => ({ id, active: true }) as Session

const storedSession = (sessionToken: string): StoredSessionToken => ({
  requiresMigration: false,
  sessionToken,
})

interface AuthProbeProps {
  onAuth: (auth: ContextAuth) => void
}

const AuthProbe = ({ onAuth }: AuthProbeProps): ReactElement => {
  const auth = useAuth()

  onAuth(auth)

  return (
    <div>
      <span data-testid='authenticated'>{String(auth.isAuthenticated)}</span>
      <span data-testid='token'>{auth.sessionToken ?? ''}</span>
    </div>
  )
}

interface RenderAuthOptions {
  onAuth: AuthProbeProps['onAuth']
  sdk: FrontendApi
  storage: SessionTokenStorage
}

const renderAuth = ({ onAuth, sdk, storage }: RenderAuthOptions): void => {
  render(
    <SdkProvider value={sdk}>
      <AuthProvider storage={storage}>
        <AuthProbe onAuth={onAuth} />
      </AuthProvider>
    </SdkProvider>
  )
}

afterEach(() => {
  cleanup()
})

test('waits for the initial credential read and exposes the public lifecycle actions', async () => {
  const credential = deferred<StoredSessionToken | undefined>()
  let auth: ContextAuth | undefined
  const storage: SessionTokenStorage = {
    delete: async (): Promise<void> => undefined,
    read: async (): Promise<StoredSessionToken | undefined> => credential.promise,
    write: async (): Promise<void> => undefined,
  }

  renderAuth({
    onAuth: (nextAuth) => {
      auth = nextAuth
    },
    sdk: {} as FrontendApi,
    storage,
  })

  assert.equal(screen.queryByTestId('authenticated'), null)

  await act(async () => {
    credential.resolve(undefined)
  })

  assert.equal(screen.getByTestId('authenticated').textContent, 'false')
  assert.equal(typeof auth?.logout, 'function')
  assert.equal(typeof auth?.setSession, 'function')
  assert.equal(typeof auth?.syncSession, 'function')
})

test('keeps local clear separate from explicit remote logout', async () => {
  let auth: ContextAuth | undefined
  let currentCredential: StoredSessionToken | undefined
  const revokedTokens: Array<string> = []
  const storage: SessionTokenStorage = {
    delete: async (): Promise<void> => {
      currentCredential = undefined
    },
    read: async (): Promise<StoredSessionToken | undefined> => currentCredential,
    write: async (sessionToken): Promise<void> => {
      currentCredential = storedSession(sessionToken)
    },
  }
  const sdk = {
    performNativeLogout: async ({
      performNativeLogoutBody,
    }: {
      performNativeLogoutBody: { session_token: string }
    }): Promise<void> => {
      revokedTokens.push(performNativeLogoutBody.session_token)
    },
  } as unknown as FrontendApi

  renderAuth({
    onAuth: (nextAuth) => {
      auth = nextAuth
    },
    sdk,
    storage,
  })

  await screen.findByText('false')
  await act(async () =>
    auth?.setSession({ session: session('account-a'), sessionToken: 'token-a' }))
  await screen.findByText('true')
  await act(async () => auth?.setSession(undefined))

  assert.equal(screen.getByTestId('authenticated').textContent, 'false')
  assert.deepEqual(revokedTokens, [])

  await act(async () =>
    auth?.setSession({ session: session('account-b'), sessionToken: 'token-b' }))
  await screen.findByText('true')

  const onPress = auth?.logout as ((event: unknown) => Promise<void>) | undefined

  assert.ok(onPress)
  await act(async () => onPress({ nativeEvent: {} }))

  assert.equal(screen.getByTestId('authenticated').textContent, 'false')
  assert.equal(currentCredential, undefined)
  assert.deepEqual(revokedTokens, ['token-b'])
})

test('a setter captured before logout cannot apply a late native result', async () => {
  let auth: ContextAuth | undefined
  let writes = 0
  const storage: SessionTokenStorage = {
    delete: async (): Promise<void> => undefined,
    read: async (): Promise<undefined> => undefined,
    write: async (): Promise<void> => {
      writes += 1
    },
  }

  renderAuth({
    onAuth: (nextAuth) => {
      auth = nextAuth
    },
    sdk: {} as FrontendApi,
    storage,
  })

  await screen.findByText('false')
  const staleSetter = auth?.setSession

  assert.ok(staleSetter)
  await act(async () => auth?.logout())
  await act(async () => staleSetter({ session: session('late'), sessionToken: 'late-token' }))

  assert.equal(screen.getByTestId('authenticated').textContent, 'false')
  assert.equal(screen.getByTestId('token').textContent, '')
  assert.equal(writes, 0)
})
