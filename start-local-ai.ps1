$ErrorActionPreference = 'Stop'
$taskEnvFile = Join-Path $PSScriptRoot '.env'
if (-not (Select-String -LiteralPath $taskEnvFile -Pattern '^AI_PROVIDER=ollama\s*$' -Quiet)) { exit 0 }
$taskAiRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\local-ai'))
$taskOllama = Join-Path $taskAiRoot 'runtime\ollama.exe'
if (-not (Test-Path -LiteralPath $taskOllama)) { throw 'Local AI runtime is missing.' }
$env:OLLAMA_HOST = '127.0.0.1:11434'
$env:OLLAMA_MODELS = Join-Path $taskAiRoot 'models'
$env:OLLAMA_CONTEXT_LENGTH = '8192'
$env:OLLAMA_NUM_PARALLEL = '1'
$env:OLLAMA_FLASH_ATTENTION = '1'
$env:OLLAMA_KV_CACHE_TYPE = 'q8_0'
$env:OLLAMA_NO_CLOUD = '1'
function Test-LocalAI {
    try { return (Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2) } catch { return $null }
}
$taskTags = Test-LocalAI
if (-not $taskTags) {
    Start-Process -FilePath $taskOllama -ArgumentList 'serve' -WindowStyle Hidden -WorkingDirectory $taskAiRoot -RedirectStandardOutput (Join-Path $taskAiRoot 'server.out.log') -RedirectStandardError (Join-Path $taskAiRoot 'server.err.log')
    for ($taskAttempt = 0; $taskAttempt -lt 45; $taskAttempt++) {
        Start-Sleep -Seconds 1
        $taskTags = Test-LocalAI
        if ($taskTags) { break }
    }
}
if (-not $taskTags) { throw 'Local AI could not start. Check local-ai/server.err.log.' }
$taskModelLine = (Select-String -LiteralPath $taskEnvFile -Pattern '^OLLAMA_MODEL=').Line
$taskModel = if ($taskModelLine) { ($taskModelLine -split '=',2)[1].Trim() } else { 'qwen3:4b-instruct' }
if (-not ($taskTags.models | Where-Object { $_.name -eq $taskModel })) { throw "Model is missing: $taskModel" }
Write-Host "Local AI ready: $taskModel (no OpenAI API calls)"
