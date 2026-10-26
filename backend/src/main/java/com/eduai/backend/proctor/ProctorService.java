package com.eduai.backend.proctor;

import com.eduai.backend.attempt.Attempt;
import com.eduai.backend.attempt.AttemptRepository;
import com.eduai.backend.auth.AuthenticatedUser;
import com.eduai.backend.common.ApiException;
import com.eduai.backend.exam.Exam;
import com.eduai.backend.exam.ExamRepository;
import com.eduai.backend.proctor.ProctorDtos.*;
import com.eduai.backend.user.Role;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * Step 9. The API never writes proctoring rows itself: it validates, then publishes to Kafka and returns.
 * ProctorConsumer stores the events.
 */
@Service
public class ProctorService {

    private final AttemptRepository attempts;
    private final ExamRepository exams;
    private final ProctorStore store;
    private final KafkaTemplate<String, String> kafka;
    private final ObjectMapper mapper;

    public ProctorService(AttemptRepository attempts, ExamRepository exams, ProctorStore store,
                          @Qualifier("proctorKafkaTemplate") KafkaTemplate<String, String> kafka,
                          ObjectMapper mapper) {
        this.attempts = attempts;
        this.exams = exams;
        this.store = store;
        this.kafka = kafka;
        this.mapper = mapper;
    }

    // ---- student: report events --------------------------------------------------

    public BatchResponse publish(AuthenticatedUser user, UUID attemptId, BatchRequest req) {
        Attempt a = attempts.findById(attemptId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Attempt not found"));
        if (!a.getStudentId().equals(user.id())) throw new ApiException(HttpStatus.NOT_FOUND, "Attempt not found");
        if (!a.getStatus().equals("IN_PROGRESS")) {
            throw new ApiException(HttpStatus.CONFLICT, "This attempt is already finished.");
        }
        Instant now = Instant.now();
        List<CompletableFuture<?>> sent = new ArrayList<>();
        List<String[]> toSend = new ArrayList<>();
        for (EventInput in : req.events()) {
            ProctorEventType type;
            try {
                type = ProctorEventType.valueOf(in.type().trim().toUpperCase(Locale.ROOT));
            } catch (IllegalArgumentException e) {
                throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "Unknown event type: " + in.type());
            }
            Instant at = in.occurredAt() == null ? now : in.occurredAt();
            if (at.isAfter(now)) at = now;                                   // clocks drift, never accept the future
            if (at.isBefore(a.getStartedAt())) at = a.getStartedAt();
            String idSource = in.clientId() == null || in.clientId().isBlank() ? UUID.randomUUID().toString() : in.clientId();
            UUID eventId = UUID.nameUUIDFromBytes((attemptId + ":" + idSource).getBytes(StandardCharsets.UTF_8));
            EventMessage msg = new EventMessage(eventId, attemptId, user.id(), type.name(), type.severity(),
                    type.weight(), at, now, cleanMetadata(in.metadata()));
            try {
                toSend.add(new String[]{attemptId.toString(), mapper.writeValueAsString(msg)});
            } catch (Exception e) {
                throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "Could not read the event.");
            }
        }
        try {
            for (String[] s : toSend) sent.add(kafka.send(ProctorKafkaConfig.TOPIC, s[0], s[1]));
            CompletableFuture.allOf(sent.toArray(new CompletableFuture[0])).get(5, TimeUnit.SECONDS);
        } catch (Exception e) {
            // the browser keeps the events and retries; the exam itself is not affected
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "The monitoring service is busy. Events will be retried.");
        }
        return new BatchResponse(toSend.size());
    }

    // ---- teacher: read -------------------------------------------------------------

    public ProctorSummary summary(AuthenticatedUser user, UUID attemptId) {
        Attempt a = attempts.findById(attemptId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Attempt not found"));
        Exam e = exams.findById(a.getExamId()).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Attempt not found"));
        if (user.role() != Role.ADMIN && !e.getTeacherId().equals(user.id())) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Attempt not found");
        }
        List<EventView> events = store.events(attemptId);
        int[] totals = store.totals(attemptId);
        Map<String, Integer> counts = new TreeMap<>();
        for (EventView ev : events) counts.merge(ev.type(), 1, Integer::sum);
        return new ProctorSummary(attemptId, totals[0], totals[1], level(totals[1]), counts, events);
    }

    static String level(int score) {
        return score >= 15 ? "HIGH" : score >= 5 ? "MEDIUM" : "LOW";
    }

    /** At most 10 short text entries: the browser may attach e.g. {"awaySeconds":"8"}, nothing else is kept. */
    private static Map<String, String> cleanMetadata(Map<String, Object> raw) {
        if (raw == null) return Map.of();
        Map<String, String> out = new LinkedHashMap<>();
        for (Map.Entry<String, Object> en : raw.entrySet()) {
            if (out.size() >= 10 || en.getKey() == null || en.getValue() == null) continue;
            String k = en.getKey().length() > 40 ? en.getKey().substring(0, 40) : en.getKey();
            String v = String.valueOf(en.getValue());
            out.put(k, v.length() > 100 ? v.substring(0, 100) : v);
        }
        return out;
    }
}
