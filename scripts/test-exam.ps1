# Step 7b smoke test: question papers (create / build / auto-fill / publish / lock). Self-contained.
# Run from the project root with the stack up:
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-exam.ps1
# Registers throwaway users, uploads a small English text, generates questions, then exercises the
# exam endpoints of the Spring Boot backend. Needs the whole stack up (backend 8080 + AI service 8000).
# With no GEMINI_API_KEY / GROQ_API_KEY it runs in offline test mode (template questions), which is
# enough to test everything except the quality of the questions.
param(
    [int]$Count = 30,
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
$txt = Join-Path $tmpDir "eduai-exam-$stamp.txt"
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


# ---- generate questions and approve most of them ----
Write-Host "Generating $Count questions..."
$start = Call POST "$ai/api/generate/jobs" @{ source_id = $id; count = $Count } $teacher
Check "job accepted (202)" $start.code 202
$job = Wait-Generation $start.body.id $teacher 600
Check "job finished DONE" $job.body.status "DONE"
$q = "$api/api/teacher/questions"
$all = @((Call GET "$q`?sourceId=$id" $null $teacher).body)
Check "enough questions to build papers" ([bool]($all.Count -ge 20)) $true
$keepDraft = @($all | Select-Object -Last 2)
$toApprove = @($all | Select-Object -First ($all.Count - 2) | ForEach-Object { $_.id })
$b = Call POST "$q/bulk" @{ action = "APPROVE"; ids = $toApprove } $teacher
Write-Host "  approved $($b.body.changed) of $($toApprove.Count)"
$approved = @((Call GET "$q`?sourceId=$id&status=APPROVED" $null $teacher).body)
Check "approved questions available" ([bool]($approved.Count -ge 10)) $true

# ---- access rules + banks ----
$ex = "$api/api/teacher/exams"
Check "exams without login -> 401" (Call GET $ex).code 401
Check "student -> 403" (Call GET $ex $null $student).code 403
$banks = Call GET "$q/banks" $null $teacher
Check "banks lists the source" (@($banks.body | Where-Object { $_.sourceId -eq $id }).Count) 1
Check "other teacher sees no banks" (@((Call GET "$q/banks" $null $other).body | Where-Object { $_.sourceId -eq $id }).Count) 0

# ---- create ----
$c = Call POST $ex @{ title = "English mock test"; durationMinutes = 45; sourceId = $id } $teacher
Check "create exam (201)" $c.code 201
$examId = $c.body.exam.id
Check "new exam is DRAFT" $c.body.exam.status "DRAFT"
$e1 = "$ex/$examId"
Check "other teacher cannot create on my source (404)" (Call POST $ex @{ title = "x"; durationMinutes = 30; sourceId = $id } $other).code 404
Check "duration 0 is rejected" ([bool]((Call POST $ex @{ title = "x"; durationMinutes = 0; sourceId = $id } $teacher).code -in 400, 422)) $true
Check "other teacher cannot read it (404)" (Call GET $e1 $null $other).code 404
Check "list contains the exam" (@((Call GET $ex $null $teacher).body | Where-Object { $_.id -eq $examId }).Count) 1
Check "other teacher's list is empty of it" (@((Call GET $ex $null $other).body | Where-Object { $_.id -eq $examId }).Count) 0

# ---- build the paper by hand ----
$pick = @($approved | Select-Object -First 3)
$items = @($pick | ForEach-Object { @{ questionId = $_.id; marks = 2 } })
$p = Call PUT "$e1/questions" @{ items = $items } $teacher
Check "save paper (200)" $p.code 200
Check "3 questions in the paper" $p.body.exam.questionCount 3
Check "total marks = 6" ([decimal]$p.body.exam.totalMarks) ([decimal]6)
Check "order is kept" $p.body.items[0].question.id $pick[0].id
$rev = @($pick[2], $pick[0], $pick[1] | ForEach-Object { @{ questionId = $_.id; marks = 1 } })
$p = Call PUT "$e1/questions" @{ items = $rev } $teacher
Check "re-order + new marks saved" $p.body.items[0].question.id $pick[2].id
Check "marks updated (total 3)" ([decimal]$p.body.exam.totalMarks) ([decimal]3)
Check "duplicate question -> 422" (Call PUT "$e1/questions" @{ items = @(@{ questionId = $pick[0].id; marks = 1 }, @{ questionId = $pick[0].id; marks = 1 }) } $teacher).code 422
Check "draft question -> 422" (Call PUT "$e1/questions" @{ items = @(@{ questionId = $keepDraft[0].id; marks = 1 }) } $teacher).code 422
Check "marks 0 is rejected" ([bool]((Call PUT "$e1/questions" @{ items = @(@{ questionId = $pick[0].id; marks = 0 }) } $teacher).code -in 400, 422)) $true
Check "other teacher cannot edit paper (404)" (Call PUT "$e1/questions" @{ items = @() } $other).code 404

# ---- questions in a paper are protected (7a rules) ----
Check "question in a paper cannot be edited (409)" (Call PUT "$q/$($pick[0].id)" @{ marks = 5 } $teacher).code 409
Check "question in a paper cannot be rejected (409)" (Call POST "$q/$($pick[0].id)/reject" $null $teacher).code 409

# ---- auto-fill (mock exam) ----
Check "auto-fill: percentages must add up (422)" (Call POST "$e1/auto-fill" @{ sourceId = $id; totalMarks = 20; easyPercent = 50; mediumPercent = 50; hardPercent = 50 } $teacher).code 422
Check "auto-fill: other teacher (404)" (Call POST "$e1/auto-fill" @{ sourceId = $id; totalMarks = 20 } $other).code 404
$af = Call POST "$e1/auto-fill" @{ sourceId = $id; totalMarks = 20 } $teacher
Check "auto-fill (200)" $af.code 200
$marks = [decimal]$af.body.exam.exam.totalMarks
Write-Host ("  built {0} marks from {1} questions" -f $marks, $af.body.exam.exam.questionCount)
Check "never more than the target marks" ([bool]($marks -le 20)) $true
Check "close to the target marks" ([bool]($marks -ge 15)) $true
$types = @($af.body.exam.items | ForEach-Object { $_.question.type } | Sort-Object -Unique)
Check "paper mixes several question types" ([bool]($types.Count -ge 3)) $true
Check "paper has only approved questions" (@($af.body.exam.items | Where-Object { $_.question.status -ne "APPROVED" }).Count) 0
$af2 = Call POST "$e1/auto-fill" @{ sourceId = $id; totalMarks = 10; types = @("MCQ", "TRUE_FALSE") } $teacher
Check "auto-fill with chosen types" (@($af2.body.exam.items | Where-Object { $_.question.type -notin @("MCQ", "TRUE_FALSE") }).Count) 0
# ---- deleting a draft exam frees its questions ----
$inE1 = @($af2.body.exam.items | ForEach-Object { $_.question.id })
$free = $approved | Where-Object { $_.id -notin $inE1 } | Select-Object -First 1
$e2 = (Call POST $ex @{ title = "To delete"; durationMinutes = 20; sourceId = $id } $teacher).body.exam.id
Call PUT "$ex/$e2/questions" @{ items = @(@{ questionId = $free.id; marks = 1 }) } $teacher | Out-Null
Check "question is locked while in a draft exam (409)" (Call PUT "$q/$($free.id)" @{ marks = 4 } $teacher).code 409
Check "delete draft exam (204)" (Call DELETE "$ex/$e2" $null $teacher).code 204
Check "deleted exam is gone (404)" (Call GET "$ex/$e2" $null $teacher).code 404
Check "question can be edited again (200)" (Call PUT "$q/$($free.id)" @{ marks = 4 } $teacher).code 200

$af3 = Call POST "$e1/auto-fill" @{ sourceId = $id; totalMarks = 500 } $teacher
Check "too-big target gives a warning, not an error" ([bool](@($af3.body.warnings).Count -ge 1)) $true

# ---- schedule + publish rules ----
$empty = (Call POST $ex @{ title = "Empty"; durationMinutes = 30; sourceId = $id } $teacher).body.exam.id
Check "publish an empty exam -> 422" (Call POST "$ex/$empty/publish" $null $teacher).code 422
$past = (Get-Date).AddDays(-1).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$before = (Get-Date).AddDays(-2).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
Check "end before start -> 422" (Call PUT $e1 @{ startsAt = $past; endsAt = $before } $teacher).code 422
Check "set a past end time (200)" (Call PUT $e1 @{ endsAt = $past } $teacher).code 200
Check "publish with end time in the past -> 422" (Call POST "$e1/publish" $null $teacher).code 422
Check "clear the schedule (200)" (Call PUT $e1 @{ clearSchedule = $true } $teacher).code 200
Check "other teacher cannot publish (404)" (Call POST "$e1/publish" $null $other).code 404
$pub = Call POST "$e1/publish" $null $teacher
Check "publish (200)" $pub.code 200
Check "status PUBLISHED" $pub.body.exam.status "PUBLISHED"
Check "published_at is set" ([bool]$pub.body.exam.publishedAt) $true

# ---- locked while published ----
Check "paper locked while published (409)" (Call PUT "$e1/questions" @{ items = @() } $teacher).code 409
Check "details locked while published (409)" (Call PUT $e1 @{ title = "New" } $teacher).code 409
Check "auto-fill locked while published (409)" (Call POST "$e1/auto-fill" @{ sourceId = $id; totalMarks = 10 } $teacher).code 409
Check "cannot delete a published exam (409)" (Call DELETE $e1 $null $teacher).code 409
Check "cannot publish twice (409)" (Call POST "$e1/publish" $null $teacher).code 409

# ---- unpublish / close ----
Check "unpublish (200)" (Call POST "$e1/unpublish" $null $teacher).body.exam.status "DRAFT"
Check "close a draft -> 409" (Call POST "$e1/close" $null $teacher).code 409
Check "publish again" (Call POST "$e1/publish" $null $teacher).body.exam.status "PUBLISHED"
Check "close (200)" (Call POST "$e1/close" $null $teacher).body.exam.status "CLOSED"
Check "closed exam cannot be unpublished (409)" (Call POST "$e1/unpublish" $null $teacher).code 409

Check "delete the empty draft (204)" (Call DELETE "$ex/$empty" $null $teacher).code 204

Remove-Item $txt -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "Note: the test source keeps its questions and a closed exam (a source with questions cannot be deleted)." -ForegroundColor DarkGray
if ($script:failed -eq 0) { Write-Host "All checks passed." -ForegroundColor Green }
else { Write-Host "$script:failed check(s) failed." -ForegroundColor Red; exit 1 }
