import { createHash, randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import type { OptimalRunJob } from '../src/team/types'
import type { OptimizationSolution } from './optimizer-core'
import type { OptimizationInput } from './session-store-core'

const JOB_TTL_MS = 12 * 60 * 60 * 1_000
const WORKER_GRACE_MS = 15_000
const MAX_WAITING_JOBS = 8
const MAX_RETAINED_TERMINAL_JOBS = 64

interface JobRecord extends OptimalRunJob {
  gameId: string
  cacheKey: string
  createdAt: number
  input: OptimizationInput
}

interface WorkerResponse {
  ok: boolean
  solution?: OptimizationSolution
  message?: string
}

interface OptimizationJobsOptions {
  maxRetainedTerminalJobs?: number
  onWorkerError?: (
    error: Error,
    context: { jobId: string; gameId: string },
  ) => void
}

export interface OptimizationService {
  start(gameId: string, input: OptimizationInput): OptimalRunJob
  get(gameId: string, jobId: string): OptimalRunJob
  close(): Promise<void>
}

const publicJob = ({
  id,
  status,
  player,
  solveTimeMs,
  message,
}: JobRecord): OptimalRunJob => structuredClone({
  id,
  status,
  player,
  solveTimeMs,
  message,
})

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    )
  }
  return value
}

const cacheKey = (input: OptimizationInput) => createHash('sha256')
  .update(JSON.stringify(stableValue(input)))
  .digest('hex')

const sourceMode = import.meta.url.endsWith('.ts')
const workerUrl = () => new URL(
  sourceMode ? './optimizer-worker-bootstrap.mjs' : './optimizer-worker.js',
  import.meta.url,
)

const timeLimitFor = (rounds: number) => Math.min(180, Math.max(10, rounds * 4))

const isTerminal = (status: OptimalRunJob['status']) =>
  status === 'optimal' || status === 'feasible' || status === 'failed'

export class OptimizationJobs implements OptimizationService {
  private readonly jobs = new Map<string, JobRecord>()
  private readonly jobIdByCacheKey = new Map<string, string>()
  private readonly queue: string[] = []
  private readonly maxRetainedTerminalJobs: number
  private readonly onWorkerError?: OptimizationJobsOptions['onWorkerError']
  private activeWorker: Worker | null = null
  private closed = false

  constructor(options: OptimizationJobsOptions = {}) {
    this.maxRetainedTerminalJobs = options.maxRetainedTerminalJobs
      ?? MAX_RETAINED_TERMINAL_JOBS
    this.onWorkerError = options.onWorkerError
    if (!Number.isInteger(this.maxRetainedTerminalJobs) || this.maxRetainedTerminalJobs < 1) {
      throw new RangeError('maxRetainedTerminalJobs must be a positive integer.')
    }
  }

  start(gameId: string, input: OptimizationInput) {
    this.prune()
    const key = `${gameId}:${cacheKey(input)}`
    const existingId = this.jobIdByCacheKey.get(key)
    const existing = existingId ? this.jobs.get(existingId) : undefined
    if (existing && existing.status !== 'failed') {
      return publicJob(existing)
    }
    if (this.queue.length >= MAX_WAITING_JOBS) {
      throw new Error('OPTIMIZATION_QUEUE_FULL')
    }

    const job: JobRecord = {
      id: randomUUID(),
      gameId,
      cacheKey: key,
      createdAt: Date.now(),
      input: structuredClone(input),
      status: 'queued',
    }
    this.jobs.set(job.id, job)
    this.jobIdByCacheKey.set(key, job.id)
    this.queue.push(job.id)
    this.runNext()
    return publicJob(job)
  }

  get(gameId: string, jobId: string) {
    this.prune()
    const job = this.jobs.get(jobId)
    if (!job || job.gameId !== gameId) {
      throw new Error('OPTIMIZATION_JOB_NOT_FOUND')
    }
    return publicJob(job)
  }

  async close() {
    this.closed = true
    this.queue.length = 0
    const worker = this.activeWorker
    this.activeWorker = null
    if (worker) await worker.terminate()
  }

  private runNext() {
    if (this.closed || this.activeWorker) return
    const jobId = this.queue.shift()
    if (!jobId) return
    const job = this.jobs.get(jobId)
    if (!job) {
      this.runNext()
      return
    }

    job.status = 'running'
    const timeLimitSeconds = timeLimitFor(job.input.endRound)
    const worker = new Worker(workerUrl(), {
      workerData: { input: job.input, timeLimitSeconds },
    })
    this.activeWorker = worker
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      job.status = 'failed'
      job.message = 'The optimizer exceeded its safety limit. Try fewer rounds.'
      this.reportWorkerError(job, new Error(
        `Optimization worker timed out after ${timeLimitSeconds + WORKER_GRACE_MS / 1_000} seconds.`,
      ))
      this.prune()
      void worker.terminate().finally(() => this.finishWorker(worker))
    }, timeLimitSeconds * 1_000 + WORKER_GRACE_MS)
    timeout.unref()

    const settle = (response: WorkerResponse, workerError?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (response.ok && response.solution) {
        job.status = response.solution.proof
        job.player = response.solution.player
        job.solveTimeMs = response.solution.solveTimeMs
      } else {
        job.status = 'failed'
        job.message = 'The optimizer could not construct a legal run for this setup.'
        this.reportWorkerError(
          job,
          workerError ?? new Error(response.message ?? 'Optimization worker returned no solution.'),
        )
      }
      this.prune()
      void worker.terminate().finally(() => this.finishWorker(worker))
    }

    worker.once('message', (response: WorkerResponse) => settle(response))
    worker.once('error', (error) => settle({ ok: false }, error))
    worker.once('exit', (code) => {
      if (!settled) settle(
        { ok: false },
        new Error(`Optimization worker exited without a result (code ${code}).`),
      )
    })
  }

  private finishWorker(worker: Worker) {
    if (this.activeWorker === worker) this.activeWorker = null
    this.runNext()
  }

  private reportWorkerError(job: JobRecord, error: Error) {
    try {
      this.onWorkerError?.(error, { jobId: job.id, gameId: job.gameId })
    } catch {
      // Observability must not interrupt the queue or gameplay.
    }
  }

  private prune() {
    const cutoff = Date.now() - JOB_TTL_MS
    const retainedTerminalJobs: Array<[string, JobRecord]> = []
    for (const [id, job] of this.jobs) {
      if (!isTerminal(job.status)) continue
      if (job.createdAt < cutoff) this.remove(id, job)
      else retainedTerminalJobs.push([id, job])
    }

    retainedTerminalJobs.sort(([, left], [, right]) => left.createdAt - right.createdAt)
    const overflow = retainedTerminalJobs.length - this.maxRetainedTerminalJobs
    for (const [id, job] of retainedTerminalJobs.slice(0, Math.max(0, overflow))) {
      this.remove(id, job)
    }
  }

  private remove(id: string, job: JobRecord) {
    this.jobs.delete(id)
    if (this.jobIdByCacheKey.get(job.cacheKey) === id) {
      this.jobIdByCacheKey.delete(job.cacheKey)
    }
  }
}
