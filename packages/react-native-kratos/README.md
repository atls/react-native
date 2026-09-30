# @atls/react-native-kratos

React Native / Expo adapter for native self-service flows with self-hosted Ory Kratos.

## Usage

Create a `FrontendApi` from `@ory/kratos-client-fetch` and provide it through
`SdkProvider`:

```tsx
import { Configuration }        from '@ory/kratos-client-fetch'
import { FrontendApi }          from '@ory/kratos-client-fetch'

import { AuthProvider }         from '@atls/react-native-kratos'
import { ReactNativeLoginFlow } from '@atls/react-native-kratos'
import { SdkProvider }          from '@atls/react-native-kratos'

const frontend = new FrontendApi(new Configuration({ basePath: kratosPublicUrl }))

export const App = () => (
  <SdkProvider value={frontend}>
    <AuthProvider>
      <ReactNativeLoginFlow route={{}}>
        <LoginScreen />
      </ReactNativeLoginFlow>
    </AuthProvider>
  </SdkProvider>
)
```

`AuthProvider` stores the raw `session_token` under the `user_session` key in
Expo SecureStore on native. It keeps the released JSON shape in AsyncStorage on
web for import compatibility. A native value written by an earlier release is
migrated from JSON to the raw token only after `toSession` has validated it.

The provider never treats a stored token as proof of authentication. On
startup, it restores the server session through `toSession`; only the returned
session makes `isAuthenticated` true. A `401` response clears the exact token
whose session Kratos confirmed inactive. Network failures, AAL responses, and
`5xx` responses retain the token and any previously confirmed session, expose
the error through `useAuth()`, and can be retried with `syncSession()`.

`setSession(undefined)` only clears local auth state and storage. `logout()`
immediately closes the current generation of local auth state, removes the
token, and calls `performNativeLogout` with the token captured before cleanup.
It attempts both operations and reports either or both failures. Replacing an
account does not revoke another session automatically. Late login,
registration, restore, synchronization, and browser-exchange results cannot
reapply a session from an older generation.

Login and registration pass redirects from the shared Ory `handleFlowError`
through Expo WebBrowser. Both wrappers accept an optional `returnTo`; otherwise
they create the Expo callback URI. After the browser returns, the adapter
exchanges the `session_token_exchange_code` / `code` pair through
`exchangeSessionToken`; the package does not reproduce Ory's error switch
locally.

## Supported versions

The supported dependency stacks are deliberately narrow:

| Expo | React Native | React | React Native Web |
| ---- | ------------ | ----- | ---------------- |
| 50   | 0.73         | 18    | 0.19             |
| 56   | 0.85         | 19    | 0.21             |

The package re-exports the shared `@atls/react-kratos@0.1.0` API. The web
storage path preserves the released fallback and import surface, but a web
bundle alone is not production authentication acceptance.

## Native acceptance setup

Use self-hosted Kratos `v26.2.0` and `@ory/kratos-client-fetch@26.2.0` for
device acceptance. The reference setup requires:

- a public Kratos endpoint reachable from both iOS and Android test devices;
- enabled password login and registration, plus an enabled OIDC provider for
  the browser-return case;
- the exact application callback, such as `my-app://Callback`, in
  `selfservice.allowed_return_urls`;
- the same callback in the Expo application scheme/link configuration and in
  each native flow wrapper's `returnTo` prop; and
- the OIDC provider callback configured for Kratos itself, separately from the
  application callback.

Keep provider secrets in the server's secret store. With that setup, verify
login, registration, browser cancellation and return, restore after restart,
`syncSession()`, `logout()`, inactive-session cleanup, temporary network/server
failures, and account switching on both platforms. These checks exercise token
authentication; they do not rely on a browser session cookie.

## Acceptance boundary

Automated build, unit, type, lint, pack, and Metro bundle checks do not replace
login, registration, restart restore, logout, and account-switching checks
against a real self-hosted Kratos deployment on a device or simulator.
