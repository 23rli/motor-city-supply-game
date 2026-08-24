import {
  CAR_MODELS,
  type CarModel,
  type ModelValues,
  type ResourcePlan,
} from '../game/types'

interface RunSetupFieldsProps {
  models: CarModel[]
  resourcePlan: ResourcePlan
  revenue: ModelValues
  wipPenalty: ModelValues
  onModelsChange: (models: CarModel[]) => void
  onResourcePlanChange: (plan: ResourcePlan) => void
  onRevenueChange: (values: ModelValues) => void
  onWipPenaltyChange: (values: ModelValues) => void
}

const numericValue = (value: number) => Number.isFinite(value) ? value : 0

export function RunSetupFields({
  models,
  resourcePlan,
  revenue,
  wipPenalty,
  onModelsChange,
  onResourcePlanChange,
  onRevenueChange,
  onWipPenaltyChange,
}: RunSetupFieldsProps) {
  return (
    <div className="run-setup-fields">
      <fieldset className="model-switches">
        <legend>Active models</legend>
        {CAR_MODELS.map((model) => (
          <label className={`model-switch model-switch-${model}`} key={model}>
            <input
              type="checkbox"
              checked={models.includes(model)}
              onChange={(event) => {
                onModelsChange(event.target.checked
                  ? CAR_MODELS.filter((candidate) => (
                      candidate === model || models.includes(candidate)
                    ))
                  : models.filter((candidate) => candidate !== model))
              }}
            />
            <span aria-hidden="true" />
            <strong>{model}</strong>
          </label>
        ))}
      </fieldset>

      <label className="select-field">
        <span>Resource plan</span>
        <select value={resourcePlan} onChange={(event) => onResourcePlanChange(event.target.value as ResourcePlan)}>
          <option value="classic">Classic 10-round sequence</option>
          <option value="evan">Original 25-round team sequence</option>
          <option value="random">Random 100-round sequence</option>
        </select>
      </label>

      <fieldset className="setup-economics">
        <legend>Economics per completed car</legend>
        <div className="setup-economics-head" aria-hidden="true">
          <span>Model</span><span>Revenue</span><span>WIP rate</span>
        </div>
        {CAR_MODELS.map((model) => {
          const enabled = models.includes(model)
          return (
            <div className={`setup-economics-row setup-${model}`} key={model}>
              <strong>{model}</strong>
              <label>
                <span className="sr-only">{model} revenue</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={revenue[model]}
                  disabled={!enabled}
                  onChange={(event) => onRevenueChange({
                    ...revenue,
                    [model]: numericValue(event.target.valueAsNumber),
                  })}
                />
              </label>
              <label>
                <span className="sr-only">{model} WIP rate</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={wipPenalty[model]}
                  disabled={!enabled}
                  onChange={(event) => onWipPenaltyChange({
                    ...wipPenalty,
                    [model]: numericValue(event.target.valueAsNumber),
                  })}
                />
              </label>
            </div>
          )
        })}
      </fieldset>
    </div>
  )
}