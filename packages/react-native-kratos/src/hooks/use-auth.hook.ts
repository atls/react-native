import type { ContextAuth } from '../providers'

import { useContext }       from 'react'

import { AuthContext }      from '../providers'

export const useAuth = (): ContextAuth => {
  const auth = useContext(AuthContext)

  if (!auth) {
    throw new Error('Missing <AuthProvider>')
  }

  return auth
}
