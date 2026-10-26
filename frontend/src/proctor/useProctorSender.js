import { useCallback, useEffect, useRef } from "react";
import api from "../api/client";

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
}));

/**
 * Collects events and sends them to the backend in small batches.
 * Every event has its own clientId, so a retry after a network error can never create duplicates.
 * Returns emit(type, metadata).
 */
export default function useProctorSender(attemptId) {
  const queue = useRef([]);
  const busy = useRef(false);
  const stopped = useRef(false);
  const failures = useRef(0);

  const flush = useCallback(async () => {
    if (busy.current || stopped.current || queue.current.length === 0) return;
    busy.current = true;
    const batch = queue.current.slice(0, 20);
    try {
      await api.post(`/api/student/attempts/${attemptId}/proctor-events`, { events: batch });
      queue.current = queue.current.slice(batch.length);
      failures.current = 0;
    } catch (e) {
      const status = e.response?.status;
      if (status === 409 || status === 404 || status === 403) { stopped.current = true; queue.current = []; }   // attempt finished
      else if (status === 422) queue.current = queue.current.slice(batch.length);                                // bad event: drop it
      else failures.current += 1;                                                                                  // offline / busy: retry later
    } finally {
      busy.current = false;
    }
  }, [attemptId]);

  useEffect(() => {
    const t = setInterval(() => {
      // back off a little while the server is unreachable
      if (failures.current === 0 || Math.random() < 1 / (1 + failures.current)) flush();
    }, 3000);
    return () => { clearInterval(t); flush(); };
  }, [flush]);

  return useCallback((type, metadata) => {
    if (stopped.current) return;
    queue.current.push({ type, occurredAt: new Date().toISOString(), clientId: uuid(), metadata: metadata || {} });
    if (queue.current.length >= 10) flush();
  }, [flush]);
}
