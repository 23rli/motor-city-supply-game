# Motor City documentation

## Start here

| I need to... | Use this |
| --- | --- |
| Train or qualify a professor, TA, or backup facilitator | [Printable SOP](Motor-City-Facilitator-SOP.pdf) and [editable source](FACILITATOR_SOP.md) |
| Run a class with the fewest possible instructions | [One-page quick start](QUICK_START.md) |
| Print or email a large-type guide | [Facilitator PDF](Motor-City-Facilitator-Guide.pdf) |
| Understand every facilitator control | [Full facilitator manual](FACILITATOR.md) |
| Answer a common question | [Frequently asked questions](FAQ.md) |
| Deploy, check, or roll back the service | [Operations runbook](OPERATIONS.md) |
| Integrate with the application | [HTTP API](API.md) |
| Understand system ownership and persistence | [Architecture](ARCHITECTURE.md) |
| Review preserved game rules | [Gameplay parity contract](PARITY.md) |
| Review security boundaries | [Security](SECURITY.md) |
| See delivery status | [Roadmap](ROADMAP.md) |

## Important facts

- **Original 25-round Team Sequence** is the exact predetermined v1 sequence.
- Facilitate opens with the exact v1 25-round sequence and a timer change after round 10.
- Factory floor shows the proven $82.00 default optimum as a non-ranked reference student and can
  calculate an engine-replayed reference for any saved 1-100-round setup.
- The timer is optional and is configured before session creation.
- Each player has an independent per-round countdown.
- At timeout, materials allocate automatically and the player confirms the next round.
- WIP rates and monetary penalties stay hidden from players until the run ends.
- The admin screen keeps the WIP round and end controls in collapsed **Private scoring**.
- The facilitator recovery code is required to recover or reuse a facilitator setup.

## Documentation maintenance

User-facing labels in these documents are written exactly as they appear in the application.
Any change to setup, timing, scoring, recovery, exports, or deployment must update the owning guide
and its tests in the same change. A major facilitator workflow change must also update the training
SOP and its qualification checklist.

The large-print guide source is [facilitator-guide.html](facilitator-guide.html), and the SOP PDF is
generated from [FACILITATOR_SOP.md](FACILITATOR_SOP.md). Regenerate both with `npm run docs:pdf`.
Set `BROWSER_BIN` if Edge or Chrome is not in a standard location.
