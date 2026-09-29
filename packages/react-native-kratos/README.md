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

`AuthProvider` stores only the `session_token`: in Expo SecureStore on native
and in AsyncStorage on web. On startup, it restores the session through
`toSession`. A `401` response clears a token whose session is confirmed to be
inactive. Network failures, `403` responses, and `5xx` responses retain the
token and expose the error through `useAuth()` so the consumer can call
`refreshSession` again. A storage read failure is likewise exposed after the
initial loading state; `retrySessionRestore` repeats the read and restore
without clearing the token.

`logout` immediately closes the current generation of local auth state,
removes the token, and calls `performNativeLogout` with the token captured
before cleanup. Late login, restore, refresh, and browser-exchange results
cannot reapply a session from an older generation.

Login and registration pass redirects from the shared Ory `handleFlowError`
through Expo WebBrowser. After the browser returns, the adapter exchanges the
`session_token_exchange_code` / `code` pair through `exchangeSessionToken`; the
package does not reproduce Ory's error switch locally.

## Acceptance boundary

Automated build, unit, type, lint, and Expo 50 Metro bundle checks do not replace
consumer acceptance on Expo 56 / React Native 0.85 / React 19 or login,
registration, restart restore, logout, and account-switching checks against a
real Kratos deployment on a device or simulator.
