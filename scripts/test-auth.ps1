# Step 4 ingestion smoke test. Run from the project root with the stack up:
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-ingest.ps1
# The web-search part runs only if a search API key is configured, and then costs 1 search credit.
$api = "http://localhost:8080"
$ai  = "http://localhost:8000"
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$tmpDir = [System.IO.Path]::GetTempPath()
$script:failed = 0

function Call($method, $url, $body = $null, $token = $null) {
    $p = @{ UseBasicParsing = $true; Method = $method; Uri = $url; Headers = @{} }
    if ($token) { $p.Headers["Authorization"] = "Bearer $token" }
    if ($body)  { $p.ContentType = "application/json"; $p.Body = ($body | ConvertTo-Json) }
    try {
        $r = Invoke-WebRequest @p
        $json = $null
        if ($r.Content) { try { $json = $r.Content | ConvertFrom-Json } catch {} }
        return @{ code = [int]$r.StatusCode; body = $json }
    } catch {
        if ($_.Exception.Response) { return @{ code = [int]$_.Exception.Response.StatusCode; body = $null } }
        Write-Host "Cannot reach $url - is the stack running?" -ForegroundColor Red
        exit 2
    }
}

# Multipart upload through curl.exe (ships with Windows 10+; Windows PowerShell 5.1 has no -Form).
function Upload($path, $token) {
    $out = [System.IO.Path]::GetTempFileName()
    $curlArgs = @("-s", "-o", $out, "-w", "%{http_code}", "-X", "POST", "-F", "file=@$path", "$ai/api/ingest/document")
    if ($token) { $curlArgs = @("-H", "Authorization: Bearer $token") + $curlArgs }
    $code = & curl.exe @curlArgs
    $body = $null
    try { $body = Get-Content $out -Raw | ConvertFrom-Json } catch {}
    Remove-Item $out -ErrorAction SilentlyContinue
    return @{ code = [int]$code; body = $body }
}

function Wait-Source($id, $token, $timeoutSec) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    do {
        $r = Call GET "$ai/api/ingest/sources/$id" $null $token
        if ($r.body.status -eq "READY" -or $r.body.status -eq "FAILED") { return $r }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    return $r
}

function Check($name, $got, $want) {
    if ($got -eq $want) { Write-Host "PASS  $name" -ForegroundColor Green }
    else { Write-Host "FAIL  $name (got $got, want $want)" -ForegroundColor Red; $script:failed++ }
}

$pw = "Passw0rd!123"
function Register($role) {
    $email = "$($role.ToLower())$stamp$([guid]::NewGuid().ToString('N').Substring(0,4))@test.com"
    $r = Call POST "$api/api/auth/register" @{ email = $email; password = $pw; fullName = "Test $role"; role = $role }
    return $r.body.token
}
$teacher = Register "TEACHER"
$other   = Register "TEACHER"
$student = Register "STUDENT"
if (-not $teacher) { Write-Host "Could not register a teacher - is the backend healthy?" -ForegroundColor Red; exit 2 }

# --- sample files ---
$txt = Join-Path $tmpDir "eduai-notes-$stamp.txt"
Set-Content -Path $txt -Encoding UTF8 -Value "Photosynthesis converts light energy into chemical energy stored in glucose. It happens in the chloroplasts of plant cells."
$exe = Join-Path $tmpDir "eduai-$stamp.exe"; Set-Content -Path $exe -Value "not really an exe"
$fakePdf = Join-Path $tmpDir "eduai-$stamp.pdf"; Set-Content -Path $fakePdf -Value "this is plain text, not a pdf"

# --- access control ---
Check "upload without token -> 401" (Upload $txt $null).code 401
Check "student upload -> 403" (Upload $txt $student).code 403

# --- file path ---
$r = Upload $txt $teacher
Check "txt upload -> 202" $r.code 202
$sid = $r.body.sourceId
$s = Wait-Source $sid $teacher 30
Check "txt processed -> READY" $s.body.status "READY"
Check "txt has 1 document" $s.body.documents 1
Check "txt has extracted text" ($s.body.chars -gt 50) $true
Check ".exe -> 415" (Upload $exe $teacher).code 415
Check "fake pdf -> 400" (Upload $fakePdf $teacher).code 400

# --- topic path: toggle OFF never goes ungrounded ---
$r = Call POST "$ai/api/ingest/topic" @{ topic = "Topic nobody searched $stamp"; useWebSearch = $false } $teacher
Check "toggle OFF, nothing saved -> 409" $r.code 409
$r = Call POST "$ai/api/ingest/topic" @{ topic = "ab" } $teacher
Check "topic too short -> 422" $r.code 422
$r = Call GET "$ai/api/ingest/usage" $null $teacher
Check "usage endpoint -> 200" $r.code 200
$configured = $r.body.configured
Write-Host "      search provider: $($r.body.provider), configured: $configured, used this month: $($r.body.searchesThisMonth)/$($r.body.monthlyCap)"

# --- ownership ---
Check "other teacher cannot read my source -> 404" (Call GET "$ai/api/ingest/sources/$sid" $null $other).code 404
$list = Call GET "$ai/api/ingest/sources" $null $other
Check "other teacher's list is empty" @($list.body).Count 0

# --- live web search (only if a key is configured; uses 1 credit) ---
if ($configured) {
    $topic = "Photosynthesis"
    $r = Call POST "$ai/api/ingest/topic" @{ topic = $topic; useWebSearch = $true } $teacher
    Check "topic search -> 202" $r.code 202
    $tid = $r.body.sourceId
    $t = Wait-Source $tid $teacher 90
    Check "topic processed -> READY" $t.body.status "READY"
    if ($t.body.status -ne "READY") { Write-Host "      reason: $($t.body.error)" -ForegroundColor Yellow }
    $d = Call GET "$ai/api/ingest/sources/$tid" $null $teacher
    Check "topic saved at least 1 web page" ($d.body.documents -ge 1) $true
    $allCited = $true
    foreach ($doc in $d.body.documentList) { if (-not ($doc.url -like "http*") -or -not $doc.retrievedAt) { $allCited = $false } }
    Check "every page has a URL + retrieval date (citation data)" $allCited $true
    $r = Call POST "$ai/api/ingest/topic" @{ topic = $topic.ToUpper(); useWebSearch = $false } $teacher
    Check "toggle OFF reuses saved topic -> 200" $r.code 200
    Check "reuse returns the same source" $r.body.sourceId $tid
    Call DELETE "$ai/api/ingest/sources/$tid" $null $teacher | Out-Null
} else {
    Write-Host "SKIP  live web search (no API key configured - add TAVILY_API_KEY to .env and restart)" -ForegroundColor Yellow
}

# --- delete ---
Check "delete own source -> 204" (Call DELETE "$ai/api/ingest/sources/$sid" $null $teacher).code 204
Check "deleted source -> 404" (Call GET "$ai/api/ingest/sources/$sid" $null $teacher).code 404

Remove-Item $txt, $exe, $fakePdf -ErrorAction SilentlyContinue
Write-Host ""
if ($script:failed -eq 0) { Write-Host "ALL CHECKS PASSED" -ForegroundColor Green }
else { Write-Host "$($script:failed) CHECK(S) FAILED" -ForegroundColor Red; exit 1 }
