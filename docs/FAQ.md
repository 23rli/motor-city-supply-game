# Frequently asked questions

## Does Original 25-round Team Sequence use the predetermined v1 dice rolls?

**Yes.** It uses the exact 25 red/yellow/blue triples from v1, in the original order. The full
75-value sequence is pinned by an executable test so an accidental change fails the test suite.

## Can I set the WIP penalty round and final round before creating the session?

**Yes.** Choose **Facilitate**, then use **Class plan**. The saved values appear in the lobby's
**Control** panel before you press **Start production**. They also prefill the end-of-run controls.

- **Final round**: revenue counts through this round.
- **WIP penalty round**: unfinished cars are measured at this round.

The WIP penalty round cannot be later than the final round.

## Can I customize the timer by round range?

**Yes.** Turn on **Use a round timer** and enter contiguous timing rows. For example:

| Rounds | Time per round |
| --- | ---: |
| 1-5 | 10 minutes |
| 6-10 | 5 minutes |

Use **Add timing change** for another range. Use **Restore 10 / 3 min** for 10 minutes in rounds 1-8
and 3 minutes in later rounds.

## What happens when time reaches zero?

The game matches v1 behavior without silently changing rounds:

1. Remaining materials allocate automatically.
2. The player's board locks.
3. A **Time is up** message appears.
4. The player presses **Advance round**.
5. The next round begins with its configured timer.

Each player has an independent timer. Refreshing or rejoining does not reset it.

## Is the timer required?

No. Leave **Use a round timer** off for untimed play.

## What is the elapsed clock in the facilitator console?

It is the total time since **Start production**. It is separate from student round timers and
never advances a round.

## Can I reuse all these settings for another class?

Yes, within 12 hours of creating the original session. Choose **Reuse a previous facilitator
setup**, then enter the old join code and facilitator recovery code. Models, economics, scoring
rounds, timer blocks, and the exact resource schedule are copied. Enter new notes for the new
class.

## Do students see the WIP penalty before the reveal?

No. During play, student views hide WIP rates, monetary exposure, projected scores, and
facilitator notes. Other students' identifiers are never shared with players. The live standings
rank revenue; the finished player report reveals final penalty and score, but not notes or cohort
identifiers.

## Which export should I use?

Use **Excel workbook**. Its **Game Details** sheet records the resource plan, scoring rounds,
timer, economics, notes, and exact resource schedule. It also includes class statistics and one
detailed sheet per player.
