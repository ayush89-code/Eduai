import BackendStatus from "./BackendStatus";

export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="rounded-2xl bg-white p-8 shadow-sm border border-gray-100">
          <h1 className="text-2xl font-bold text-gray-900">EduAI</h1>
          <p className="text-xs text-gray-400">Intelligent Examination &amp; Assessment Platform</p>
          <h2 className="mt-6 text-lg font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
          <div className="mt-5">{children}</div>
          {footer && <div className="mt-5 text-sm text-gray-500 text-center">{footer}</div>}
        </div>
        <div className="mt-4 px-2">
          <BackendStatus />
        </div>
      </div>
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
export const buttonClass =
  "w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60";
