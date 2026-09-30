import type { FrontendApi }            from '@ory/kratos-client-fetch'
import type { Session }                from '@ory/kratos-client-fetch'

import type { SessionContext }         from '../src/providers/index.js'

import assert                          from 'node:assert/strict'
import { test }                        from 'node:test'

import { createNativeRedirectHandler } from '../src/flows/session-token-exchange.js'

type SessionExchangeSdk = Pick<FrontendApi, 'exchangeSessionToken'>
type NativeRedirectHandler = (url: string, external: boolean) => Promise<void>

const session = { id: 'exchanged-session', active: true } as Session

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: PromiseLike<T> | T) => void
}

const deferred = <T>(): Deferred<T> => {
  let resolve: (value: PromiseLike<T> | T) => void = (): void => undefined
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

test('opens the vendor redirect and exchanges its code for a session token', async () => {
  const opened: Array<Array<string>> = []
  const exchanges: Array<{ initCode: string; returnToCode: string }> = []
  const sessions: Array<SessionContext> = []
  const handler = createNativeRedirectHandler({
    getInitCode: () => 'init-code',
    openAuthSession: async (url, returnTo) => {
      opened.push([url, returnTo])

      return { type: 'success', url: 'atls://Callback?code=return-code' }
    },
    returnTo: 'atls://Callback',
    sdk: {
      exchangeSessionToken: async (request) => {
        exchanges.push(request)

        return { session, session_token: 'exchanged-token' }
      },
    } as SessionExchangeSdk,
    setSession: async (nextSession) => {
      sessions.push(nextSession)
    },
  })

  await handler('https://identity.example.test/oidc', true)

  assert.deepEqual(opened, [['https://identity.example.test/oidc', 'atls://Callback']])
  assert.deepEqual(exchanges, [{ initCode: 'init-code', returnToCode: 'return-code' }])
  assert.deepEqual(sessions, [{ session, sessionToken: 'exchanged-token' }])
})

test('does not exchange a canceled browser session', async () => {
  let exchanged = false
  const handler = createNativeRedirectHandler({
    getInitCode: () => 'init-code',
    openAuthSession: async () => ({ type: 'cancel' }),
    returnTo: 'atls://Callback',
    sdk: {
      exchangeSessionToken: async () => {
        exchanged = true

        return { session, session_token: 'unexpected-token' }
      },
    } as SessionExchangeSdk,
    setSession: async () => undefined,
  })

  await handler('https://identity.example.test/oidc', true)

  assert.equal(exchanged, false)
})

test('does not authenticate when the vendor exchange fails', async () => {
  const exchangeError = new Error('exchange failed')
  let accepted = false
  const handler = createNativeRedirectHandler({
    getInitCode: () => 'init-code',
    openAuthSession: async () => ({
      type: 'success',
      url: 'atls://Callback?code=return-code',
    }),
    returnTo: 'atls://Callback',
    sdk: {
      exchangeSessionToken: async () => {
        throw exchangeError
      },
    } as SessionExchangeSdk,
    setSession: async () => {
      accepted = true
    },
  })

  await assert.rejects(
    handler('https://identity.example.test/oidc', true),
    (error) => error === exchangeError
  )
  assert.equal(accepted, false)
})

test('captures the flow init code before waiting for the browser result', async () => {
  let initCode = 'init-a'
  const browser = deferred<{ type: string; url: string }>()
  const exchanges: Array<{ initCode: string; returnToCode: string }> = []
  const handler = createNativeRedirectHandler({
    getInitCode: () => initCode,
    openAuthSession: async () => browser.promise,
    returnTo: 'atls://Callback',
    sdk: {
      exchangeSessionToken: async (request) => {
        exchanges.push(request)

        return { session, session_token: 'exchanged-token' }
      },
    } as SessionExchangeSdk,
    setSession: async () => undefined,
  })
  const pendingRedirect = handler('https://identity.example.test/oidc-a', true)

  initCode = 'init-b'
  browser.resolve({ type: 'success', url: 'atls://Callback?code=return-a' })
  await pendingRedirect

  assert.deepEqual(exchanges, [{ initCode: 'init-a', returnToCode: 'return-a' }])
})

test('rejects redirects without the vendor exchange codes', async () => {
  const createHandler = (initCode: string | undefined, resultUrl: string): NativeRedirectHandler =>
    createNativeRedirectHandler({
      getInitCode: () => initCode,
      openAuthSession: async () => ({ type: 'success', url: resultUrl }),
      returnTo: 'atls://Callback',
      sdk: {} as SessionExchangeSdk,
      setSession: async () => undefined,
    })

  await assert.rejects(
    createHandler(undefined, 'atls://Callback?code=return-code')(
      'https://identity.example.test/oidc',
      true
    ),
    /Missing session token exchange init code/
  )
  await assert.rejects(
    createHandler('init-code', 'atls://Callback')('https://identity.example.test/oidc', true),
    /Missing session token exchange return code/
  )
})

test('rejects internal redirects without a native route adapter', async () => {
  const handler = createNativeRedirectHandler({
    getInitCode: () => 'init-code',
    openAuthSession: async () => ({ type: 'cancel' }),
    returnTo: 'atls://Callback',
    sdk: {} as SessionExchangeSdk,
    setSession: async () => undefined,
  })

  await assert.rejects(handler('/verification?flow=flow-id', false), /Missing native route adapter/)
})
