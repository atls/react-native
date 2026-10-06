# @atls/react-native-kratos

Username/password authentication and native session management for Expo 56,
React Native 0.85 and React 19. The package connects the shared
`@atls/react-kratos` flows to Expo SecureStore; your application owns its screens,
navigation and account/profile initialization.

## Install and configure

Install the adapter and Ory client, then install the native storage module with
your application's Expo CLI:

```sh
yarn add @atls/react-native-kratos @ory/kratos-client-fetch@26.2.0
npx expo install expo-secure-store
```

Use a Kratos Public API endpoint reachable from the device, with password login
and registration enabled. Configure its identity schema for the traits your
registration screen collects. Never embed Kratos admin credentials in the app.

Create one SDK client and mount the providers above your authentication screens:

```tsx
import { Configuration } from '@ory/kratos-client-fetch'
import { FrontendApi }   from '@ory/kratos-client-fetch'

import { AuthProvider }  from '@atls/react-native-kratos'
import { SdkProvider }   from '@atls/react-native-kratos'

const frontend = new FrontendApi(new Configuration({ basePath: kratosPublicUrl }))

export const App = () => (
  <SdkProvider value={frontend}>
    <AuthProvider>
      <AuthenticationScreen />
    </AuthProvider>
  </SdkProvider>
)
```

Keep the SDK instance stable across renders. `AuthProvider` waits for the initial
storage read before rendering its children. A credential awaiting server
validation is not an authenticated session: use `isAuthenticated` to choose the
signed-in screen, not the presence of `sessionToken`.

## Password login and registration

Wrap a login screen with `ReactNativeLoginFlow`. Its required `route` accepts
optional `params.aal` and `params.refresh`; use `route={{}}` for ordinary login.
Shared flow components provide values, submission state and Kratos validation
messages while you supply native UI:

```tsx
import { Button }               from 'react-native'
import { TextInput }            from 'react-native'
import { View }                 from 'react-native'

import { FlowInputNode }        from '@atls/react-native-kratos'
import { FlowSubmit }           from '@atls/react-native-kratos'
import { ReactNativeLoginFlow } from '@atls/react-native-kratos'

export const LoginScreen = () => (
  <ReactNativeLoginFlow route={{}} onError={reportAuthError}>
    <View>
      <FlowInputNode name='identifier'>
        {(node, value, onChange) => (
          <TextInput autoCapitalize='none' value={value} onChangeText={onChange} />
        )}
      </FlowInputNode>
      <FlowInputNode name='password'>
        {(node, value, onChange) => (
          <TextInput secureTextEntry value={value} onChangeText={onChange} />
        )}
      </FlowInputNode>
      <FlowSubmit>
        {({ onSubmit, submitting }) => (
          <Button
            title='Sign in'
            disabled={submitting}
            onPress={() => {
              onSubmit({ method: 'password' }).catch(reportAuthError)
            }}
          />
        )}
      </FlowSubmit>
    </View>
  </ReactNativeLoginFlow>
)
```

Use `ReactNativeRegistrationFlow` for registration. Provide the fields required
by your identity schema and submit nested `traits`, rather than flat field names
such as `traits.username`. For a username schema, a child of the registration
flow can read `useValues()` and submit:

```tsx
onSubmit({
  method: 'password',
  traits: { username: values.getValue('traits.username') },
}).catch(reportAuthError)
```

The wrappers pass a successful native session to the auth provider and await
credential persistence. `useFlow()`, `FlowMessages` and `FlowNodeMessages` remain
available from the shared package for displaying flow and field validation
messages. No browser callback or `returnTo` is required for these password flows.

## Session API

Read the public state and actions with `useAuth()`. `AuthContext` is also exported
for consumers that use React's context API directly.

| Member                                  | Application behavior                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `isAuthenticated`                       | True only when the current confirmed session is active                             |
| `session`                               | Current server session, when available                                             |
| `sessionToken`                          | Current known opaque credential; its presence alone is not proof of authentication |
| `error`                                 | Storage or session validation failure reported by the provider                     |
| `setSession({ session, sessionToken })` | Persist and accept a native flow result; the wrappers normally call this for you   |
| `setSession(undefined)`                 | Clear local authentication and storage without revoking a server session           |
| `syncSession(): Promise<void>`          | Wait for pending acceptance and revalidate the current credential                  |
| `logout(): Promise<void>`               | Clear local authentication, remove its stored credential and attempt server logout |

Await actions and handle rejection. For example, a logout button can report an
incomplete logout and allow the user to retry:

```tsx
const { logout } = useAuth()

const signOut = async () => {
  try {
    await logout()
  } catch (error) {
    reportAuthError(error)
  }
}
```

Explicit logout also covers a credential already read during pending restoration.
If remote logout fails after local clearing, another `logout()` call on the same
mounted provider retries it. Both local and remote failures are reported, using
an `AggregateError` if both fail. Retry before replacing or unmounting that
provider; remote retry state is not persisted across process restarts.

## Storage and recovery

SecureStore holds the raw opaque token under `user_session`. Older native JSON
values are read at the same key and migrated only after successful server
validation; stored session data is never trusted as authentication.

A confirmed inactive-session response clears the affected credential. Temporary
network or server failures retain the token and any previously confirmed session,
expose the error, and allow `syncSession()` to retry. A failed replacement write
does not replace the last committed credential. Late asynchronous results cannot
reauthenticate after logout or overwrite a newer accepted session. Switching
accounts does not automatically revoke another server session.

## Supported runtime

The native integration targets Expo 56, React Native 0.85 and React 19 with
`expo-secure-store` 56 and `@ory/kratos-client-fetch` 26.2. The client version does
not select or upgrade your Kratos server; verify your server's password and
session behavior separately.

Expo 50, web storage, browser/OIDC authentication and redirect-code exchange are
not supported by this native adapter. Shared `@atls/react-kratos@0.1.0` exports,
including `SdkProvider` and `useSdk`, remain available; their presence does not
add native support for browser-only flows.
