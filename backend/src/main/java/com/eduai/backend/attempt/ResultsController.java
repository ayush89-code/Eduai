package com.eduai.backend.attempt;

import com.eduai.backend.attempt.AttemptDtos.*;
import com.eduai.backend.auth.AuthenticatedUser;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/** Step 8a: teacher side - results of an exam and marking of written answers. */
@RestController
@RequestMapping("/api/teacher")
public class ResultsController {

    private final ResultsService service;

    public ResultsController(ResultsService service) {
        this.service = service;
    }

    @GetMapping("/exams/{examId}/attempts")
    public ExamResults results(@AuthenticationPrincipal AuthenticatedUser p, @PathVariable UUID examId) {
        return service.forExam(p, examId);
    }

    @GetMapping("/attempts/{attemptId}")
    public AttemptDetail detail(@AuthenticationPrincipal AuthenticatedUser p, @PathVariable UUID attemptId) {
        return service.detail(p, attemptId);
    }

    @PutMapping("/attempts/{attemptId}/answers/{questionId}/marks")
    public AttemptDetail mark(@AuthenticationPrincipal AuthenticatedUser p, @PathVariable UUID attemptId,
                              @PathVariable UUID questionId, @Valid @RequestBody MarkRequest req) {
        return service.mark(p, attemptId, questionId, req);
    }
}
