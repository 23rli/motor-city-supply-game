import { CAR_MODELS, type GameConfig } from '../game/types'
import { RECIPES } from '../game/engine'

interface RecipePanelProps {
  config: GameConfig
}

export function RecipePanel({ config }: RecipePanelProps) {
  return (
    <div className="recipe-table" role="table" aria-label="Car recipes and revenue">
      <div className="recipe-row recipe-head" role="row">
        <span role="columnheader">Model</span>
        <span role="columnheader" className="material-red">Red</span>
        <span role="columnheader" className="material-yellow">Yellow</span>
        <span role="columnheader" className="material-blue">Blue</span>
        <span role="columnheader">Revenue</span>
      </div>
      {CAR_MODELS.map((model) => (
        <div className="recipe-row" role="row" key={model}>
          <span role="cell" className={`recipe-model recipe-${model}`}>
            <i aria-hidden="true" /> {model}
          </span>
          <strong role="cell">{RECIPES[model].red}</strong>
          <strong role="cell">{RECIPES[model].yellow}</strong>
          <strong role="cell">{RECIPES[model].blue}</strong>
          <span role="cell">${config.revenue[model].toFixed(2)}</span>
        </div>
      ))}
    </div>
  )
}