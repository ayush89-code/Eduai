import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api, { errorMessage } from "../api/client";

const STATUS_STYLE = { DRAFT: "bg-gray-100 text-gray-700", PUBLISHED: "bg-emerald-100 text-emerald-800", CLOSED: "bg-slate-200 text-slate-700" };
const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

function NewExam({ banks, onError }) {
  const nav = useNavigate();
  const [sourceId, setSourceId] = useState("");
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(60);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!sourceId && banks.length) setSourceId(banks[0].sourceId); }, [banks, sourceId]);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post("/api/teacher/exams", { title, durationMinutes: Number(duration), sourceId });
      nav(`/exams/${data.exam.id}`);
    } catch (err) { onError(errorMessage(err)); } finally { setBusy(false); }
  };

  if (banks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-3 text-sm text-gray-600">
        No questions yet. <Link to="/sources" className="text-indigo-600 hover:underline">Generate and approve some questions</Link> first, then build a paper from them.
      </p>
    );
  }
  return (
    <form onSubmit={create} className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end">
      <label className="text-xs font-medium text-gray-600">Exam title
        <input required maxLength={255} className={`${input} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. English grammar mock test" />
      </label>
      <label className="text-xs font-medium text-gray-600">Minutes
        <input required type="number" min="1" max="600" className={`${input} mt-1`} value={duration} onChange={(e) => setDuration(e.target.value)} />
      </label>
      <label className="text-xs font-medium text-gray-600">Questions from
        <select className={`${input} mt-1`} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          {banks.map((b) => <option key={b.sourceId} value={b.sourceId}>{b.title} ({b.approved} approved)</option>)}
        </select>
      </label>
      <button disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">Create</button>
    </form>
  );
}

export default function PapersPage() {
  const [exams, setExams] = useState(null);
  const [banks, setBanks] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/api/teacher/exams").then((r) => setExams(r.data)).catch((e) => setError(errorMessage(e)));
    api.get("/api/teacher/questions/banks").then((r) => setBanks(r.data)).catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <h1 className="text-xl font-bold text-gray-900">Exams</h1>
          <Link to="/" className="text-sm text-indigo-600 hover:underline">← Dashboard</Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-5 px-6 py-6">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <NewExam banks={banks} onError={setError} />
        {!exams && !error && <p className="text-sm text-gray-500">Loading…</p>}
        {exams && exams.length === 0 && <p className="text-sm text-gray-500">No exams yet. Create your first one above.</p>}
        <ul className="space-y-3">
          {exams?.map((x) => (
            <li key={x.id}>
              <Link to={`/exams/${x.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-5 py-4 hover:border-indigo-300">
                <div>
                  <div className="font-semibold text-gray-900">{x.title}</div>
                  <div className="text-xs text-gray-500">
                    {x.questionCount} question{x.questionCount !== 1 ? "s" : ""} · {Number(x.totalMarks)} marks · {x.durationMinutes} min
                    {x.startsAt && ` · opens ${new Date(x.startsAt).toLocaleString()}`}
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[x.status]}`}>{x.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
