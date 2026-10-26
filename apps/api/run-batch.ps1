# One-shot batch runner: POST /run for a task and write the JSON result to a file.
# Pure ASCII only (PS 5.1 misreads UTF-8 no-BOM with non-ASCII bytes).
param([string]$TaskId = "tsk_mvp6muahpvppyg")
$body = '{"generator":"openrouter"}'
try {
  $r = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/tasks/$TaskId/run" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 2400
  $r | ConvertTo-Json -Depth 8 | Out-File -Encoding ascii "$PSScriptRoot\batch-result.json"
} catch {
  @{ error = $_.Exception.Message } | ConvertTo-Json | Out-File -Encoding ascii "$PSScriptRoot\batch-result.json"
}
