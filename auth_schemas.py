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


class ContactRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    message: str = Field(min_length=10, max_length=4000)
    subject: str = Field(default="Studio inquiry", max_length=200)


class SoundoraGenerateRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=500)
    style: str = Field(default="", max_length=120)
    title: str = Field(default="", max_length=120)
    instrumental: bool = False


class SoundoraTrackItem(BaseModel):
    id: str
    prompt: str
    style: str
    title: str
    status: str
    audio_url: str | None = None
    image_url: str | None = None
    error_message: str | None = None
    created_at: str
    completed_at: str | None = None


class SoundoraTrackListResponse(BaseModel):
    tracks: list[SoundoraTrackItem]
    total_generated: int


class SoundoraStatsResponse(BaseModel):
    total_generated: int
    completed: int
    processing: int
    max_tracks: int

