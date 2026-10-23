package com.eduai.backend.question;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class QuestionDtos {
    private QuestionDtos() {}

    public record OptionDto(int position, String text, boolean correct) {}

    public record QuestionView(
            UUID id, UUID sourceId, UUID jobId, String type, String difficulty, String topic,
            String questionText, String correctAnswer, String explanation, String status,
            String citationRef, Instant citationRetrievedAt, BigDecimal marks,
            Map<String, Object> payload, List<OptionDto> options,
            boolean usedInExam, boolean fullyEditable) {}

    public record OptionInput(@NotBlank @Size(max = 1000) String text, boolean correct) {}

    /** Every field is optional: null means "leave unchanged". */
    public record UpdateRequest(
            @Size(min = 3, max = 6000) String questionText,
            @Size(max = 4000) String correctAnswer,
            @Size(max = 4000) String explanation,
            @Size(max = 6) String difficulty,
            @Size(min = 1, max = 200) String topic,
            BigDecimal marks,
            @Valid @Size(min = 2, max = 6) List<OptionInput> options) {}

    /** action = APPROVE or REJECT. */
    public record BulkRequest(
            @NotBlank String action,
            @NotEmpty @Size(max = 200) List<UUID> ids) {}

    public record BulkSkipped(UUID id, String reason) {}

    public record BulkResult(int changed, List<BulkSkipped> skipped) {}
}
