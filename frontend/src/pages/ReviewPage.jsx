import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { errorMessage } from "../api/client";

const TYPES = [
  ["MCQ", "Multiple choice"],
  ["TRUE_FALSE", "True / False"],
  ["FILL_BLANK", "Fill in the blanks"],
  ["SHORT_ANSWER", "Short answer"],
  ["LONG_ANSWER", "Long answer"],
  ["MATCH", "Match the following"],
  ["CASE_BASED", "Passage based"],
  ["SUBJECTIVE", "Subjective"],
];
const TYPE_LABEL = Object.fromEntries(TYPES);
const DIFF_STYLE = { EASY: "bg-green-100 text-green-800", MEDIUM: "bg-amber-100 text-amber-800", HARD: "bg-red-100 text-red-800" };
const STATUS_STYLE = { DRAFT: "bg-gray-100 text-gray-700", APPROVED: "bg-emerald-100 text-emerald-800", REJECTED: "bg-red-100 text-red-700" };
const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50";

function Answer({ q }) {
  const p = q.payload || {};
  switch (q.type) {
    case "MCQ":
      return (
        <ul className="mt-2 space-y-1 text-sm">
          {q.options.map((o) => (
            <li key={o.position} className={o.correct ? "font-semibold text-emerald-700" : "text-gray-700"}>
              {String.fromCharCode(64 + o.position)}. {o.text}{o.correct ? "  ✓" : ""}
            </li>
          ))}
        </ul>
      );
    case "TRUE_FALSE":
      return <p className="mt-2 text-sm text-emerald-700">Answer: <b>{q.correctAnswer === "true" ? "True" : "False"}</b></p>;
    case "MATCH":
      return (
        <div className="mt-2 grid gap-4 text-sm sm:grid-cols-2">
          <ol className="list-decimal space-y-1 pl-5 text-gray-800">{p.left?.map((l) => <li key={l}>{l}</li>)}</ol>
          <ol className="space-y-1 text-gray-800" style={{ listStyleType: "upper-alpha", paddingLeft: "1.25rem" }}>
            {p.right?.map((r) => <li key={r}>{r}</li>)}
          </ol>
          <p className="text-emerald-700 sm:col-span-2">Answer key: <b>{q.correctAnswer}</b></p>
        </div>
      );
    case "CASE_BASED":
      return (
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
          {p.sub_questions?.map((s) => (
            <li key={s.question}><span className="text-gray-900">{s.question}</span><p className="text-emerald-700">{s.answer}</p></li>
          ))}
        </ol>
      );
    default:
      return (
        <div className="mt-2 text-sm">
          <p className="whitespace-pre-line text-emerald-700">{q.correctAnswer}</p>
          {p.alt_answers?.length > 0 && <p className="text-gray-500">Also accept: {p.alt_answers.join(", ")}</p>}
          {p.marking_points?.length > 0 && <ul className="mt-2 list-disc pl-5 text-gray-600">{p.marking_points.map((m) => <li key={m}>{m}</li>)}</ul>}
        </div>
      );
  }
}

function EditForm({ q, onSave, onCancel, busy }) {
  const [text, setText] = useState(q.questionText);
  const [answer, setAnswer] = useState(q.correctAnswer || "");
  const [expl, setExpl] = useState(q.explanation || "");
  const [diff, setDiff] = useState(q.difficulty);
  const [topic, setTopic] = useState(q.topic);
  const [marks, setMarks] = useState(String(q.marks));
  const [opts, setOpts] = useState(q.options.map((o) => ({ text: o.text, correct: o.correct })));
  const mcq = q.type === "MCQ";

  const submit = () => {
    const body = { questionText: text, explanation: expl, difficulty: diff, topic, marks: Number(marks) };
    if (mcq) body.options = opts;
    else if (q.type !== "MATCH" && q.type !== "CASE_BASED") body.correctAnswer = answer;
    onSave(body);
  };

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
      <label className="block text-xs font-medium text-gray-600">
        {q.type === "CASE_BASED" ? "Passage" : "Question"}
        <textarea className={`${input} mt-1`} rows={q.type === "CASE_BASED" ? 6 : 3} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {mcq && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-600">Options (select the correct one)</p>
          {opts.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="radio" name={`c-${q.id}`} checked={o.correct}
                onChange={() => setOpts(opts.map((x, j) => ({ ...x, correct: j === i })))} />
              <input className={input} value={o.text} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
            </div>
          ))}
        </div>
      )}
      {q.type === "TRUE_FALSE" && (
        <select className={input} value={answer} onChange={(e) => setAnswer(e.target.value)}>
          <option value="true">True</option><option value="false">False</option>
        </select>
      )}
      {!mcq && q.type !== "TRUE_FALSE" && q.fullyEditable && (
        <label className="block text-xs font-medium text-gray-600">Answer
          <textarea className={`${input} mt-1`} rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} />
        </label>
      )}
      {!q.fullyEditable && <p className="text-xs text-gray-500">The pairs / sub-questions of this type are kept as generated. Reject it if they are wrong.</p>}
      <label className="block text-xs font-medium text-gray-600">Explanation
        <input className={`${input} mt-1`} value={expl} onChange={(e) => setExpl(e.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-gray-600">Difficulty
          <select className={`${input} mt-1`} value={diff} onChange={(e) => setDiff(e.target.value)}>
            <option>EASY</option><option>MEDIUM</option><option>HARD</option>
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">Topic
          <input className={`${input} mt-1`} value={topic} onChange={(e) => setTopic(e.target.value)} />
        </label>
        <label className="text-xs font-medium text-gray-600">Marks
          <input className={`${input} mt-1`} type="number" min="0.25" step="0.25" value={marks} onChange={(e) => setMarks(e.target.value)} />
        </label>
      </div>
      <div className="flex gap-2">
        <button disabled={busy} onClick={submit} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}>Save</button>
        <button disabled={busy} onClick={onCancel} className={`${btn} border border-gray-300 hover:bg-gray-100`}>Cancel</button>
      </div>
    </div>
  );
}

function QuestionCard({ q, n, busy, onApprove, onReject, onSave }) {
  const [editing, setEditing] = useState(false);
  const isUrl = /^https?:\/\//.test(q.citationRef || "");
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-gray-500">Q{n}</span>
        <span className="rounded bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700">{TYPE_LABEL[q.type] || q.type}</span>
        <span className={`rounded px-2 py-0.5 font-medium ${DIFF_STYLE[q.difficulty] || ""}`}>{q.difficulty}</span>
        <span className={`rounded px-2 py-0.5 font-medium ${STATUS_STYLE[q.status]}`}>{q.status}</span>
        <span className="text-gray-500">{q.topic}</span>
        <span className="text-gray-500">· {q.marks} mark{Number(q.marks) !== 1 ? "s" : ""}</span>
        {q.payload?.edited_by_teacher && <span className="text-gray-400">· edited</span>}
        {q.usedInExam && <span className="rounded bg-sky-100 px-2 py-0.5 text-sky-800">in an exam</span>}
      </div>
      {editing ? (
        <EditForm q={q} busy={busy} onCancel={() => setEditing(false)}
          onSave={async (body) => { if (await onSave(q.id, body)) setEditing(false); }} />
      ) : (
        <>
          <p className="whitespace-pre-line text-sm font-medium text-gray-900">{q.questionText}</p>
          <Answer q={q} />
          {q.explanation && <p className="mt-2 text-xs text-gray-500">Why: {q.explanation}</p>}
        </>
      )}
      <p className="mt-2 text-xs text-gray-400">
        Source:{" "}
        {isUrl ? <a href={q.citationRef} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">{q.citationRef}</a> : q.citationRef}
        {q.citationRetrievedAt && ` · retrieved ${new Date(q.citationRetrievedAt).toLocaleDateString()}`}
      </p>
      {!editing && (
        <div className="mt-3 flex flex-wrap gap-2">
          {q.status !== "APPROVED" && <button disabled={busy} onClick={() => onApprove(q.id)} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>Approve</button>}
          {q.status !== "REJECTED" && <button disabled={busy || q.usedInExam} onClick={() => onReject(q.id)} className={`${btn} border border-red-300 text-red-700 hover:bg-red-50`}>Reject</button>}
          <button disabled={busy || q.usedInExam} onClick={() => setEditing(true)} className={`${btn} border border-gray-300 hover:bg-gray-100`}>Edit</button>
        </div>
      )}
    </li>
  );
}

export default function ReviewPage() {
  const { sourceId } = useParams();
  const [all, setAll] = useState(null);
  const [status, setStatus] = useState("DRAFT");
  const [type, setType] = useState("ALL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.get("/api/teacher/questions", { params: { sourceId } });
      setAll(r.data);
      setError("");
    } catch (e) { setError(errorMessage(e)); }
  }, [sourceId]);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = { DRAFT: 0, APPROVED: 0, REJECTED: 0 };
    (all || []).forEach((q) => { c[q.status] += 1; });
    return c;
  }, [all]);
  const shown = useMemo(
    () => (all || []).filter((q) => (status === "ALL" || q.status === status) && (type === "ALL" || q.type === type)),
    [all, status, type]);

  const replace = (updated) => setAll((list) => list.map((q) => (q.id === updated.id ? updated : q)));
  const act = async (fn) => {
    setBusy(true); setError(""); setNote("");
    try { return await fn(); } catch (e) { setError(errorMessage(e)); return false; } finally { setBusy(false); }
  };
  const approve = (id) => act(async () => { replace((await api.post(`/api/teacher/questions/${id}/approve`)).data); });
  const reject = (id) => act(async () => { replace((await api.post(`/api/teacher/questions/${id}/reject`)).data); });
  const save = (id, body) => act(async () => { replace((await api.put(`/api/teacher/questions/${id}`, body)).data); return true; });
  const bulk = (action, list) => act(async () => {
    const r = await api.post("/api/teacher/questions/bulk", { action, ids: list.map((q) => q.id) });
    setNote(`${r.data.changed} question(s) updated` + (r.data.skipped.length ? `, ${r.data.skipped.length} skipped (${r.data.skipped[0].reason})` : "."));
    await load();
  });

  const drafts = shown.filter((q) => q.status === "DRAFT");

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <h1 className="text-xl font-bold text-gray-900">Review questions</h1>
          <Link to="/sources" className="text-sm text-indigo-600 hover:underline">← Back to sources</Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-4 px-6 py-6">
        <div className="flex flex-wrap items-center gap-2">
          {["DRAFT", "APPROVED", "REJECTED", "ALL"].map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 text-sm font-medium ${status === s ? "bg-indigo-600 text-white" : "bg-white text-gray-700 ring-1 ring-gray-300 hover:bg-gray-100"}`}>
              {s === "ALL" ? "All" : s[0] + s.slice(1).toLowerCase()}{s !== "ALL" && ` (${counts[s]})`}
            </button>
          ))}
          <select value={type} onChange={(e) => setType(e.target.value)} className="ml-auto rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm">
            <option value="ALL">All types</option>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {drafts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => bulk("APPROVE", drafts)} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>Approve all {drafts.length} shown drafts</button>
            <button disabled={busy} onClick={() => bulk("REJECT", drafts)} className={`${btn} border border-red-300 text-red-700 hover:bg-red-50`}>Reject all {drafts.length}</button>
          </div>
        )}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {note && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{note}</p>}
        {!all && !error && <p className="text-sm text-gray-500">Loading questions…</p>}
        {all && shown.length === 0 && <p className="text-sm text-gray-500">No questions here. Generate some from the sources page, or change the filter.</p>}
        <ul className="space-y-3">
          {shown.map((q, i) => (
            <QuestionCard key={q.id} q={q} n={i + 1} busy={busy} onApprove={approve} onReject={reject} onSave={save} />
          ))}
        </ul>
      </main>
    </div>
  );
}
