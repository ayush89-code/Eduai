import { useEffect, useState } from "react";
import api, { errorMessage } from "../api/client";

const LEVEL_STYLE = { LOW: "bg-emerald-100 text-emerald-800", MEDIUM: "bg-amber-100 text-amber-800", HIGH: "bg-red-100 text-red-700" };
const SEV_STYLE = { LOW: "text-gray-500", MEDIUM: "text-amber-700", HIGH: "font-semibold text-red-700" };

/** Teacher: the proctoring record of one attempt (risk level, counts, timeline). */
export default function ProctorPanel({ attemptId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.get(`/api/teacher/attempts/${attemptId}/proctoring`).then((r) => setData(r.data)).catch((e) => setError(errorMessage(e)));
  }, [attemptId]);

  if (error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!data) return null;
  const kinds = Object.entries(data.countsByType);

  return (
    <section className="rounded-xl border border-gray-200 bg-white px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Proctoring</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${LEVEL_STYLE[data.riskLevel]}`}>Risk: {data.riskLevel}</span>
        <span className="text-sm text-gray-600">{data.flagCount} flag{data.flagCount === 1 ? "" : "s"} · score {data.riskScore}</span>
        {data.events.length > 0 && <button onClick={() => setOpen(!open)} className="ml-auto text-sm text-indigo-600 hover:underline">{open ? "Hide timeline" : "Show timeline"}</button>}
      </div>
      {kinds.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">No events were recorded for this attempt.</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {kinds.map(([k, n]) => <span key={k} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{k.replaceAll("_", " ").toLowerCase()} × {n}</span>)}
        </div>
      )}
      {open && (
        <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto text-sm">
          {data.events.map((e, i) => (
            <li key={i} className="flex flex-wrap gap-x-3 border-t border-gray-100 py-1">
              <span className="w-20 text-gray-400">{new Date(e.occurredAt).toLocaleTimeString()}</span>
              <span className={`w-40 ${SEV_STYLE[e.severity]}`}>{e.type.replaceAll("_", " ").toLowerCase()}</span>
              <span className="text-xs text-gray-500">{Object.entries(e.metadata || {}).map(([k, v]) => `${k}: ${v}`).join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
