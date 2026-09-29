import type { AsyncStorageStatic }   from '@react-native-async-storage/async-storage'

import AsyncStorage                  from '@react-native-async-storage/async-storage'
import * as SecureStore              from 'expo-secure-store'
import { Platform }                  from 'react-native'

import { createSessionTokenStorage } from './session-token.storage.js'

export const sessionTokenStorage = createSessionTokenStorage(
  Platform.OS,
  SecureStore,
  AsyncStorage as unknown as AsyncStorageStatic
)
