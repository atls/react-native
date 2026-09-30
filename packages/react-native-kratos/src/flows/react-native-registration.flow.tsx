import type { ReactNode }         from 'react'
import type { ReactElement }      from 'react'

import { RegistrationNativeFlow } from '@atls/react-kratos'
import React                      from 'react'

import { useAuth }                from '../hooks/index.js'

export interface ReactNativeRegistrationFlowProps {
  children: ReactNode
  onError?: (error: unknown) => void
}

export const ReactNativeRegistrationFlow = ({
  children,
  onError,
}: ReactNativeRegistrationFlowProps): ReactElement => {
  const { setSession } = useAuth()

  return (
    <RegistrationNativeFlow onError={onError} onGenericError={onError} onSession={setSession}>
      {children}
    </RegistrationNativeFlow>
  )
}
