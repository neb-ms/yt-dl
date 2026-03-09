# Step Report Template

Use this template for every step report listed in `PLAN.md`.

## Report Metadata
- Step ID:
- Step Name:
- Report Date (YYYY-MM-DD):
- Agent:
- Branch:
- Commit SHA (optional):

## Status Gate
- [ ] Step implementation complete
- [ ] Verification complete and passing
- [ ] Report saved to `/reports/` with required step filename

## Scope Completed
- Summary of what was implemented in this step.
- Note any intentionally deferred items.

## Files Changed
- Added:
  - `path/to/file`
- Modified:
  - `path/to/file`
- Deleted:
  - `path/to/file`

## Verification Performed
List each verification check you ran.

1. Check name
- Command(s):
```bash
# command here
```
- Expected result:
- Actual result:

2. Check name
- Command(s):
```bash
# command here
```
- Expected result:
- Actual result:

## Verification Results
- Overall status: PASS | FAIL
- Evidence summary (key logs, outputs, screenshots, or file artifacts):
- If FAIL, include root cause and fix status:

## Known Issues / Follow-ups
- Issue:
- Impact:
- Suggested next action:

## Handoff Notes for Future Agents
- Assumptions made:
- Open decisions:
- Recommended first action for next step:
