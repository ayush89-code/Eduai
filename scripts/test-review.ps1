# Step 7a smoke test: reviewing generated questions (edit / approve / reject / bulk). Self-contained.
# Run from the project root with the stack up:
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-review.ps1
# Registers throwaway users, uploads a small English text, generates questions, then exercises the
# review endpoints of the Spring Boot backend. Needs the whole stack up (backend 8080 + AI service 8000).
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
$txt = Join-Path $tmpDir "eduai-rev-$stamp.txt"
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


# ---- generate a batch of DRAFT questions ----
Write-Host "Generating $Count questions..."
$start = Call POST "$ai/api/generate/jobs" @{ source_id = $id; count = $Count } $teacher
Check "job accepted (202)" $start.code 202
$job = Wait-Generation $start.body.id $teacher 600
Check "job finished DONE" $job.body.status "DONE"
$jobId = $start.body.id

# ---- access rules ----
$list = "$api/api/teacher/questions?sourceId=$id"
Check "list without login -> 401" (Call GET $list).code 401
Check "student -> 403" (Call GET $list $null $student).code 403
Check "other teacher -> 404" (Call GET $list $null $other).code 404
Check "bad status filter -> 422" (Call GET "$list&status=NOPE" $null $teacher).code 422

# ---- list ----
$r = Call GET "$list&status=DRAFT" $null $teacher
Check "list drafts (200)" $r.code 200
$qs = @($r.body)
$minimum = [Math]::Ceiling($Count * 0.8)
Check "at least $minimum drafts listed" ([bool]($qs.Count -ge $minimum)) $true
Check "all listed are DRAFT" (@($qs | Where-Object { $_.status -ne "DRAFT" }).Count) 0
$mcq = $qs | Where-Object { $_.type -eq "MCQ" } | Select-Object -First 1
$tf  = $qs | Where-Object { $_.type -eq "TRUE_FALSE" } | Select-Object -First 1
$mt  = $qs | Where-Object { $_.type -eq "MATCH" } | Select-Object -First 1
$sa  = $qs | Where-Object { $_.type -eq "SHORT_ANSWER" } | Select-Object -First 1
Check "type filter works" (@((Call GET "$list&type=MCQ" $null $teacher).body | Where-Object { $_.type -ne "MCQ" }).Count) 0

# ---- edit: MCQ ----
$u = "$api/api/teacher/questions/$($mcq.id)"
$e = Call PUT $u @{ questionText = "Edited: which sentence is correct?"; marks = 3; difficulty = "HARD" } $teacher
Check "edit text / marks / difficulty (200)" $e.code 200
Check "text saved" $e.body.questionText "Edited: which sentence is correct?"
Check "marks saved" ([decimal]$e.body.marks) ([decimal]3)
Check "difficulty saved" $e.body.difficulty "HARD"
$opts = @($mcq.options | ForEach-Object { @{ text = $_.text; correct = $false } })
$opts[1].correct = $true
$e = Call PUT $u @{ options = $opts } $teacher
Check "change the correct option (200)" $e.code 200
Check "exactly one correct option" (@($e.body.options | Where-Object { $_.correct }).Count) 1
Check "answer follows the correct option" $e.body.correctAnswer $opts[1].text
$two = @($opts | ForEach-Object { @{ text = $_.text; correct = $true } })
Check "two correct options -> 422" (Call PUT $u @{ options = $two } $teacher).code 422
$none = @($opts | ForEach-Object { @{ text = $_.text; correct = $false } })
Check "no correct option -> 422" (Call PUT $u @{ options = $none } $teacher).code 422
Check "marks 0 -> 422" (Call PUT $u @{ marks = 0 } $teacher).code 422
Check "bad difficulty -> 422" (Call PUT $u @{ difficulty = "WRONG" } $teacher).code 422
Check "other teacher cannot edit (404)" (Call PUT $u @{ marks = 2 } $other).code 404

# ---- edit: other types ----
$tfu = "$api/api/teacher/questions/$($tf.id)"
Check "true/false answer 'maybe' -> 422" (Call PUT $tfu @{ correctAnswer = "maybe" } $teacher).code 422
$e = Call PUT $tfu @{ correctAnswer = "FALSE" } $teacher
Check "true/false answer saved as 'false'" $e.body.correctAnswer "false"
$mtu = "$api/api/teacher/questions/$($mt.id)"
Check "match: options not allowed -> 422" (Call PUT $mtu @{ options = @(@{ text = "a"; correct = $true }, @{ text = "b"; correct = $false }) } $teacher).code 422
Check "match: answer key not editable -> 422" (Call PUT $mtu @{ correctAnswer = "1-A" } $teacher).code 422
Check "match: wording editable (200)" (Call PUT $mtu @{ questionText = "Match the tenses with their uses." } $teacher).code 200
if ($sa) {
    $e = Call PUT "$api/api/teacher/questions/$($sa.id)" @{ correctAnswer = "A model answer written by the teacher." } $teacher
    Check "short answer: answer edited" $e.body.correctAnswer "A model answer written by the teacher."
}

# ---- approve / reject ----
$a = Call POST "$u/approve" $null $teacher
Check "approve (200)" $a.code 200
Check "status APPROVED" $a.body.status "APPROVED"
Check "other teacher cannot approve (404)" (Call POST "$tfu/approve" $null $other).code 404
$rj = Call POST "$u/reject" $null $teacher
Check "reject an approved question" $rj.body.status "REJECTED"
Check "approve again after reject" (Call POST "$u/approve" $null $teacher).body.status "APPROVED"

# ---- bulk ----
$left = @((Call GET "$list&status=DRAFT" $null $teacher).body)
$ids = @($left | ForEach-Object { $_.id })
Check "bulk bad action -> 422" (Call POST "$api/api/teacher/questions/bulk" @{ action = "DELETE"; ids = $ids } $teacher).code 422
$b = Call POST "$api/api/teacher/questions/bulk" @{ action = "APPROVE"; ids = $ids } $teacher
Check "bulk approve (200)" $b.code 200
$skipped = @($b.body.skipped | Where-Object { $_ })
Check "every draft approved or skipped with a reason" ([bool](($b.body.changed + $skipped.Count) -eq $ids.Count)) $true
Write-Host "  bulk: $($b.body.changed) approved, $($skipped.Count) skipped"
$b2 = Call POST "$api/api/teacher/questions/bulk" @{ action = "APPROVE"; ids = $ids } $other
Check "other teacher bulk: nothing changed" $b2.body.changed 0
Check "no drafts left except skipped" (@((Call GET "$list&status=DRAFT" $null $teacher).body).Count) $skipped.Count

Remove-Item $txt -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "Note: the test source keeps its reviewed questions (a source with questions cannot be deleted)." -ForegroundColor DarkGray
if ($script:failed -eq 0) { Write-Host "All checks passed." -ForegroundColor Green }
else { Write-Host "$script:failed check(s) failed." -ForegroundColor Red; exit 1 }
