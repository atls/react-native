import * as SecureStore              from 'expo-secure-store'

import { createSessionTokenStorage } from './session-token.storage.js'

export const sessionTokenStorage = createSessionTokenStorage(SecureStore)
