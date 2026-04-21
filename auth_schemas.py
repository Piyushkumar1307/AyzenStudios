from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    # bcrypt only uses the first 72 bytes of a password; enforce a safe max to avoid 500s.
    password: str = Field(min_length=6, max_length=72)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    id: str
    name: str
    email: EmailStr


class RequestEmailOtp(BaseModel):
    email: EmailStr


class VerifyEmailOtp(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=12)


class OtpStatusResponse(BaseModel):
    ok: bool
    detail: str

