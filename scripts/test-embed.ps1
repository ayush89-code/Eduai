# Step 5 smoke test (self-contained - no source id or token needed).
# Run from the project root with the stack up:
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-embed.ps1
# Registers throwaway users, uploads a small text file, then checks automatic indexing,
# search, login rules and teacher-only ownership. First run downloads the ~90 MB embedding model.
param(
    [string]$Password = "Eduai@Test123",
    [string]$Query = "what generates lift on a wing"
)
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

function Wait-Indexed($id, $token, $timeoutSec) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    do {
        $r = Call GET "$ai/api/rag/status/$id" $null $token
        if ($r.body.status -eq "indexed" -or $r.body.status -eq "failed") { return $r }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    return $r
}

function Check($name, $got, $want) {
    if ($got -eq $want) { Write-Host "PASS  $name" -ForegroundColor Green }
    else { Write-Host "FAIL  $name (got $got, want $want)" -ForegroundColor Red; $script:failed++ }
}

function Register($role) {
    $email = "$($role.ToLower())$stamp$([guid]::NewGuid().ToString('N').Substring(0,4))@test.com"
    $r = Call POST "$api/api/auth/register" @{ email = $email; password = $Password; fullName = "Test $role"; role = $role }
    return $r.body.token
}

# ---- sample study material (several paragraphs so it splits into a few chunks) ----
$text = @"
Lift is the upward force that keeps an aircraft in the air. It is produced when air flows over and under the wing: the curved upper surface speeds the air up, the pressure above the wing drops, and the higher pressure below pushes the wing upward. The angle of attack, the wing area and the speed of the air all change how much lift is generated, and lift grows with the square of airspeed.

Drag is the force that resists the motion of the aircraft through the air. Parasite drag comes from the shape and skin of the aircraft, while induced drag is a side effect of producing lift. Streamlined bodies, smooth surfaces and retractable landing gear all reduce drag, which saves fuel and raises the maximum speed of the aircraft.

Thrust is the forward force produced by the engines. Propellers and jet engines both work by accelerating a mass of air backwards, so that by Newton's third law the aircraft is pushed forwards. In steady level flight thrust balances drag, and to climb or accelerate the pilot adds more thrust than drag.

Weight is the force of gravity acting on the aircraft and everything inside it, including fuel, passengers and cargo. Weight always acts towards the centre of the Earth, and in steady level flight lift must equal weight. As fuel is burned the weight decreases, so less lift is needed and the aircraft can fly more efficiently.

Stability and control describe how an aircraft responds to disturbances. The tail surfaces keep the nose pointing into the airflow, the ailerons roll the aircraft, the elevator pitches it up and down, and the rudder yaws it left and right. A well designed aircraft returns to level flight by itself after a small gust of wind.
"@
$txt = Join-Path $tmpDir "eduai-embed-$stamp.txt"
[System.IO.File]::WriteAllText($txt, $text)

Write-Host "Registering users..."
$teacher = Register "TEACHER"
$other   = Register "TEACHER"
$student = Register "STUDENT"
if (-not $teacher -or -not $other -or -not $student) {
    Write-Host "Registration failed. If your password rule differs, run with -Password <the one used in test-auth.ps1>" -ForegroundColor Red
    exit 2
}

# ---- ingest ----
$up = Upload $txt $teacher
Check "upload accepted (202)" $up.code 202
$id = $up.body.sourceId
$src = Wait-Source $id $teacher 60
Check "ingestion READY" $src.body.status "READY"

# ---- automatic indexing ----
Write-Host "Waiting for automatic indexing (first run downloads the embedding model)..."
$idx = Wait-Indexed $id $teacher 420
Check "indexed automatically" $idx.body.status "indexed"
Check "chunks stored (> 0)" ($idx.body.chunk_count -gt 0) $true
$chunks = $idx.body.chunk_count

# ---- search ----
$s = Call POST "$ai/api/rag/search" @{ query = $Query; source_id = $id; top_k = 3 } $teacher
Check "search returns 200" $s.code 200
$hits = @()
if ($s.code -eq 200 -and $s.body) { $hits = @($s.body) }
Check "search returns hits" ($hits.Count -gt 0) $true
if ($hits.Count -gt 0) {
    Check "top hit is about lift" ([bool]($hits[0].content -match "(?i)lift")) $true
    Check "hit carries a citation" ([bool]$hits[0].citation_ref) $true
    Write-Host ("  top hit [{0:N3}] {1}" -f $hits[0].score, $hits[0].content.Substring(0, [Math]::Min(80, $hits[0].content.Length)))
}

# ---- access rules ----
Check "search without login -> 401" (Call POST "$ai/api/rag/search" @{ query = $Query; source_id = $id }).code 401
Check "student -> 403" (Call GET "$ai/api/rag/status/$id" $null $student).code 403
Check "other teacher status -> 404" (Call GET "$ai/api/rag/status/$id" $null $other).code 404
Check "other teacher search -> 404" (Call POST "$ai/api/rag/search" @{ query = $Query; source_id = $id } $other).code 404

# ---- re-index must not duplicate chunks ----
$re = Call POST "$ai/api/rag/embed" @{ source_id = $id; force = $true } $teacher
Check "re-index accepted (202)" $re.code 202
$idx2 = Wait-Indexed $id $teacher 120
Check "re-index finishes" $idx2.body.status "indexed"
Check "re-index keeps same chunk count" $idx2.body.chunk_count $chunks

# ---- cleanup ----
Check "cleanup: delete source (204)" (Call DELETE "$ai/api/ingest/sources/$id" $null $teacher).code 204
Remove-Item $txt -ErrorAction SilentlyContinue

Write-Host ""
if ($script:failed -eq 0) { Write-Host "All checks passed." -ForegroundColor Green }
else { Write-Host "$script:failed check(s) failed." -ForegroundColor Red; exit 1 }