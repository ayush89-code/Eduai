import { useEffect, useRef, useState } from "react";
import api from "../api/client";

// The browser WebSocket API cannot set an Authorization header, so the JWT goes in the URL.
// Your auth code already keeps the token somewhere: we look it up from the axios default header first,
// then fall back to any localStorage value that looks like a JWT (so this works whatever key AuthContext uses).
function findToken() {
  const h = api?.defaults?.headers?.common?.Authorization;
  if (typeof h === "string" && h.startsWith("Bearer ")) return h.slice(7);
  try {
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        let v = store.getItem(store.key(i)) || "";
        try { const o = JSON.parse(v); if (o && typeof o === "object") v = o.token || o.accessToken || ""; else if (typeof o === "string") v = o; } catch { /* plain string */ }
        if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v)) return v;
      }
    }
  } catch { /* storage blocked */ }
  return null;
}

function wsUrl(token) {
  const base = api?.defaults?.baseURL || import.meta.env.VITE_API_URL || "http://localhost:8080";
  return base.replace(/^http/, "ws").replace(/\/$/, "") + "/ws/proctor?token=" + encodeURIComponent(token);
}

/**
 * Connects, subscribes to one exam and calls onEvent(msg) for each pushed proctoring event.
 * Reconnects with a growing delay; `onOpen` fires after every (re)subscribe so the page can re-sync.
 * Returns "connecting" | "live" | "offline".
 */
export default function useLiveSocket(examId, onEvent, onOpen) {
  const [state, setState] = useState("connecting");
  const cb = useRef({ onEvent, onOpen });
  cb.current = { onEvent, onOpen };

  useEffect(() => {
    let ws, timer, ping, tries = 0, closed = false;

    const connect = () => {
      const token = findToken();
      if (!token) { setState("offline"); return; }
      setState("connecting");
      ws = new WebSocket(wsUrl(token));
      ws.onopen = () => ws.send(JSON.stringify({ subscribe: examId }));
      ws.onmessage = (m) => {
        let msg; try { msg = JSON.parse(m.data); } catch { return; }
        if (msg.type === "subscribed") { tries = 0; setState("live"); cb.current.onOpen?.(); }
        else if (msg.type === "event") cb.current.onEvent?.(msg);
        else if (msg.type === "error") setState("offline");
      };
      ws.onclose = () => {
        if (closed) return;
        setState("offline");
        timer = setTimeout(connect, Math.min(15000, 1000 * 2 ** tries++));
      };
      ws.onerror = () => ws.close();
    };

    connect();
    ping = setInterval(() => { if (ws?.readyState === 1) ws.send('{"ping":1}'); }, 25000);   // keeps proxies from idling the socket out
    return () => { closed = true; clearTimeout(timer); clearInterval(ping); ws?.close(); };
  }, [examId]);

  return state;
}
