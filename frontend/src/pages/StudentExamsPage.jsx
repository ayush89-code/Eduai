import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api, { errorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const fmt = (iso) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

function ExamCard({ exam, onStart, busy }) {
  const a = exam.attempt;
  const upcoming = !exam.canStart && !a && exam.startsAt && new Date(exam.startsAt) > new Date();
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{exam.title}</h3>
          {exam.description && <p className="mt-1 text-sm text-gray-600">{exam.description}</p>}
          <p className="mt-2 text-xs text-gray-500">
            {exam.questionCount} questions · {Number(exam.totalMarks)} marks · {exam.durationMinutes} minutes
            {exam.startsAt && ` · opens ${fmt(exam.startsAt)}`}
            {exam.endsAt && ` · closes ${fmt(exam.endsAt)}`}
          </p>
        </div>
        <div className="text-right">
          {a?.status === "SUBMITTED" ? (
            <>
              <p className="text-sm text-gray-600">Your score</p>
              <p className="text-2xl font-bold text-gray-900">{Number(a.score)} <span className="text-base font-medium text-gray-500">/ {Number(a.maxScore)}</span></p>
              {a.pendingMarking > 0 && <p className="text-xs text-sky-700">{a.pendingMarking} written answer{a.pendingMarking > 1 ? "s" : ""} still being marked</p>}
              <Link to={`/student/attempts/${a.id}/result`} className="mt-2 inline-block text-sm font-medium text-indigo-600 hover:underline">View result</Link>
            </>
          ) : exam.canStart ? (
            <button disabled={busy} onClick={() => onStart(exam.id, !!a)} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {a ? "Resume exam" : "Start exam"}
            </button>
          ) : (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">{upcoming ? "Not open yet" : "Not available"}</span>
          )}
        </div>
      </div>
    </li>
  );
}

export default function StudentExamsPage() {
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const [exams, setExams] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/api/student/exams").then((r) => setExams(r.data)).catch((e) => setError(errorMessage(e)));
  }, []);

  const start = async (examId, resume) => {
    if (!resume && !window.confirm("Start the exam now? The timer begins immediately and cannot be paused.")) return;
    setBusy(true); setError("");
    try {
      const { data } = await api.post(`/api/student/exams/${examId}/start`);
      nav(`/student/attempts/${data.id}`);
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };

  const open = (exams || []).filter((e) => !e.attempt || e.attempt.status === "IN_PROGRESS");
  const done = (exams || []).filter((e) => e.attempt && e.attempt.status !== "IN_PROGRESS");

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <h1 className="text-xl font-bold text-gray-900">My exams</h1>
          <div className="flex items-center gap-3">
            <Link to="/" className="text-sm text-indigo-600 hover:underline">Dashboard</Link>
            <span className="text-sm text-gray-600">{user?.fullName}</span>
            <button onClick={logout} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100">Log out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!exams && !error && <p className="text-sm text-gray-500">Loading…</p>}
        {exams && exams.length === 0 && <p className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-500">No exams are available right now.</p>}
        {open.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Available</h2>
            <ul className="space-y-3">{open.map((e) => <ExamCard key={e.id} exam={e} onStart={start} busy={busy} />)}</ul>
          </section>
        )}
        {done.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Completed</h2>
            <ul className="space-y-3">{done.map((e) => <ExamCard key={e.id} exam={e} onStart={start} busy={busy} />)}</ul>
          </section>
        )}
      </main>
    </div>
  );
}
