package com.eduai.backend.live;

import com.eduai.backend.auth.AuthenticatedUser;
import com.eduai.backend.exam.Exam;
import com.eduai.backend.exam.ExamRepository;
import com.eduai.backend.user.Role;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Teacher browsers connect here and subscribe to one exam: {"subscribe":"<examId>"}.
 * Messages pushed to them: {"type":"subscribed"} | {"type":"event",...} | {"type":"pong"} | {"type":"error"}.
 */
@Component
public class LiveSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(LiveSocketHandler.class);

    private final ExamRepository exams;
    private final ObjectMapper mapper;
    /** session id -> send-safe wrapper (one thread at a time per session, slow clients are cut off) */
    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    /** exam id -> ids of the sessions watching it */
    private final Map<UUID, Set<String>> watchers = new ConcurrentHashMap<>();

    public LiveSocketHandler(ExamRepository exams, ObjectMapper mapper) {
        this.exams = exams;
        this.mapper = mapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.put(session.getId(), new ConcurrentWebSocketSessionDecorator(session, 5000, 64 * 1024));
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        Map<String, Object> msg;
        try {
            msg = mapper.readValue(message.getPayload(), new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            send(session.getId(), "{\"type\":\"error\",\"message\":\"Unreadable message\"}");
            return;
        }
        if (msg.containsKey("ping")) {
            send(session.getId(), "{\"type\":\"pong\"}");
            return;
        }
        Object sub = msg.get("subscribe");
        if (sub == null) return;
        UUID examId;
        try {
            examId = UUID.fromString(String.valueOf(sub));
        } catch (IllegalArgumentException e) {
            send(session.getId(), "{\"type\":\"error\",\"message\":\"Exam not found\"}");
            return;
        }
        AuthenticatedUser user = (AuthenticatedUser) session.getAttributes().get(LiveHandshakeInterceptor.USER);
        Exam exam = exams.findById(examId).orElse(null);
        boolean allowed = exam != null && user != null && (user.role() == Role.ADMIN || exam.getTeacherId().equals(user.id()));
        if (!allowed) {
            send(session.getId(), "{\"type\":\"error\",\"message\":\"Exam not found\"}");   // same answer for "missing" and "not yours"
            return;
        }
        watchers.computeIfAbsent(examId, k -> ConcurrentHashMap.newKeySet()).add(session.getId());
        send(session.getId(), "{\"type\":\"subscribed\",\"examId\":\"" + examId + "\"}");
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session.getId());
        watchers.values().forEach(s -> s.remove(session.getId()));
    }

    /** Sends one JSON message to everybody watching the exam. Never throws. */
    public void broadcast(UUID examId, String json) {
        Set<String> ids = watchers.get(examId);
        if (ids == null) return;
        for (String id : ids) send(id, json);
    }

    private void send(String sessionId, String json) {
        WebSocketSession s = sessions.get(sessionId);
        if (s == null) return;
        try {
            s.sendMessage(new TextMessage(json));
        } catch (Exception e) {
            log.debug("dropping a dead live-dashboard connection: {}", e.getMessage());
            sessions.remove(sessionId);
            watchers.values().forEach(w -> w.remove(sessionId));
            try { s.close(); } catch (Exception ignored) { /* already closed */ }
        }
    }
}
