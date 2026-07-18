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
from sqlalchemy.orm import Session

from database import SessionLocal
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change_this_later")
ALGORITHM = "HS256"

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

GOOGLE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
_certs_cache = {}
_certs_expiry = 0

def get_google_public_keys():
    global _certs_cache, _certs_expiry
    now = time.time()
    if not _certs_cache or now > _certs_expiry:
        try:
            r = httpx.get(GOOGLE_CERTS_URL)
            if r.status_code == 200:
                _certs_cache = r.json()
                max_age = 3600
                cache_control = r.headers.get("Cache-Control", "")
                for part in cache_control.split(","):
                    if "max-age" in part:
                        try:
                            max_age = int(part.split("=")[1].strip())
                        except Exception:
                            pass
                _certs_expiry = now + max_age
        except Exception as e:
            print(f"[FIREBASE AUTH] Failed to fetch Google public keys: {e}")
    return _certs_cache

def verify_firebase_token(token: str, project_id: str) -> dict:
    header = jwt.get_unverified_header(token)
    kid = header.get("kid")
    if not kid:
        raise ValueError("Firebase token missing kid claim")
        
    certs = get_google_public_keys()
    cert = certs.get(kid)
    if not cert:
        raise ValueError(f"Firebase token kid {kid} not found in public keys")
        
    decoded = jwt.decode(
        token,
        cert,
        algorithms=["RS256"],
        audience=project_id,
        issuer=f"https://securetoken.google.com/{project_id}"
    )
    return decoded



def validate_registration(username: str, email: str, password: str, db: Session):
    # 1. Email format
    if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
        raise HTTPException(status_code=400, detail="Invalid email format")
    
    # 2. Password length
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters long")
    
    # 3. Username uniqueness
    existing_user = db.query(User).filter(User.username == username).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already taken")
        
    # 4. Email uniqueness
    existing_email = db.query(User).filter(User.email == email).first()
    if existing_email:
        raise HTTPException(status_code=400, detail="Email already exists")


def create_token(user_id: str, token_type: str, expires_delta: timedelta) -> str:
    expire = datetime.utcnow() + expires_delta
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
