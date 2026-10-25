package com.eduai.backend.question;

import com.eduai.backend.auth.AuthenticatedUser;
import com.eduai.backend.question.QuestionDtos.*;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/** Step 7a: review generated questions. /api/teacher/** is already limited to TEACHER and ADMIN. */
@RestController
@RequestMapping("/api/teacher/questions")
public class QuestionController {

    private final QuestionService service;

    public QuestionController(QuestionService service) {
        this.service = service;
    }

    @GetMapping
    public List<QuestionView> list(@AuthenticationPrincipal AuthenticatedUser principal,
                                   @RequestParam UUID sourceId,
                                   @RequestParam(required = false) String status,
                                   @RequestParam(required = false) String type) {
        return service.list(principal, sourceId, status, type);
    }

    /** Sources with questions + approved counts; feeds the source picker of the paper builder. */
    @GetMapping("/banks")
    public List<BankView> banks(@AuthenticationPrincipal AuthenticatedUser principal) {
        return service.banks(principal);
    }

    @PutMapping("/{id}")
    public QuestionView update(@AuthenticationPrincipal AuthenticatedUser principal, @PathVariable UUID id,
                               @Valid @RequestBody UpdateRequest req) {
        return service.update(principal, id, req);
    }

    @PostMapping("/{id}/approve")
    public QuestionView approve(@AuthenticationPrincipal AuthenticatedUser principal, @PathVariable UUID id) {
        return service.approve(principal, id);
    }

    @PostMapping("/{id}/reject")
    public QuestionView reject(@AuthenticationPrincipal AuthenticatedUser principal, @PathVariable UUID id) {
        return service.reject(principal, id);
    }

    @PostMapping("/bulk")
    public BulkResult bulk(@AuthenticationPrincipal AuthenticatedUser principal,
                           @Valid @RequestBody BulkRequest req) {
        return service.bulk(principal, req);
    }
}
