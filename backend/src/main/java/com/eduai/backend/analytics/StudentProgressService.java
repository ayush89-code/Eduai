package com.eduai.backend.analytics;

import com.eduai.backend.analytics.AnalyticsDtos.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * Step 11, student side: result history, topic strengths and weaknesses, and rule-based revision advice.
 * The advice is built from the student's own accuracy and the citation of the questions they missed,
 * so every suggestion points at a real source (no model-written text that could be made up).
 * Only answers the student already finished are used; answers waiting for marking are left out.
 */
@Service
public class StudentProgressService {

    private static final int MAX_RECOMMENDATIONS = 5;
    private static final int MAX_SOURCES = 3;

    private final JdbcTemplate jdbc;

    public StudentProgressService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public StudentProgress progress(UUID studentId) {
        List<AttemptPoint> history = jdbc.query("""
                SELECT a.id, a.exam_id, e.title, a.submitted_at, a.score, a.max_score, a.pending_count,
                       (SELECT avg(100.0 * x.score / x.max_score) FROM attempts x
                         WHERE x.exam_id = a.exam_id AND x.status <> 'IN_PROGRESS' AND x.max_score > 0) AS class_avg
                  FROM attempts a JOIN exams e ON e.id = a.exam_id
                 WHERE a.student_id = ? AND a.status <> 'IN_PROGRESS'
                 ORDER BY a.submitted_at
                """, (rs, i) -> {
            double max = rs.getDouble("max_score");
            double score = rs.getDouble("score");
            double avg = rs.getDouble("class_avg");
            Double classAvg = rs.wasNull() ? null : ExamAnalyticsService.round(avg);
            return new AttemptPoint(rs.getObject("exam_id", UUID.class), rs.getObject("id", UUID.class), rs.getString("title"),
                    rs.getTimestamp("submitted_at") == null ? null : rs.getTimestamp("submitted_at").toInstant(),
                    score, max, max > 0 ? ExamAnalyticsService.round(100.0 * score / max) : 0, classAvg,
                    rs.getInt("pending_count") > 0);
        }, studentId);

        double avgPct = history.isEmpty() ? 0
                : ExamAnalyticsService.round(history.stream().mapToDouble(AttemptPoint::percent).average().orElse(0));

        // marks-weighted accuracy per topic over every finished attempt
        List<Object[]> raw = jdbc.query("""
                SELECT q.topic, count(*) AS total_q,
                       count(*) FILTER (WHERE COALESCE(an.marks_awarded, 0) < eq.marks) AS missed,
                       sum(COALESCE(an.marks_awarded, 0)) AS got, sum(eq.marks) AS total
                  FROM attempts a
                  JOIN exam_questions eq ON eq.exam_id = a.exam_id
                  JOIN questions q ON q.id = eq.question_id
                  LEFT JOIN answers an ON an.attempt_id = a.id AND an.question_id = eq.question_id
                 WHERE a.student_id = ? AND a.status <> 'IN_PROGRESS' AND (an.grading IS NULL OR an.grading <> 'AWAITING')
                 GROUP BY q.topic
                """, (rs, i) -> new Object[]{rs.getString("topic"), rs.getInt("total_q"), rs.getInt("missed"),
                rs.getDouble("got"), rs.getDouble("total")}, studentId);

        List<TopicStat> topics = new ArrayList<>();
        Map<String, int[]> counts = new HashMap<>();
        for (Object[] r : raw) {
            double total = (Double) r[4];
            double acc = total == 0 ? 0 : ExamAnalyticsService.round4((Double) r[3] / total);
            String topic = (String) r[0];
            topics.add(new TopicStat(topic, (Integer) r[1], acc, ExamAnalyticsService.level(acc)));
            counts.put(topic, new int[]{(Integer) r[2], (Integer) r[1]});
        }
        topics.sort(Comparator.comparingDouble(TopicStat::accuracy));

        // where the missed questions came from (most-missed sources first)
        Map<String, List<String>> sources = new HashMap<>();
        jdbc.query("""
                SELECT q.topic, q.citation_ref, count(*) AS n
                  FROM attempts a
                  JOIN exam_questions eq ON eq.exam_id = a.exam_id
                  JOIN questions q ON q.id = eq.question_id
                  LEFT JOIN answers an ON an.attempt_id = a.id AND an.question_id = eq.question_id
                 WHERE a.student_id = ? AND a.status <> 'IN_PROGRESS' AND (an.grading IS NULL OR an.grading <> 'AWAITING')
                   AND COALESCE(an.marks_awarded, 0) < eq.marks
                 GROUP BY q.topic, q.citation_ref ORDER BY n DESC
                """, rs -> {
            List<String> l = sources.computeIfAbsent(rs.getString("topic"), k -> new ArrayList<>());
            if (l.size() < MAX_SOURCES) l.add(rs.getString("citation_ref"));
        }, studentId);

        List<Recommendation> recs = new ArrayList<>();
        for (TopicStat t : topics) {
            if (t.accuracy() >= AnalyticsDtos.WEAK_BELOW || recs.size() >= MAX_RECOMMENDATIONS) continue;
            int[] c = counts.get(t.topic());
            List<String> src = sources.getOrDefault(t.topic(), List.of());
            recs.add(new Recommendation(t.topic(), t.accuracy(), c[0], c[1], src, message(t, c, src)));
        }
        return new StudentProgress(history.size(), avgPct, history, topics, recs);
    }

    static String message(TopicStat t, int[] c, List<String> src) {
        int pct = (int) Math.round(t.accuracy() * 100);
        String how = pct < 30 ? "Start again from the basics of" : "Revise the key points of";
        String s = how + " \"" + t.topic() + "\": you scored " + pct + "% and missed " + c[0] + " of " + c[1] + " questions.";
        if (!src.isEmpty()) s += " Read: " + String.join("; ", src) + ".";
        return s;
    }
}
