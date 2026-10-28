package com.eduai.backend.analytics;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class AnalyticsDtos {
    private AnalyticsDtos() {}

    /** Accuracy below this is a weak spot; at or above STRONG it is a strength. */
    public static final double WEAK_BELOW = 0.60;
    public static final double STRONG_FROM = 0.80;
    /** A student passes with this share of the marks (shown to the teacher as "pass rate"). */
    public static final double PASS_AT = 0.40;

    public record Summary(int submitted, int inProgress, int awaitingMarking, double averagePercent,
                          double highestPercent, double lowestPercent, double passRate) {}

    /** counts of the 10 score bands: 0-9.99 %, 10-19.99 %, ... 90-100 %. */
    public record Histogram(List<Integer> bands) {}

    public record QuestionStat(int position, UUID questionId, String text, String type, String difficulty,
                               String topic, double marks, int answered, int students, double accuracy) {}

    public record TopicStat(String topic, int questions, double accuracy, String level) {}

    public record ExamAnalytics(UUID examId, String title, String status, Summary summary, Histogram histogram,
                                Map<String, Integer> risk, List<QuestionStat> questions, List<TopicStat> topics) {}

    public record AttemptPoint(UUID examId, UUID attemptId, String title, Instant submittedAt, double score,
                               double maxScore, double percent, Double classAveragePercent, boolean pendingMarking) {}

    public record Recommendation(String topic, double accuracy, int missed, int total, List<String> sources, String message) {}

    public record StudentProgress(int examsTaken, double averagePercent, List<AttemptPoint> history,
                                  List<TopicStat> topics, List<Recommendation> recommendations) {}
}
