import { parentPort, workerData } from 'node:worker_threads'
import { optimizeGame } from './optimizer-core'
import type { OptimizationInput } from './session-store-core'

interface WorkerInput {
  input: OptimizationInput
  timeLimitSeconds: number
}

const port = parentPort
if (!port) throw new Error('The optimization worker needs a parent port.')

const request = workerData as WorkerInput

void optimizeGame(request.input, {
  timeLimitSeconds: request.timeLimitSeconds,
}).then(
  (solution) => port.postMessage({ ok: true, solution }),
  (caught: unknown) => port.postMessage({
    ok: false,
    message: caught instanceof Error ? caught.message : 'Optimization failed.',
  }),
)
