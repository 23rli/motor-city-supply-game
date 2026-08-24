import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getCompleted, getRevenue, getWip } from '../game/engine'
import {
  CAR_MODELS,
  RESOURCES,
  type GameState,
} from '../game/types'
import { pageStatistics } from './reportPagination'

interface StatisticsPanelProps {
  game: GameState
}

const total = (values: Record<string, number>) =>
  Object.values(values).reduce((sum, value) => sum + value, 0)

const REPORT_STATIONS = [
  'manufacturing',
  'assembly',
  'quality',
  'paint',
  'dry',
] as const

const STATION_LABELS: Record<(typeof REPORT_STATIONS)[number], string> = {
  manufacturing: 'Manufacturing',
  assembly: 'Assembly',
  quality: 'Quality',
  paint: 'Paint',
  dry: 'Dry',
}

export function StatisticsPanel({ game }: StatisticsPanelProps) {
  const enabled = CAR_MODELS.filter((model) => game.config.enabledModels.includes(model))
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(12)
  const paged = pageStatistics(game.history, page, pageSize)
  const columnCount = 12 + 6 * enabled.length

  useEffect(() => {
    if (page !== paged.page) setPage(paged.page)
  }, [page, paged.page])

  return (
    <div className="statistics-panel">
      <div className="statistics-kpis">
        <div><span>Revenue</span><strong>${getRevenue(game).toFixed(2)}</strong></div>
        <div><span>Completed</span><strong>{total(getCompleted(game))}</strong></div>
        <div><span>Current WIP</span><strong>{total(getWip(game))}</strong></div>
        <div><span>Materials on hand</span><strong>{RESOURCES.reduce((sum, resource) => sum + game.resources[resource], 0)}</strong></div>
      </div>

      <p className="statistics-hint">
        Where your cars stood at the end of each round. Watch for a station that keeps filling up
        while the ones after it sit empty — that is your bottleneck.
      </p>

      <div className="table-scroll">
        <table className="legacy-statistics-table">
          <thead>
            <tr className="statistics-groups">
              <th aria-hidden="true" />
              {REPORT_STATIONS.map((station) => (
                <th scope="colgroup" colSpan={enabled.length} key={station}>
                  {STATION_LABELS[station]}
                </th>
              ))}
              <th aria-hidden="true" />
              <th scope="colgroup" colSpan={enabled.length}>Done</th>
              <th aria-hidden="true" />
              <th scope="colgroup" colSpan={3}>Resources</th>
              <th scope="colgroup" colSpan={3}>Converted resources</th>
              <th scope="colgroup" colSpan={3}>Unused resources</th>
            </tr>
            <tr>
              <th scope="col">Round</th>
              {REPORT_STATIONS.flatMap((station) => enabled.map((model) => (
                <th scope="col" key={`${station}-${model}`} className={`model-column model-${model}`}>{model}</th>
              )))}
              <th scope="col">WIP</th>
              {enabled.map((model) => (
                <th scope="col" key={`done-${model}`} className={`model-column model-${model}`}>{model}</th>
              ))}
              <th scope="col">Revenue</th>
              {RESOURCES.map((resource) => <th scope="col" key={`issued-${resource}`}>{resource[0].toUpperCase()}</th>)}
              {RESOURCES.map((resource) => <th scope="col" key={`converted-${resource}`}>{resource[0].toUpperCase()}</th>)}
              {RESOURCES.map((resource) => <th scope="col" key={`unused-${resource}`}>{resource[0].toUpperCase()}</th>)}
            </tr>
          </thead>
          <tbody>
            {game.history.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="empty-row">
                  Round history begins after the first advance.
                </td>
              </tr>
            ) : paged.rows.map((round) => (
              <tr key={round.round}>
                <td>{round.round + 1}</td>
                {REPORT_STATIONS.flatMap((station) => enabled.map((model) => {
                  const count = round.stations[station][model]
                  return <td key={`${station}-${model}`} className={count > 0 ? 'station-busy' : undefined}>{count || '—'}</td>
                }))}
                <td>{total(round.wip)}</td>
                {enabled.map((model) => <td key={`done-${model}`}>{round.completed[model] || '—'}</td>)}
                <td>${round.revenue.toFixed(2)}</td>
                {RESOURCES.map((resource) => <td key={`issued-${resource}`}>{round.issuedResources[resource] || '—'}</td>)}
                {RESOURCES.map((resource) => <td key={`converted-${resource}`}>{round.convertedResources[resource] || '—'}</td>)}
                {RESOURCES.map((resource) => <td key={`unused-${resource}`}>{round.unusedResources[resource] || '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {game.history.length > 12 && (
        <div className="statistics-pagination" aria-label="Statistics pages">
          <label>
            <span>Rows</span>
            <select value={pageSize} onChange={(event) => {
              setPageSize(Number(event.target.value))
              setPage(0)
            }}>
              <option value="12">12</option>
              <option value="24">24</option>
              <option value="48">48</option>
            </select>
          </label>
          <span>Page {paged.page + 1} of {paged.pageCount}</span>
          <div>
            <button className="icon-button" type="button" aria-label="Previous statistics page" disabled={paged.page === 0} onClick={() => setPage((current) => current - 1)}>
              <ChevronLeft size={18} />
            </button>
            <button className="icon-button" type="button" aria-label="Next statistics page" disabled={paged.page + 1 >= paged.pageCount} onClick={() => setPage((current) => current + 1)}>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}