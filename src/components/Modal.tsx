import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  title: string
  eyebrow: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
  extraWide?: boolean
  dismissible?: boolean
}

export function Modal({
  open,
  title,
  eyebrow,
  onClose,
  children,
  wide,
  extraWide,
  dismissible = true,
}: ModalProps) {
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (dismissible && event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dismissible, open, onClose])

  if (!open) return null

  return (
    <div className="modal-backdrop" onMouseDown={dismissible ? onClose : undefined}>
      <section
        className={`modal-panel${wide ? ' modal-wide' : ''}${extraWide ? ' modal-extra-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        ref={panelRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <p>{eyebrow}</p>
            <h2 id="modal-title">{title}</h2>
          </div>
          {dismissible && (
            <button className="icon-button" type="button" onClick={onClose} aria-label={`Close ${title}`} title={`Close ${title}`}>
              <X size={20} />
            </button>
          )}
        </header>
        <div className="modal-content">{children}</div>
      </section>
    </div>
  )
}