package com.eduai.backend.live;

import com.eduai.backend.auth.AuthenticatedUser;
import com.eduai.backend.common.ApiException;
import com.eduai.backend.exam.Exam;
import com.eduai.backend.exam.ExamRepository;
import com.eduai.backend.live.LiveDtos.*;
import com.eduai.backend.user.Role;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Step 10: the current state of every student of an exam (loaded when the dashboard opens and re-synced every few seconds). */
@Service
public class LiveService {

    private final ExamRepository exams;
    private final JdbcTemplate jdbc;

    public LiveService(ExamRepository exams, JdbcTemplate jdbc) {
        this.exams = exams;
        this.jdbc = jdbc;
    }

    public LiveSnapshot snapshot(AuthenticatedUser user, UUID examId) {
        Exam e = ownedExam(user, examId);
        int total = jdbc.queryForObject("SELECT count(*) FROM exam_questions WHERE exam_id = ?",
                (rs, i) -> rs.getInt(1), examId);
        List<LiveRow> rows = jdbc.query("""
                SELECT a.id, a.student_id, u.full_name, u.email, a.status, a.started_at, a.submitted_at,
                       LEAST(a.started_at + make_interval(mins => e.duration_minutes), COALESCE(e.ends_at, 'infinity'::timestamptz)) AS deadline,
                       (SELECT count(*) FROM answers an WHERE an.attempt_id = a.id) AS answered,
                       a.flag_count, a.risk_score,
                       (SELECT pe.event_type FROM proctoring_events pe WHERE pe.attempt_id = a.id
                           AND pe.event_type NOT IN ('FACE_RETURNED', 'WINDOW_FOCUS', 'PROCTOR_STARTED', 'RIGHT_CLICK')
                          ORDER BY pe.occurred_at DESC LIMIT 1) AS last_type,
                       (SELECT pe.occurred_at FROM proctoring_events pe WHERE pe.attempt_id = a.id
                           AND pe.event_type NOT IN ('FACE_RETURNED', 'WINDOW_FOCUS', 'PROCTOR_STARTED', 'RIGHT_CLICK')
                          ORDER BY pe.occurred_at DESC LIMIT 1) AS last_at
                  FROM attempts a
                  JOIN users u ON u.id = a.student_id
                  JOIN exams e ON e.id = a.exam_id
                 WHERE a.exam_id = ?
                 ORDER BY a.risk_score DESC, a.started_at
                """, (rs, i) -> new LiveRow(
                rs.getObject("id", UUID.class), rs.getObject("student_id", UUID.class),
                rs.getString("full_name"), rs.getString("email"), rs.getString("status"),
                rs.getTimestamp("started_at").toInstant(), instant(rs.getTimestamp("submitted_at")),
                instant(rs.getTimestamp("deadline")), rs.getInt("answered"),
                rs.getInt("flag_count"), rs.getInt("risk_score"), riskLevel(rs.getInt("risk_score")),
                rs.getString("last_type"), instant(rs.getTimestamp("last_at"))), examId);
        return new LiveSnapshot(e.getId(), e.getTitle(), e.getStatus(), total, Instant.now(), rows);
    }

    /** Same ownership rule as everywhere: the exam's teacher, or an admin; anyone else gets 404. */
    public Exam ownedExam(AuthenticatedUser user, UUID examId) {
        Exam e = exams.findById(examId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Exam not found"));
        if (user.role() != Role.ADMIN && !e.getTeacherId().equals(user.id())) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Exam not found");
        }
        return e;
    }

    public static String riskLevel(int score) {
        return score >= 15 ? "HIGH" : score >= 5 ? "MEDIUM" : "LOW";
    }

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }
}
