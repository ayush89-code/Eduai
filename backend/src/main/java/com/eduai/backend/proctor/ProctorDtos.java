package com.eduai.backend.proctor;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class ProctorDtos {
    private ProctorDtos() {}

    /** clientId (optional UUID made by the browser) makes a retried event idempotent. */
    public record EventInput(@NotBlank @Size(max = 40) String type, Instant occurredAt,
                             Map<String, Object> metadata, @Size(max = 64) String clientId) {}

    public record BatchRequest(@NotEmpty @Size(max = 20) List<@Valid EventInput> events) {}

    public record BatchResponse(int accepted) {}

    /** The message that travels through Kafka (key = attemptId, so one attempt's events stay in order). */
    public record EventMessage(UUID eventId, UUID attemptId, UUID studentId, String type, String severity,
                               int weight, Instant occurredAt, Instant receivedAt, Map<String, String> metadata) {}

    public record EventView(String type, String severity, Instant occurredAt, Instant receivedAt,
                            Map<String, Object> metadata) {}

    /** riskLevel: LOW (score below 5), MEDIUM (5 to 14), HIGH (15 and above). */
    public record ProctorSummary(UUID attemptId, int flagCount, int riskScore, String riskLevel,
                                 Map<String, Integer> countsByType, List<EventView> events) {}
}
