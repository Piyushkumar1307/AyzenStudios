from pydantic import BaseModel
from typing import Optional

class Landmark(BaseModel):
    x: float
    y: float
    z: float

class GestureEvent(BaseModel):
    gesture: str           # "pinch", "point", "fist", "open", "none"
    confidence: float      # 0.0 to 1.0
    cursor_x: float        # normalized 0.0 to 1.0
    cursor_y: float        # normalized 0.0 to 1.0
    hand: str              # "left" or "right"
    timestamp: float

class HandState(BaseModel):
    detected: bool
    gesture: Optional[str] = None
    cursor_x: Optional[float] = None
    cursor_y: Optional[float] = None