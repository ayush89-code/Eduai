package com.eduai.backend.admin;

import com.eduai.backend.user.UserDto;
import com.eduai.backend.user.UserRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Route guard: /api/admin/** requires ROLE_ADMIN (see SecurityConfig). */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private final UserRepository users;

    public AdminController(UserRepository users) {
        this.users = users;
    }

    @GetMapping("/users")
    public List<UserDto> listUsers() {
        return users.findAll().stream().map(UserDto::from).toList();
    }
}
