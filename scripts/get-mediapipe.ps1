# Optional: downloads the MediaPipe files into frontend\public\mediapipe so face detection also works
# without internet access (e.g. in a college lab or at the project demo). Run once from the project root:
#   powershell -ExecutionPolicy Bypass -File .\scripts\get-mediapipe.ps1
# Then rebuild the frontend:  docker compose up -d --build frontend
$ErrorActionPreference = "Stop"
$ver  = "0.10.14"
$cdn  = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@$ver"
$dest = Join-Path (Get-Location) "frontend\public\mediapipe"
New-Item -ItemType Directory -Force -Path "$dest\wasm" | Out-Null

$files = @(
    @{ url = "$cdn/vision_bundle.mjs";                          out = "vision_bundle.mjs" },
    @{ url = "$cdn/wasm/vision_wasm_internal.js";               out = "wasm\vision_wasm_internal.js" },
    @{ url = "$cdn/wasm/vision_wasm_internal.wasm";             out = "wasm\vision_wasm_internal.wasm" },
    @{ url = "$cdn/wasm/vision_wasm_nosimd_internal.js";        out = "wasm\vision_wasm_nosimd_internal.js" },
    @{ url = "$cdn/wasm/vision_wasm_nosimd_internal.wasm";      out = "wasm\vision_wasm_nosimd_internal.wasm" },
    @{ url = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite"; out = "blaze_face_short_range.tflite" }
)
foreach ($f in $files) {
    Write-Host "Downloading $($f.out) ..."
    Invoke-WebRequest -UseBasicParsing -Uri $f.url -OutFile (Join-Path $dest $f.out)
}
Write-Host "Done. Files are in $dest" -ForegroundColor Green
