package com.eduai.backend.exam;

import com.eduai.backend.auth.AuthenticatedUser;
import com.eduai.backend.exam.ExamDtos.*;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/** Step 7b: question papers. /api/teacher/** is already limited to TEACHER and ADMIN. */
@RestController
@RequestMapping("/api/teacher/exams")
public class ExamController {

    private final ExamService service;

    public ExamController(ExamService service) {
        this.service = service;
    }

    @GetMapping
    public List<ExamSummary> list(@AuthenticationPrincipal AuthenticatedUser p) {
        return service.list(p);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ExamDetail create(@AuthenticationPrincipal AuthenticatedUser p, @Valid @RequestBody CreateRequest req) {
        return service.create(p, req);
    }

    @GetMapping("/{id}")
    public ExamDetail get(@AuthenticationPrincipal AuthenticatedUser p, @PathVariable UUID id) {
        return service.get(p, id);
    }

    @PutMapping("/{id}")
    public ExamDetail update(@AuthenticationPrincipal AuthenticatedUser p, @PathVariable UUID id,
                             @Valid @RequestBody UpdateRequest req) {
        return service.update(p, id, req);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal AuthenticatedUser p, @PathVariable UUID id) {
        service.delete(p, id);
    }

    @PutMapping("/{id}/questions")
    public ExamDetail setPaper(@AuthenticationPrincipal AuthenticatedUser p, @PathVariable UUID id,
                               @Valid @RequestBody PaperRequest req) {
        return service.setPaper(p, id, req);
    }

    @PostMapping("/{id}/auto-fill")
    public BlueprintResult autoFill(@AuthenticationPrincipal AuthenticatedUser p, @PathVariable UUID id,
                                    @Valid @RequestBody BlueprintRequest req) {
        return service.autoFill(p, id, req);
    }

    @PostMapping("/{id}/publish")
    public ExamDetail publish(@AuthenticationPrincipal AuthenticatedUser p, @PathVariable UUID id) {
        return service.publish(p, id);
    }

    @PostMapping("/{id}/unpublish")
    public ExamDetail unpublish(@AuthenticationPrincipal AuthenticatedUser p, @PathVariable UUID id) {
        return service.unpublish(p, id);
    }

    @PostMapping("/{id}/close")
    public ExamDetail close(@AuthenticationPrincipal AuthenticatedUser p, @PathVariable UUID id) {
        return service.close(p, id);
    }
}
