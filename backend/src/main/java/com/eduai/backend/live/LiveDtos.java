package com.eduai.backend.live;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class LiveDtos {
    private LiveDtos() {}

    /** One student of an exam as the teacher sees them while it is running. */
    public record LiveRow(UUID attemptId, UUID studentId, String studentName, String studentEmail, String status,
                          Instant startedAt, Instant submittedAt, Instant deadline, int answered,
                          int flagCount, int riskScore, String riskLevel, String lastEventType, Instant lastEventAt) {}

    public record LiveSnapshot(UUID examId, String title, String status, int questionCount, Instant serverNow,
                               List<LiveRow> rows) {}
}
