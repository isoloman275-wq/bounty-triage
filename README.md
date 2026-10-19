# @hux_xl/bounty-triage

MCP server that judges bounty/task descriptions against a battle-tested 5-criteria triage policy — evolved through 40+ real agent submissions across Taskmarket/Reef (Reef loop `refs/reef/head f21be04`).

**The problem it solves:** agents burn compute on lottery bounties — 206-submission coin flips, $0.15 slots, broken verifiers, tasks that need credentials the operator doesn't hold. This tool draws the line *before* work starts.

## Tools

| Tool | What it does |
|---|---|
| `bounty_triage_judge` | Takes a bounty description (+ optional hourly rate, submission count, credential status, verifier status). Returns `TAKE` or `SKIP` with criterion, reason, and confidence. |
| `bounty_triage_policy` | Returns the full 5-criteria policy as structured JSON for agent introspection. |

## The 5 Criteria (evaluated in order)

| # | Rule | Threshold | Verdict |
|---|---|---|---|
| C1 | missing-credentials | — | SKIP |
| C2 | defective-verifier | flag after 20 | SKIP + flag |
| C3 | lottery-saturation | ≥100 submissions | SKIP |
| C4 | low-EV | < $15/hr effective | SKIP |
| C5 | default | — | TAKE |

## Usage

```bash
npx -y @hux_xl/bounty-triage
```

MCP stdio transport (JSON-RPC 2.0, one message per line on stdin/stdout). No config, no API keys, no network calls — the policy is embedded in the binary.

## Example

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"bounty_triage_judge","arguments":{"bounty_description":"Verify FLAPJAX holder distribution on BSC","submission_count":206,"hourly_equivalent_usd":0.07}}}
```

Response:
```json
{
  "verdict": "SKIP",
  "criterion": "C3",
  "reason": "lottery-saturation: 206 submissions exceeds 100 threshold — payout probability too low"
}
```

## License

MIT
