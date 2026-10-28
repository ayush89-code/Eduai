import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { errorMessage } from "../api/client";

const LEVEL = { WEAK: "bg-red-500", OK: "bg-amber-400", STRONG: "bg-emerald-500" };
const pct = (x) => `${Math.round(x * 100)}%`;

function Bar({ value, color }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-gray-100">
      <div className={`h-full ${color}`} style={{ width: `${Math.max(2, Math.round(value * 100))}%` }} />
    </div>
  );
}

export default function MyProgressPage() {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/api/student/progress").then((r) => setD(r.data)).catch((e) => setError(errorMessage(e)));
  }, []);

  if (!d) return <div className="p-8 text-sm text-gray-500">{error || "Loading…"}</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">My progress</h1>
            <p className="text-xs text-gray-500">{d.examsTaken} exam(s) taken · average {d.averagePercent}%</p>
          </div>
          <Link to="/student/exams" className="text-sm text-gray-500 hover:underline">Back to exams</Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-6 py-6">
        {d.examsTaken === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
            Take an exam and your progress will show up here.
          </p>
        ) : (
          <>
            <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h2 className="mb-2 text-sm font-semibold text-amber-900">What to revise</h2>
              {d.recommendations.length === 0 ? (
                <p className="text-sm text-amber-900">Nothing urgent: every topic is at 60 % or above. Keep it up.</p>
              ) : (
                <ul className="space-y-3">
                  {d.recommendations.map((r) => (
                    <li key={r.topic} className="text-sm text-amber-950">
                      <div className="font-medium">{r.topic} <span className="text-xs font-normal text-amber-800">({pct(r.accuracy)})</span></div>
                      <div>{r.message}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Topics – weakest first</h2>
              <div className="space-y-3">
                {d.topics.map((t) => (
                  <div key={t.topic}>
                    <div className="mb-1 flex justify-between text-sm"><span className="text-gray-800">{t.topic}</span><span className="tabular-nums text-gray-600">{pct(t.accuracy)}</span></div>
                    <Bar value={t.accuracy} color={LEVEL[t.level]} />
                  </div>
                ))}
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <h2 className="px-4 pt-4 text-sm font-semibold text-gray-700">My results</h2>
              <table className="mt-2 w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr><th className="px-3 py-2">Exam</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Score</th><th className="px-3 py-2">Class avg</th><th className="px-3 py-2" /></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[...d.history].reverse().map((h) => (
                    <tr key={h.attemptId}>
                      <td className="px-3 py-2 text-gray-900">{h.title}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{h.submittedAt ? new Date(h.submittedAt).toLocaleDateString() : "–"}</td>
                      <td className="px-3 py-2 tabular-nums">{h.score}/{h.maxScore} ({h.percent}%){h.pendingMarking && <span className="ml-1 text-xs text-amber-600">marking pending</span>}</td>
                      <td className="px-3 py-2 tabular-nums text-gray-500">{h.classAveragePercent != null ? `${h.classAveragePercent}%` : "–"}</td>
                      <td className="px-3 py-2"><Link to={`/student/attempts/${h.attemptId}/result`} className="text-indigo-600 hover:underline">View</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
