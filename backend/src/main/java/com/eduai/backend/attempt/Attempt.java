package com.eduai.backend.attempt;

import jakarta.persistence.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** One student's try at one exam (a student gets exactly one per exam). */
@Entity
@Table(name = "attempts")
public class Attempt {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "exam_id", nullable = false, updatable = false)
    private UUID examId;

    @Column(name = "student_id", nullable = false, updatable = false)
    private UUID studentId;

    @Column(nullable = false, length = 12)
    private String status = "IN_PROGRESS";

    @Column(name = "started_at", nullable = false, updatable = false)
    private Instant startedAt;

    @Column(name = "submitted_at")
    private Instant submittedAt;

    @Column(precision = 7, scale = 2)
    private BigDecimal score;

    @Column(name = "max_score", precision = 7, scale = 2)
    private BigDecimal maxScore;

    @Column(name = "pending_count", nullable = false)
    private int pendingCount;

    @PrePersist
    void onCreate() {
        if (startedAt == null) startedAt = Instant.now();
    }

    protected Attempt() {}

    public Attempt(UUID examId, UUID studentId, BigDecimal maxScore) {
        this.examId = examId;
        this.studentId = studentId;
        this.maxScore = maxScore;
    }

    public UUID getId() { return id; }
    public UUID getExamId() { return examId; }
    public UUID getStudentId() { return studentId; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Instant getStartedAt() { return startedAt; }
    public Instant getSubmittedAt() { return submittedAt; }
    public void setSubmittedAt(Instant submittedAt) { this.submittedAt = submittedAt; }
    public BigDecimal getScore() { return score; }
    public void setScore(BigDecimal score) { this.score = score; }
    public BigDecimal getMaxScore() { return maxScore; }
    public int getPendingCount() { return pendingCount; }
    public void setPendingCount(int pendingCount) { this.pendingCount = pendingCount; }
}
