import { useState, type FormEvent } from 'react'
import type { GameConfig, GameSetup } from '../game/types'
import { RunSetupFields } from './RunSetupFields'

interface NewRunPanelProps {
  config: GameConfig
  onStart: (setup: GameSetup) => void
  onCancel: () => void
}

export function NewRunPanel({ config, onStart, onCancel }: NewRunPanelProps) {
  const [models, setModels] = useState([...config.enabledModels])
  const [resourcePlan, setResourcePlan] = useState(config.resourcePlan)
  const [revenue, setRevenue] = useState({ ...config.revenue })
  const [wipPenalty, setWipPenalty] = useState({ ...config.wipPenalty })
  const [notes, setNotes] = useState(config.notes)

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (models.length > 0) {
      onStart({ enabledModels: models, resourcePlan, revenue, wipPenalty, notes })
    }
  }

  return (
    <form className="new-run-form" onSubmit={handleSubmit}>
      <RunSetupFields
        models={models}
        resourcePlan={resourcePlan}
        revenue={revenue}
        wipPenalty={wipPenalty}
        onModelsChange={setModels}
        onResourcePlanChange={setResourcePlan}
        onRevenueChange={setRevenue}
        onWipPenaltyChange={setWipPenalty}
      />

      <label className="notes-field">
        <span>Run notes <em>optional</em></span>
        <textarea value={notes} maxLength={2_000} rows={3} onChange={(event) => setNotes(event.target.value)} />
      </label>

      {models.length === 0 && <p className="form-error" role="alert">Select at least one model.</p>}

      <div className="modal-actions">
        <button className="button button-secondary" type="button" onClick={onCancel}>Cancel</button>
        <button className="button button-primary" type="submit" disabled={models.length === 0}>Start run</button>
      </div>
    </form>
  )
}