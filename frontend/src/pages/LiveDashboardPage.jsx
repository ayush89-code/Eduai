import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { errorMessage } from "../api/client";
import useLiveSocket from "../live/useLiveSocket";

const LEVEL = { LOW: "bg-emerald-100 text-emerald-800", MEDIUM: "bg-amber-100 text-amber-800", HIGH: "bg-red-100 text-red-700" };
const SEV = { HIGH: "text-red-600", MEDIUM: "text-amber-600", LOW: "text-gray-500", INFO: "text-gray-400" };
const STATUS = { IN_PROGRESS: "bg-blue-100 text-blue-800", SUBMITTED: "bg-emerald-100 text-emerald-800", TERMINATED: "bg-red-100 text-red-700" };
const label = (t) => (t || "").toLowerCase().replace(/_/g, " ");
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString() : "–");

export default function LiveDashboardPage() {
  const { examId } = useParams();
  const [snap, setSnap] = useState(null);
  const [feed, setFeed] = useState([]);
  const [error, setError] = useState("");
  const [, tick] = useState(0);

  const load = useCallback(() => {
    api.get(`/api/teacher/exams/${examId}/live`).then((r) => { setSnap(r.data); setError(""); }).catch((e) => setError(errorMessage(e)));
  }, [examId]);

  const onEvent = useCallback((m) => {
    setFeed((f) => [m, ...f].slice(0, 100));
    setSnap((s) => {
      if (!s) return s;
      const rows = s.rows.map((r) => r.attemptId === m.attemptId
        ? { ...r, flagCount: m.flagCount, riskScore: m.riskScore, riskLevel: m.riskLevel,
            lastEventType: m.eventType, lastEventAt: m.occurredAt } : r);
      rows.sort((a, b) => b.riskScore - a.riskScore);
      return { ...s, rows };
    });
  }, []);

  const state = useLiveSocket(examId, onEvent, load);

  useEffect(() => {          // safety net: re-sync every 20 s (new students, answered counts, submissions)
    load();
    const t = setInterval(load, 20000);
    const c = setInterval(() => tick((n) => n + 1), 1000);   // countdown
    return () => { clearInterval(t); clearInterval(c); };
  }, [load]);

  if (!snap) return <div className="p-8 text-sm text-gray-500">{error || "Loading…"}</div>;
  const active = snap.rows.filter((r) => r.status === "IN_PROGRESS").length;
  const dot = state === "live" ? "bg-emerald-500" : state === "connecting" ? "bg-amber-400" : "bg-red-500";

  const remaining = (r) => {
    if (r.status !== "IN_PROGRESS" || !r.deadline) return "–";
    const left = Math.max(0, Math.floor((new Date(r.deadline) - Date.now()) / 1000));
    return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{snap.title} – live monitoring</h1>
            <p className="flex items-center gap-2 text-xs text-gray-500">
              <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
              {state === "live" ? "Live" : state === "connecting" ? "Connecting…" : "Offline – refreshing every 20 s"}
              <span>· {active} taking the exam · {snap.rows.length} started · exam {snap.status}</span>
            </p>
          </div>
          <div className="flex gap-4 text-sm">
            <Link to={`/exams/${examId}/results`} className="text-indigo-600 hover:underline">Results</Link>
            <Link to="/teacher" className="text-gray-500 hover:underline">Back</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr><th className="px-3 py-2">Student</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Progress</th>
                  <th className="px-3 py-2">Time left</th><th className="px-3 py-2">Flags</th><th className="px-3 py-2">Risk</th><th className="px-3 py-2">Last flag</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {snap.rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">Nobody has started yet.</td></tr>}
                {snap.rows.map((r) => (
                  <tr key={r.attemptId} className={r.riskLevel === "HIGH" ? "bg-red-50" : ""}>
                    <td className="px-3 py-2"><div className="font-medium text-gray-900">{r.studentName}</div><div className="text-xs text-gray-400">{r.studentEmail}</div></td>
                    <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs ${STATUS[r.status] || ""}`}>{label(r.status)}</span></td>
                    <td className="px-3 py-2">{r.answered}/{snap.questionCount}</td>
                    <td className="px-3 py-2 tabular-nums">{remaining(r)}</td>
                    <td className="px-3 py-2">{r.flagCount}</td>
                    <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs ${LEVEL[r.riskLevel]}`}>{r.riskLevel} · {r.riskScore}</span></td>
                    <td className="px-3 py-2 text-xs text-gray-600">{r.lastEventType ? `${label(r.lastEventType)} (${time(r.lastEventAt)})` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Live event feed</h2>
          <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-gray-200 bg-white">
            {feed.length === 0 && <p className="p-4 text-sm text-gray-400">Waiting for events…</p>}
            <ul className="divide-y divide-gray-100">
              {feed.map((m, i) => (
                <li key={`${m.attemptId}-${m.occurredAt}-${i}`} className="px-3 py-2 text-sm">
                  <span className={`font-medium ${SEV[m.severity] || ""}`}>{label(m.eventType)}</span>
                  <span className="text-gray-700"> – {m.studentName}</span>
                  <div className="text-xs text-gray-400">{time(m.occurredAt)} · risk {m.riskScore} ({m.riskLevel})</div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </main>
    </div>
  );
}
