import re
from datetime import datetime, timedelta
from typing import Optional
import os
import httpx
import time

from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from models import User
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.time import utc_now
from database import SessionLocal
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change_this_later")
ALGORITHM = "HS256"

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

GOOGLE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
_firebase_keys_cache: dict[str, dict] = {}
_firebase_keys_expiry = 0.0


class UsernameAlreadyExistsError(ValueError):
    pass


def _cache_max_age(cache_control: str, default: int = 3600) -> int:
    match = re.search(r"(?:^|,)\s*max-age\s*=\s*(\d+)", cache_control or "", re.IGNORECASE)
    return int(match.group(1)) if match else default


def get_google_public_keys(force_refresh: bool = False) -> dict[str, dict]:
    global _firebase_keys_cache, _firebase_keys_expiry
    now = time.time()
    if not force_refresh and _firebase_keys_cache and now < _firebase_keys_expiry:
        return _firebase_keys_cache

    try:
        response = httpx.get(GOOGLE_JWKS_URL, timeout=10.0)
        response.raise_for_status()
        payload = response.json()
        keys = payload.get("keys") if isinstance(payload, dict) else None
        if not isinstance(keys, list):
            raise ValueError("Firebase signing-key response did not contain a keys list")

        refreshed = {
            key["kid"]: key
            for key in keys
            if isinstance(key, dict) and isinstance(key.get("kid"), str) and key.get("kid")
        }
        if not refreshed:
            raise ValueError("Firebase signing-key response did not contain usable keys")

        _firebase_keys_cache = refreshed
        _firebase_keys_expiry = now + _cache_max_age(response.headers.get("Cache-Control", ""))
    except Exception as exc:
        # A temporarily unavailable Google endpoint should not invalidate keys
        # that were already fetched successfully. If no key has ever been
        # loaded, fail closed and let the caller return a safe auth error.
        if not _firebase_keys_cache:
            raise RuntimeError("Firebase signing keys are unavailable") from exc

    return _firebase_keys_cache

def verify_firebase_token(token: str, project_id: str) -> dict:
    if not isinstance(token, str) or not token.strip():
        raise ValueError("Firebase token is empty")
    if not isinstance(project_id, str) or not project_id.strip():
        raise ValueError("Firebase project ID is empty")

    header = jwt.get_unverified_header(token)
    if header.get("alg") != "RS256":
        raise ValueError("Firebase token must use RS256")

    kid = header.get("kid")
    if not kid:
        raise ValueError("Firebase token missing kid claim")

    keys = get_google_public_keys()
    signing_key = keys.get(kid)
    if not signing_key:
        # Google rotates Firebase signing keys. Refresh once before rejecting a
        # token whose key was not in the current cache.
        signing_key = get_google_public_keys(force_refresh=True).get(kid)
    if not signing_key:
        raise ValueError("Firebase token signing key was not found")

    project_id = project_id.strip()
    decoded = jwt.decode(
        token,
        signing_key,
        algorithms=["RS256"],
        audience=project_id,
        issuer=f"https://securetoken.google.com/{project_id}"
    )
    if not isinstance(decoded.get("sub"), str) or not decoded["sub"].strip():
        raise ValueError("Firebase token subject is missing")
    return decoded


def find_user_by_username(db: Session, username: str) -> Optional[User]:
    normalized = (username or "").strip()
    if not normalized:
        return None
    return db.query(User).filter(func.lower(User.username) == normalized.lower()).first()


def find_user_by_email(db: Session, email: str) -> Optional[User]:
    normalized = (email or "").strip()
    if not normalized:
        return None
    return db.query(User).filter(func.lower(User.email) == normalized.lower()).first()


def username_is_available(
    db: Session,
    username: str,
    *,
    exclude_user_id: Optional[str] = None,
) -> bool:
    normalized = (username or "").strip()
    if not normalized:
        return False
    query = db.query(User).filter(func.lower(User.username) == normalized.lower())
    if exclude_user_id:
        query = query.filter(User.id != exclude_user_id)
    return query.first() is None


def allocate_username(db: Session, preferred: str) -> str:
    base = (preferred or "").strip() or "user"
    candidate = base
    suffix = 1
    while not username_is_available(db, candidate):
        candidate = f"{base}{suffix}"
        suffix += 1
    return candidate


def complete_firebase_signup_user(
    db: Session,
    *,
    firebase_uid: str,
    email: str,
    username: str,
    avatar_url: Optional[str] = None,
) -> tuple[User, bool]:
    firebase_uid = (firebase_uid or "").strip()
    email = (email or "").strip()
    username = (username or "").strip()
    if not firebase_uid or not email or not username:
        raise ValueError("Firebase signup identity is incomplete")

    existing = db.query(User).filter(User.id == firebase_uid).first()
    if existing:
        return existing, False
    existing_by_email = find_user_by_email(db, email)
    if existing_by_email:
        existing_by_email.id = firebase_uid
        if avatar_url and not existing_by_email.avatar_url:
            existing_by_email.avatar_url = avatar_url
        db.commit()
        db.refresh(existing_by_email)
        return existing_by_email, False
    if not username_is_available(db, username):
        raise UsernameAlreadyExistsError("Username already taken")

    user = User(
        id=firebase_uid,
        username=username,
        email=email,
        password_hash="firebase_managed",
        avatar_url=avatar_url,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user, True


def get_or_create_firebase_session_user(db: Session, decoded: dict) -> tuple[User, bool]:
    firebase_uid = str(decoded.get("sub") or "").strip()
    if not firebase_uid:
        raise ValueError("Firebase identity is missing")

    email = str(decoded.get("email") or "").strip()
    display_name = str(decoded.get("name") or "").strip()
    user = db.query(User).filter(User.id == firebase_uid).first()
    if user:
        return user, False

    if email:
        existing_by_email = find_user_by_email(db, email)
        if existing_by_email:
            existing_by_email.id = firebase_uid
            db.commit()
            db.refresh(existing_by_email)
            return existing_by_email, False

    preferred_username = display_name or (email.split("@")[0] if email else f"user_{firebase_uid[:8]}")
    user = User(
        id=firebase_uid,
        username=allocate_username(db, preferred_username),
        email=email or f"{firebase_uid}@firebase.local",
        password_hash="firebase_managed",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user, True



def validate_registration(username: str, email: str, password: str, db: Session):
    # 1. Email format
    if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
        raise HTTPException(status_code=400, detail="Invalid email format")
    
    # 2. Password length
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters long")
    
    # 3. Username uniqueness
    existing_user = find_user_by_username(db, username)
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already taken")
        
    # 4. Email uniqueness
    existing_email = find_user_by_email(db, email)
    if existing_email:
        raise HTTPException(status_code=400, detail="Email already exists")


def create_token(user_id: str, token_type: str, expires_delta: timedelta) -> str:
    expire = utc_now() + expires_delta
    payload = {
        "sub": user_id,
        "exp": expire,
        "token_type": token_type,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def create_access_token(user_id: str, remember_me: bool = False) -> str:
    days = 30 if remember_me else 2
    return create_token(user_id, "access", timedelta(days=days))


def create_refresh_token(user_id: str, remember_me: bool = False) -> str:
    days = 60 if remember_me else 7
    return create_token(user_id, "refresh", timedelta(days=days))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def validate_token(token: str, expected_type: str = "access") -> str:
    # Try local JWT first (primary auth method)
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        token_type = payload.get("token_type")

        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        if token_type and token_type != expected_type:
            raise HTTPException(status_code=401, detail=f"Invalid token type")
        
        return user_id
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except JWTError:
        pass  # Not a local JWT, try Firebase below

    # Fallback to Firebase verification
    project_id = os.environ.get("VITE_FIREBASE_PROJECT_ID", "bannana-487713")
    try:
        decoded_token = verify_firebase_token(token, project_id)
        return decoded_token.get("sub")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


def get_current_user_id(
    token: str = Depends(oauth2_scheme),
):
    return validate_token(token, "access")


def get_current_user(
    db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)
):
    user_id = validate_token(token, "access")
    
    user = db.query(User).filter(User.id == user_id).first()
    
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user
