package com.eduai.backend.proctor;

import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.annotation.EnableKafka;
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.core.DefaultKafkaConsumerFactory;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

import java.util.HashMap;
import java.util.Map;

/**
 * Step 9: the proctoring event pipeline. The broker address comes from the standard Spring setting
 * spring.kafka.bootstrap-servers (docker compose: SPRING_KAFKA_BOOTSTRAP_SERVERS=kafka:<internal port>).
 * The producer gives up after a few seconds, so a Kafka outage can never freeze an exam.
 */
@Configuration
@EnableKafka
public class ProctorKafkaConfig {

    public static final String TOPIC = "eduai.proctoring.events";
    public static final String GROUP = "eduai-proctoring-writer";

    @Bean
    public NewTopic proctoringTopic() {
        return TopicBuilder.name(TOPIC).partitions(3).replicas(1).build();
    }

    @Bean("proctorKafkaTemplate")
    public KafkaTemplate<String, String> proctorKafkaTemplate(
            @Value("${spring.kafka.bootstrap-servers:localhost:9092}") String servers) {
        Map<String, Object> p = new HashMap<>();
        p.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, servers);
        p.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        p.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        p.put(ProducerConfig.ACKS_CONFIG, "all");
        p.put(ProducerConfig.MAX_BLOCK_MS_CONFIG, 3000);
        p.put(ProducerConfig.REQUEST_TIMEOUT_MS_CONFIG, 3000);
        p.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, 5000);
        return new KafkaTemplate<>(new DefaultKafkaProducerFactory<>(p));
    }

    @Bean("proctorListenerFactory")
    public ConcurrentKafkaListenerContainerFactory<String, String> proctorListenerFactory(
            @Value("${spring.kafka.bootstrap-servers:localhost:9092}") String servers) {
        Map<String, Object> c = new HashMap<>();
        c.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, servers);
        c.put(ConsumerConfig.GROUP_ID_CONFIG, GROUP);
        c.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
        c.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
        c.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        c.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);
        ConcurrentKafkaListenerContainerFactory<String, String> f = new ConcurrentKafkaListenerContainerFactory<>();
        f.setConsumerFactory(new DefaultKafkaConsumerFactory<>(c));
        f.setConcurrency(1);
        // a message that keeps failing is retried 3 times, then skipped, so one bad event never blocks the rest
        f.setCommonErrorHandler(new DefaultErrorHandler(new FixedBackOff(1000L, 3L)));
        return f;
    }
}
