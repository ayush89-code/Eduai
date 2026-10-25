# Step 8a smoke test: students take an exam (start / autosave / submit / auto-scoring / teacher marking). Self-contained.
# Run from the project root with the stack up:
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-attempt.ps1
# Registers throwaway users, uploads a small English text, generates questions, then exercises the
# student + results endpoints of the Spring Boot backend. Needs the whole stack up (backend 8080 + AI service 8000).
# With no GEMINI_API_KEY / GROQ_API_KEY it runs in offline test mode (template questions), which is
# enough to test everything except the quality of the questions.
param(
    [int]$Count = 30,
    [string]$Password = "Eduai@Test123",
    [switch]$SkipTimeout
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
$txt = Join-Path $tmpDir "eduai-att-$stamp.txt"
[System.IO.File]::WriteAllText($txt, $text)

Write-Host "Registering users..."
$teacher = Register "TEACHER"
$other   = Register "TEACHER"
$student = Register "STUDENT"
$student2 = Register "STUDENT"
if (-not $teacher -or -not $other -or -not $student -or -not $student2) {
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


# ---- prepare: approved questions and a published exam ----
Write-Host "Generating $Count questions..."
$start = Call POST "$ai/api/generate/jobs" @{ source_id = $id; count = $Count } $teacher
Check "job accepted (202)" $start.code 202
Check "job finished DONE" (Wait-Generation $start.body.id $teacher 600).body.status "DONE"
$q = "$api/api/teacher/questions"
$ids = @((Call GET "$q`?sourceId=$id" $null $teacher).body | ForEach-Object { $_.id })
Call POST "$q/bulk" @{ action = "APPROVE"; ids = $ids } $teacher | Out-Null
$ex = "$api/api/teacher/exams"
$examId = (Call POST $ex @{ title = "Attempt test"; durationMinutes = 30; sourceId = $id } $teacher).body.exam.id
$e1 = "$ex/$examId"
$af = Call POST "$e1/auto-fill" @{ sourceId = $id; totalMarks = 25 } $teacher
$items = @($af.body.exam.items)
Check "paper built" ([bool]($items.Count -ge 5)) $true
$st = "$api/api/student"
Check "draft exam is invisible to students" (@((Call GET "$st/exams" $null $student).body | Where-Object { $_.id -eq $examId }).Count) 0
Check "student cannot start a draft exam (404)" (Call POST "$st/exams/$examId/start" $null $student).code 404

# ---- access rules ----
Check "student endpoints without login -> 401" (Call GET "$st/exams").code 401
Check "teacher on student endpoint -> 403" (Call GET "$st/exams" $null $teacher).code 403
Check "publish" (Call POST "$e1/publish" $null $teacher).body.exam.status "PUBLISHED"

# ---- student 1: list, start, leakage check ----
$list = (Call GET "$st/exams" $null $student).body
$mine = @($list | Where-Object { $_.id -eq $examId })
Check "published exam is listed" $mine.Count 1
Check "student can start it" $mine[0].canStart $true
$s = Call POST "$st/exams/$examId/start" $null $student
Check "start (200)" $s.code 200
$aid = $s.body.id
$a1 = "$st/attempts/$aid"
Check "all questions delivered" @($s.body.questions).Count $items.Count
Check "deadline is ahead" ([bool]([datetime]$s.body.deadline -gt [datetime]$s.body.serverNow)) $true
$leak = 0
foreach ($sq in @($s.body.questions)) {
    $names = @($sq.PSObject.Properties.Name)
    if ($names -contains "correctAnswer" -or $names -contains "explanation" -or $names -contains "payload") { $leak++ }
    foreach ($o in @($sq.options)) { if (@($o.PSObject.Properties.Name) -contains "correct") { $leak++ } }
}
Check "no answer key leaks to the student" $leak 0
Check "start again resumes the same attempt" (Call POST "$st/exams/$examId/start" $null $student).body.id $aid
Check "other student cannot read the attempt (404)" (Call GET $a1 $null $student2).code 404
Check "teacher cannot use the student attempt endpoint (403)" (Call GET $a1 $null $teacher).code 403
Check "exam with an attempt cannot be unpublished (409)" (Call POST "$e1/unpublish" $null $teacher).code 409

# ---- student 1 answers everything correctly (key taken from the teacher's view) ----
$expectAuto = [decimal]0
$expectPending = 0
foreach ($it in $items) {
    $qq = $it.question
    $body = $null
    switch ($qq.type) {
        "MCQ"        { $pos = @($qq.options | Where-Object { $_.correct })[0].position; $body = @{ optionPosition = $pos }; $expectAuto += [decimal]$it.marks }
        "TRUE_FALSE" { $body = @{ text = $qq.correctAnswer }; $expectAuto += [decimal]$it.marks }
        "FILL_BLANK" { $body = @{ text = $qq.correctAnswer }; $expectAuto += [decimal]$it.marks }
        "MATCH"      { $body = @{ text = ($qq.payload.answer_key | ConvertTo-Json -Compress) }; $expectAuto += [decimal]$it.marks }
        default      { $body = @{ text = "A written answer by the student." }; $expectPending++ }
    }
    $r = Call PUT "$a1/answers/$($qq.id)" $body $student
    if ($r.code -ne 200) { Write-Host "  save failed for $($qq.type): $($r.code)" -ForegroundColor Red; $script:failed++ }
}
Check "autosave works for every question" $script:failed 0
$re = (Call GET $a1 $null $student).body
Check "saved answers survive a reload" @($re.answers.PSObject.Properties).Count $items.Count
Check "question outside the exam is rejected (404)" (Call PUT "$a1/answers/$([guid]::NewGuid())" @{ text = "x" } $student).code 404
Check "other student cannot save into it (404)" (Call PUT "$a1/answers/$($items[0].question.id)" @{ text = "x" } $student2).code 404

# ---- submit + auto-scoring ----
$sub = Call POST "$a1/submit" $null $student
Check "submit (200)" $sub.code 200
Check "status SUBMITTED" $sub.body.status "SUBMITTED"
Write-Host ("  auto score {0} (expected {1}), waiting for teacher: {2}" -f $sub.body.result.score, $expectAuto, $sub.body.result.pendingMarking)
Check "objective answers scored correctly" ([decimal]$sub.body.result.score) $expectAuto
Check "written answers wait for the teacher" $sub.body.result.pendingMarking $expectPending
Check "answers are hidden while the exam is open" @($sub.body.result.items).Count 0
Check "submit twice changes nothing" ([decimal](Call POST "$a1/submit" $null $student).body.result.score) $expectAuto
Check "cannot save after submitting (409)" (Call PUT "$a1/answers/$($items[0].question.id)" @{ text = "late" } $student).code 409
Check "cannot start a second attempt (409)" (Call POST "$st/exams/$examId/start" $null $student).code 409
Check "list shows the finished attempt" (@((Call GET "$st/exams" $null $student).body | Where-Object { $_.id -eq $examId })[0].attempt.status) "SUBMITTED"

# ---- student 2 hands in an empty paper ----
$s2 = Call POST "$st/exams/$examId/start" $null $student2
$sub2 = Call POST "$st/attempts/$($s2.body.id)/submit" $null $student2
Check "empty attempt scores 0" ([decimal]$sub2.body.result.score) ([decimal]0)

# ---- teacher: results and marking ----
$res = Call GET "$e1/attempts" $null $teacher
Check "teacher sees both attempts" @($res.body.attempts).Count 2
Check "other teacher cannot see results (404)" (Call GET "$e1/attempts" $null $other).code 404
Check "student cannot see results (403)" (Call GET "$e1/attempts" $null $student).code 403
$row = @($res.body.attempts | Where-Object { $_.id -eq $aid })[0]
Check "results row has the student name" ([bool]$row.studentName) $true
$t1 = "$api/api/teacher/attempts/$aid"
$d = Call GET $t1 $null $teacher
Check "attempt detail lists every question" @($d.body.items).Count $items.Count
Check "other teacher cannot open the attempt (404)" (Call GET $t1 $null $other).code 404
$await = @($d.body.items | Where-Object { $_.grading -eq "AWAITING" })
Check "written answers are awaiting" $await.Count $expectPending
if ($await.Count -gt 0) {
    $w = $await[0]
    $mk = "$t1/answers/$($w.questionId)/marks"
    Check "marks above the maximum -> 422" (Call PUT $mk @{ marks = ([decimal]$w.marks + 1); feedback = "x" } $teacher).code 422
    Check "other teacher cannot mark (404)" (Call PUT $mk @{ marks = 1 } $other).code 404
    $before = [decimal]$d.body.attempt.score
    $m = Call PUT $mk @{ marks = [decimal]$w.marks; feedback = "Well explained." } $teacher
    Check "teacher marks an answer (200)" $m.code 200
    Check "score goes up by the marks" ([decimal]$m.body.attempt.score) ($before + [decimal]$w.marks)
    Check "one less waiting" $m.body.attempt.pendingMarking ($expectPending - 1)
}
$auto = @($d.body.items | Where-Object { $_.grading -eq "AUTO" })[0]
Check "auto-scored answer cannot be re-marked (409)" (Call PUT "$t1/answers/$($auto.questionId)/marks" @{ marks = 0 } $teacher).code 409

# ---- results are released when the exam closes ----
Check "close the exam" (Call POST "$e1/close" $null $teacher).body.exam.status "CLOSED"
$fin = (Call GET $a1 $null $student).body
Check "student now sees the full result" @($fin.result.items).Count $items.Count
Check "student sees teacher feedback" ([bool](@($fin.result.items | Where-Object { $_.feedback -eq "Well explained." }).Count -ge ([int]($await.Count -gt 0)))) $true
Check "closed exam stays in the list for the student" (@((Call GET "$st/exams" $null $student).body | Where-Object { $_.id -eq $examId }).Count) 1

# ---- time limit: an attempt left open is submitted when time runs out ----
if (-not $SkipTimeout) {
    $e3 = (Call POST $ex @{ title = "One minute exam"; durationMinutes = 1; sourceId = $id } $teacher).body.exam.id
    Call POST "$ex/$e3/auto-fill" @{ sourceId = $id; totalMarks = 5 } $teacher | Out-Null
    Call POST "$ex/$e3/publish" $null $teacher | Out-Null
    $s3 = Call POST "$st/exams/$e3/start" $null $student2
    Check "1-minute exam started" $s3.code 200
    Write-Host "  waiting 75 seconds for the timer (use -SkipTimeout to skip)..."
    Start-Sleep -Seconds 75
    $late = Call GET "$st/attempts/$($s3.body.id)" $null $student2
    Check "attempt was submitted automatically" $late.body.status "SUBMITTED"
    Check "saving after the deadline is refused (409)" (Call PUT "$st/attempts/$($s3.body.id)/answers/$([guid]::NewGuid())" @{ text = "x" } $student2).code 409
}

Remove-Item $txt -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "Note: the test source keeps its questions and exams (a source with questions cannot be deleted)." -ForegroundColor DarkGray
if ($script:failed -eq 0) { Write-Host "All checks passed." -ForegroundColor Green }
else { Write-Host "$script:failed check(s) failed." -ForegroundColor Red; exit 1 }
