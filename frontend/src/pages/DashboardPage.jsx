import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { errorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const ROLE_STYLE = {
  ADMIN: "bg-purple-100 text-purple-800",
  TEACHER: "bg-blue-100 text-blue-800",
  STUDENT: "bg-green-100 text-green-800",
};

const COMING = {
  ADMIN: ["User management", "Platform overview"],
  TEACHER: ["Question paper builder (Step 7)", "Live proctoring dashboard (Step 10)"],
  STUDENT: ["Available exams (Step 8)", "Take an exam (Step 8)", "My results (Step 11)"],
};

function AdminUsers() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/api/admin/users").then((r) => setUsers(r.data)).catch((e) => setError(errorMessage(e)));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!users) return <p className="text-sm text-gray-500">Loading users…</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr><th className="px-4 py-2">Name</th><th className="px-4 py-2">Email</th><th className="px-4 py-2">Role</th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-gray-100">
              <td className="px-4 py-2">{u.fullName}</td>
              <td className="px-4 py-2 text-gray-600">{u.email}</td>
              <td className="px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_STYLE[u.role]}`}>{u.role}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DashboardPage() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <h1 className="text-xl font-bold text-gray-900">EduAI</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">{user.fullName}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROLE_STYLE[user.role]}`}>{user.role}</span>
            <button onClick={logout} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100">Log out</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Welcome, {user.fullName.split(" ")[0]}</h2>
          <p className="text-sm text-gray-500">Signed in as {user.email}</p>
        </div>

        {(user.role === "TEACHER" || user.role === "ADMIN") && (
          <section>
            <Link to="/sources" className="block rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-4 hover:bg-indigo-100">
              <div className="font-semibold text-indigo-900">Study sources</div>
              <div className="text-sm text-indigo-700">Upload material or enter a topic to build your question bank</div>
            </Link>
            <Link to="/exams" className="mt-3 block rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 hover:bg-emerald-100">
              <div className="font-semibold text-emerald-900">Exams</div>
              <div className="text-sm text-emerald-700">Build question papers and mock exams from approved questions, then publish</div>
            </Link>
          </section>
        )}

        {user.role === "ADMIN" && (
          <section>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">All users</h3>
            <AdminUsers />
          </section>
        )}

        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Coming next</h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {COMING[user.role].map((item) => (
              <li key={item} className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-sm text-gray-600">{item}
              COMING.TEACHER delete "Question paper builder (Step 7)"
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
