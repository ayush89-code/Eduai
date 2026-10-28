import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { errorMessage } from "../api/client";

const LEVEL = { WEAK: "bg-red-500", OK: "bg-amber-400", STRONG: "bg-emerald-500" };
const RISK = { LOW: "bg-emerald-500", MEDIUM: "bg-amber-400", HIGH: "bg-red-500" };
const pct = (x) => `${Math.round(x * 100)}%`;
const label = (t) => (t || "").toLowerCase().replace(/_/g, " ");

function Stat({ name, value }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs uppercase text-gray-500">{name}</div>
      <div className="text-2xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function Bar({ value, color }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-gray-100">
      <div className={`h-full ${color}`} style={{ width: `${Math.max(2, Math.round(value * 100))}%` }} />
    </div>
  );
}

export default function ExamAnalyticsPage() {
  const { examId } = useParams();
  const [d, setD] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(`/api/teacher/exams/${examId}/analytics`).then((r) => setD(r.data)).catch((e) => setError(errorMessage(e)));
  }, [examId]);

  if (!d) return <div className="p-8 text-sm text-gray-500">{error || "Loading…"}</div>;
  const s = d.summary;
  const maxBand = Math.max(1, ...d.histogram.bands);
  const hardest = [...d.questions].sort((a, b) => a.accuracy - b.accuracy).slice(0, 3).map((q) => q.questionId);
  const riskTotal = Object.values(d.risk).reduce((a, b) => a + b, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{d.title} – analytics</h1>
            <p className="text-xs text-gray-500">Exam {label(d.status)} · based on finished attempts only</p>
          </div>
          <div className="flex gap-4 text-sm">
            <Link to={`/exams/${examId}/results`} className="text-indigo-600 hover:underline">Results</Link>
            <Link to={`/exams/${examId}/live`} className="text-indigo-600 hover:underline">Live</Link>
            <Link to="/teacher" className="text-gray-500 hover:underline">Back</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        {s.submitted === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
            No finished attempts yet. Analytics appear as soon as the first student submits.
          </p>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Stat name="Submitted" value={s.submitted} />
              <Stat name="Average" value={`${s.averagePercent}%`} />
              <Stat name="Highest" value={`${s.highestPercent}%`} />
              <Stat name="Lowest" value={`${s.lowestPercent}%`} />
              <Stat name="Pass rate (40%)" value={`${s.passRate}%`} />
            </section>
            {(s.awaitingMarking > 0 || s.inProgress > 0) && (
              <p className="text-sm text-amber-700">
                {s.awaitingMarking > 0 && `${s.awaitingMarking} attempt(s) still have written answers to mark – their scores are not final. `}
                {s.inProgress > 0 && `${s.inProgress} student(s) are still taking the exam.`}
              </p>
            )}

            <div className="grid gap-6 lg:grid-cols-3">
              <section className="rounded-lg border border-gray-200 bg-white p-4 lg:col-span-2">
                <h2 className="mb-3 text-sm font-semibold text-gray-700">Score distribution</h2>
                <div className="flex h-40 items-end gap-2">
                  {d.histogram.bands.map((n, i) => (
                    <div key={i} className="flex flex-1 flex-col items-center justify-end">
                      <span className="text-xs text-gray-500">{n || ""}</span>
                      <div className="w-full rounded-t bg-indigo-500" style={{ height: `${(n / maxBand) * 100}%`, minHeight: n ? 4 : 1 }} />
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex gap-2 text-center text-[10px] text-gray-400">
                  {d.histogram.bands.map((_, i) => <span key={i} className="flex-1">{i * 10}–{i === 9 ? 100 : i * 10 + 9}</span>)}
                </div>
              </section>

              <section className="rounded-lg border border-gray-200 bg-white p-4">
                <h2 className="mb-3 text-sm font-semibold text-gray-700">Proctoring risk</h2>
                {["LOW", "MEDIUM", "HIGH"].map((k) => (
                  <div key={k} className="mb-3">
                    <div className="mb-1 flex justify-between text-xs text-gray-600"><span>{label(k)}</span><span>{d.risk[k] || 0}</span></div>
                    <Bar value={riskTotal ? (d.risk[k] || 0) / riskTotal : 0} color={RISK[k]} />
                  </div>
                ))}
              </section>
            </div>

            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="mb-1 text-sm font-semibold text-gray-700">Topics – weakest first</h2>
              <p className="mb-3 text-xs text-gray-500">Share of the marks the class earned. Red is under 60 %: worth re-teaching.</p>
              <div className="space-y-3">
                {d.topics.map((t) => (
                  <div key={t.topic}>
                    <div className="mb-1 flex justify-between text-sm"><span className="text-gray-800">{t.topic} <span className="text-xs text-gray-400">({t.questions} q)</span></span><span className="tabular-nums text-gray-600">{pct(t.accuracy)}</span></div>
                    <Bar value={t.accuracy} color={LEVEL[t.level]} />
                  </div>
                ))}
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <h2 className="px-4 pt-4 text-sm font-semibold text-gray-700">Questions</h2>
              <table className="mt-2 w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Question</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Level</th><th className="px-3 py-2">Topic</th><th className="px-3 py-2">Answered</th><th className="w-40 px-3 py-2">Accuracy</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {d.questions.map((q) => (
                    <tr key={q.questionId} className={hardest.includes(q.questionId) && q.accuracy < 0.6 ? "bg-red-50" : ""}>
                      <td className="px-3 py-2 text-gray-500">{q.position}</td>
                      <td className="px-3 py-2 text-gray-900">{q.text}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{label(q.type)}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{label(q.difficulty)}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{q.topic}</td>
                      <td className="px-3 py-2 tabular-nums">{q.answered}/{q.students}</td>
                      <td className="px-3 py-2"><div className="flex items-center gap-2"><div className="flex-1"><Bar value={q.accuracy} color={q.accuracy < 0.4 ? "bg-red-500" : q.accuracy < 0.7 ? "bg-amber-400" : "bg-emerald-500"} /></div><span className="w-10 text-right text-xs tabular-nums">{pct(q.accuracy)}</span></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-4 py-2 text-xs text-gray-400">Written answers are counted only after you have marked them.</p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
