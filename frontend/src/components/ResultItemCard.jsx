// One question of a finished attempt: the student's answer, the key, marks and feedback.
// Used by the student's result page and the teacher's review page (children = marking controls).

const TYPE_LABEL = {
  MCQ: "Multiple choice", TRUE_FALSE: "True / False", FILL_BLANK: "Fill in the blanks", SHORT_ANSWER: "Short answer",
  LONG_ANSWER: "Long answer", MATCH: "Match the following", CASE_BASED: "Passage based", SUBJECTIVE: "Subjective",
};

export const parseMap = (text) => {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
};

const letter = (i) => String.fromCharCode(65 + i);

function badge(item) {
  const marks = Number(item.marks);
  const got = item.awarded == null ? null : Number(item.awarded);
  if (item.grading === "UNANSWERED") return ["Not answered", "bg-gray-100 text-gray-600"];
  if (item.grading === "AWAITING") return ["Waiting for the teacher", "bg-sky-100 text-sky-800"];
  if (got === marks) return ["Correct", "bg-emerald-100 text-emerald-800"];
  if (got === 0) return ["Wrong", "bg-red-100 text-red-700"];
  return ["Partly correct", "bg-amber-100 text-amber-800"];
}

function Answer({ item, who }) {
  const p = item.payload || {};
  const text = who === "student" ? item.studentAnswer : item.correctAnswer;
  if (item.type === "MATCH") {
    const map = who === "student" ? parseMap(text) : (p.answer_key || {});
    return (
      <ul className="space-y-0.5 text-sm">
        {(p.left || []).map((l, i) => {
          const pick = map[String(i + 1)];
          const idx = pick ? pick.toString().toUpperCase().charCodeAt(0) - 65 : -1;
          return <li key={i}>{i + 1}. {l} <span className="text-gray-400">→</span> {pick ? `${String(pick).toUpperCase()}. ${(p.right || [])[idx] ?? ""}` : <em className="text-gray-400">none</em>}</li>;
        })}
      </ul>
    );
  }
  if (item.type === "CASE_BASED") {
    const map = who === "student" ? parseMap(text) : null;
    return (
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        {(p.sub_questions || []).map((s, i) => (
          <li key={i}>
            <span className="text-gray-700">{s.question}</span>
            <p className="whitespace-pre-line">{who === "student" ? (map[String(i + 1)] || <em className="text-gray-400">no answer</em>) : s.answer}</p>
          </li>
        ))}
      </ol>
    );
  }
  if (!text) return <em className="text-sm text-gray-400">no answer</em>;
  if (item.type === "TRUE_FALSE") return <p className="text-sm">{text.toLowerCase() === "true" ? "True" : "False"}</p>;
  return <p className="whitespace-pre-line text-sm">{text}</p>;
}

export default function ResultItemCard({ item, children }) {
  const [label, style] = badge(item);
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-gray-500">Q{item.position}</span>
        <span className="rounded bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700">{TYPE_LABEL[item.type] || item.type}</span>
        <span className={`rounded px-2 py-0.5 font-medium ${style}`}>{label}</span>
        <span className="ml-auto font-semibold text-gray-700">{item.awarded == null ? "–" : Number(item.awarded)} / {Number(item.marks)}</span>
      </div>
      <p className="whitespace-pre-line text-sm font-medium text-gray-900">{item.questionText}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Student's answer</p>
          <Answer item={item} who="student" />
        </div>
        <div className="rounded-lg bg-emerald-50 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">Correct answer</p>
          <Answer item={item} who="key" />
        </div>
      </div>
      {item.explanation && <p className="mt-2 text-xs text-gray-500">Why: {item.explanation}</p>}
      {item.feedback && <p className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900">Teacher: {item.feedback}</p>}
      {children}
    </li>
  );
}
