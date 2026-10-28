# Step 11 smoke test: exam analytics (teacher) and progress + recommendations (student). Self-contained.
# Run from the project root with the stack up:
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-analytics.ps1
# Registers throwaway users, uploads a small English text, generates questions, then exercises the
# proctoring endpoints of the Spring Boot backend. Needs the whole stack up (backend 8080 + AI service 8000).
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
$txt = Join-Path $tmpDir "eduai-pro-$stamp.txt"
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

# ---- prepare: approved questions, a published exam ----
Write-Host "Generating $Count questions..."
$start = Call POST "$ai/api/generate/jobs" @{ source_id = $id; count = $Count } $teacher
Check "job finished DONE" (Wait-Generation $start.body.id $teacher 600).body.status "DONE"
$q = "$api/api/teacher/questions"
$ids = @((Call GET "$q`?sourceId=$id" $null $teacher).body | ForEach-Object { $_.id })
Call POST "$q/bulk" @{ action = "APPROVE"; ids = $ids } $teacher | Out-Null
$ex = "$api/api/teacher/exams"
$examId = (Call POST $ex @{ title = "Analytics test"; durationMinutes = 30; sourceId = $id } $teacher).body.exam.id
$af = Call POST "$ex/$examId/auto-fill" @{ sourceId = $id; totalMarks = 25 } $teacher
$items = @($af.body.exam.items)
Check "paper built" ([bool]($items.Count -ge 5)) $true
Check "publish" (Call POST "$ex/$examId/publish" $null $teacher).body.exam.status "PUBLISHED"
$st = "$api/api/student"
$an = "$ex/$examId/analytics"

# ---- before anybody has finished ----
$empty = Call GET $an $null $teacher
Check "analytics 200 with no attempts" $empty.code 200
Check "no submissions yet" $empty.body.summary.submitted 0
Check "other teacher cannot read analytics (404)" (Call GET $an $null $other).code 404
Check "student cannot read teacher analytics (403)" (Call GET $an $null $student).code 403
Check "teacher cannot read student progress (403)" (Call GET "$st/progress" $null $teacher).code 403
Check "progress without login -> 401" (Call GET "$st/progress").code 401
Check "new student has no history" (Call GET "$st/progress" $null $student).body.examsTaken 0

# ---- student 1 answers every objective question correctly, student 2 hands in an empty paper ----
$s1 = Call POST "$st/exams/$examId/start" $null $student
$a1 = "$st/attempts/$($s1.body.id)"
$nObj = 0
foreach ($it in $items) {
    $qq = $it.question
    $body = $null
    switch ($qq.type) {
        "MCQ"        { $pos = @($qq.options | Where-Object { $_.correct })[0].position; $body = @{ optionPosition = $pos }; $nObj++ }
        "TRUE_FALSE" { $body = @{ text = $qq.correctAnswer }; $nObj++ }
        "FILL_BLANK" { $body = @{ text = $qq.correctAnswer }; $nObj++ }
        "MATCH"      { $body = @{ text = ($qq.payload.answer_key | ConvertTo-Json -Compress) }; $nObj++ }
        default      { $body = @{ text = "A written answer by the student." } }
    }
    Call PUT "$a1/answers/$($qq.id)" $body $student | Out-Null
}
Check "student 1 submits" (Call POST "$a1/submit" $null $student).code 200
$s2 = Call POST "$st/exams/$examId/start" $null $student2
Check "student 2 submits an empty paper" (Call POST "$st/attempts/$($s2.body.id)/submit" $null $student2).code 200

# ---- teacher analytics ----
$r = Call GET $an $null $teacher
$d = $r.body
Check "analytics 200" $r.code 200
Check "2 submitted" $d.summary.submitted 2
Check "histogram counts both students" (($d.histogram.bands | Measure-Object -Sum).Sum) 2
Check "10 score bands" @($d.histogram.bands).Count 10
Check "one student scored 0 -> lowest 0" ([double]$d.summary.lowestPercent) ([double]0)
Check "highest is above lowest" ([bool]([double]$d.summary.highestPercent -gt [double]$d.summary.lowestPercent)) $true
Check "every question is listed" @($d.questions).Count $items.Count
$obj = @($d.questions | Where-Object { $_.type -in "MCQ", "TRUE_FALSE", "FILL_BLANK", "MATCH" })
Check "objective questions counted" $obj.Count $nObj
$bad = @($obj | Where-Object { [math]::Abs([double]$_.accuracy - 0.5) -gt 0.001 }).Count
Check "objective accuracy is 50% (one of two right)" $bad 0
Check "topics are listed" ([bool](@($d.topics).Count -ge 1)) $true
$sorted = @($d.topics | ForEach-Object { [double]$_.accuracy })
$ok = $true; for ($i = 1; $i -lt $sorted.Count; $i++) { if ($sorted[$i] -lt $sorted[$i - 1]) { $ok = $false } }
Check "topics sorted weakest first" $ok $true
Check "risk counts add up" (($d.risk.PSObject.Properties | ForEach-Object { $_.Value } | Measure-Object -Sum).Sum) 2

# ---- student progress ----
$p1 = (Call GET "$st/progress" $null $student).body
$p2 = (Call GET "$st/progress" $null $student2).body
Check "student 1 has 1 exam" $p1.examsTaken 1
Check "history carries the class average" ([bool]($null -ne $p1.history[0].classAveragePercent)) $true
Check "student 1 did well on objective topics (no weak topic from them)" (@($p1.topics | Where-Object { $_.level -eq "WEAK" -and [double]$_.accuracy -gt 0 }).Count) 0
Check "student 2 has recommendations" ([bool](@($p2.recommendations).Count -ge 1)) $true
Check "recommendations are capped at 5" ([bool](@($p2.recommendations).Count -le 5)) $true
Check "recommendation cites a source" ([bool](@($p2.recommendations[0].sources).Count -ge 1)) $true
Check "recommendation has advice text" ([bool]$p2.recommendations[0].message) $true
Check "student 2 average is 0" ([double]$p2.averagePercent) ([double]0)
Check "student 1 sees only own data" ([bool]($p1.averagePercent -gt $p2.averagePercent)) $true

Write-Host ""
if ($script:failed -eq 0) { Write-Host "All checks passed." -ForegroundColor Green; exit 0 }
Write-Host "$script:failed check(s) FAILED." -ForegroundColor Red; exit 1
