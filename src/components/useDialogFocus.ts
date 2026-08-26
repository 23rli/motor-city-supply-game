import { useEffect, useEffectEvent, useRef } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useDialogFocus<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  dismissible = true,
) {
  const dialogRef = useRef<T>(null)
  const close = useEffectEvent(onClose)

  useEffect(() => {
    if (!open || !dialogRef.current) return
    const dialog = dialogRef.current
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const container = dialog.parentElement?.classList.contains('modal-backdrop')
      ? dialog.parentElement
      : dialog
    const priorAttributes = new Map<Element, {
      inert: boolean
      ariaHidden: string | null
    }>()
    let branch: Element | null = container
    while (branch?.parentElement) {
      const parent: HTMLElement = branch.parentElement
      for (const sibling of parent.children) {
        if (sibling === branch || priorAttributes.has(sibling)) continue
        priorAttributes.set(sibling, {
          inert: sibling.hasAttribute('inert'),
          ariaHidden: sibling.getAttribute('aria-hidden'),
        })
        sibling.setAttribute('inert', '')
        sibling.setAttribute('aria-hidden', 'true')
      }
      if (parent === document.body) break
      branch = parent
    }

    const focusFrame = requestAnimationFrame(() => dialog.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (dismissible && event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((element) => element.getClientRects().length > 0)
      if (!focusable.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable.at(-1)!
      if (event.shiftKey && (
        document.activeElement === first
        || !dialog.contains(document.activeElement)
      )) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      for (const [element, { inert, ariaHidden }] of priorAttributes) {
        if (!inert) element.removeAttribute('inert')
        if (ariaHidden === null) element.removeAttribute('aria-hidden')
        else element.setAttribute('aria-hidden', ariaHidden)
      }
      requestAnimationFrame(() => {
        if (
          previouslyFocused?.isConnected
          && !previouslyFocused.matches(':disabled')
        ) {
          previouslyFocused.focus()
          return
        }
        const fallback = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)]
          .find((element) => element.getClientRects().length > 0)
        fallback?.focus()
      })
    }
  }, [dismissible, open])

  return dialogRef
}