import type { ReactElement }   from 'react'
import type { ReactNode }      from 'react'

import React                   from 'react'

import { AuthProvider }        from './auth.provider.js'
import { sessionTokenStorage } from './platform-session-token.storage.js'

export interface PlatformAuthProviderProps {
  children: ReactNode
}

export const PlatformAuthProvider = ({ children }: PlatformAuthProviderProps): ReactElement => (
  <AuthProvider storage={sessionTokenStorage}>{children}</AuthProvider>
)
