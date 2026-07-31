import { Download } from 'lucide-react'
import {
  getCompleted,
  getProjectedPenalty,
  getRevenue,
  getWip,
} from '../game/engine'
import { buildRunCsv } from '../game/report'
import { CAR_MODELS, type GameState } from '../game/types'

interface EndRunPanelProps {
  game: GameState
  onContinue: () => void
  onNewRun: () => void
  newRunLabel?: string
}

export function EndRunPanel({
  game,
  onContinue,
  onNewRun,
  newRunLabel = 'New run',
}: EndRunPanelProps) {
  const revenue = getRevenue(game)
  const penalty = getProjectedPenalty(game)
  const completed = getCompleted(game)
  const wip = getWip(game)

  const downloadReport = () => {
    const csv = buildRunCsv(game)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `motor-city-run-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  return (
    <div className="end-run-panel">
      <div className="score-readout">
        <span>Projected score</span>
        <strong>${(revenue - penalty).toFixed(2)}</strong>
        <small>${revenue.toFixed(2)} revenue - ${penalty.toFixed(2)} WIP exposure</small>
      </div>

      <div className="model-results">
        {CAR_MODELS.map((model) => (
          <div key={model}>
            <span className={`recipe-${model}`}>{model}</span>
            <strong>{completed[model]}</strong>
            <small>{wip[model]} WIP</small>
          </div>
        ))}
      </div>

      <div className="modal-actions modal-actions-split">
        <button className="button button-secondary" type="button" onClick={downloadReport}>
          <Download size={16} aria-hidden="true" /> Download CSV
        </button>
        <div>
          <button className="button button-secondary" type="button" onClick={onContinue}>Continue</button>
          <button className="button button-primary" type="button" onClick={onNewRun}>{newRunLabel}</button>
        </div>
      </div>
    </div>
  )
}