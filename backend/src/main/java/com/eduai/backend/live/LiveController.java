package com.eduai.backend.live;

import com.eduai.backend.auth.AuthenticatedUser;
import com.eduai.backend.live.LiveDtos.LiveSnapshot;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
public class LiveController {

    private final LiveService service;

    public LiveController(LiveService service) {
        this.service = service;
    }

    /** /api/teacher/** is TEACHER or ADMIN only (SecurityConfig). */
    @GetMapping("/api/teacher/exams/{examId}/live")
    public LiveSnapshot live(@AuthenticationPrincipal AuthenticatedUser p, @PathVariable UUID examId) {
        return service.snapshot(p, examId);
    }
}
