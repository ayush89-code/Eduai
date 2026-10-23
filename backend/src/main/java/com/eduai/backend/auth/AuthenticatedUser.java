package com.eduai.backend.auth;

import com.eduai.backend.user.Role;

import java.util.UUID;

/** Principal placed in the SecurityContext for every request carrying a valid JWT. */
public record AuthenticatedUser(UUID id, String email, Role role) {
}
