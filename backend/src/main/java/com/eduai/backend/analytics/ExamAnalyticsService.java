package com.eduai.backend.analytics;

import com.eduai.backend.analytics.AnalyticsDtos.*;
import com.eduai.backend.auth.AuthenticatedUser;
import com.eduai.backend.common.ApiException;
import com.eduai.backend.exam.Exam;
import com.eduai.backend.exam.ExamRepository;
import com.eduai.backend.user.Role;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * Step 11, teacher side. Everything is computed in SQL from finished attempts (SUBMITTED / TERMINATED).
 * An answer that still waits for the teacher's marks (grading = AWAITING) is left out of the accuracy figures,
 * so unmarked written answers never look like zeros. A question the student left blank counts as 0.
 */
@Service
public class ExamAnalyticsService {

    private final ExamRepository exams;
    private final JdbcTemplate jdbc;

    public ExamAnalyticsService(ExamRepository exams, JdbcTemplate jdbc) {
        this.exams = exams;
        this.jdbc = jdbc;
    }

    public ExamAnalytics analytics(AuthenticatedUser user, UUID examId) {
        Exam e = exams.findById(examId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Exam not found"));
        if (user.role() != Role.ADMIN && !e.getTeacherId().equals(user.id())) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Exam not found");   // same answer for "missing" and "not yours"
        }

        // ---- attempts ----
        List<double[]> done = new ArrayList<>();   // {percent, risk}
        int[] counts = new int[2];                 // {inProgress, awaitingMarking}
        jdbc.query("SELECT status, score, max_score, pending_count, risk_score FROM attempts WHERE exam_id = ?", rs -> {
            if ("IN_PROGRESS".equals(rs.getString("status"))) { counts[0]++; return; }
            double max = rs.getDouble("max_score");
            double pct = max > 0 ? 100.0 * rs.getDouble("score") / max : 0;
            done.add(new double[]{pct, rs.getInt("risk_score")});
            if (rs.getInt("pending_count") > 0) counts[1]++;
        }, examId);

        int n = done.size();
        double sum = 0, hi = 0, lo = 100;
        int passed = 0;
        int[] bands = new int[10];
        Map<String, Integer> risk = new LinkedHashMap<>(Map.of("LOW", 0, "MEDIUM", 0, "HIGH", 0));
        for (double[] d : done) {
            sum += d[0];
            hi = Math.max(hi, d[0]);
            lo = Math.min(lo, d[0]);
            if (d[0] >= PASS * 100) passed++;
            bands[Math.min(9, (int) (d[0] / 10))]++;
            risk.merge(com.eduai.backend.live.LiveService.riskLevel((int) d[1]), 1, Integer::sum);
        }
        Summary summary = new Summary(n, counts[0], counts[1], n == 0 ? 0 : round(sum / n), n == 0 ? 0 : round(hi),
                n == 0 ? 0 : round(lo), n == 0 ? 0 : round(100.0 * passed / n));
        List<Integer> bandList = new ArrayList<>();
        for (int b : bands) bandList.add(b);

        // ---- per question ----
        List<QuestionStat> questions = jdbc.query("""
                SELECT eq.position, q.id, q.question_text, q.type, q.difficulty, q.topic, eq.marks,
                       count(a.id) AS students,
                       count(an.id) FILTER (WHERE an.answer_text IS NOT NULL OR an.selected_option_id IS NOT NULL) AS answered,
                       COALESCE(sum(COALESCE(an.marks_awarded, 0)), 0) AS got
                  FROM exam_questions eq
                  JOIN questions q ON q.id = eq.question_id
                  LEFT JOIN attempts a ON a.exam_id = eq.exam_id AND a.status <> 'IN_PROGRESS'
                  LEFT JOIN answers an ON an.attempt_id = a.id AND an.question_id = eq.question_id
                 WHERE eq.exam_id = ? AND (an.grading IS NULL OR an.grading <> 'AWAITING')
                 GROUP BY eq.position, q.id, q.question_text, q.type, q.difficulty, q.topic, eq.marks
                 ORDER BY eq.position
                """, (rs, i) -> {
            int students = rs.getInt("students");
            double marks = rs.getDouble("marks");
            double acc = students == 0 ? 0 : rs.getDouble("got") / (marks * students);
            return new QuestionStat(rs.getInt("position"), rs.getObject("id", UUID.class), cut(rs.getString("question_text")),
                    rs.getString("type"), rs.getString("difficulty"), rs.getString("topic"), marks,
                    rs.getInt("answered"), students, round4(acc));
        }, examId);

        // ---- per topic (marks-weighted) ----
        List<TopicStat> topics = jdbc.query("""
                SELECT q.topic, count(DISTINCT q.id) AS questions,
                       COALESCE(sum(COALESCE(an.marks_awarded, 0)), 0) AS got,
                       COALESCE(sum(eq.marks) FILTER (WHERE a.id IS NOT NULL), 0) AS total
                  FROM exam_questions eq
                  JOIN questions q ON q.id = eq.question_id
                  LEFT JOIN attempts a ON a.exam_id = eq.exam_id AND a.status <> 'IN_PROGRESS'
                  LEFT JOIN answers an ON an.attempt_id = a.id AND an.question_id = eq.question_id
                 WHERE eq.exam_id = ? AND (an.grading IS NULL OR an.grading <> 'AWAITING')
                 GROUP BY q.topic
                """, (rs, i) -> {
            double total = rs.getDouble("total");
            double acc = total == 0 ? 0 : rs.getDouble("got") / total;
            return new TopicStat(rs.getString("topic"), rs.getInt("questions"), round4(acc), level(acc));
        }, examId);
        if (n == 0) topics = List.of();
        topics = new ArrayList<>(topics);
        topics.sort(Comparator.comparingDouble(TopicStat::accuracy));

        return new ExamAnalytics(e.getId(), e.getTitle(), e.getStatus(), summary, new Histogram(bandList), risk,
                n == 0 ? List.of() : questions, topics);
    }

    private static final double PASS = AnalyticsDtos.PASS_AT;

    static String level(double acc) {
        return acc < AnalyticsDtos.WEAK_BELOW ? "WEAK" : acc >= AnalyticsDtos.STRONG_FROM ? "STRONG" : "OK";
    }

    static String cut(String s) {
        if (s == null) return "";
        String t = s.replaceAll("\\s+", " ").trim();
        return t.length() > 140 ? t.substring(0, 137) + "..." : t;
    }

    static double round(double v) {
        return Math.round(v * 10.0) / 10.0;
    }

    static double round4(double v) {
        return Math.round(v * 10000.0) / 10000.0;
    }
}
