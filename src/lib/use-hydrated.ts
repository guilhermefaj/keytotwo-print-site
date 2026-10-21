import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

// false no pré-render e na hidratação, true depois: o que depende da URL ou do navegador entra sem divergir do HTML.
export const useHydrated = () => useSyncExternalStore(subscribe, () => true, () => false)
