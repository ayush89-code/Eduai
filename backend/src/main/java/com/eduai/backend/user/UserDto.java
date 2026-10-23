package com.eduai.backend.user;

import java.util.UUID;

public record UserDto(UUID id, String email, String fullName, Role role) {
    public static UserDto from(User u) {
        return new UserDto(u.getId(), u.getEmail(), u.getFullName(), u.getRole());
    }
}
