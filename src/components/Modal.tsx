import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useDialogFocus } from './useDialogFocus'

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
  const panelRef = useDialogFocus<HTMLElement>(open, onClose, dismissible)

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