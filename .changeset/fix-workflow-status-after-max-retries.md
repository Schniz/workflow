---
"@workflow/core": patch
---

Fix workflow run not marked as failed when step exhausts max retries

When a step fails after max retries, the workflow run is now properly marked as 'failed' instead of staying in 'running' state. This prevents workflows from getting stuck when a step cannot recover.
