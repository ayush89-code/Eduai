import { useEffect, useState } from "react";
import axios from "axios";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import ProtectedRoute from "./auth/ProtectedRoute";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import SourcesPage from "./pages/SourcesPage";
import ReviewPage from "./pages/ReviewPage";
 import PapersPage from "./pages/PapersPage";
       import PaperBuilderPage from "./pages/PaperBuilderPage";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

function StatusBadge({ label, status }) {
  const color =
    status === "UP" ? "bg-green-100 text-green-800" : status === "checking" ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800";
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
      <span className="font-medium text-gray-700">{label}</span>
      <span className={`rounded-full px-3 py-1 text-sm font-semibold ${color}`}>
        {status === "checking" ? "checking…" : status}
      </span>
    </div>
  );
}

export default function App() {
  const [backendStatus, setBackendStatus] = useState("checking");

  useEffect(() => {
    axios
      .get(`${API_BASE_URL}/api/health`)
      .then(() => setBackendStatus("UP"))
      .catch(() => setBackendStatus("DOWN"));
  }, []);

    return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/sources" element={<ProtectedRoute roles={["TEACHER", "ADMIN"]}><SourcesPage /></ProtectedRoute>} />
          <Route path="/sources/:sourceId/review" element={<ProtectedRoute roles={["TEACHER", "ADMIN"]}><ReviewPage /></ProtectedRoute>} />
         <Route path="/exams" element={<ProtectedRoute roles={["TEACHER", "ADMIN"]}><PapersPage /></ProtectedRoute>} />
       <Route path="/exams/:examId" element={<ProtectedRoute roles={["TEACHER", "ADMIN"]}><PaperBuilderPage /></ProtectedRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
  // return (
  //   <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
  //     <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm border border-gray-100">
  //       <h1 className="text-2xl font-bold text-gray-900">EduAI</h1>
  //       <p className="mt-1 text-sm text-gray-500">
  //         Intelligent Examination &amp; Assessment Platform
  //       </p>

  //       <div className="mt-6 space-y-3">
  //         <StatusBadge label="Backend (Spring Boot)" status={backendStatus} />
  //       </div>

  //       <p className="mt-6 text-xs text-gray-400">
  //         Step 1 scaffold — auth, ingestion, and exam UI land in later steps.
  //       </p>
  //     </div>
  //   </div>

  
  // );
  
}
