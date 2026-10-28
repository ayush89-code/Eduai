import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api, { errorMessage } from "../api/client";

const TYPES = [
  ["MCQ", "Multiple choice"], ["TRUE_FALSE", "True / False"], ["FILL_BLANK", "Fill in the blanks"],
  ["SHORT_ANSWER", "Short answer"], ["LONG_ANSWER", "Long answer"], ["MATCH", "Match the following"],
  ["CASE_BASED", "Passage based"], ["SUBJECTIVE", "Subjective"],
];
const TYPE_LABEL = Object.fromEntries(TYPES);
const DIFF_STYLE = { EASY: "bg-green-100 text-green-800", MEDIUM: "bg-amber-100 text-amber-800", HARD: "bg-red-100 text-red-800" };
const STATUS_STYLE = { DRAFT: "bg-gray-100 text-gray-700", PUBLISHED: "bg-emerald-100 text-emerald-800", CLOSED: "bg-slate-200 text-slate-700" };
const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50";

const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const toIso = (local) => (local ? new Date(local).toISOString() : null);
const short = (t) => (t.length > 140 ? t.slice(0, 140) + "…" : t);

function Badges({ q }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700">{TYPE_LABEL[q.type] || q.type}</span>
      <span className={`rounded px-1.5 py-0.5 font-medium ${DIFF_STYLE[q.difficulty] || ""}`}>{q.difficulty}</span>
      <span className="text-gray-500">{q.topic}</span>
    </div>
  );
}

function AutoFill({ sourceId, disabled, onRun }) {
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState(50);
  const [mix, setMix] = useState({ easy: 30, medium: 50, hard: 20 });
  const [types, setTypes] = useState([]);
  const sum = mix.easy + mix.medium + mix.hard;
  const num = (k) => (e) => setMix({ ...mix, [k]: Number(e.target.value) });

  if (!open) return <button disabled={disabled} onClick={() => setOpen(true)} className={`${btn} border border-indigo-300 text-indigo-700 hover:bg-indigo-50`}>Auto-fill (mock exam)</button>;
  return (
    <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
      <p className="text-sm text-gray-700">Builds the paper from approved questions: a mix of types and difficulty, up to the marks you choose. This replaces the current paper.</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="text-xs font-medium text-gray-600">Total marks
          <input type="number" min="1" max="500" className={`${input} mt-1`} value={total} onChange={(e) => setTotal(Number(e.target.value))} />
        </label>
        {["easy", "medium", "hard"].map((k) => (
          <label key={k} className="text-xs font-medium capitalize text-gray-600">{k} %
            <input type="number" min="0" max="100" className={`${input} mt-1`} value={mix[k]} onChange={num(k)} />
          </label>
        ))}
      </div>
      {sum !== 100 && <p className="text-xs text-red-600">Easy + medium + hard must be 100 (now {sum}).</p>}
      <div>
        <p className="mb-1 text-xs font-medium text-gray-600">Question types (none selected = all)</p>
        <div className="flex flex-wrap gap-2">
          {TYPES.slice(0, 7).map(([v, l]) => (
            <label key={v} className="flex items-center gap-1 text-xs text-gray-700">
              <input type="checkbox" checked={types.includes(v)} onChange={() => setTypes(types.includes(v) ? types.filter((t) => t !== v) : [...types, v])} />{l}
            </label>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button disabled={disabled || sum !== 100 || !(total >= 1)} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}
          onClick={async () => { if (await onRun({ sourceId, totalMarks: total, easyPercent: mix.easy, mediumPercent: mix.medium, hardPercent: mix.hard, types })) setOpen(false); }}>
          Build paper
        </button>
        <button onClick={() => setOpen(false)} className={`${btn} border border-gray-300 hover:bg-gray-100`}>Cancel</button>
      </div>
    </div>
  );
}

export default function PaperBuilderPage() {
  const { examId } = useParams();
  const nav = useNavigate();
  const [exam, setExam] = useState(null);
  const [paper, setPaper] = useState([]);       // [{ q, marks }]
  const [dirty, setDirty] = useState(false);
  const [bank, setBank] = useState([]);
  const [filter, setFilter] = useState({ type: "ALL", text: "" });
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState([]);

  const apply = useCallback((detail) => {
    setExam(detail.exam);
    setPaper(detail.items.map((i) => ({ q: i.question, marks: Number(i.marks) })));
    setDirty(false);
    setForm({
      title: detail.exam.title, description: detail.exam.description || "", durationMinutes: detail.exam.durationMinutes,
      startsAt: toLocalInput(detail.exam.startsAt), endsAt: toLocalInput(detail.exam.endsAt),
    });
  }, []);

  useEffect(() => {
    api.get(`/api/teacher/exams/${examId}`).then((r) => apply(r.data)).catch((e) => setError(errorMessage(e)));
  }, [examId, apply]);

  const sourceId = exam?.sourceId;
  useEffect(() => {
    if (!sourceId) return;
    api.get("/api/teacher/questions", { params: { sourceId, status: "APPROVED" } })
      .then((r) => setBank(r.data)).catch((e) => setError(errorMessage(e)));
  }, [sourceId]);

  const draft = exam?.status === "DRAFT";
  const total = useMemo(() => paper.reduce((s, p) => s + (Number(p.marks) || 0), 0), [paper]);
  const inPaper = useMemo(() => new Set(paper.map((p) => p.q.id)), [paper]);
  const available = useMemo(() => bank.filter((q) => !inPaper.has(q.id)
    && (filter.type === "ALL" || q.type === filter.type)
    && (!filter.text || q.questionText.toLowerCase().includes(filter.text.toLowerCase()) || q.topic.toLowerCase().includes(filter.text.toLowerCase()))),
    [bank, inPaper, filter]);

  const run = async (fn) => {
    setBusy(true); setError(""); setNotes([]);
    try { return await fn(); } catch (e) { setError(errorMessage(e)); return false; } finally { setBusy(false); }
  };
  const edit = (next) => { setPaper(next); setDirty(true); };
  const move = (i, d) => { const n = [...paper];[n[i], n[i + d]] = [n[i + d], n[i]]; edit(n); };

  const savePaper = () => run(async () => {
    const { data } = await api.put(`/api/teacher/exams/${examId}/questions`, { items: paper.map((p) => ({ questionId: p.q.id, marks: Number(p.marks) })) });
    apply(data); return true;
  });
  const saveDetails = () => run(async () => {
    const body = { title: form.title, description: form.description, durationMinutes: Number(form.durationMinutes) };
    if (form.startsAt || form.endsAt) { body.startsAt = toIso(form.startsAt); body.endsAt = toIso(form.endsAt); }
    else body.clearSchedule = true;
    const { data } = await api.put(`/api/teacher/exams/${examId}`, body);
    setExam(data.exam); setNotes(["Details saved."]); return true;
  });
  const autoFill = (body) => run(async () => {
    const { data } = await api.post(`/api/teacher/exams/${examId}/auto-fill`, body);
    apply(data.exam); setNotes(data.warnings.length ? data.warnings : ["Paper built."]); return true;
  });
  const post = (action) => run(async () => {
    if (action === "publish" && dirty && !(await savePaper())) return false;
    const { data } = await api.post(`/api/teacher/exams/${examId}/${action}`);
    apply(data); return true;
  });
  const remove = () => run(async () => {
    if (!window.confirm("Delete this draft exam?")) return false;
    await api.delete(`/api/teacher/exams/${examId}`); nav("/exams"); return true;
  });

  if (!exam) return <div className="p-8 text-sm text-gray-500">{error || "Loading…"}</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900">{exam.title}</h1>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[exam.status]}`}>{exam.status}</span>
          </div>
          <div className="flex items-center gap-4">
            {exam.status !== "DRAFT" && <Link to={`/exams/${exam.id}/results`} className="text-sm font-semibold text-indigo-600 hover:underline">Results</Link>}
            <Link to="/exams" className="text-sm text-indigo-600 hover:underline">← All exams</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-6 py-6">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {notes.map((n) => <p key={n} className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{n}</p>)}

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs font-medium text-gray-600 sm:col-span-2">Title
              <input disabled={!draft} className={`${input} mt-1`} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <label className="text-xs font-medium text-gray-600">Minutes
              <input disabled={!draft} type="number" min="1" max="600" className={`${input} mt-1`} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} />
            </label>
            <div className="flex items-end text-sm text-gray-600">{paper.length} questions · <b className="ml-1">{total}</b>&nbsp;marks</div>
            <label className="text-xs font-medium text-gray-600 sm:col-span-2">Description / instructions
              <input disabled={!draft} className={`${input} mt-1`} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <label className="text-xs font-medium text-gray-600">Opens (optional)
              <input disabled={!draft} type="datetime-local" className={`${input} mt-1`} value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
            </label>
            <label className="text-xs font-medium text-gray-600">Closes (optional)
              <input disabled={!draft} type="datetime-local" className={`${input} mt-1`} value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {draft && <button disabled={busy} onClick={saveDetails} className={`${btn} border border-gray-300 hover:bg-gray-100`}>Save details</button>}
            {draft && <button disabled={busy || !dirty} onClick={savePaper} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}>Save paper{dirty ? " *" : ""}</button>}
            {draft && <button disabled={busy || (paper.length === 0)} onClick={() => post("publish")} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>Publish</button>}
            {exam.status === "PUBLISHED" && <button disabled={busy} onClick={() => post("unpublish")} className={`${btn} border border-gray-300 hover:bg-gray-100`}>Unpublish</button>}
            {exam.status === "PUBLISHED" && <button disabled={busy} onClick={() => post("close")} className={`${btn} border border-red-300 text-red-700 hover:bg-red-50`}>Close exam</button>}
           { exam.status === "PUBLISHED" && <Link to={`/exams/${exam.id}/live`} className="text-indigo-600 hover:underline">Live monitoring</Link>}
           {draft && <button disabled={busy} onClick={remove} className={`${btn} ml-auto border border-red-300 text-red-700 hover:bg-red-50`}>Delete</button>}
          </div>
          {!draft && <p className="mt-2 text-xs text-gray-500">The paper is locked while the exam is {exam.status.toLowerCase()}. Unpublish it to make changes.</p>}
        </section>

        {draft && sourceId && <AutoFill sourceId={sourceId} disabled={busy} onRun={autoFill} />}

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Paper ({paper.length})</h2>
            {paper.length === 0 && <p className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500">Empty. Add questions from the bank, or use auto-fill.</p>}
            <ol className="space-y-2">
              {paper.map((p, i) => (
                <li key={p.q.id} className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-xs font-semibold text-gray-400">{i + 1}</span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <Badges q={p.q} />
                      <p className="whitespace-pre-line text-sm text-gray-900">{short(p.q.questionText)}</p>
                    </div>
                    <label className="text-xs text-gray-500">marks
                      <input disabled={!draft} type="number" min="0.25" step="0.25" className="ml-1 w-16 rounded border border-gray-300 px-1 py-0.5 text-sm"
                        value={p.marks} onChange={(e) => edit(paper.map((x, j) => (j === i ? { ...x, marks: e.target.value } : x)))} />
                    </label>
                  </div>
                  {draft && (
                    <div className="mt-2 flex gap-2 text-xs">
                      <button disabled={i === 0} onClick={() => move(i, -1)} className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-100 disabled:opacity-40">↑</button>
                      <button disabled={i === paper.length - 1} onClick={() => move(i, 1)} className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-100 disabled:opacity-40">↓</button>
                      <button onClick={() => edit(paper.filter((_, j) => j !== i))} className="ml-auto text-red-600 hover:underline">Remove</button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </section>

          {draft && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Approved questions ({available.length} available)</h2>
              <div className="flex gap-2">
                <input className={input} placeholder="Search…" value={filter.text} onChange={(e) => setFilter({ ...filter, text: e.target.value })} />
                <select className="rounded-lg border border-gray-300 bg-white px-2 text-sm" value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
                  <option value="ALL">All types</option>
                  {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              {bank.length === 0 && <p className="text-sm text-gray-500">No approved questions in this source yet. <Link className="text-indigo-600 hover:underline" to={`/sources/${sourceId}/review`}>Review them</Link>.</p>}
              <ul className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
                {available.map((q) => (
                  <li key={q.id} className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white p-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <Badges q={q} />
                      <p className="whitespace-pre-line text-sm text-gray-900">{short(q.questionText)}</p>
                      <p className="text-xs text-gray-500">{Number(q.marks)} mark{Number(q.marks) !== 1 ? "s" : ""}</p>
                    </div>
                    <button onClick={() => edit([...paper, { q, marks: Number(q.marks) }])} className={`${btn} border border-indigo-300 text-indigo-700 hover:bg-indigo-50`}>Add</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
