import { useState, type FormEvent } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import { RESOURCES, type Resource, type ResourcePool } from '../game/types'

interface ConverterPanelProps {
  resources: ResourcePool
  onConvert: (
    spend: ResourcePool,
    receive: Resource,
  ) => string | null | Promise<string | null>
  onClose: () => void
}

export function ConverterPanel({ resources, onConvert, onClose }: ConverterPanelProps) {
  const [spend, setSpend] = useState<ResourcePool>({ red: 0, yellow: 0, blue: 0 })
  const [receive, setReceive] = useState<Resource>('red')
  const [error, setError] = useState<string | null>(null)
  const total = RESOURCES.reduce((sum, resource) => sum + spend[resource], 0)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const conversionError = await onConvert(spend, receive)
    if (conversionError) {
      setError(conversionError)
      return
    }
    onClose()
  }

  return (
    <form className="converter-form" onSubmit={handleSubmit}>
      <div className="converter-equation">
        <div><strong>{total}</strong><span>selected</span></div>
        <ArrowRightLeft size={22} aria-hidden="true" />
        <div><strong>1</strong><span>{receive} material</span></div>
      </div>

      <fieldset className="resource-inputs">
        <legend>Resources to exchange</legend>
        {RESOURCES.map((resource) => (
          <label className={`number-field material-${resource}`} key={resource}>
            <span>{resource}</span>
            <input
              type="number"
              min="0"
              max={resources[resource]}
              value={spend[resource]}
              onChange={(event) => {
                const value = Math.min(resources[resource], Math.max(0, Number(event.target.value)))
                setSpend((current) => ({ ...current, [resource]: value }))
                setError(null)
              }}
            />
            <small>{resources[resource]} available</small>
          </label>
        ))}
      </fieldset>

      <label className="select-field">
        <span>Material to receive</span>
        <select value={receive} onChange={(event) => setReceive(event.target.value as Resource)}>
          {RESOURCES.map((resource) => <option value={resource} key={resource}>{resource}</option>)}
        </select>
      </label>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="modal-actions">
        <button className="button button-secondary" type="button" onClick={onClose}>Cancel</button>
        <button className="button button-primary" type="submit" disabled={total !== 4}>
          Exchange 4 for 1
        </button>
      </div>
    </form>
  )
}