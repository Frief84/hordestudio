param([string]$OutputDirectory = 'N:\Horde Studio\app\scratch\world-model-screening-2026-10-26')
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$env:HORDE_BROWSER_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:HORDE_LIVE_MAX_REQUESTS = '1'
$env:HORDE_LIVE_REQUEST_TIMEOUT_MS = '150000'
$models = @(
    @('gemma4:31b-it-q4_K_M', 'gemma4'),
    @('gpt-oss:20b', 'gpt-oss'),
    @('ministral-3:14b', 'ministral-3'),
    @('jaahas/qwen3.5-uncensored:27b', 'qwen3.5'),
    @('mistral-small3.2:24b', 'mistral-small3.2'),
    @('qwen2.5:14b-instruct-q4_K_M', 'qwen2.5'),
    @('qwen3:30b', 'qwen3')
)
foreach ($entry in $models) {
    foreach ($case in @('T03', 'P42')) {
        $name = $entry[1] + '-' + $case
        $target = Join-Path $OutputDirectory ($name + '.json')
        if (Test-Path -LiteralPath $target) { continue }
        $env:HORDE_LIVE_MODEL = $entry[0]
        $env:HORDE_LIVE_CASE = $case
        $env:HORDE_LIVE_OUTPUT = $target
        Write-Output "SCREENING $name"
        node (Join-Path $PSScriptRoot 'world_linked_ollama_live_audit.js') 2>&1 |
            Tee-Object -FilePath (Join-Path $OutputDirectory ($name + '.log'))
    }
}
