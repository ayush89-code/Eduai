package com.eduai.backend.question;

import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** A generated question (Step 6 writes them as DRAFT, Step 7 reviews them). */
@Entity
@Table(name = "questions")
public class Question {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "source_id", nullable = false, updatable = false)
    private UUID sourceId;

    @Column(name = "generation_job_id", updatable = false)
    private UUID generationJobId;

    @Column(name = "created_by", nullable = false, updatable = false)
    private UUID createdBy;

    @Column(nullable = false, length = 20, updatable = false)
    private String type;

    @Column(nullable = false, length = 6)
    private String difficulty;

    @Column(nullable = false, length = 200)
    private String topic;

    @Column(name = "question_text", nullable = false, columnDefinition = "text")
    private String questionText;

    @Column(name = "correct_answer", columnDefinition = "text")
    private String correctAnswer;

    @Column(columnDefinition = "text")
    private String explanation;

    @Column(nullable = false, length = 10)
    private String status;

    @Column(name = "source_chunk_id", nullable = false, updatable = false)
    private UUID sourceChunkId;

    @Column(name = "citation_ref", nullable = false, updatable = false, columnDefinition = "text")
    private String citationRef;

    @Column(name = "citation_retrieved_at", nullable = false, updatable = false)
    private Instant citationRetrievedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private Map<String, Object> payload = new HashMap<>();

    public UUID getId() { return id; }
    public UUID getSourceId() { return sourceId; }
    public UUID getGenerationJobId() { return generationJobId; }
    public UUID getCreatedBy() { return createdBy; }
    public String getType() { return type; }
    public String getDifficulty() { return difficulty; }
    public void setDifficulty(String difficulty) { this.difficulty = difficulty; }
    public String getTopic() { return topic; }
    public void setTopic(String topic) { this.topic = topic; }
    public String getQuestionText() { return questionText; }
    public void setQuestionText(String questionText) { this.questionText = questionText; }
    public String getCorrectAnswer() { return correctAnswer; }
    public void setCorrectAnswer(String correctAnswer) { this.correctAnswer = correctAnswer; }
    public String getExplanation() { return explanation; }
    public void setExplanation(String explanation) { this.explanation = explanation; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public UUID getSourceChunkId() { return sourceChunkId; }
    public String getCitationRef() { return citationRef; }
    public Instant getCitationRetrievedAt() { return citationRetrievedAt; }
    public Instant getCreatedAt() { return createdAt; }
    public Map<String, Object> getPayload() { return payload; }
    public void setPayload(Map<String, Object> payload) { this.payload = payload; }
}
