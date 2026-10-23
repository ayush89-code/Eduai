"""Validates JWTs issued by the Spring Boot backend (shared JWT_SECRET, HS256).

Claims set by the backend: sub = user id, email, role (ADMIN|TEACHER|STUDENT), name.
"""
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings

ALGORITHM = "HS256"  # pinned: never accept the algorithm named in the token header

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str
    role: str
    name: str


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> CurrentUser:
    if creds is None:
        raise _unauthorized("Authentication required")
    try:
        payload = jwt.decode(
            creds.credentials,
            settings.jwt_secret,
            algorithms=[ALGORITHM],
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Token expired")
    except jwt.InvalidTokenError:
        raise _unauthorized("Invalid token")

    role = payload.get("role")
    if role not in ("ADMIN", "TEACHER", "STUDENT"):
        raise _unauthorized("Invalid token")
    return CurrentUser(
        id=payload["sub"],
        email=payload.get("email", ""),
        role=role,
        name=payload.get("name", ""),
    )


def require_roles(*allowed: str):
    """Dependency factory: `Depends(require_roles("TEACHER", "ADMIN"))`."""

    def checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to access this resource",
            )
        return user

    return checker
