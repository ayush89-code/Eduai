package com.eduai.backend.live;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

import java.util.Arrays;

/** Step 10: ws://localhost:8080/ws/proctor?token=<jwt> (same allowed origins as the REST CORS setting). */
@Configuration
@EnableWebSocket
public class LiveWebSocketConfig implements WebSocketConfigurer {

    private final LiveSocketHandler handler;
    private final LiveHandshakeInterceptor interceptor;
    private final String[] origins;

    public LiveWebSocketConfig(LiveSocketHandler handler, LiveHandshakeInterceptor interceptor,
                               @Value("${eduai.cors.allowed-origins:http://localhost:5173,http://127.0.0.1:5173}") String origins) {
        this.handler = handler;
        this.interceptor = interceptor;
        this.origins = Arrays.stream(origins.split(",")).map(String::trim).toArray(String[]::new);
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/ws/proctor")
                .addInterceptors(interceptor)
                .setAllowedOrigins(origins);
    }
}
