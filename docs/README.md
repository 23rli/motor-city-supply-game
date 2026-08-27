# Motor City documentation

## Start here

| I need to... | Use this |
| --- | --- |
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
- Facilitate opens with the professor's recommended 10-round, 10/5-minute preset.
- The timer is optional and is configured before session creation.
- Each player has an independent per-round countdown.
- At timeout, materials allocate automatically and the player confirms the next round.
- WIP rates and monetary penalties stay hidden from players until the run ends.
- The admin screen keeps the WIP round and end controls in collapsed **Private scoring**.
- The facilitator recovery code is required to recover or reuse a facilitator setup.

## Documentation maintenance

User-facing labels in these documents are written exactly as they appear in the application.
Any change to setup, timing, scoring, recovery, exports, or deployment must update the owning guide
and its tests in the same change.

The editable print source is [facilitator-guide.html](facilitator-guide.html). Regenerate the PDF
with `npm run docs:pdf`. Set `BROWSER_BIN` if Edge or Chrome is not in a standard location.
