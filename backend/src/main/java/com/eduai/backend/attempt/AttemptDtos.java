package com.eduai.backend.attempt;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class AttemptDtos {
    private AttemptDtos() {}

    // ---- student: exam list -----------------------------------------------------

    public record AttemptBrief(UUID id, String status, BigDecimal score, BigDecimal maxScore,
                               Instant startedAt, Instant submittedAt, int pendingMarking) {}

    /** canStart is false for an exam that has not opened yet (or that is already taken). */
    public record StudentExam(UUID id, String title, String description, int durationMinutes, String status,
                              Instant startsAt, Instant endsAt, int questionCount, BigDecimal totalMarks,
                              boolean canStart, AttemptBrief attempt) {}

    // ---- student: taking the exam (no answers are ever included) ----------------

    public record StudentOption(int position, String text) {}

    public record StudentQuestion(int position, UUID id, String type, String text, BigDecimal marks,
                                  List<StudentOption> options, List<String> left, List<String> right,
                                  List<String> subQuestions) {}

    /** What the student has saved so far for one question (MCQ: optionPosition, otherwise text). */
    public record SavedAnswer(Integer optionPosition, String text) {}

    public record SaveAnswerRequest(Integer optionPosition, @Size(max = 8000) String text) {}

    public record SaveResult(Instant savedAt, Instant serverNow) {}

    // ---- results ------------------------------------------------------------------

    /** One question with the student's answer and the key. grading: AUTO, AWAITING, MANUAL or UNANSWERED. */
    public record ResultItem(int position, UUID questionId, String type, String questionText, BigDecimal marks,
                             BigDecimal awarded, String grading, Boolean correct, String studentAnswer,
                             String correctAnswer, String explanation, String feedback,
                             Map<String, Object> payload) {}

    /** items is empty until the exam is closed (so answers cannot be shared with students still writing). */
    public record ResultSummary(BigDecimal score, BigDecimal maxScore, int pendingMarking,
                                boolean detailsReleased, List<ResultItem> items) {}

    public record AttemptView(UUID id, UUID examId, String examTitle, String status, Instant startedAt,
                              Instant deadline, Instant serverNow, int durationMinutes, BigDecimal maxScore,
                              List<StudentQuestion> questions, Map<UUID, SavedAnswer> answers,
                              ResultSummary result) {}

    // ---- teacher ------------------------------------------------------------------

    public record AttemptRow(UUID id, UUID studentId, String studentName, String studentEmail, String status,
                             Instant startedAt, Instant submittedAt, BigDecimal score, BigDecimal maxScore,
                             int pendingMarking) {}

    public record ExamResults(UUID examId, String title, String status, BigDecimal maxScore, List<AttemptRow> attempts) {}

    public record AttemptDetail(AttemptRow attempt, List<ResultItem> items) {}

    public record MarkRequest(@NotNull @DecimalMin("0") BigDecimal marks, @Size(max = 2000) String feedback) {}
}
