import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  CAR_MODELS,
  RESOURCES,
  ROUND_STATIONS,
  type ModelValues,
  type ResourcePool,
  type RoundStation,
} from '../game/types'
import type { TeamExportPlayer } from '../team/types'
import { pageRoundHistory } from './reportPagination'

const STATION_LABELS: Record<RoundStation, string> = {
  planning: 'Planning',
  manufacturing: 'Manufacturing',
  assembly: 'Assembly',
  quality: 'Quality',
  paint: 'Paint',
  dry: 'Dry',
}

const total = (values: ModelValues) =>
  CAR_MODELS.reduce((sum, model) => sum + values[model], 0)

function ModelCounts({ values }: { values: ModelValues }) {
  return (
    <span className="history-counts">
      {CAR_MODELS.map((model) => (
        <span className={`history-${model}`} key={model} title={model}>
          {model[0].toUpperCase()} {values[model]}
        </span>
      ))}
    </span>
  )
}

function ResourceCounts({ values }: { values: ResourcePool }) {
  return (
    <span className="history-counts history-resources">
      {RESOURCES.map((resource) => (
        <span className={`history-${resource}`} key={resource} title={resource}>
          {resource[0].toUpperCase()} {values[resource]}
        </span>
      ))}
    </span>
  )
}

export function PlayerRoundHistory({ player }: { player: TeamExportPlayer }) {
  const [page, setPage] = useState(0)
  const paged = pageRoundHistory(player.history, page)

  useEffect(() => setPage(0), [player.id])
  useEffect(() => {
    if (page !== paged.page) setPage(paged.page)
  }, [page, paged.page])

  return (
    <div className="player-history">
      <dl className="history-summary">
        <div><dt>Scored through</dt><dd>Round {player.scoredThroughRound}</dd></div>
        <div><dt>Revenue</dt><dd>${player.revenue.toFixed(2)}</dd></div>
        <div><dt>Cars shipped</dt><dd>{player.throughput}</dd></div>
        <div><dt>Peak WIP</dt><dd>{player.peakWip}</dd></div>
      </dl>

      <p className="statistics-hint">
        Newest rounds first. Each station cell shows Blue, Green, Red, and Yellow model counts.
      </p>

      <div className="table-scroll history-table">
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
            {paged.rows.length === 0 ? (
              <tr><td className="empty-row" colSpan={13}>No round history yet.</td></tr>
            ) : paged.rows.map((round) => (
              <tr key={round.round}>
                <td><strong>{round.round + 1}</strong></td>
                {ROUND_STATIONS.map((station) => (
                  <td key={station}><ModelCounts values={round.stations[station]} /></td>
                ))}
                <td>{total(round.wip)}</td>
                <td><ModelCounts values={round.completed} /></td>
                <td>${round.revenue.toFixed(2)}</td>
                <td><ResourceCounts values={round.issuedResources} /></td>
                <td><ResourceCounts values={round.convertedResources} /></td>
                <td><ResourceCounts values={round.unusedResources} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="history-pagination" aria-label="Round history pages">
        <span>
          {paged.total === 0
            ? 'No rounds'
            : `Page ${paged.page + 1} of ${paged.pageCount} / ${paged.total} rounds`}
        </span>
        <div>
          <button className="icon-button" type="button" aria-label="Newer rounds" disabled={paged.page === 0} onClick={() => setPage((current) => current - 1)}>
            <ChevronLeft size={18} />
          </button>
          <button className="icon-button" type="button" aria-label="Older rounds" disabled={paged.page + 1 >= paged.pageCount} onClick={() => setPage((current) => current + 1)}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}