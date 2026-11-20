# Browser workflow

- Observe before editing: `browser_status`, `browser_console`, `browser_network`, `browser_snapshot`.
- One hypothesis per iteration; record the evidence next to the change.
- After a fix: `browser_reload`, repeat the same action, then snapshot/console to verify.
- Do not claim "fixed" without a fresh artifact that proves it.
- Do not use `browser_eval` when a snapshot is enough; eval requires explicit user approval.
- Write lessons to `MEMORY.md`; never store passwords, cookies, or tokens there.
- Stop and ask on `POLICY_DENIED`, or after two consecutive tool failures.
