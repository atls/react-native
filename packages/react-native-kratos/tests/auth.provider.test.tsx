import 'global-jsdom/register'

import type { FrontendApi }            from '@ory/kratos-client-fetch'
import type { Session }                from '@ory/kratos-client-fetch'
import type { RenderResult }           from '@testing-library/react'
import type { ReactElement }           from 'react'

import type { ContextAuth }            from '../src/providers/index.js'
import type { SessionTokenStorage }    from '../src/providers/session-token.storage.js'

import assert                          from 'node:assert/strict'
import { afterEach }                   from 'node:test'
import { test }                        from 'node:test'

import { SdkProvider }                 from '@atls/react-kratos'
import { act }                         from '@testing-library/react'
import { cleanup }                     from '@testing-library/react'
import { render }                      from '@testing-library/react'
import { screen }                      from '@testing-library/react'
import { waitFor }                     from '@testing-library/react'
import React                           from 'react'

import { AuthProvider }                from '../src/providers/auth.provider.js'
import { createNativeRedirectHandler } from '../src/flows/session-token-exchange.js'
import { useAuth }                     from '../src/hooks/index.js'

interface Deferred<T> {
  promise: Promise<T>
  reject: (error: unknown) => void
  resolve: (value: PromiseLike<T> | T) => void
}

const deferred = <T,>(): Deferred<T> => {
  let resolve: (value: PromiseLike<T> | T) => void = (): void => undefined
  let reject: (error: unknown) => void = (): void => undefined
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

const session = (id: string): Session => ({ id, active: true }) as Session

interface AuthProbeProps {
  onAuth: (auth: ContextAuth) => void
}

const AuthProbe = ({ onAuth }: AuthProbeProps): ReactElement => {
  const auth = useAuth()

  onAuth(auth)

  return (
    <div>
      <span data-testid='authenticated'>{String(auth.isAuthenticated)}</span>
      <span data-testid='error'>{auth.error instanceof Error ? auth.error.message : ''}</span>
      <span data-testid='token'>{auth.sessionToken ?? ''}</span>
    </div>
  )
}

interface RenderAuthOptions {
  sdk: FrontendApi
  storage: SessionTokenStorage
}

const renderAuth = (
  { sdk, storage }: RenderAuthOptions,
  onAuth: AuthProbeProps['onAuth']
): RenderResult =>
  render(
    <SdkProvider value={sdk}>
      <AuthProvider storage={storage}>
        <AuthProbe onAuth={onAuth} />
      </AuthProvider>
    </SdkProvider>
  )

afterEach(() => {
  cleanup()
})

test('surfaces a storage read failure and retries session restoration', async () => {
  const storageError = new Error('secure storage unavailable')
  const firstRead = deferred<string>()
  let reads = 0
  let auth: ContextAuth | undefined
  const restoredSession = session('restored')
  const storage: SessionTokenStorage = {
    delete: async (): Promise<void> => undefined,
    read: async (): Promise<string> => {
      reads += 1

      if (reads === 1) {
        return firstRead.promise
      }

      return 'persisted-token'
    },
    write: async (): Promise<void> => undefined,
  }
  const sdk = {
    toSession: async ({ xSessionToken }: { xSessionToken?: string }): Promise<Session> => {
      assert.equal(xSessionToken, 'persisted-token')

      return restoredSession
    },
  } as unknown as FrontendApi

  renderAuth({ sdk, storage }, (nextAuth) => {
    auth = nextAuth
  })

  assert.equal(screen.queryByTestId('authenticated'), null)
  await act(async () => {
    firstRead.reject(storageError)
  })
  await screen.findByText('secure storage unavailable')
  assert.equal(screen.getByTestId('authenticated').textContent, 'false')

  const retry = auth?.retrySessionRestore

  assert.ok(retry)
  await act(async () => retry())

  await waitFor(() => {
    assert.equal(screen.getByTestId('authenticated').textContent, 'true')
  })
  assert.equal(screen.getByTestId('token').textContent, 'persisted-token')
  assert.equal(reads, 2)
})

test('a stale setter cannot clear the current account but current logout can', async () => {
  let auth: ContextAuth | undefined
  let token: string | undefined
  const revokedTokens: Array<string> = []
  const storage: SessionTokenStorage = {
    delete: async (): Promise<void> => {
      token = undefined
    },
    read: async (): Promise<undefined> => undefined,
    write: async (nextToken): Promise<void> => {
      token = nextToken
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

  renderAuth({ sdk, storage }, (nextAuth) => {
    auth = nextAuth
  })

  await screen.findByText('false')
  const staleSetter = auth?.setSession

  assert.ok(staleSetter)
  await act(async () => staleSetter({ session: session('account-b'), sessionToken: 'token-b' }))
  await screen.findByText('true')
  const currentLogout = auth?.logout

  assert.ok(currentLogout)
  await act(async () => staleSetter(undefined))

  assert.equal(screen.getByTestId('authenticated').textContent, 'true')
  assert.equal(screen.getByTestId('token').textContent, 'token-b')
  assert.equal(token, 'token-b')
  assert.deepEqual(revokedTokens, [])

  await act(async () => currentLogout())

  assert.equal(screen.getByTestId('authenticated').textContent, 'false')
  assert.equal(token, undefined)
  assert.deepEqual(revokedTokens, ['token-b'])
})

test('concurrent Provider results keep memory, storage, and logout on one account', async () => {
  let auth: ContextAuth | undefined
  let token: string | undefined
  const writes: Array<string> = []
  const revokedTokens: Array<string> = []
  const storage: SessionTokenStorage = {
    delete: async (): Promise<void> => {
      token = undefined
    },
    read: async (): Promise<undefined> => undefined,
    write: async (nextToken): Promise<void> => {
      writes.push(nextToken)
      token = nextToken
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

  renderAuth({ sdk, storage }, (nextAuth) => {
    auth = nextAuth
  })

  await screen.findByText('false')
  const sameGenerationSetter = auth?.setSession

  assert.ok(sameGenerationSetter)
  await act(async () =>
    Promise.all([
      sameGenerationSetter({ session: session('account-a'), sessionToken: 'token-a' }),
      sameGenerationSetter({ session: session('account-b'), sessionToken: 'token-b' }),
    ]))
  await screen.findByText('true')

  assert.equal(screen.getByTestId('token').textContent, 'token-a')
  assert.equal(token, 'token-a')
  assert.deepEqual(writes, ['token-a'])

  const currentLogout = auth?.logout

  assert.ok(currentLogout)
  await act(async () => currentLogout())

  assert.equal(screen.getByTestId('authenticated').textContent, 'false')
  assert.equal(token, undefined)
  assert.deepEqual(revokedTokens, ['token-a'])
})

test('a held browser result keeps its flow code and cannot reauthorize after logout', async () => {
  let auth: ContextAuth | undefined
  let currentInitCode = 'init-a'
  let token: string | undefined
  const browser = deferred<{ type: string; url: string }>()
  const exchanges: Array<{ initCode: string; returnToCode: string }> = []
  const storage: SessionTokenStorage = {
    delete: async (): Promise<void> => {
      token = undefined
    },
    read: async (): Promise<undefined> => undefined,
    write: async (nextToken): Promise<void> => {
      token = nextToken
    },
  }
  const sdk = {
    exchangeSessionToken: async (request: { initCode: string; returnToCode: string }) => {
      exchanges.push(request)

      return { session: session('late-exchange'), session_token: 'late-token' }
    },
  } as unknown as FrontendApi

  renderAuth({ sdk, storage }, (nextAuth) => {
    auth = nextAuth
  })

  await screen.findByText('false')
  const staleSetter = auth?.setSession
  const currentLogout = auth?.logout

  assert.ok(staleSetter)
  assert.ok(currentLogout)
  const redirect = createNativeRedirectHandler({
    getInitCode: () => currentInitCode,
    openAuthSession: async () => browser.promise,
    returnTo: 'atls://Callback',
    sdk,
    setSession: staleSetter,
  })
  const pendingRedirect = redirect('https://identity.example.test/oidc-a', true)

  currentInitCode = 'init-b'
  await act(async () => currentLogout())
  browser.resolve({ type: 'success', url: 'atls://Callback?code=return-a' })
  await act(async () => pendingRedirect)

  assert.deepEqual(exchanges, [{ initCode: 'init-a', returnToCode: 'return-a' }])
  assert.equal(screen.getByTestId('authenticated').textContent, 'false')
  assert.equal(token, undefined)
})
