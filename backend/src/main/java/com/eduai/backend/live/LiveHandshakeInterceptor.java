package com.eduai.backend.live;

import com.eduai.backend.auth.AuthenticatedUser;
import com.eduai.backend.auth.JwtService;
import com.eduai.backend.user.Role;
import io.jsonwebtoken.Claims;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.Map;
import java.util.UUID;

/**
 * Browsers cannot send an Authorization header on a WebSocket, so the JWT travels in the URL
 * (ws://host/ws/proctor?token=...). It is verified here, before the connection is accepted.
 * Only TEACHER and ADMIN may connect.
 */
@Component
public class LiveHandshakeInterceptor implements HandshakeInterceptor {

    static final String USER = "user";

    private final JwtService jwt;

    public LiveHandshakeInterceptor(JwtService jwt) {
        this.jwt = jwt;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler handler, Map<String, Object> attributes) {
        String token = UriComponentsBuilder.fromUri(request.getURI()).build().getQueryParams().getFirst("token");
        if (token == null || token.isBlank()) {
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }
        try {
            Claims c = jwt.parse(token);
            Role role = Role.valueOf(c.get("role", String.class));
            if (role != Role.TEACHER && role != Role.ADMIN) {
                response.setStatusCode(HttpStatus.FORBIDDEN);
                return false;
            }
            attributes.put(USER, new AuthenticatedUser(UUID.fromString(c.getSubject()), c.get("email", String.class), role));
            return true;
        } catch (RuntimeException ex) {   // expired, tampered, malformed
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler handler, Exception exception) {
    }
}
