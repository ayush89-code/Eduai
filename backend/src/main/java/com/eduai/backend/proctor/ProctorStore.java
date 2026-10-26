package com.eduai.backend.proctor;

import com.eduai.backend.proctor.ProctorDtos.EventMessage;
import com.eduai.backend.proctor.ProctorDtos.EventView;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Plain SQL for proctoring_events (written only by the Kafka consumer, read by the teacher endpoint). */
@Repository
public class ProctorStore {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public ProctorStore(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    /** Stores one event once. Returns false when it was already stored (Kafka redelivery) or the attempt is gone. */
    @Transactional
    public boolean save(EventMessage m) {
        String metadata;
        try {
            metadata = mapper.writeValueAsString(m.metadata() == null ? Map.of() : m.metadata());
        } catch (Exception e) {
            metadata = "{}";
        }
        int inserted = jdbc.update("""
                INSERT INTO proctoring_events (id, attempt_id, event_type, severity, occurred_at, received_at, metadata, event_id)
                SELECT gen_random_uuid(), a.id, ?, ?, ?, ?, CAST(? AS jsonb), ?
                  FROM attempts a WHERE a.id = ?
                ON CONFLICT (event_id) DO NOTHING
                """, m.type(), m.severity(), Timestamp.from(m.occurredAt()), Timestamp.from(m.receivedAt()),
                metadata, m.eventId(), m.attemptId());
        if (inserted == 0) return false;
        if (m.weight() > 0) {
            jdbc.update("UPDATE attempts SET flag_count = flag_count + 1, risk_score = risk_score + ? WHERE id = ?",
                    m.weight(), m.attemptId());
        }
        return true;
    }

    public List<EventView> events(UUID attemptId) {
        return jdbc.query("""
                SELECT event_type, severity, occurred_at, received_at, CAST(metadata AS text) AS metadata
                  FROM proctoring_events WHERE attempt_id = ?
                 ORDER BY occurred_at, received_at LIMIT 1000
                """, (rs, i) -> new EventView(rs.getString("event_type"), rs.getString("severity"),
                rs.getTimestamp("occurred_at").toInstant(), rs.getTimestamp("received_at").toInstant(),
                parse(rs.getString("metadata"))), attemptId);
    }

    /** {flagCount, riskScore} of an attempt. */
    public int[] totals(UUID attemptId) {
        return jdbc.queryForObject("SELECT flag_count, risk_score FROM attempts WHERE id = ?",
                (rs, i) -> new int[]{rs.getInt(1), rs.getInt(2)}, attemptId);
    }

    private Map<String, Object> parse(String json) {
        try {
            return mapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }
}
