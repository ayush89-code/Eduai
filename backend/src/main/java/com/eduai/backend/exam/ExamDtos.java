package com.eduai.backend.exam;

import com.eduai.backend.question.QuestionDtos.QuestionView;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class ExamDtos {
    private ExamDtos() {}

    public record CreateRequest(
            @NotBlank @Size(max = 255) String title,
            @Size(max = 4000) String description,
            @NotNull @Min(1) @Max(600) Integer durationMinutes,
            UUID sourceId, Instant startsAt, Instant endsAt) {}

    /** Every field optional: null = unchanged. Only DRAFT papers can be edited. */
    public record UpdateRequest(
            @Size(min = 1, max = 255) String title,
            @Size(max = 4000) String description,
            @Min(1) @Max(600) Integer durationMinutes,
            Instant startsAt, Instant endsAt, Boolean clearSchedule) {}

    public record PaperItem(
            @NotNull UUID questionId,
            @NotNull @DecimalMin("0.25") @DecimalMax("100") BigDecimal marks) {}

    /** The full ordered paper; replaces what is there. */
    public record PaperRequest(@NotNull @Size(max = 200) List<@Valid PaperItem> items) {}

    /** Mock-exam shortcut: fill the paper from the APPROVED questions of one source. */
    public record BlueprintRequest(
            @NotNull UUID sourceId,
            @NotNull @DecimalMin("1") @DecimalMax("500") BigDecimal totalMarks,
            List<String> types,
            @Min(0) @Max(100) Integer easyPercent,
            @Min(0) @Max(100) Integer mediumPercent,
            @Min(0) @Max(100) Integer hardPercent) {}

    public record ExamSummary(
            UUID id, String title, String description, int durationMinutes, String status, UUID sourceId,
            Instant startsAt, Instant endsAt, Instant createdAt, Instant publishedAt,
            int questionCount, BigDecimal totalMarks) {}

    public record ExamQuestionView(int position, BigDecimal marks, QuestionView question) {}

    public record ExamDetail(ExamSummary exam, List<ExamQuestionView> items) {}

    public record BlueprintResult(ExamDetail exam, List<String> warnings) {}
}
