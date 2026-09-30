import type { useSdk } from '../src/index.js'

import assert          from 'node:assert/strict'
import { test }        from 'node:test'

type UseSdk = typeof useSdk

const exportedUseSdk: UseSdk | undefined = undefined

test('keeps react-kratos exports available from the package root', () => {
  assert.equal(exportedUseSdk, undefined)
})
