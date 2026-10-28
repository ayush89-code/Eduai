# Step 10 smoke test: a teacher's WebSocket receives proctoring events live. Self-contained.
# Run from the project root with the stack up:
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-live.ps1
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


# ---- prepare: a published exam and a student who has started it ----
Write-Host "Generating $Count questions..."
$start = Call POST "$ai/api/generate/jobs" @{ source_id = $id; count = $Count } $teacher
Check "job finished DONE" (Wait-Generation $start.body.id $teacher 600).body.status "DONE"
$q = "$api/api/teacher/questions"
$ids = @((Call GET "$q`?sourceId=$id" $null $teacher).body | ForEach-Object { $_.id })
Call POST "$q/bulk" @{ action = "APPROVE"; ids = $ids } $teacher | Out-Null
$ex = "$api/api/teacher/exams"
$examId = (Call POST $ex @{ title = "Proctor test"; durationMinutes = 30; sourceId = $id } $teacher).body.exam.id
Call POST "$ex/$examId/auto-fill" @{ sourceId = $id; totalMarks = 5 } $teacher | Out-Null
Check "publish" (Call POST "$ex/$examId/publish" $null $teacher).body.exam.status "PUBLISHED"
$st = "$api/api/student"
$aid = (Call POST "$st/exams/$examId/start" $null $student).body.id
Check "attempt started" ([bool]$aid) $true
$pe = "$st/attempts/$aid/proctor-events"
$tp = "$api/api/teacher/attempts/$aid/proctoring"
$now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")


# ---- live WebSocket ----
function WsOpen($url) {
    $ws = New-Object System.Net.WebSockets.ClientWebSocket
    try { $ws.ConnectAsync([Uri]$url, [Threading.CancellationToken]::None).Wait(5000) | Out-Null } catch { }
    return $ws
}
function WsSend($ws, $text) {
    $b = [Text.Encoding]::UTF8.GetBytes($text)
    $ws.SendAsync([ArraySegment[byte]]::new($b), "Text", $true, [Threading.CancellationToken]::None).Wait(5000) | Out-Null
}
function WsRecv($ws, $ms) {
    $buf = New-Object byte[] 8192
    $cts = New-Object Threading.CancellationTokenSource($ms)
    try {
        $t = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), $cts.Token)
        $t.Wait()
        return [Text.Encoding]::UTF8.GetString($buf, 0, $t.Result.Count) | ConvertFrom-Json
    } catch { return $null }
}
$wsBase = "ws://localhost:8080/ws/proctor"

# no token / bad token / student token cannot connect
Check "no token refused" ((WsOpen $wsBase).State -eq "Open") $false
Check "garbage token refused" ((WsOpen "$wsBase`?token=abc.def.ghi").State -eq "Open") $false
Check "student token refused" ((WsOpen "$wsBase`?token=$student").State -eq "Open") $false

# another teacher connects but cannot subscribe to this exam
$wo = WsOpen "$wsBase`?token=$other"
Check "teacher token accepted" ($wo.State -eq "Open") $true
WsSend $wo (@{ subscribe = $examId } | ConvertTo-Json -Compress)
Check "other teacher's subscribe -> error" (WsRecv $wo 5000).type "error"

# the owner subscribes
$w = WsOpen "$wsBase`?token=$teacher"
WsSend $w (@{ subscribe = $examId } | ConvertTo-Json -Compress)
Check "owner subscribed" (WsRecv $w 5000).type "subscribed"

# snapshot endpoint
$live = Call GET "$ex/$examId/live" $null $teacher
Check "snapshot 200" $live.code 200
Check "snapshot lists the student" @($live.body.rows).Count 1
Check "other teacher cannot read snapshot (404)" (Call GET "$ex/$examId/live" $null $other).code 404
Check "student cannot read snapshot (403)" (Call GET "$ex/$examId/live" $null $student).code 403

# a student event arrives on the socket
$ev = @{ events = @(@{ type = "MULTIPLE_FACES"; occurredAt = $now; clientId = [guid]::NewGuid().ToString() }) }
Check "event accepted" (Call POST $pe $ev $student).code 202
$got = $null
$deadline = (Get-Date).AddSeconds(15)
while (-not $got -and (Get-Date) -lt $deadline) {
    $m = WsRecv $w 3000
    if ($m -and $m.type -eq "event") { $got = $m }
}
Check "event pushed to the teacher" ([bool]$got) $true
Check "pushed event type" $got.eventType "MULTIPLE_FACES"
Check "pushed risk score" $got.riskScore 5
Check "pushed risk level" $got.riskLevel "MEDIUM"
Check "pushed student name" $got.studentName "Test STUDENT"
Check "the other teacher received nothing" ($null -eq (WsRecv $wo 1500)) $true

$live2 = Call GET "$ex/$examId/live" $null $teacher
Check "snapshot shows the risk" $live2.body.rows[0].riskScore 5

foreach ($s in @($w, $wo)) { try { $s.Dispose() } catch { } }
Write-Host ""
if ($script:failed -eq 0) { Write-Host "All checks passed." -ForegroundColor Green; exit 0 }
Write-Host "$script:failed check(s) FAILED." -ForegroundColor Red; exit 1
