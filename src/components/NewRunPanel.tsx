import { useState, type FormEvent } from 'react'
import { CAR_MODELS, type CarModel } from '../game/types'

export type ResourcePlan = 'classic' | 'random'

interface NewRunPanelProps {
  enabledModels: CarModel[]
  onStart: (models: CarModel[], resourcePlan: ResourcePlan) => void
  onCancel: () => void
}

export function NewRunPanel({ enabledModels, onStart, onCancel }: NewRunPanelProps) {
  const [models, setModels] = useState<CarModel[]>(enabledModels)
  const [resourcePlan, setResourcePlan] = useState<ResourcePlan>('classic')

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (models.length > 0) onStart(models, resourcePlan)
  }

  return (
    <form className="new-run-form" onSubmit={handleSubmit}>
      <fieldset className="model-switches">
        <legend>Active models</legend>
        {CAR_MODELS.map((model) => (
          <label className={`model-switch model-switch-${model}`} key={model}>
            <input
              type="checkbox"
              checked={models.includes(model)}
              onChange={(event) => {
                setModels((current) => event.target.checked
                  ? [...current, model]
                  : current.filter((candidate) => candidate !== model))
              }}
            />
            <span aria-hidden="true" />
            <strong>{model}</strong>
          </label>
        ))}
      </fieldset>

      <label className="select-field">
        <span>Resource plan</span>
        <select value={resourcePlan} onChange={(event) => setResourcePlan(event.target.value as ResourcePlan)}>
          <option value="classic">Classic demo sequence</option>
          <option value="random">Random 100-round sequence</option>
        </select>
      </label>

      {models.length === 0 && <p className="form-error" role="alert">Select at least one model.</p>}

      <div className="modal-actions">
        <button className="button button-secondary" type="button" onClick={onCancel}>Cancel</button>
        <button className="button button-primary" type="submit" disabled={models.length === 0}>Start run</button>
      </div>
    </form>
  )
}