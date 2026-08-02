import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, RotateCcw, X } from 'lucide-react'
import { RESOURCES, type Resource, type ResourcePool } from '../game/types'

const SOCKETS = 4
const EMPTY: ResourcePool = { red: 0, yellow: 0, blue: 0 }

interface ConverterPanelProps {
  resources: ResourcePool
  onConvert: (
    spend: ResourcePool,
    receive: Resource,
  ) => string | null | Promise<string | null>
  onClose: () => void
}

export function ConverterPanel({ resources, onConvert, onClose }: ConverterPanelProps) {
  const [loaded, setLoaded] = useState<Resource[]>([])
  const [receive, setReceive] = useState<Resource>('red')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submitRef = useRef<HTMLButtonElement>(null)
  const chipRefs = useRef<Partial<Record<Resource, HTMLButtonElement | null>>>({})

  // A team-mode poll can change the pool underneath the mat; never show a negative stock.
  const stock = `${resources.red}:${resources.yellow}:${resources.blue}`
  useEffect(() => {
    setLoaded([])
    setError(null)
  }, [stock])

  const spend = loaded.reduce<ResourcePool>(
    (pool, resource) => ({ ...pool, [resource]: pool[resource] + 1 }),
    { ...EMPTY },
  )
  const remaining = (resource: Resource) => resources[resource] - spend[resource]
  const full = loaded.length === SOCKETS

  const load = (resource: Resource) => {
    if (full || remaining(resource) < 1) return
    const next = [...loaded, resource]
    setLoaded(next)
    setError(null)
    // The chips all disable on the fourth material, so move focus to the only next step.
    if (next.length === SOCKETS) requestAnimationFrame(() => submitRef.current?.focus())
  }

  const unload = (index: number) => {
    const resource = loaded[index]
    setLoaded((current) => current.filter((_, position) => position !== index))
    setError(null)
    // The emptied socket stops being focusable, so hand focus to its material.
    requestAnimationFrame(() => chipRefs.current[resource]?.focus())
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!full || busy) return
    setBusy(true)
    try {
      const conversionError = await onConvert(spend, receive)
      if (conversionError) {
        setError(conversionError)
        return
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="exchange" onSubmit={handleSubmit}>
      <div className="exchange-mat">
        <div className="mat-sockets">
          {Array.from({ length: SOCKETS }, (_, index) => {
            const resource = loaded[index]
            return resource ? (
              <button
                className={`mat-socket socket-filled socket-${resource}`}
                type="button"
                key={index}
                onClick={() => unload(index)}
                aria-label={`Take the ${resource} material back out of slot ${index + 1}`}
              >
                <span>{resource}</span>
                <X size={13} aria-hidden="true" />
              </button>
            ) : (
              <span className="mat-socket" key={index} aria-hidden="true" />
            )
          })}
        </div>

        <ArrowRight className="mat-arrow" size={22} aria-hidden="true" />

        <div className={`mat-output output-${receive}`}>
          <strong>1</strong>
          <span>{receive}</span>
        </div>
      </div>

      <p className="exchange-progress" role="status" aria-live="polite">
        {full
          ? `Trading 4 materials for 1 ${receive}.`
          : `Tap materials to fill ${SOCKETS - loaded.length} more slot${SOCKETS - loaded.length === 1 ? '' : 's'}.`}
      </p>

      <fieldset className="exchange-stock">
        <legend>Your stock</legend>
        <div className="stock-row">
          {RESOURCES.map((resource) => (
            <button
              className={`stock-chip chip-${resource}`}
              type="button"
              key={resource}
              ref={(node) => { chipRefs.current[resource] = node }}
              disabled={full || remaining(resource) < 1}
              onClick={() => load(resource)}
              aria-label={`Add one ${resource} material, ${remaining(resource)} left`}
            >
              <strong>{remaining(resource)}</strong>
              <span>{resource}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="exchange-receive">
        <legend>Take in return</legend>
        <div className="receive-row">
          {RESOURCES.map((resource) => (
            <button
              className={`receive-option option-${resource}${receive === resource ? ' option-active' : ''}`}
              type="button"
              key={resource}
              aria-pressed={receive === resource}
              onClick={() => setReceive(resource)}
            >
              {resource}
            </button>
          ))}
        </div>
      </fieldset>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="modal-actions modal-actions-split">
        <button
          className="button button-quiet"
          type="button"
          disabled={loaded.length === 0}
          onClick={() => setLoaded([])}
        >
          <RotateCcw size={15} aria-hidden="true" /> Clear
        </button>
        <div>
          <button className="button button-secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" type="submit" ref={submitRef} disabled={!full || busy}>
            Exchange
          </button>
        </div>
      </div>
    </form>
  )
}
