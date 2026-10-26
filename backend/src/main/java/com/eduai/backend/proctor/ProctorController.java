package com.eduai.backend.proctor;

import com.eduai.backend.auth.AuthenticatedUser;
import com.eduai.backend.proctor.ProctorDtos.*;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/** Step 9. /api/student/** is STUDENT only and /api/teacher/** is TEACHER or ADMIN (see SecurityConfig). */
@RestController
public class ProctorController {

    private final ProctorService service;

    public ProctorController(ProctorService service) {
        this.service = service;
    }

    @PostMapping("/api/student/attempts/{attemptId}/proctor-events")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public BatchResponse report(@AuthenticationPrincipal AuthenticatedUser p, @PathVariable UUID attemptId,
                                @Valid @RequestBody BatchRequest req) {
        return service.publish(p, attemptId, req);
    }

    @GetMapping("/api/teacher/attempts/{attemptId}/proctoring")
    public ProctorSummary summary(@AuthenticationPrincipal AuthenticatedUser p, @PathVariable UUID attemptId) {
        return service.summary(p, attemptId);
    }
}
