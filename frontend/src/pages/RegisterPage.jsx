import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { errorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import AuthLayout, { buttonClass, inputClass } from "../components/AuthLayout";

export default function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: "", email: "", password: "", role: "STUDENT" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await register(form);
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err, "Registration failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      footer={<>Already registered? <Link to="/login" className="font-semibold text-indigo-600 hover:underline">Sign in</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Full name</label>
          <input required className={inputClass} value={form.fullName} onChange={set("fullName")} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
          <input type="email" required className={inputClass} value={form.email} onChange={set("email")} autoComplete="username" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Password</label>
          <input type="password" required minLength={8} maxLength={72} className={inputClass} value={form.password} onChange={set("password")} autoComplete="new-password" />
          <p className="mt-1 text-xs text-gray-400">At least 8 characters.</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">I am a</label>
          <select className={inputClass} value={form.role} onChange={set("role")}>
            <option value="STUDENT">Student</option>
            <option value="TEACHER">Teacher</option>
          </select>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={busy} className={buttonClass}>{busy ? "Creating account…" : "Create account"}</button>
      </form>
    </AuthLayout>
  );
}
