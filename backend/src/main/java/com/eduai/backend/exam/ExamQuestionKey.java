package com.eduai.backend.exam;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

/** Composite primary key (exam_id, question_id) of exam_questions. */
@Embeddable
public class ExamQuestionKey implements Serializable {

    @Column(name = "exam_id", nullable = false)
    private UUID examId;

    @Column(name = "question_id", nullable = false)
    private UUID questionId;

    protected ExamQuestionKey() {}

    public ExamQuestionKey(UUID examId, UUID questionId) {
        this.examId = examId;
        this.questionId = questionId;
    }

    public UUID getExamId() { return examId; }
    public UUID getQuestionId() { return questionId; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof ExamQuestionKey k)) return false;
        return Objects.equals(examId, k.examId) && Objects.equals(questionId, k.questionId);
    }

    @Override
    public int hashCode() { return Objects.hash(examId, questionId); }
}
