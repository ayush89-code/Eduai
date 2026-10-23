package com.eduai.backend.admin;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Placeholder endpoints that prove the role guards work. They get replaced by the real
 * teacher (Step 7) and student (Step 8) APIs and can be deleted then.
 */
@RestController
public class RoleCheckController {

    @GetMapping("/api/teacher/ping")
    public Map<String, String> teacherPing() {
        return Map.of("area", "teacher", "status", "ok");
    }

    @GetMapping("/api/student/ping")
    public Map<String, String> studentPing() {
        return Map.of("area", "student", "status", "ok");
    }
}
