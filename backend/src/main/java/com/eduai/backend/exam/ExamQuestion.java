package com.eduai.backend.exam;

import jakarta.persistence.*;

import java.math.BigDecimal;
import java.util.UUID;

/** One slot of a paper: which question, in which position, worth how many marks. */
@Entity
@Table(name = "exam_questions")
public class ExamQuestion {

    @EmbeddedId
    private ExamQuestionKey id;

    @Column(nullable = false)
    private int position;

    @Column(nullable = false, precision = 5, scale = 2)
    private BigDecimal marks;

    protected ExamQuestion() {}

    public ExamQuestion(UUID examId, UUID questionId, int position, BigDecimal marks) {
        this.id = new ExamQuestionKey(examId, questionId);
        this.position = position;
        this.marks = marks;
    }

    public ExamQuestionKey getId() { return id; }
    public UUID getQuestionId() { return id.getQuestionId(); }
    public int getPosition() { return position; }
    public BigDecimal getMarks() { return marks; }
}
