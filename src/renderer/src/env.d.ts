/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

import type { ApiBridge } from '@shared/types'

declare global {
  interface Window {
    api: ApiBridge
  }
}

export {}
