package com.eduai.backend.proctor;

import com.eduai.backend.proctor.ProctorDtos.EventMessage;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/** Step 9: the only writer of proctoring_events. Redelivered messages are harmless (idempotent insert). */
@Component
public class ProctorConsumer {

    private static final Logger log = LoggerFactory.getLogger(ProctorConsumer.class);

    private final ProctorStore store;
    private final ObjectMapper mapper;

    public ProctorConsumer(ProctorStore store, ObjectMapper mapper) {
        this.store = store;
        this.mapper = mapper;
    }

    @KafkaListener(topics = ProctorKafkaConfig.TOPIC, groupId = ProctorKafkaConfig.GROUP,
            containerFactory = "proctorListenerFactory")
    public void onEvent(String payload) {
        EventMessage m;
        try {
            m = mapper.readValue(payload, EventMessage.class);
        } catch (Exception e) {
            throw new IllegalStateException("Unreadable proctoring event", e);
        }
        boolean stored = store.save(m);
        if (stored) log.debug("proctoring event {} stored for attempt {}", m.type(), m.attemptId());
    }
}
