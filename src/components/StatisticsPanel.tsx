import { getCompleted, getProjectedPenalty, getRevenue, getWip } from '../game/engine'
import type { GameState } from '../game/types'

interface StatisticsPanelProps {
  game: GameState
}

const total = (values: Record<string, number>) =>
  Object.values(values).reduce((sum, value) => sum + value, 0)

export function StatisticsPanel({ game }: StatisticsPanelProps) {
  return (
    <div className="statistics-panel">
      <div className="statistics-kpis">
        <div><span>Revenue</span><strong>${getRevenue(game).toFixed(2)}</strong></div>
        <div><span>Completed</span><strong>{total(getCompleted(game))}</strong></div>
        <div><span>Current WIP</span><strong>{total(getWip(game))}</strong></div>
        <div><span>WIP exposure</span><strong>${getProjectedPenalty(game).toFixed(2)}</strong></div>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Round</th><th>Revenue</th><th>Completed</th><th>WIP</th><th>Unused R / Y / B</th></tr>
          </thead>
          <tbody>
            {game.history.length === 0 ? (
              <tr><td colSpan={5} className="empty-row">Round history begins after the first advance.</td></tr>
            ) : game.history.map((round) => (
              <tr key={round.round}>
                <td>{round.round + 1}</td>
                <td>${round.revenue.toFixed(2)}</td>
                <td>{total(round.completed)}</td>
                <td>{total(round.wip)}</td>
                <td>{round.unusedResources.red} / {round.unusedResources.yellow} / {round.unusedResources.blue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}