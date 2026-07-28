import base64
import time
import unittest
from unittest.mock import Mock, patch

import rsa
from jose import jwt
from jose.backends.rsa_backend import RSAKey as PurePythonRSAKey
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import auth
from auth import (
    UsernameAlreadyExistsError,
    complete_firebase_signup_user,
    find_user_by_username,
    get_or_create_firebase_session_user,
    username_is_available,
    verify_firebase_token,
)
from database import Base
from models import User


def _base64url_uint(value: int) -> str:
    raw = value.to_bytes(max(1, (value.bit_length() + 7) // 8), "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


class FirebaseTokenVerificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.public_key, cls.private_key = rsa.newkeys(2048)
        cls.kid = "firebase-test-key"
        cls.public_jwk = {
            "kty": "RSA",
            "kid": cls.kid,
            "alg": "RS256",
            "use": "sig",
            "n": _base64url_uint(cls.public_key.n),
            "e": _base64url_uint(cls.public_key.e),
        }
        cls.private_pem = cls.private_key.save_pkcs1()
        cls.project_id = "test-firebase-project"

    def setUp(self):
        auth._firebase_keys_cache = {}
        auth._firebase_keys_expiry = 0

    def _claims(self, **overrides):
        now = int(time.time())
        claims = {
            "aud": self.project_id,
            "iss": f"https://securetoken.google.com/{self.project_id}",
            "sub": "firebase-user-123",
            "email": "person@example.com",
            "iat": now - 5,
            "exp": now + 300,
        }
        claims.update(overrides)
        return claims

    def _token(self, claims=None, *, kid=None):
        return jwt.encode(
            claims or self._claims(),
            self.private_pem,
            algorithm="RS256",
            headers={"kid": kid or self.kid},
        )

    def test_valid_jwk_token_verifies_with_expected_claims(self):
        with patch.object(auth, "get_google_public_keys", return_value={self.kid: self.public_jwk}):
            decoded = verify_firebase_token(self._token(), self.project_id)
        self.assertEqual(decoded["sub"], "firebase-user-123")
        self.assertEqual(decoded["email"], "person@example.com")

    def test_jwk_verifies_through_python_jose_pure_python_rsa_backend(self):
        token = self._token()
        with (
            patch.object(auth, "get_google_public_keys", return_value={self.kid: self.public_jwk}),
            patch("jose.jwk.get_key", return_value=PurePythonRSAKey),
        ):
            decoded = verify_firebase_token(token, self.project_id)
        self.assertEqual(decoded["sub"], "firebase-user-123")

    def test_unknown_kid_forces_one_key_rotation_refresh(self):
        rotated_kid = "rotated-firebase-key"
        rotated_jwk = {**self.public_jwk, "kid": rotated_kid}
        token = self._token(kid=rotated_kid)
        key_loader = Mock(side_effect=[
            {self.kid: self.public_jwk},
            {rotated_kid: rotated_jwk},
        ])

        with patch.object(auth, "get_google_public_keys", key_loader):
            decoded = verify_firebase_token(token, self.project_id)

        self.assertEqual(decoded["sub"], "firebase-user-123")
        self.assertEqual(key_loader.call_args_list[0].kwargs, {})
        self.assertEqual(key_loader.call_args_list[1].kwargs, {"force_refresh": True})

    def test_invalid_standard_claims_are_rejected(self):
        cases = {
            "expired": {"exp": int(time.time()) - 60},
            "audience": {"aud": "another-project"},
            "issuer": {"iss": "https://securetoken.google.com/another-project"},
            "subject": {"sub": ""},
        }
        with patch.object(auth, "get_google_public_keys", return_value={self.kid: self.public_jwk}):
            for label, overrides in cases.items():
                with self.subTest(label=label):
                    with self.assertRaises(Exception):
                        verify_firebase_token(
                            self._token(self._claims(**overrides)),
                            self.project_id,
                        )

    def test_non_rs256_algorithm_is_rejected_before_key_lookup(self):
        token = jwt.encode(
            self._claims(),
            "test-only-hmac-secret",
            algorithm="HS256",
            headers={"kid": self.kid},
        )
        key_loader = Mock()
        with patch.object(auth, "get_google_public_keys", key_loader):
            with self.assertRaisesRegex(ValueError, "RS256"):
                verify_firebase_token(token, self.project_id)
        key_loader.assert_not_called()

    def test_jwk_cache_honors_max_age(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"keys": [self.public_jwk]}
        response.headers = {"Cache-Control": "public, max-age=120"}

        with (
            patch.object(auth.httpx, "get", return_value=response) as request,
            patch.object(auth.time, "time", return_value=1000),
        ):
            first = auth.get_google_public_keys()
            second = auth.get_google_public_keys()

        self.assertIs(first, second)
        self.assertEqual(auth._firebase_keys_expiry, 1120)
        request.assert_called_once_with(auth.GOOGLE_JWKS_URL, timeout=10.0)

    def test_signing_key_network_failure_fails_closed_without_cached_keys(self):
        with patch.object(auth.httpx, "get", side_effect=OSError("offline")):
            with self.assertRaisesRegex(RuntimeError, "signing keys are unavailable"):
                auth.get_google_public_keys()

    def test_stale_signing_keys_remain_available_during_temporary_network_failure(self):
        auth._firebase_keys_cache = {self.kid: self.public_jwk}
        auth._firebase_keys_expiry = 0
        with patch.object(auth.httpx, "get", side_effect=OSError("offline")):
            self.assertEqual(
                auth.get_google_public_keys(force_refresh=True),
                {self.kid: self.public_jwk},
            )


class FirebaseAccountPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.session = sessionmaker(bind=self.engine)()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def _add_user(self, *, user_id: str, username: str, email: str):
        user = User(
            id=user_id,
            username=username,
            email=email,
            password_hash="firebase_managed",
        )
        self.session.add(user)
        self.session.commit()
        return user

    def test_complete_signup_creates_the_requested_username(self):
        user, created = complete_firebase_signup_user(
            self.session,
            firebase_uid="firebase-new",
            email="new@example.com",
            username="ChosenName",
            avatar_url="avatar.svg",
        )
        self.assertTrue(created)
        self.assertEqual(user.username, "ChosenName")
        self.assertEqual(find_user_by_username(self.session, "chosenname").email, "new@example.com")

    def test_username_resolution_and_availability_are_case_insensitive(self):
        self._add_user(user_id="one", username="MixedCase", email="mixed@example.com")
        self.assertEqual(find_user_by_username(self.session, "mixedcase").id, "one")
        self.assertEqual(find_user_by_username(self.session, "MIXEDCASE").id, "one")
        self.assertFalse(username_is_available(self.session, "mixedCASE"))
        self.assertTrue(username_is_available(self.session, "mixedCASE", exclude_user_id="one"))

    def test_signup_rejects_a_case_only_username_collision(self):
        self._add_user(user_id="one", username="ExistingName", email="one@example.com")
        with self.assertRaises(UsernameAlreadyExistsError):
            complete_firebase_signup_user(
                self.session,
                firebase_uid="two",
                email="two@example.com",
                username="existingname",
            )

    def test_complete_signup_reconciles_an_existing_email(self):
        self._add_user(user_id="legacy-id", username="LocalUser", email="person@example.com")
        user, created = complete_firebase_signup_user(
            self.session,
            firebase_uid="firebase-id",
            email="PERSON@example.com",
            username="RequestedName",
            avatar_url="avatar.svg",
        )
        self.assertFalse(created)
        self.assertEqual(user.id, "firebase-id")
        self.assertEqual(user.username, "LocalUser")
        self.assertEqual(user.avatar_url, "avatar.svg")

    def test_firebase_session_reconciles_an_existing_email(self):
        self._add_user(user_id="legacy-id", username="LocalUser", email="person@example.com")
        user, created = get_or_create_firebase_session_user(
            self.session,
            {
                "sub": "firebase-id",
                "email": "PERSON@example.com",
                "name": "FirebaseName",
            },
        )
        self.assertFalse(created)
        self.assertEqual(user.id, "firebase-id")
        self.assertEqual(user.username, "LocalUser")

    def test_firebase_session_allocates_a_case_safe_username(self):
        self._add_user(user_id="one", username="DesiredName", email="one@example.com")
        user, created = get_or_create_firebase_session_user(
            self.session,
            {
                "sub": "firebase-two",
                "email": "two@example.com",
                "name": "desiredname",
            },
        )
        self.assertTrue(created)
        self.assertEqual(user.username, "desiredname1")


if __name__ == "__main__":
    unittest.main()
