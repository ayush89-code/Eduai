import { useEffect, useState } from "react";
import aiApi, { aiErrorMessage } from "../api/aiClient";

const COUNTS = [10, 30, 50];
const TYPES = [
  ["MCQ", "Multiple choice"],
  ["TRUE_FALSE", "True / False"],
  ["FILL_BLANK", "Fill in the blanks"],
  ["SHORT_ANSWER", "Short answer"],
  ["LONG_ANSWER", "Long answer"],
  ["MATCH", "Match the following"],
  ["CASE_BASED", "Passage based"],
];
const TYPE_LABEL = Object.fromEntries(TYPES);
const DIFF_STYLE = {
  EASY: "bg-green-100 text-green-800",
  MEDIUM: "bg-amber-100 text-amber-800",
  HARD: "bg-red-100 text-red-800",
};
const ACTIVE = ["QUEUED", "RUNNING"];
const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const button = "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50";

function Answer({ q }) {
  const p = q.payload || {};
  switch (q.type) {
    case "MCQ":
      return (
        <ul className="mt-2 space-y-1 text-sm">
          {q.options.map((o) => (
            <li key={o.position} className={o.is_correct ? "font-semibold text-emerald-700" : "text-gray-700"}>
              {String.fromCharCode(64 + o.position)}. {o.text}{o.is_correct ? "  ✓" : ""}
            </li>
          ))}
        </ul>
      );
    case "TRUE_FALSE":
      return <p className="mt-2 text-sm text-emerald-700">Answer: <b>{q.correct_answer === "true" ? "True" : "False"}</b></p>;
    case "FILL_BLANK":
      return (
        <p className="mt-2 text-sm text-emerald-700">
          Answer: <b>{q.correct_answer}</b>
          {p.alt_answers?.length > 0 && <span className="text-gray-500"> (also accept: {p.alt_answers.join(", ")})</span>}
        </p>
      );
    case "MATCH":
      return (
        <div className="mt-2 grid gap-4 text-sm sm:grid-cols-2">
          <ol className="list-decimal space-y-1 pl-5 text-gray-800">{p.left?.map((l) => <li key={l}>{l}</li>)}</ol>
          <ol className="space-y-1 text-gray-800" style={{ listStyleType: "upper-alpha", paddingLeft: "1.25rem" }}>
            {p.right?.map((r) => <li key={r}>{r}</li>)}
          </ol>
          <p className="text-emerald-700 sm:col-span-2">Answer key: <b>{q.correct_answer}</b></p>
        </div>
      );
    case "CASE_BASED":
      return (
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
          {p.sub_questions?.map((s) => (
            <li key={s.question}>
              <span className="text-gray-900">{s.question}</span>
              <p className="text-emerald-700">{s.answer}</p>
            </li>
          ))}
        </ol>
      );
    default: // SHORT_ANSWER, LONG_ANSWER
      return (
        <div className="mt-2 text-sm">
          <p className="whitespace-pre-line text-emerald-700">{q.correct_answer}</p>
          {p.marking_points?.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-gray-600">{p.marking_points.map((m) => <li key={m}>{m}</li>)}</ul>
          )}
        </div>
      );
  }
}

function QuestionCard({ q, n }) {
  const isUrl = /^https?:\/\//.test(q.citation_ref || "");
  return (
    <li className="rounded-lg border border-gray-100 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-gray-500">Q{n}</span>
        <span className="rounded bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700">{TYPE_LABEL[q.type] || q.type}</span>
        <span className={`rounded px-2 py-0.5 font-medium ${DIFF_STYLE[q.difficulty] || ""}`}>{q.difficulty}</span>
        <span className="text-gray-500">{q.topic}</span>
        {q.payload?.marks != null && <span className="text-gray-500">· {q.payload.marks} mark{q.payload.marks > 1 ? "s" : ""}</span>}
        {q.payload?.generated_by === "mock" && <span className="rounded bg-gray-200 px-2 py-0.5 text-gray-600">offline test</span>}
      </div>
      <p className="whitespace-pre-line text-sm font-medium text-gray-900">{q.question_text}</p>
      <Answer q={q} />
      {q.explanation && <p className="mt-2 text-xs text-gray-500">Why: {q.explanation}</p>}
      <p className="mt-2 text-xs text-gray-400">
        Source:{" "}
        {isUrl ? <a href={q.citation_ref} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">{q.citation_ref}</a> : q.citation_ref}
        {q.citation_retrieved_at && ` · retrieved ${new Date(q.citation_retrieved_at).toLocaleDateString()}`}
      </p>
    </li>
  );
}

export default function GeneratePanel({ sourceId, onError }) {
  const [count, setCount] = useState(10);
  const [selected, setSelected] = useState(() => new Set(TYPES.map(([t]) => t)));
  const [focus, setFocus] = useState("");
  const [job, setJob] = useState(null);
  const [questions, setQuestions] = useState(null);
  const [busy, setBusy] = useState(false);

  // Show the most recent job of this source (so a page reload keeps the results).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await aiApi.get(`/api/generate/sources/${sourceId}/jobs`);
        if (!cancelled) setJob(data[0] || null);
      } catch { /* optional: the panel just starts empty */ }
    })();
    return () => { cancelled = true; };
  }, [sourceId]);

  // Poll while a job is running.
  useEffect(() => {
    if (!job || !ACTIVE.includes(job.status)) return undefined;
    const id = setInterval(async () => {
      try {
        const { data } = await aiApi.get(`/api/generate/jobs/${job.id}`);
        setJob(data);
      } catch { /* try again on the next tick */ }
    }, 2500);
    return () => clearInterval(id);
  }, [job?.id, job?.status]);

  // Load the questions once the job is done.
  useEffect(() => {
    if (!job || job.status !== "DONE") { setQuestions(null); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await aiApi.get(`/api/generate/jobs/${job.id}/questions`);
        if (!cancelled) setQuestions(data);
      } catch (err) {
        onError(aiErrorMessage(err, "Could not load the questions"));
      }
    })();
    return () => { cancelled = true; };
  }, [job?.id, job?.status]);

  const toggleType = (t) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(t)) next.delete(t); else next.add(t);
    return next;
  });

  const generate = async () => {
    setBusy(true);
    try {
      const { data } = await aiApi.post("/api/generate/jobs", {
        source_id: sourceId, count, types: [...selected], focus: focus.trim() || null,
      });
      setQuestions(null);
      setJob(data);
    } catch (err) {
      onError(aiErrorMessage(err, "Could not start generating questions"));
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!job || !window.confirm("Discard these generated questions? This cannot be undone.")) return;
    try {
      await aiApi.delete(`/api/generate/jobs/${job.id}`);
      setQuestions(null);
      setJob(null);
    } catch (err) {
      onError(aiErrorMessage(err, "Could not discard the questions"));
    }
  };

  const running = job && ACTIVE.includes(job.status);
  const pct = job && job.requested_count ? Math.min(100, Math.round((100 * job.generated_count) / job.requested_count)) : 0;

  return (
    <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
      <h4 className="font-semibold text-gray-900">Generate questions</h4>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <label className="text-sm text-gray-700">
          <span className="mb-1 block font-medium">Number of questions</span>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))} disabled={running}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            {COUNTS.map((c) => <option key={c} value={c}>{c} questions</option>)}
          </select>
        </label>
        <label className="min-w-[220px] flex-1 text-sm text-gray-700">
          <span className="mb-1 block font-medium">Focus on (optional)</span>
          <input className={input} value={focus} maxLength={200} disabled={running}
            onChange={(e) => setFocus(e.target.value)} placeholder="e.g. tenses, or a chapter name" />
        </label>
      </div>

      <fieldset className="mt-3" disabled={running}>
        <legend className="mb-1 text-sm font-medium text-gray-700">Question types</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {TYPES.map(([t, label]) => (
            <label key={t} className="flex items-center gap-1.5 text-sm text-gray-700">
              <input type="checkbox" checked={selected.has(t)} onChange={() => toggleType(t)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <button onClick={generate} disabled={busy || running || selected.size === 0} className={`${button} mt-4`}>
        {running ? "Generating…" : `Generate ${count} questions`}
      </button>

      {running && (
        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full bg-indigo-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs text-gray-600">{job.generated_count} of {job.requested_count} ready…</p>
        </div>
      )}

      {job?.status === "FAILED" && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{job.error || "Generation failed."}</p>
      )}
      {job?.status === "DONE" && job.error && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{job.error}</p>
      )}
      {job?.status === "DONE" && job.mode === "mock" && (
        <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Offline test mode: no AI key is configured, so these are simple template questions that only prove the
          pipeline works. Add a Gemini or Groq key to get real exam questions.
        </p>
      )}

      {job && (job.status === "DONE" || job.status === "FAILED") && (
        <button onClick={discard} className="mt-3 text-sm text-gray-500 hover:text-red-600">
          {job.status === "DONE" ? "Discard these questions" : "Clear this attempt"}
        </button>
      )}

      {questions && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold text-gray-800">
            {questions.length} questions
            <span className="ml-2 font-normal text-gray-500">
              {Object.entries(job.by_type || {}).map(([t, n]) => `${TYPE_LABEL[t] || t} ${n}`).join(" · ")}
            </span>
          </p>
          <ul className="space-y-3">
            {questions.map((q, i) => <QuestionCard key={q.id} q={q} n={i + 1} />)}
          </ul>
        </div>
      )}
    </div>
  );
}
