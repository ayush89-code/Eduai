// Face detection with MediaPipe Tasks Vision. Runs entirely in the student's browser: no video leaves the computer.
// Files are loaded from /mediapipe/ when present (run scripts\get-mediapipe.ps1 once for offline use),
// otherwise from the public CDNs.

const VERSION = "0.10.14";
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL_CDN = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

async function exists(url) {
  try {
    const r = await fetch(url, { method: "HEAD" });
    // the dev server answers unknown paths with index.html (status 200), so check the type too
    return r.ok && !(r.headers.get("content-type") || "").includes("text/html");
  } catch { return false; }
}

/** Resolves to { detect(video) -> { faces, turned } , close() } or throws when the model cannot be loaded. */
export async function createFaceMonitor() {
  const local = await exists("/mediapipe/vision_bundle.mjs");
  const bundle = local ? "/mediapipe/vision_bundle.mjs" : `${CDN}/vision_bundle.mjs`;
  const wasm = local ? "/mediapipe/wasm" : `${CDN}/wasm`;
  const model = (await exists("/mediapipe/blaze_face_short_range.tflite")) ? "/mediapipe/blaze_face_short_range.tflite" : MODEL_CDN;

  const vision = await import(/* @vite-ignore */ bundle);
  const fileset = await vision.FilesetResolver.forVisionTasks(wasm);
  const make = (delegate) => vision.FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: model, delegate },
    runningMode: "VIDEO",
    minDetectionConfidence: 0.5,
  });
  let detector;
  try { detector = await make("GPU"); } catch { detector = await make("CPU"); }

  let lastTime = -1;
  return {
    /** faces: how many; turned: true when the only face is clearly looking away from the screen. */
    detect(video) {
      if (video.readyState < 2 || video.currentTime === lastTime) return null;   // no new frame yet
      lastTime = video.currentTime;
      const res = detector.detectForVideo(video, performance.now());
      const dets = res?.detections || [];
      let turned = false;
      if (dets.length === 1) {
        // keypoints: 0 right eye, 1 left eye, 2 nose tip. Nose far from the middle of the eyes = head turned.
        const k = dets[0].keypoints || [];
        if (k.length >= 3) {
          const eyeDist = Math.abs(k[0].x - k[1].x);
          if (eyeDist > 0.01) turned = Math.abs(k[2].x - (k[0].x + k[1].x) / 2) / eyeDist > 0.5;
        }
      }
      return { faces: dets.length, turned };
    },
    close() { try { detector.close(); } catch { /* ignore */ } },
  };
}
