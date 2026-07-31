# Gameplay parity contract

This document defines what "the same gamewise" means for the rebuild. Changes to these rules require an explicit product decision and test updates.

## Flow

Cars move one station at a time: Planning, Manufacturing, Assembly, Quality, Paint, then Done. Moving a car out of Planning immediately replenishes that model in Planning. A board cell holds one active car.

## Recipes

| Model | Red | Yellow | Blue | Revenue | WIP penalty |
| --- | ---: | ---: | ---: | ---: | ---: |
| Blue | 3 | 3 | 2 | $3.00 | $1.50 |
| Green | 2 | 2 | 2 | $2.00 | $1.00 |
| Red | 3 | 2 | 2 | $2.50 | $1.25 |
| Yellow | 2 | 3 | 2 | $2.50 | $1.25 |

Manufacturing consumes red requirements, Assembly consumes yellow requirements, and Quality consumes blue requirements.

## Rounds and movement

- A car entering a material station cannot leave during that same round.
- At round advance, a car becomes ready when its current material requirement is full.
- The classic timer is 10 minutes through round 8 and 3 minutes afterward.
- Reset restores the exact beginning-of-round board and resource checkpoint.

## Allocation

- Allocation visits red, yellow, then blue material stations.
- Within each material, cars receive available resources from the top board lane downward.
- A car receives no more than its remaining recipe requirement.

## Paint

- Paint holds at most three cars.
- A paint batch prevents additional cars from entering while processing.
- Cars remain in Paint for the original two-round cycle before becoming ready for Done.

## Converter

Any combination of exactly four available resources can be exchanged for one red, yellow, or blue resource.

## Resources

Classic mode uses the original deterministic demonstration sequence. Random mode preserves the original per-round ranges: red 1-10, yellow 1-8, and blue 1-4.

## Scoring and reporting

- Revenue is cumulative completed cars multiplied by model revenue.
- WIP includes cars in Manufacturing, Assembly, Quality, and Paint.
- Projected score is revenue minus configured WIP penalty exposure.
- Round reports preserve completed counts, WIP, revenue, and unused resources.

## Intentional experience changes

These do not alter game rules:

- click, touch, and keyboard placement replaces drag-only interaction
- local recovery replaces the "do not refresh" constraint for solo play
- recipe, converter, statistics, and end-run tools remain in context
- mobile uses full-sized horizontally paged stations
- invalid moves explain the unmet rule