import type { ReactNode }         from 'react'
import type { ReactElement }      from 'react'

import { RegistrationNativeFlow } from '@atls/react-kratos'
import React                      from 'react'

import { useAuth }                from '../hooks'

export interface ReactNativeRegistrationFlowProps {
  children: ReactNode
}

export const ReactNativeRegistrationFlow = ({
  children,
}: ReactNativeRegistrationFlowProps): ReactElement => {
  const { setSession } = useAuth()

  return <RegistrationNativeFlow onSession={setSession}>{children}</RegistrationNativeFlow>
}
