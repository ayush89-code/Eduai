package com.eduai.backend.auth;

import com.eduai.backend.auth.AuthDtos.*;
import com.eduai.backend.common.ApiException;
import com.eduai.backend.user.Role;
import com.eduai.backend.user.User;
import com.eduai.backend.user.UserDto;
import com.eduai.backend.user.UserRepository;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.Locale;

@Service
public class AuthService {

    private final UserRepository users;
    private final PasswordEncoder encoder;
    private final AuthenticationManager authManager;
    private final JwtService jwt;

    public AuthService(UserRepository users, PasswordEncoder encoder,
                       AuthenticationManager authManager, JwtService jwt) {
        this.users = users;
        this.encoder = encoder;
        this.authManager = authManager;
        this.jwt = jwt;
    }

    public AuthResponse register(RegisterRequest req) {
        if (req.role() == Role.ADMIN) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Admin accounts cannot be self-registered");
        }
        String email = normalize(req.email());
        if (users.existsByEmailIgnoreCase(email)) {
            throw new ApiException(HttpStatus.CONFLICT, "Email already registered");
        }
        User u = new User();
        u.setEmail(email);
        u.setPasswordHash(encoder.encode(req.password()));
        u.setFullName(req.fullName().trim());
        u.setRole(req.role());
        users.save(u);
        return toResponse(u);
    }

    public AuthResponse login(LoginRequest req) {
        String email = normalize(req.email());
        // Throws BadCredentialsException / DisabledException, mapped in GlobalExceptionHandler.
        authManager.authenticate(new UsernamePasswordAuthenticationToken(email, req.password()));
        User u = users.findByEmailIgnoreCase(email)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Invalid email or password"));
        return toResponse(u);
    }

    public UserDto me(java.util.UUID id) {
        return users.findById(id).map(UserDto::from)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "User no longer exists"));
    }

    private AuthResponse toResponse(User u) {
        return new AuthResponse(jwt.generate(u), "Bearer", jwt.getExpirationSeconds(), UserDto.from(u));
    }

    public static String normalize(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }
}
