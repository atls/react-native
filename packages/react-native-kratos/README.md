# @atls/react-native-kratos

React Native / Expo-адаптер native self-service flows для self-hosted Ory Kratos.

## Использование

Создайте `FrontendApi` из `@ory/kratos-client-fetch` и передайте его через
`SdkProvider`:

```tsx
import {
  AuthProvider,
  ReactNativeLoginFlow,
  SdkProvider,
} from '@atls/react-native-kratos'
import {
  Configuration,
  FrontendApi,
} from '@ory/kratos-client-fetch'

const frontend = new FrontendApi(
  new Configuration({ basePath: kratosPublicUrl })
)

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

`AuthProvider` сохраняет только `session_token`: в Expo SecureStore на native и
в AsyncStorage на web. При запуске сессия восстанавливается через `toSession`.
Ответ `401` удаляет подтверждённо неактивный token; network, `403` и `5xx`
оставляют token и ошибку в `useAuth()` для повторного `refreshSession`. Ошибка
чтения storage также становится видна потребителю после первого loading state;
`retrySessionRestore` повторяет чтение и восстановление, не очищая token.

`logout` сразу закрывает текущее поколение локального auth state, удаляет token
и вызывает `performNativeLogout` с token, захваченным до очистки. Поздние
результаты login, restore, refresh и browser exchange не могут снова применить
сессию старого поколения.

Login и registration передают redirect из общего Ory `handleFlowError` в Expo
WebBrowser. После возврата адаптер обменивает пару
`session_token_exchange_code` / `code` через `exchangeSessionToken`; локальный
Ory error switch пакет не воспроизводит.
