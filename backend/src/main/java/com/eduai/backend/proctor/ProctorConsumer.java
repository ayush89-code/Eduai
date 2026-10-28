package com.eduai.backend.proctor;

import com.eduai.backend.live.LiveBroadcaster;
import com.eduai.backend.proctor.ProctorDtos.EventMessage;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Step 9: the only writer of proctoring_events. Redelivered messages are harmless (idempotent insert).
 * Step 10: every newly stored event is pushed to the live teacher dashboard.
 */
@Component
public class ProctorConsumer {

    private final ProctorStore store;
    private final ObjectMapper mapper;
    private final LiveBroadcaster live;

    public ProctorConsumer(ProctorStore store, ObjectMapper mapper, LiveBroadcaster live) {
        this.store = store;
        this.mapper = mapper;
        this.live = live;
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
        if (store.save(m)) {
            live.onStored(m);    // only for events that were really new, never for a Kafka redelivery
        }
    }
}
