import { useCallback, useEffect, useRef, useState } from "react";
import { createFaceMonitor } from "./faceMonitor";
import useProctorSender from "./useProctorSender";

// What counts towards the student's own flag counter (same idea as the server's risk weights).
const FLAGGED = new Set(["FACE_MISSING", "MULTIPLE_FACES", "LOOKING_AWAY", "TAB_SWITCH", "WINDOW_BLUR", "COPY_PASTE", "CAMERA_DENIED", "CAMERA_LOST"]);
const MESSAGES = {
  FACE_MISSING: "We cannot see your face. Please stay in front of the camera.",
  MULTIPLE_FACES: "More than one person was detected in the camera.",
  LOOKING_AWAY: "Please keep your eyes on the screen.",
  TAB_SWITCH: "Leaving the exam tab is recorded. Please stay on this page.",
  WINDOW_BLUR: "You left the exam window. This is recorded.",
  COPY_PASTE: "Copy and paste are recorded during the exam.",
  CAMERA_LOST: "The camera stopped working. Please reconnect it.",
};

/**
 * Exam proctoring: camera face check (MediaPipe, in the browser) + tab / window / clipboard tracking.
 * Mount it once inside the exam player: <ProctorGuard attemptId={attemptId} />
 */
export default function ProctorGuard({ attemptId }) {
  const emit = useProctorSender(attemptId);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [phase, setPhase] = useState("intro");        // intro | starting | on | nocamera
  const [faceState, setFaceState] = useState("ok");   // ok | missing | multiple | away | loading
  const [note, setNote] = useState("");
  const [flags, setFlags] = useState(0);
  const [banner, setBanner] = useState("");
  const bannerTimer = useRef(null);

  const report = useCallback((type, metadata) => {
    emit(type, metadata);
    if (FLAGGED.has(type)) setFlags((n) => n + 1);
    if (MESSAGES[type]) {
      setBanner(MESSAGES[type]);
      clearTimeout(bannerTimer.current);
      bannerTimer.current = setTimeout(() => setBanner(""), 7000);
    }
  }, [emit]);

  // ---- browser behaviour: tab switch, window focus, clipboard, right click (active once the exam is on screen) ----
  useEffect(() => {
    if (phase === "intro" || phase === "starting") return undefined;
    let blurredAt = null;
    let lastClip = 0, lastMenu = 0;
    const onVisibility = () => { if (document.hidden) { blurredAt = Date.now(); report("TAB_SWITCH"); } };
    const onBlur = () => setTimeout(() => {
      if (!document.hidden && !document.hasFocus()) { blurredAt = blurredAt || Date.now(); report("WINDOW_BLUR"); }
    }, 400);
    const onFocus = () => {
      if (blurredAt) { emit("WINDOW_FOCUS", { seconds: Math.round((Date.now() - blurredAt) / 1000) }); blurredAt = null; }
    };
    const onClipboard = () => { if (Date.now() - lastClip > 5000) { lastClip = Date.now(); report("COPY_PASTE"); } };
    const onMenu = (e) => { e.preventDefault(); if (Date.now() - lastMenu > 5000) { lastMenu = Date.now(); emit("RIGHT_CLICK"); } };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("copy", onClipboard);
    document.addEventListener("cut", onClipboard);
    document.addEventListener("paste", onClipboard);
    document.addEventListener("contextmenu", onMenu);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("copy", onClipboard);
      document.removeEventListener("cut", onClipboard);
      document.removeEventListener("paste", onClipboard);
      document.removeEventListener("contextmenu", onMenu);
    };
  }, [phase, emit, report]);

  // ---- camera + face detection loop ----
  useEffect(() => {
    if (phase !== "on") return undefined;
    let timer, monitor, cancelled = false;
    const t = { noFace: null, multi: null, away: null, missingSent: false, lastMulti: 0, lastAway: 0 };

    const tick = () => {
      if (!monitor || !videoRef.current) return;
      const r = monitor.detect(videoRef.current);
      if (!r) return;
      const now = Date.now();
      if (r.faces === 0) {
        t.noFace = t.noFace || now;
        setFaceState("missing");
        if (!t.missingSent && now - t.noFace >= 4000) { t.missingSent = true; report("FACE_MISSING", { seconds: 4 }); }
      } else {
        if (t.missingSent) emit("FACE_RETURNED", { seconds: Math.round((now - t.noFace) / 1000) });
        t.noFace = null; t.missingSent = false;
        if (r.faces >= 2) {
          setFaceState("multiple");
          t.multi = t.multi || now;
          if (now - t.multi >= 2000 && now - t.lastMulti > 30000) { t.lastMulti = now; report("MULTIPLE_FACES", { faces: r.faces }); }
        } else {
          t.multi = null;
          if (r.turned) {
            setFaceState("away");
            t.away = t.away || now;
            if (now - t.away >= 4000 && now - t.lastAway > 20000) { t.lastAway = now; report("LOOKING_AWAY"); }
          } else { t.away = null; setFaceState("ok"); }
        }
      }
    };

    (async () => {
      try {
        setFaceState("loading");
        monitor = await createFaceMonitor();
        if (cancelled) { monitor.close(); return; }
        setFaceState("ok");
        emit("PROCTOR_STARTED", { detector: "mediapipe" });
        timer = setInterval(tick, 500);
      } catch {
        setFaceState("ok");
        setNote("Face detection could not be loaded. Tab and window monitoring is still active.");
        emit("PROCTOR_STARTED", { detector: "none" });
      }
    })();
    return () => { cancelled = true; clearInterval(timer); if (monitor) monitor.close(); };
  }, [phase, emit, report]);

  // show the preview once the <video> element exists
  useEffect(() => {
    if (phase === "on" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [phase]);

  useEffect(() => () => { streamRef.current?.getTracks().forEach((tr) => tr.stop()); clearTimeout(bannerTimer.current); }, []);

  const allowCamera = async () => {
    setPhase("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: "user" }, audio: false });
      streamRef.current = stream;
      stream.getVideoTracks().forEach((tr) => { tr.onended = () => report("CAMERA_LOST"); });
      setPhase("on");
    } catch {
      report("CAMERA_DENIED");
      setPhase("nocamera");
    }
  };

  const dot = { ok: "bg-emerald-500", loading: "bg-gray-400", missing: "bg-red-500", multiple: "bg-red-500", away: "bg-amber-500" }[faceState];
  const label = { ok: "Camera OK", loading: "Starting camera check…", missing: "Face not visible", multiple: "More than one face", away: "Looking away" }[faceState];

  return (
    <>
      {(phase === "intro" || phase === "starting") && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">This exam is monitored</h2>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-600">
              <li>Your camera checks that you are in front of the screen. The video stays on your computer and is never uploaded.</li>
              <li>Switching tabs or windows, copying and pasting are recorded and shown to your teacher.</li>
              <li>Your timer is already running.</li>
            </ul>
            <div className="mt-5 flex flex-col gap-2">
              <button disabled={phase === "starting"} onClick={allowCamera} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                {phase === "starting" ? "Waiting for camera permission…" : "Allow camera and continue"}
              </button>
              <button disabled={phase === "starting"} onClick={() => { report("CAMERA_DENIED", { chosen: "skip" }); setPhase("nocamera"); }}
                className="text-sm text-gray-500 hover:underline">Continue without camera (this will be flagged)</button>
            </div>
          </div>
        </div>
      )}

      {banner && (
        <div className="fixed left-1/2 top-16 z-30 -translate-x-1/2 rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white shadow-lg">{banner}</div>
      )}

      <div className="fixed bottom-4 right-4 z-20 w-44 overflow-hidden rounded-xl border border-gray-300 bg-white shadow-lg">
        {phase === "on" && <video ref={videoRef} muted playsInline className="h-32 w-full -scale-x-100 bg-black object-cover" />}
        {phase === "nocamera" && <div className="flex h-16 items-center justify-center bg-red-50 px-2 text-center text-xs text-red-700">Camera is off</div>}
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-gray-700">
          <span className="flex items-center gap-1.5">{phase === "on" && <span className={`h-2 w-2 rounded-full ${dot}`} />}{phase === "on" ? label : "Monitoring"}</span>
          <span className="font-semibold">{flags} flag{flags === 1 ? "" : "s"}</span>
        </div>
        {note && <p className="border-t border-gray-100 px-3 py-1 text-[10px] text-gray-500">{note}</p>}
      </div>
    </>
  );
}
