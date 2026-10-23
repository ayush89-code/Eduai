package com.eduai.backend.question;

import jakarta.persistence.*;

import java.util.UUID;

/** One answer choice of an MCQ question. */
@Entity
@Table(name = "question_options")
public class QuestionOption {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "question_id", nullable = false)
    private UUID questionId;

    @Column(nullable = false)
    private int position;

    @Column(name = "option_text", nullable = false, columnDefinition = "text")
    private String optionText;

    @Column(name = "is_correct", nullable = false)
    private boolean correct;

    protected QuestionOption() {}

    public QuestionOption(UUID questionId, int position, String optionText, boolean correct) {
        this.questionId = questionId;
        this.position = position;
        this.optionText = optionText;
        this.correct = correct;
    }

    public UUID getId() { return id; }
    public UUID getQuestionId() { return questionId; }
    public int getPosition() { return position; }
    public String getOptionText() { return optionText; }
    public boolean isCorrect() { return correct; }
}
