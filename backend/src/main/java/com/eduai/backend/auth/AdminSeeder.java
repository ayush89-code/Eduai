package com.eduai.backend.auth;

import com.eduai.backend.user.Role;
import com.eduai.backend.user.User;
import com.eduai.backend.user.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/** Creates the first ADMIN on startup if none exists (admins cannot self-register). */
@Component
public class AdminSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminSeeder.class);

    private final UserRepository users;
    private final PasswordEncoder encoder;
    private final String email;
    private final String password;
    private final String name;

    public AdminSeeder(UserRepository users, PasswordEncoder encoder,
                       @Value("${eduai.admin.email:admin@eduai.local}") String email,
                       @Value("${eduai.admin.password:Admin@12345}") String password,
                       @Value("${eduai.admin.name:EduAI Admin}") String name) {
        this.users = users;
        this.encoder = encoder;
        this.email = email;
        this.password = password;
        this.name = name;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (users.existsByRole(Role.ADMIN)) return;
        User admin = new User();
        admin.setEmail(AuthService.normalize(email));
        admin.setPasswordHash(encoder.encode(password));
        admin.setFullName(name);
        admin.setRole(Role.ADMIN);
        users.save(admin);
        log.warn("Seeded initial admin account '{}'. Change EDUAI_ADMIN_EMAIL / EDUAI_ADMIN_PASSWORD outside local dev.", admin.getEmail());
    }
}
