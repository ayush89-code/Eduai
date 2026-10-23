import { useEffect, useState } from "react";
import api from "../api/client";

export default function BackendStatus() {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    api.get("/api/health").then(() => setStatus("UP")).catch(() => setStatus("DOWN"));
  }, []);

  const color =
    status === "UP" ? "bg-green-100 text-green-800" : status === "checking" ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800";
  return (
    <div className="flex items-center justify-between text-xs text-gray-500">
      <span>Backend</span>
      <span className={`rounded-full px-2.5 py-0.5 font-semibold ${color}`}>{status === "checking" ? "checking…" : status}</span>
    </div>
  );
}
