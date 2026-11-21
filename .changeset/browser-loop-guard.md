---
"@kilocode/kilo-browser": patch
---

Stop the browser agent from looping on a failing tool call: an identical call that keeps failing now returns a loop-stop error immediately instead of blocking for the tool timeout on every repeated attempt. `browser_batch` now also respects each step's tool policy and counts failed steps toward the loop stop.
