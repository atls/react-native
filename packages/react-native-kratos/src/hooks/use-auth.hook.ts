import type { ContextAuth } from '../providers/auth.provider.js'

import { useContext }       from 'react'

import { AuthContext }      from '../providers/auth.provider.js'

export const useAuth = (): ContextAuth => useContext(AuthContext)
