import { getCompleted, getProjectedPenalty, getRevenue, getWip } from '../game/engine'
import { CAR_MODELS, ROUND_STATIONS, type GameState, type RoundStation } from '../game/types'

interface StatisticsPanelProps {
  game: GameState
}

const total = (values: Record<string, number>) =>
  Object.values(values).reduce((sum, value) => sum + value, 0)

const STATION_LABELS: Record<RoundStation, string> = {
  planning: 'Waiting',
  manufacturing: 'Manufacturing',
  assembly: 'Assembly',
  quality: 'Quality',
  paint: 'Paint',
  dry: 'Drying',
}

export function StatisticsPanel({ game }: StatisticsPanelProps) {
  const enabled = CAR_MODELS.filter((model) => game.config.enabledModels.includes(model))

  return (
    <div className="statistics-panel">
      <div className="statistics-kpis">
        <div><span>Revenue</span><strong>${getRevenue(game).toFixed(2)}</strong></div>
        <div><span>Completed</span><strong>{total(getCompleted(game))}</strong></div>
        <div><span>Current WIP</span><strong>{total(getWip(game))}</strong></div>
        <div><span>WIP exposure</span><strong>${getProjectedPenalty(game).toFixed(2)}</strong></div>
      </div>

      <p className="statistics-hint">
        Where your cars stood at the end of each round. Watch for a station that keeps filling up
        while the ones after it sit empty — that is your bottleneck.
      </p>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Round</th>
              {ROUND_STATIONS.map((station) => (
                <th scope="col" key={station}>{STATION_LABELS[station]}</th>
              ))}
              <th scope="col">WIP</th>
              <th scope="col">Shipped</th>
              <th scope="col">Revenue</th>
              <th scope="col">Issued R/Y/B</th>
              <th scope="col">Exchanged R/Y/B</th>
              <th scope="col">Unused R/Y/B</th>
            </tr>
          </thead>
          <tbody>
            {game.history.length === 0 ? (
              <tr>
                <td colSpan={ROUND_STATIONS.length + 7} className="empty-row">
                  Round history begins after the first advance.
                </td>
              </tr>
            ) : game.history.map((round) => (
              <tr key={round.round}>
                <td>{round.round + 1}</td>
                {ROUND_STATIONS.map((station) => {
                  const counts = round.stations[station]
                  const stationTotal = enabled.reduce((sum, model) => sum + counts[model], 0)
                  return (
                    <td key={station} className={stationTotal > 0 ? 'station-busy' : undefined}>
                      {stationTotal === 0 ? '—' : stationTotal}
                    </td>
                  )
                })}
                <td>{total(round.wip)}</td>
                <td>{total(round.completed)}</td>
                <td>${round.revenue.toFixed(2)}</td>
                <td>{round.issuedResources.red} / {round.issuedResources.yellow} / {round.issuedResources.blue}</td>
                <td>{round.convertedResources.red} / {round.convertedResources.yellow} / {round.convertedResources.blue}</td>
                <td>{round.unusedResources.red} / {round.unusedResources.yellow} / {round.unusedResources.blue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}