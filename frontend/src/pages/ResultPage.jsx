import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api, { errorMessage } from "../api/client";
import ResultItemCard from "../components/ResultItemCard";

export default function ResultPage() {
  const { attemptId } = useParams();
  const nav = useNavigate();
  const [att, setAtt] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(`/api/student/attempts/${attemptId}`).then((r) => {
      if (r.data.status === "IN_PROGRESS") nav(`/student/attempts/${attemptId}`, { replace: true });
      else setAtt(r.data);
    }).catch((e) => setError(errorMessage(e)));
  }, [attemptId, nav]);

  if (!att) return <div className="p-8 text-sm text-gray-500">{error || "Loading…"}</div>;
  const r = att.result;
  const pct = Number(r.maxScore) > 0 ? Math.round((Number(r.score) / Number(r.maxScore)) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <h1 className="text-xl font-bold text-gray-900">{att.examTitle}</h1>
          <Link to="/student/exams" className="text-sm text-indigo-600 hover:underline">← My exams</Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-5 px-6 py-8">
        <section className="rounded-xl border border-gray-200 bg-white p-6 text-center">
          <p className="text-sm text-gray-500">Your score</p>
          <p className="text-5xl font-bold text-gray-900">{Number(r.score)}<span className="text-2xl font-medium text-gray-400"> / {Number(r.maxScore)}</span></p>
          <p className="mt-1 text-sm text-gray-600">{pct}%</p>
          {r.pendingMarking > 0 && (
            <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
              {r.pendingMarking} written answer{r.pendingMarking > 1 ? "s are" : " is"} still being marked by your teacher. Your score will go up when they are done.
            </p>
          )}
        </section>
        {r.detailsReleased ? (
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Your answers</h2>
            <ul className="space-y-3">{r.items.map((it) => <ResultItemCard key={it.questionId} item={it} />)}</ul>
          </section>
        ) : (
          <p className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-600">
            The correct answers and your marks for each question will appear here once the exam has closed for everyone.
          </p>
        )}
      </main>
    </div>
  );
}
