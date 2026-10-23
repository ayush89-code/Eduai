"""Placeholder endpoints proving the AI service validates backend-issued JWTs.
Replaced by the real ingestion / generation routers from Step 4 onward."""
from fastapi import APIRouter, Depends

from app.core.security import CurrentUser, get_current_user, require_roles

router = APIRouter(prefix="/api", tags=["auth-check"])


@router.get("/whoami")
def whoami(user: CurrentUser = Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "role": user.role, "name": user.name}


@router.get("/teacher-only")
def teacher_only(user: CurrentUser = Depends(require_roles("TEACHER", "ADMIN"))):
    return {"area": "teacher", "status": "ok", "user": user.email}
