import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { errorMessage } from "../api/client";
import ResultItemCard from "../components/ResultItemCard";
import ProctorPanel from "../components/ProctorPanel";

function MarkBox({ item, busy, onSave }) {
  const [marks, setMarks] = useState(item.awarded == null ? "" : String(Number(item.awarded)));
  const [feedback, setFeedback] = useState(item.feedback || "");
  const max = Number(item.marks);
  const bad = marks === "" || Number(marks) < 0 || Number(marks) > max;
  return (
    <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-sky-200 bg-sky-50/60 p-3">
      <label className="text-xs font-medium text-gray-600">Marks (max {max})
        <input type="number" min="0" max={max} step="0.25" value={marks} onChange={(e) => setMarks(e.target.value)}
          className="mt-1 block w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
      </label>
      <label className="min-w-[200px] flex-1 text-xs font-medium text-gray-600">Feedback for the student (optional)
        <input value={feedback} maxLength={2000} onChange={(e) => setFeedback(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
      </label>
      <button disabled={busy || bad} onClick={() => onSave(item.questionId, Number(marks), feedback)}
        className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
        {item.grading === "MANUAL" ? "Update marks" : "Save marks"}
      </button>
    </div>
  );
}

export default function AttemptReviewPage() {
  const { examId, attemptId } = useParams();
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(`/api/teacher/attempts/${attemptId}`).then((r) => setDetail(r.data)).catch((e) => setError(errorMessage(e)));
  }, [attemptId]);

  const save = async (questionId, marks, feedback) => {
    setBusy(true); setError("");
    try {
      const { data } = await api.put(`/api/teacher/attempts/${attemptId}/answers/${questionId}/marks`, { marks, feedback });
      setDetail(data);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  if (!detail) return <div className="p-8 text-sm text-gray-500">{error || "Loading…"}</div>;
  const a = detail.attempt;
  const markable = (it) => it.grading === "AWAITING" || it.grading === "MANUAL";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{a.studentName}</h1>
            <p className="text-xs text-gray-500">{a.studentEmail}</p>
          </div>
          <Link to={`/exams/${examId}/results`} className="text-sm text-indigo-600 hover:underline">← All results</Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-4 px-6 py-6">
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4">
          <div><p className="text-xs uppercase tracking-wide text-gray-500">Score</p><p className="text-2xl font-bold text-gray-900">{Number(a.score)} / {Number(a.maxScore)}</p></div>
          {a.pendingMarking > 0
            ? <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">{a.pendingMarking} written answer{a.pendingMarking > 1 ? "s" : ""} waiting for your marks</p>
            : <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Fully marked</p>}
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <ProctorPanel attemptId={attemptId} />
        <ul className="space-y-3">
          {detail.items.map((it) => (
            <ResultItemCard key={`${it.questionId}-${it.awarded}-${it.feedback}`} item={it}>
              {markable(it) && <MarkBox item={it} busy={busy} onSave={save} />}
            </ResultItemCard>
          ))}
        </ul>
      </main>
    </div>
  );
}
