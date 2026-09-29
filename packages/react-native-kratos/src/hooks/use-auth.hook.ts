import type { ContextAuth } from '../providers/auth.provider.js'

import { useContext }       from 'react'

import { AuthContext }      from '../providers/auth.provider.js'

export const useAuth = (): ContextAuth => {
  const auth = useContext(AuthContext)

  if (!auth) {
    throw new Error('Missing <AuthProvider>')
  }

  return auth
}
