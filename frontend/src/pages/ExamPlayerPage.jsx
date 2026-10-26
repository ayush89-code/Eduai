import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api, { errorMessage } from "../api/client";
import { parseMap } from "../components/ResultItemCard";
import ProctorGuard from "../proctor/ProctorGuard";

const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const L = (i) => String.fromCharCode(65 + i);

const isAnswered = (q, a) => {
  if (!a) return false;
  if (q.type === "MCQ") return a.optionPosition != null;
  return !!(a.text && a.text.trim());
};

const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`;
};

/** The answer input for one question, by type. onChange gets { optionPosition } or { text }. */
function AnswerInput({ q, a, onChange }) {
  const text = a?.text || "";
  switch (q.type) {
    case "MCQ":
      return (
        <div className="space-y-2">
          {q.options.map((o, i) => (
            <button key={o.position} onClick={() => onChange({ optionPosition: o.position })}
              className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm ${a?.optionPosition === o.position ? "border-indigo-500 bg-indigo-50" : "border-gray-300 bg-white hover:bg-gray-50"}`}>
              <span className="font-semibold text-gray-500">{L(i)}</span><span>{o.text}</span>
            </button>
          ))}
        </div>
      );
    case "TRUE_FALSE":
      return (
        <div className="flex gap-3">
          {["true", "false"].map((v) => (
            <button key={v} onClick={() => onChange({ text: v })}
              className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium ${text === v ? "border-indigo-500 bg-indigo-50" : "border-gray-300 bg-white hover:bg-gray-50"}`}>
              {v === "true" ? "True" : "False"}
            </button>
          ))}
        </div>
      );
    case "FILL_BLANK":
      return <input className={input} value={text} placeholder="Type your answer" onChange={(e) => onChange({ text: e.target.value })} />;
    case "MATCH": {
      const map = parseMap(text);
      const set = (i, v) => {
        const next = { ...map, [String(i + 1)]: v };
        if (!v) delete next[String(i + 1)];
        onChange({ text: Object.keys(next).length ? JSON.stringify(next) : "" });
      };
      return (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-gray-500">Column A</p>
              <ol className="space-y-2 text-sm">
                {q.left.map((l, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="w-5 text-gray-500">{i + 1}.</span><span className="flex-1">{l}</span>
                    <select className="rounded-lg border border-gray-300 px-2 py-1 text-sm" value={map[String(i + 1)] || ""} onChange={(e) => set(i, e.target.value)}>
                      <option value="">–</option>
                      {q.right.map((_, j) => <option key={j} value={L(j)}>{L(j)}</option>)}
                    </select>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-gray-500">Column B</p>
              <ul className="space-y-2 text-sm">{q.right.map((r, j) => <li key={j}><span className="mr-2 text-gray-500">{L(j)}.</span>{r}</li>)}</ul>
            </div>
          </div>
        </div>
      );
    }
    case "CASE_BASED": {
      const map = parseMap(text);
      const set = (i, v) => {
        const next = { ...map, [String(i + 1)]: v };
        if (!v.trim()) delete next[String(i + 1)];
        onChange({ text: Object.keys(next).length ? JSON.stringify(next) : "" });
      };
      return (
        <ol className="space-y-4">
          {(q.subQuestions || []).map((s, i) => (
            <li key={i}>
              <p className="mb-1 text-sm font-medium text-gray-800">{i + 1}. {s}</p>
              <textarea rows={3} className={input} value={map[String(i + 1)] || ""} onChange={(e) => set(i, e.target.value)} />
            </li>
          ))}
        </ol>
      );
    }
    default:
      return <textarea rows={q.type === "LONG_ANSWER" ? 10 : 5} className={input} value={text} placeholder="Write your answer" onChange={(e) => onChange({ text: e.target.value })} />;
  }
}

export default function ExamPlayerPage() {
  const { attemptId } = useParams();
  const nav = useNavigate();
  const [att, setAtt] = useState(null);
  const [answers, setAnswers] = useState({});
  const [idx, setIdx] = useState(0);
  const [saveState, setSaveState] = useState("saved");   // saved | saving | error
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const latest = useRef({});          // questionId -> { optionPosition, text }
  const dirty = useRef(new Set());
  const timers = useRef({});
  const offset = useRef(0);           // server clock - this computer's clock
  const submittingRef = useRef(false);
  const result = `/student/attempts/${attemptId}/result`;

  useEffect(() => {
    api.get(`/api/student/attempts/${attemptId}`).then((r) => {
      if (r.data.status !== "IN_PROGRESS") { nav(result, { replace: true }); return; }
      offset.current = new Date(r.data.serverNow).getTime() - Date.now();
      latest.current = { ...r.data.answers };
      setAnswers({ ...r.data.answers });
      setAtt(r.data);
    }).catch((e) => setError(errorMessage(e)));
  }, [attemptId, nav, result]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // never lose typing when the tab is closed or refreshed in the middle of a save
  useEffect(() => {
    const warn = (e) => { if (dirty.current.size > 0) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const send = useCallback(async (qid) => {
    const a = latest.current[qid] || {};
    setSaveState("saving");
    try {
      await api.put(`/api/student/attempts/${attemptId}/answers/${qid}`, { optionPosition: a.optionPosition ?? null, text: a.text ?? "" });
      dirty.current.delete(qid);
      if (dirty.current.size === 0) setSaveState("saved");
      return true;
    } catch (e) {
      if (e.response?.status === 409) { nav(result, { replace: true }); return true; }   // time is up / already submitted
      setSaveState("error");
      return false;
    }
  }, [attemptId, nav, result]);

  const change = (qid, patch, immediate) => {
    const next = { ...(latest.current[qid] || {}), ...patch };
    latest.current = { ...latest.current, [qid]: next };
    setAnswers(latest.current);
    dirty.current.add(qid);
    clearTimeout(timers.current[qid]);
    timers.current[qid] = setTimeout(() => send(qid), immediate ? 0 : 800);
    setSaveState("saving");
  };

  const submit = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true); setConfirm(false); setError("");
    Object.values(timers.current).forEach(clearTimeout);
    await Promise.all([...dirty.current].map(send));
    try {
      await api.post(`/api/student/attempts/${attemptId}/submit`);
      nav(result, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [attemptId, nav, result, send]);

  const remaining = att ? new Date(att.deadline).getTime() - (now + offset.current) : 0;
  useEffect(() => { if (att && remaining <= 0) submit(); }, [att, remaining, submit]);

  const unanswered = useMemo(() => (att ? att.questions.filter((q) => !isAnswered(q, answers[q.id])).length : 0), [att, answers]);

  if (!att) return <div className="p-8 text-sm text-gray-500">{error || "Loading your exam…"}</div>;
  const q = att.questions[idx];
  const low = remaining < 60_000;

  return (
    <div className="min-h-screen bg-gray-50">
      <ProctorGuard attemptId={attemptId} />
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <h1 className="truncate text-lg font-bold text-gray-900">{att.examTitle}</h1>
          <div className="flex items-center gap-4">
            <span className={`text-xs ${saveState === "error" ? "font-semibold text-red-600" : "text-gray-500"}`}>
              {saveState === "saved" ? "All answers saved" : saveState === "saving" ? "Saving…" : "Could not save – check your connection"}
            </span>
            <span className={`rounded-lg px-3 py-1 font-mono text-lg font-bold ${low ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-800"}`}>{clock(remaining)}</span>
            <button disabled={submitting} onClick={() => setConfirm(true)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">Submit</button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-6 py-6 lg:grid-cols-[1fr_220px]">
        <section className="space-y-4">
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between text-xs text-gray-500">
              <span className="font-semibold">Question {idx + 1} of {att.questions.length}</span>
              <span>{Number(q.marks)} mark{Number(q.marks) !== 1 ? "s" : ""}</span>
            </div>
            <p className="mb-4 whitespace-pre-line text-base font-medium text-gray-900">{q.text}</p>
            <AnswerInput q={q} a={answers[q.id]} onChange={(patch) => change(q.id, patch, q.type === "MCQ" || q.type === "TRUE_FALSE")} />
          </div>
          <div className="flex justify-between">
            <button disabled={idx === 0} onClick={() => setIdx(idx - 1)} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-gray-100 disabled:opacity-40">← Previous</button>
            <button disabled={idx === att.questions.length - 1} onClick={() => setIdx(idx + 1)} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-gray-100 disabled:opacity-40">Next →</button>
          </div>
        </section>

        <aside className="h-fit rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Questions</p>
          <div className="grid grid-cols-5 gap-2">
            {att.questions.map((x, i) => (
              <button key={x.id} onClick={() => setIdx(i)}
                className={`h-9 rounded-lg text-sm font-semibold ${i === idx ? "ring-2 ring-indigo-500 " : ""}${isAnswered(x, answers[x.id]) ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-600"}`}>
                {i + 1}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-500"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-400" />answered · <span className="mr-1 inline-block h-2 w-2 rounded-full bg-gray-300" />not yet</p>
        </aside>
      </main>

      {confirm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Submit your exam?</h2>
            <p className="mt-2 text-sm text-gray-600">
              {unanswered > 0 ? `${unanswered} question${unanswered > 1 ? "s are" : " is"} not answered. ` : "All questions are answered. "}
              You cannot change your answers after submitting.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirm(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100">Keep working</button>
              <button onClick={submit} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Submit now</button>
            </div>
          </div>
        </div>
      )}
      {submitting && <div className="fixed inset-0 z-30 flex items-center justify-center bg-white/70 text-sm text-gray-700">Submitting…</div>}
    </div>
  );
}
