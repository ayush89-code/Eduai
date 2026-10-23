import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import aiApi, { aiErrorMessage } from "../api/aiClient";
import { useAuth } from "../auth/AuthContext";
import GeneratePanel from "./GeneratePanel";

const STATUS_STYLE = {
  PENDING: "bg-yellow-100 text-yellow-800",
  PROCESSING: "bg-blue-100 text-blue-800",
  READY: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
};
const INDEX_STYLE = {
  pending: "bg-gray-100 text-gray-600",
  indexing: "bg-blue-100 text-blue-800",
  indexed: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};
const ACTIVE = ["PENDING", "PROCESSING"];
const MAX_MB = 20;

const card = "rounded-2xl border border-gray-100 bg-white p-6 shadow-sm";
const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const button = "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50";

function Toggle({ checked, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="flex items-center gap-3 text-left">
      <span className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-indigo-600" : "bg-gray-300"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
      </span>
      <span className="text-sm font-medium text-gray-800">{label}</span>
    </button>
  );
}

function UploadCard({ onDone, onError }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) return onError(`File is larger than ${MAX_MB} MB.`);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await aiApi.post("/api/ingest/document", form);
      setFile(null);
      e.target.reset();
      onDone();
    } catch (err) {
      onError(aiErrorMessage(err, "Upload failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className={card}>
      <h3 className="font-semibold text-gray-900">Upload study material</h3>
      <p className="mb-4 text-sm text-gray-500">PDF, DOCX, PPTX or TXT, up to {MAX_MB} MB. Scanned (image-only) files are not supported yet.</p>
      <input type="file" accept=".pdf,.docx,.pptx,.txt" onChange={(e) => setFile(e.target.files[0] || null)}
        className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-indigo-700" />
      <button type="submit" disabled={!file || busy} className={`${button} mt-4`}>{busy ? "Uploading…" : "Upload & extract"}</button>
    </form>
  );
}

function TopicCard({ usage, onDone, onError }) {
  const [topic, setTopic] = useState("");
  const [useWeb, setUseWeb] = useState(true);
  const [busy, setBusy] = useState(false);

  const capReached = usage && usage.searchesThisMonth >= usage.monthlyCap;
  const blocked = useWeb && usage && (!usage.configured || capReached);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await aiApi.post("/api/ingest/topic", { topic, useWebSearch: useWeb });
      setTopic("");
      onDone(res.data.reused ? "Reused the sources you already saved for this topic (no search credit used)." : null);
    } catch (err) {
      onError(aiErrorMessage(err, "Could not submit the topic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className={card}>
      <h3 className="font-semibold text-gray-900">Or enter a topic</h3>
      <p className="mb-4 text-sm text-gray-500">e.g. Aerospace, Mathematics. Every question will cite the web page it came from.</p>
      <input className={input} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic" minLength={3} maxLength={200} required />
      <div className="mt-4 space-y-1">
        <Toggle checked={useWeb} onChange={setUseWeb} label="Search the web for fresh sources" />
        <p className="pl-14 text-xs text-gray-500">
          {useWeb ? "Runs a new search (uses 1 search credit)." : "Reuses the sources you already saved for this topic (no credits used)."}
        </p>
      </div>
      {usage && (
        <p className="mt-3 text-xs text-gray-500">
          Web searches this month: <b>{usage.searchesThisMonth}</b> / {usage.monthlyCap} · provider: {usage.provider}
        </p>
      )}
      {useWeb && usage && !usage.configured && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Web search is not configured. Add your API key to <code>.env</code>, or turn the switch off to reuse saved sources.
        </p>
      )}
      {useWeb && capReached && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Monthly search cap reached. Turn the switch off to reuse saved sources.</p>
      )}
      <button type="submit" disabled={busy || blocked || topic.trim().length < 3} className={`${button} mt-4`}>
        {busy ? "Submitting…" : useWeb ? "Search & extract" : "Use saved sources"}
      </button>
    </form>
  );
}
// Step 5: shows whether a READY source has been chunked + embedded for question generation.
function IndexBadge({ sourceId, onError }) {
  const [info, setInfo] = useState(null);
  const [tick, setTick] = useState(0); // bump to restart polling

  useEffect(() => {
    let cancelled = false;
    let timer;
    let tries = 0;
    const load = async () => {
      try {
        const { data } = await aiApi.get(`/api/rag/status/${sourceId}`);
        if (cancelled) return;
        setInfo(data);
        tries += 1;
        const waiting = data.status === "indexing" || (data.status === "pending" && tries < 10);
        if (waiting) timer = setTimeout(load, 3000);
      } catch {
        /* the badge is informational; a failed poll just stops it updating */
      }
    };
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [sourceId, tick]);

  const start = async () => {
    try {
      await aiApi.post("/api/rag/embed", { source_id: sourceId });
      setTick((t) => t + 1);
    } catch (err) {
      onError(aiErrorMessage(err, "Could not start indexing"));
    }
  };

  if (!info) return null;
  const labels = {
    pending: "Not indexed yet",
    indexing: "Indexing…",
    indexed: `Indexed · ${info.chunk_count} chunks`,
    failed: "Index failed",
  };
  const firstError = (info.documents || []).find((d) => d.error)?.error;
  const canStart = info.status === "pending" || info.status === "failed";

  return (
    <>
      <span title={firstError || ""}
        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${INDEX_STYLE[info.status] || INDEX_STYLE.pending}`}>
        {labels[info.status] || info.status}
      </span>
      {canStart && (
        <button onClick={start} className="text-sm text-indigo-600 hover:underline">
          {info.status === "failed" ? "Retry" : "Index now"}
        </button>
      )}
    </>
  );
}
function SourceRow({ s, onDelete, onError }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [gen, setGen] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      try {
        setDetail((await aiApi.get(`/api/ingest/sources/${s.id}`)).data);
      } catch (err) {
        onError(aiErrorMessage(err));
      }
    }
  };

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{s.kind === "TOPIC" ? "Topic" : "File"}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-gray-900" title={s.title}>{s.title}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[s.status]}`}>{s.status}</span>
        {s.status === "READY" && <IndexBadge sourceId={s.id} onError={onError} />}
        {s.status === "READY" && <button onClick={toggle} className="text-sm text-indigo-600 hover:underline">{open ? "Hide" : "Details"}</button>}
          
        {s.status === "READY" && <button onClick={() => setGen(!gen)} className="text-sm font-medium text-indigo-600 hover:underline">{gen ? "Close" : "Generate questions"}</button>}
        {s.status === "READY" && (
         <Link to={`/sources/${s.id}/review`} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100">Review questions</Link>
       )}

        <button onClick={() => onDelete(s)} className="text-sm text-gray-400 hover:text-red-600">Delete</button>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {new Date(s.createdAt).toLocaleString()}
        {s.status === "READY" && ` · ${s.documents} ${s.kind === "TOPIC" ? "web page(s)" : "file"} · ${s.chars.toLocaleString()} characters`}
      </p>
      {s.status === "FAILED" && s.error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{s.error}</p>}
      {open && detail && (
        <ul className="mt-3 space-y-2 rounded-lg bg-gray-50 p-3 text-sm">
          {detail.documentList.map((d) => (
            <li key={d.id} className="flex flex-wrap justify-between gap-2">
              {d.url ? (
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="truncate text-indigo-600 hover:underline">{d.title || d.url}</a>
              ) : (
                <span className="truncate text-gray-800">{d.filename}</span>
              )}
              <span className="text-xs text-gray-500">retrieved {new Date(d.retrievedAt).toLocaleDateString()} · {d.chars.toLocaleString()} chars</span>
            </li>
          ))}
        </ul>
      )}

      {gen && s.status === "READY" && <GeneratePanel sourceId={s.id} onError={onError} />}
    </li>
  );
}

export default function SourcesPage() {
  const { user } = useAuth();
  const [sources, setSources] = useState(null);
  const [usage, setUsage] = useState(null);
  const [message, setMessage] = useState(null); // {type: "error" | "info", text}

  const refresh = useCallback(async () => {
    try {
      const [list, use] = await Promise.all([aiApi.get("/api/ingest/sources"), aiApi.get("/api/ingest/usage")]);
      setSources(list.data);
      setUsage(use.data);
    } catch (err) {
      setMessage({ type: "error", text: aiErrorMessage(err, "Could not load sources") });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll while anything is still being processed.
  const hasActive = sources?.some((s) => ACTIVE.includes(s.status));
  useEffect(() => {
    if (!hasActive) return undefined;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [hasActive, refresh]);

  const onError = (text) => setMessage({ type: "error", text });
  const onDone = (info) => { setMessage(info ? { type: "info", text: info } : null); refresh(); };

  const remove = async (s) => {
    if (!window.confirm(`Delete "${s.title}"? This cannot be undone.`)) return;
    try {
      await aiApi.delete(`/api/ingest/sources/${s.id}`);
      refresh();
    } catch (err) {
      onError(aiErrorMessage(err, "Could not delete"));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-sm text-indigo-600 hover:underline">← Dashboard</Link>
            <h1 className="text-xl font-bold text-gray-900">Study sources</h1>
          </div>
          <span className="text-sm text-gray-600">{user.fullName}</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        {message && (
          <p className={`rounded-lg px-4 py-3 text-sm ${message.type === "error" ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>{message.text}</p>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <UploadCard onDone={onDone} onError={onError} />
          <TopicCard usage={usage} onDone={onDone} onError={onError} />
        </div>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Your sources</h2>
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
            {sources === null ? (
              <p className="p-5 text-sm text-gray-500">Loading…</p>
            ) : sources.length === 0 ? (
              <p className="p-5 text-sm text-gray-500">Nothing here yet. Upload a file or enter a topic above.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {sources.map((s) => <SourceRow key={s.id} s={s} onDelete={remove} onError={onError} />)}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
