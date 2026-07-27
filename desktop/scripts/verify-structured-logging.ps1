$ErrorActionPreference = "Stop"

$desktopSource = Join-Path $PSScriptRoot "..\src"
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$requiredBackendFiles = @(
    "backend\services\queue_service.py",
    "backend\services\processing_service.py",
    "backend\services\knowledge_service.py"
)
$requiredRagFiles = @(
    "backend\services\pipeline_logger.py",
    "backend\services\rag_service.py",
    "backend\services\planner\planner_executor.py",
    "backend\services\planner\retrieval_planner.py",
    "backend\services\agent\retrieval_agent.py",
    "backend\services\hybrid_service.py",
    "backend\services\query_rewrite_service.py"
)
$requiredGenerationFiles = @(
    "backend\services\generation_trace.py",
    "backend\services\llm_service.py",
    "backend\services\ai_cost_service.py",
    "backend\services\provider_billing_service.py"
)

$rawDesktopConsole = Get-ChildItem -LiteralPath $desktopSource -Filter "*.ts" -Recurse |
    Select-String -Pattern "console\.(log|warn|error)\("
if ($rawDesktopConsole) {
    $locations = ($rawDesktopConsole | ForEach-Object { "$($_.Path):$($_.LineNumber)" }) -join ", "
    throw "Raw Electron console calls bypass structured logging: $locations"
}

foreach ($relativePath in $requiredBackendFiles) {
    $filePath = Join-Path $projectRoot $relativePath
    $content = Get-Content -LiteralPath $filePath -Raw
    if ($content -notmatch "get_logger" -or $content -notmatch "event\s*=") {
        throw "Critical backend pipeline lacks structured logging: $relativePath"
    }
}

foreach ($relativePath in $requiredRagFiles) {
    $filePath = Join-Path $projectRoot $relativePath
    $content = Get-Content -LiteralPath $filePath -Raw
    if ($content -notmatch "RagPipelineTrace|get_current_rag_trace|trace_rag_pipeline") {
        throw "RAG component lacks correlated structured tracing: $relativePath"
    }
}

$ragService = Get-Content -LiteralPath (Join-Path $projectRoot "backend\services\rag_service.py") -Raw
$requiredRagPhases = @(
    "semantic_cache_lookup",
    "retrieval_orchestration",
    "answer_generation",
    "citation_enforcement",
    "source_extraction",
    "hallucination_verification",
    "confidence_scoring",
    "semantic_cache_write"
)
foreach ($phase in $requiredRagPhases) {
    if ($ragService -notmatch [regex]::Escape($phase)) {
        throw "Required RAG trace phase is missing: $phase"
    }
}

foreach ($relativePath in $requiredGenerationFiles) {
    $filePath = Join-Path $projectRoot $relativePath
    $content = Get-Content -LiteralPath $filePath -Raw
    if ($content -notmatch "generation|provider") {
        throw "Generation component lacks structured tracing: $relativePath"
    }
}

$generationTrace = Get-Content -LiteralPath (Join-Path $projectRoot "backend\services\generation_trace.py") -Raw
$llmService = Get-Content -LiteralPath (Join-Path $projectRoot "backend\services\llm_service.py") -Raw
$costService = Get-Content -LiteralPath (Join-Path $projectRoot "backend\services\ai_cost_service.py") -Raw
$mainService = Get-Content -LiteralPath (Join-Path $projectRoot "backend\main.py") -Raw
foreach ($requiredEvent in @(
    "generation.run_started",
    "generation.run_completed",
    "generation.run_failed",
    "generation.run_stopped",
    "generation.phase_started",
    "generation.phase_completed"
)) {
    if ($generationTrace -notmatch [regex]::Escape($requiredEvent)) {
        throw "Required generation trace event is missing: $requiredEvent"
    }
}
foreach ($requiredPhase in @("provider_configuration", "provider_request", "response_parsing", "usage_accounting")) {
    if ($llmService -notmatch [regex]::Escape($requiredPhase)) {
        throw "Required generation phase is missing: $requiredPhase"
    }
}
foreach ($requiredEvent in @("provider.usage_settled", "provider.usage_pending")) {
    if ($costService -notmatch [regex]::Escape($requiredEvent)) {
        throw "Required provider settlement event is missing: $requiredEvent"
    }
}
$providerBilling = Get-Content -LiteralPath (Join-Path $projectRoot "backend\services\provider_billing_service.py") -Raw
foreach ($requiredEvent in @(
    "provider.billing_reported",
    "provider.billing_pending",
    "provider.billing_unavailable"
)) {
    if ($providerBilling -notmatch [regex]::Escape($requiredEvent)) {
        throw "Required non-chat provider billing event is missing: $requiredEvent"
    }
}
if ($mainService -notmatch "api\.request_started" -or $mainService -notmatch "generation\.persistence_completed") {
    throw "API start or generation persistence tracing is missing."
}

$systemConsole = Get-Content -LiteralPath (Join-Path $projectRoot "frontend\src\components\SystemConsole.tsx") -Raw
foreach ($metric in @("averageRagLatencyMs", "ragFailureRate", "retainedProviderCostUsd", "dailyCosts")) {
    if ($systemConsole -notmatch [regex]::Escape($metric)) {
        throw "System Console performance aggregation is missing: $metric"
    }
}

$rendererLogger = Join-Path $projectRoot "frontend\src\utils\systemLogger.ts"
$rendererEntry = Join-Path $projectRoot "frontend\src\main.tsx"
if ((Get-Content -LiteralPath $rendererLogger -Raw) -notmatch "renderer\.uncaught_error") {
    throw "Renderer error capture is missing."
}
if ((Get-Content -LiteralPath $rendererEntry -Raw) -notmatch "installRendererDiagnostics") {
    throw "Renderer diagnostics are not installed at startup."
}

Write-Host "Structured logging verification passed."
