package com.eduai.backend.live;

import com.eduai.backend.proctor.ProctorDtos.EventMessage;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Step 10: called by the Kafka consumer right after an event was stored; pushes it to the teachers watching that exam. */
@Service
public class LiveBroadcaster {

    private static final Logger log = LoggerFactory.getLogger(LiveBroadcaster.class);

    private final JdbcTemplate jdbc;
    private final LiveSocketHandler handler;
    private final ObjectMapper mapper;

    public LiveBroadcaster(JdbcTemplate jdbc, LiveSocketHandler handler, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.handler = handler;
        this.mapper = mapper;
    }

    /** Must never break the consumer: any problem is logged and ignored (the dashboard re-syncs on its own). */
    public void onStored(EventMessage m) {
        try {
            List<Object[]> found = jdbc.query("""
                    SELECT a.exam_id, u.full_name, a.flag_count, a.risk_score
                      FROM attempts a JOIN users u ON u.id = a.student_id WHERE a.id = ?
                    """, (rs, i) -> new Object[]{rs.getObject("exam_id", UUID.class), rs.getString("full_name"),
                    rs.getInt("flag_count"), rs.getInt("risk_score")}, m.attemptId());
            if (found.isEmpty()) return;
            Object[] r = found.get(0);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("type", "event");
            out.put("examId", r[0]);
            out.put("attemptId", m.attemptId());
            out.put("studentId", m.studentId());
            out.put("studentName", r[1]);
            out.put("eventType", m.type());
            out.put("severity", m.severity());
            out.put("occurredAt", m.occurredAt());
            out.put("metadata", m.metadata());
            out.put("flagCount", r[2]);
            out.put("riskScore", r[3]);
            out.put("riskLevel", LiveService.riskLevel((Integer) r[3]));
            handler.broadcast((UUID) r[0], mapper.writeValueAsString(out));
        } catch (Exception e) {
            log.warn("live broadcast failed: {}", e.getMessage());
        }
    }
}
