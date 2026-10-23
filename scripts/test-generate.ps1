# Step 6 smoke test (self-contained - no source id or token needed).
# Run from the project root with the stack up:
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-generate.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-generate.ps1 -Count 30
# Registers throwaway users, uploads a small English text, waits for indexing, generates questions
# and checks the question types, citations, progress and access rules.
# With no GEMINI_API_KEY / GROQ_API_KEY it runs in offline test mode (template questions), which is
# enough to test everything except the quality of the questions.
param(
    [int]$Count = 10,
    [string]$Password = "Eduai@Test123"
)
$api = "http://localhost:8080"
$ai  = "http://localhost:8000"
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$tmpDir = [System.IO.Path]::GetTempPath()
$script:failed = 0

function Call($method, $url, $body = $null, $token = $null) {
    $p = @{ UseBasicParsing = $true; Method = $method; Uri = $url; Headers = @{} }
    if ($token) { $p.Headers["Authorization"] = "Bearer $token" }
    if ($body)  { $p.ContentType = "application/json"; $p.Body = ($body | ConvertTo-Json -Depth 5) }
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

function Wait-Generation($jobId, $token, $timeoutSec) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    $lastShown = -1
    do {
        $r = Call GET "$ai/api/generate/jobs/$jobId" $null $token
        if ($r.body.generated_count -ne $lastShown) {
            $lastShown = $r.body.generated_count
            Write-Host ("  progress: {0} of {1}" -f $r.body.generated_count, $r.body.requested_count)
        }
        if ($r.body.status -eq "DONE" -or $r.body.status -eq "FAILED") { return $r }
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

# ---- sample English study material ----
$text = @"
Tenses show when an action happens. The simple present tense describes habits and general truths, for example: The sun rises in the east. The present continuous tense describes an action happening now, for example: She is reading a book. The simple past tense describes a finished action, such as: They visited the museum yesterday.

The past perfect tense shows an action that was completed before another action in the past. For example: By the time we reached the station, the train had left. The future perfect tense shows an action that will be completed before a certain time in the future: She will have finished her homework by nine o'clock.

Articles are small words that come before nouns. The indefinite articles a and an refer to any member of a group: a book, an apple. The definite article the refers to something specific that both speaker and listener know: the book on the table. Use an before words that begin with a vowel sound.

Prepositions show the relationship between a noun and another word in the sentence. In is used for enclosed spaces and long periods: in the room, in 2020. On is used for surfaces and days: on the table, on Monday. At is used for exact points and times: at the door, at five o'clock.

A sentence is a group of words that expresses a complete thought. A simple sentence has one independent clause. A compound sentence joins two independent clauses with a conjunction such as and, but or or. A complex sentence has one independent clause and at least one dependent clause, for example: Although it was raining, we went for a walk.

Synonyms are words with similar meanings, such as big and large. Antonyms are words with opposite meanings, such as hot and cold. Building vocabulary helps students read faster, write more clearly and understand difficult passages without a dictionary.

Reading comprehension means understanding a passage and answering questions about it. Good readers look for the main idea, notice supporting details, and make inferences from clues in the text. They also check the meaning of unfamiliar words from the surrounding sentences.
"@
$txt = Join-Path $tmpDir "eduai-gen-$stamp.txt"
[System.IO.File]::WriteAllText($txt, $text)

Write-Host "Registering users..."
$teacher = Register "TEACHER"
$other   = Register "TEACHER"
$student = Register "STUDENT"
if (-not $teacher -or -not $other -or -not $student) {
    Write-Host "Registration failed. If your password rule differs, run with -Password <the one used in test-auth.ps1>" -ForegroundColor Red
    exit 2
}

# ---- ingest + index ----
$up = Upload $txt $teacher
Check "upload accepted (202)" $up.code 202
$id = $up.body.sourceId
Check "ingestion READY" (Wait-Source $id $teacher 60).body.status "READY"
Write-Host "Waiting for indexing (first run downloads the embedding model)..."
Check "indexed" (Wait-Indexed $id $teacher 420).body.status "indexed"

# ---- access rules ----
$req = @{ source_id = $id; count = $Count }
Check "start without login -> 401" (Call POST "$ai/api/generate/jobs" $req).code 401
Check "student -> 403" (Call POST "$ai/api/generate/jobs" $req $student).code 403
Check "other teacher -> 404" (Call POST "$ai/api/generate/jobs" $req $other).code 404
Check "unknown question type -> 422" (Call POST "$ai/api/generate/jobs" @{ source_id = $id; count = $Count; types = @("ESSAY") } $teacher).code 422

# ---- generate ----
Write-Host "Generating $Count questions..."
$start = Call POST "$ai/api/generate/jobs" $req $teacher
Check "job accepted (202)" $start.code 202
$jobId = $start.body.id
$job = Wait-Generation $jobId $teacher 600
Write-Host ("  mode: {0}  providers: {1}" -f $job.body.mode, ($job.body.provider_counts | ConvertTo-Json -Compress))
Check "job finished DONE" $job.body.status "DONE"
if ($job.body.error) { Write-Host "  note: $($job.body.error)" -ForegroundColor Yellow }
$minimum = [Math]::Ceiling($Count * 0.8)
Check "generated at least $minimum of $Count" ([bool]($job.body.generated_count -ge $minimum)) $true

# ---- the questions ----
$qr = Call GET "$ai/api/generate/jobs/$jobId/questions" $null $teacher
$qs = @()
if ($qr.code -eq 200 -and $qr.body) { $qs = @($qr.body) }
Check "questions returned" ([bool]($qs.Count -ge $minimum)) $true
$types = @($qs | ForEach-Object { $_.type } | Sort-Object -Unique)
Write-Host ("  types: " + (($qs | Group-Object type | ForEach-Object { "$($_.Name) $($_.Count)" }) -join ", "))
if ($Count -ge 10) { Check "all 7 question types present" $types.Count 7 }

$bad = 0
foreach ($q in $qs) {
    $ok = [bool]$q.citation_ref -and [bool]$q.citation_retrieved_at -and ($q.difficulty -in @("EASY", "MEDIUM", "HARD")) -and ($q.status -eq "DRAFT")
    if ($q.type -eq "MCQ")        { $ok = $ok -and (@($q.options).Count -eq 4) -and (@($q.options | Where-Object { $_.is_correct }).Count -eq 1) }
    if ($q.type -eq "TRUE_FALSE") { $ok = $ok -and ($q.correct_answer -in @("true", "false")) }
    if ($q.type -eq "FILL_BLANK") { $ok = $ok -and ($q.question_text -like "*_____*") -and [bool]$q.correct_answer }
    if ($q.type -eq "MATCH")      { $ok = $ok -and (@($q.payload.left).Count -ge 4) -and (@($q.payload.left).Count -eq @($q.payload.right).Count) }
    if ($q.type -eq "CASE_BASED") { $ok = $ok -and (@($q.payload.sub_questions).Count -ge 2) }
    if ($q.type -eq "LONG_ANSWER"){ $ok = $ok -and (@($q.payload.marking_points).Count -ge 2) }
    if (-not $ok) { $bad++ }
}
Check "every question is well-formed, cited and DRAFT" $bad 0

# ---- ownership of results ----
Check "other teacher cannot read the job" (Call GET "$ai/api/generate/jobs/$jobId" $null $other).code 404
Check "other teacher cannot read the questions" (Call GET "$ai/api/generate/jobs/$jobId/questions" $null $other).code 404
$list = Call GET "$ai/api/generate/sources/$id/jobs" $null $teacher
Check "source lists its jobs" ([bool](@($list.body).Count -ge 1)) $true

# ---- re-index guard, discard, then the source can be deleted again ----
Check "re-index blocked while questions exist (409)" (Call POST "$ai/api/rag/embed" @{ source_id = $id; force = $true } $teacher).code 409
Check "source cannot be deleted while questions exist (409)" (Call DELETE "$ai/api/ingest/sources/$id" $null $teacher).code 409
Check "other teacher cannot discard (404)" (Call DELETE "$ai/api/generate/jobs/$jobId" $null $other).code 404
Check "discard the questions (204)" (Call DELETE "$ai/api/generate/jobs/$jobId" $null $teacher).code 204
Check "discarded job is gone (404)" (Call GET "$ai/api/generate/jobs/$jobId" $null $teacher).code 404
Check "source can be deleted now (204)" (Call DELETE "$ai/api/ingest/sources/$id" $null $teacher).code 204

Remove-Item $txt -ErrorAction SilentlyContinue
Write-Host ""
if ($script:failed -eq 0) { Write-Host "All checks passed." -ForegroundColor Green }
else { Write-Host "$script:failed check(s) failed." -ForegroundColor Red; exit 1 }
