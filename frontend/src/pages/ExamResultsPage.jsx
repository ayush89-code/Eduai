import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { errorMessage } from "../api/client";

const STATUS_STYLE = { IN_PROGRESS: "bg-amber-100 text-amber-800", SUBMITTED: "bg-emerald-100 text-emerald-800", TERMINATED: "bg-red-100 text-red-700" };

export default function ExamResultsPage() {
  const { examId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.get(`/api/teacher/exams/${examId}/attempts`).then((r) => { setData(r.data); setError(""); }).catch((e) => setError(errorMessage(e)));
  }, [examId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);   // students are still finishing: keep the table fresh
    return () => clearInterval(t);
  }, [load]);

  const stats = useMemo(() => {
    const done = (data?.attempts || []).filter((a) => a.status !== "IN_PROGRESS" && a.score != null);
    if (done.length === 0) return null;
    const scores = done.map((a) => Number(a.score));
    return { n: done.length, avg: scores.reduce((s, x) => s + x, 0) / scores.length, max: Math.max(...scores), min: Math.min(...scores) };
  }, [data]);

  if (!data) return <div className="p-8 text-sm text-gray-500">{error || "Loading…"}</div>;
  const max = Number(data.maxScore);
  const pending = data.attempts.reduce((s, a) => s + a.pendingMarking, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{data.title} – results</h1>
            <p className="text-xs text-gray-500">Exam status: {data.status}</p>
          </div>
          <div className="flex gap-4 text-sm">
            <button onClick={load} className="text-indigo-600 hover:underline">Refresh</button>
            <Link to={`/exams/${examId}`} className="text-indigo-600 hover:underline">← Exam</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-5 px-6 py-6">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ["Students", data.attempts.length],
            ["Average", stats ? `${stats.avg.toFixed(1)} / ${max}` : "–"],
            ["Highest", stats ? `${stats.max} / ${max}` : "–"],
            ["To mark", pending],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">{k}</p>
              <p className="text-xl font-bold text-gray-900">{v}</p>
            </div>
          ))}
        </div>
        {data.attempts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-500">No student has started this exam yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr><th className="px-4 py-2">Student</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Score</th><th className="px-4 py-2">Submitted</th><th className="px-4 py-2" /></tr>
              </thead>
              <tbody>
                {data.attempts.map((a) => (
                  <tr key={a.id} className="border-t border-gray-100">
                    <td className="px-4 py-2"><div className="font-medium text-gray-900">{a.studentName}</div><div className="text-xs text-gray-500">{a.studentEmail}</div></td>
                    <td className="px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[a.status]}`}>{a.status === "IN_PROGRESS" ? "Writing" : a.status}</span></td>
                    <td className="px-4 py-2">
                      {a.status === "IN_PROGRESS" ? "–" : <>{Number(a.score)} / {Number(a.maxScore)}{a.pendingMarking > 0 && <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800">{a.pendingMarking} to mark</span>}</>}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{a.submittedAt ? new Date(a.submittedAt).toLocaleString() : "–"}</td>
                    <td className="px-4 py-2 text-right">{a.status !== "IN_PROGRESS" && <Link to={`/exams/${examId}/results/${a.id}`} className="font-medium text-indigo-600 hover:underline">Review</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
