from __future__ import annotations

import re
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


class CalibrationState(str, Enum):
    IDLE = "IDLE"
    CONNECTION_CHECK = "CONNECTION_CHECK"
    READY = "READY"
    ACCLIMATION = "ACCLIMATION"
    ACCLIMATION_COMPLETE = "ACCLIMATION_COMPLETE"
    BLOCK_READY = "BLOCK_READY"
    BLOCK_RECORDING = "BLOCK_RECORDING"
    SELF_REPORT = "SELF_REPORT"
    PROCESSING = "PROCESSING"
    COMPLETE = "COMPLETE"
    ERROR = "ERROR"


class SessionCreate(BaseModel):
    participant_id: str = Field(min_length=2, max_length=64)

    @field_validator("participant_id")
    @classmethod
    def normalize(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not re.fullmatch(r"P0*[1-9][0-9]*", normalized):
            raise ValueError("Participant ID must use P followed by a positive integer, for example P001")
        return normalized


class CalibrationStart(BaseModel):
    quality_override: bool = False


class SelfReportSubmit(BaseModel):
    mind_wandering: int | None = Field(default=None, ge=1, le=7)
    drowsiness: int | None = Field(default=None, ge=1, le=7)
    investigator_notes: str = Field(default="", max_length=2000)
    unable_to_judge: bool = False

    @field_validator("investigator_notes")
    @classmethod
    def normalize_notes(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def require_ratings_when_judged(self):
        if not self.unable_to_judge and (self.mind_wandering is None or self.drowsiness is None):
            raise ValueError("Both 1–7 ratings are required unless unable to judge")
        return self


class Marker(BaseModel):
    event: str
    monotonic_timestamp: float
    session_elapsed_seconds: float
    nearest_eeg_sample_index: int | None
    local_timestamp: str
    condition: str | None = None
    block_number: int | None = None
    block_id: str | None = None
    attempt: int | None = None
    completed_automatically: bool | None = None
    reason: str | None = None


class EEGSample(BaseModel):
    sample_index: int
    monotonic_timestamp: float
    session_elapsed_seconds: float | None
    tp9: float
    af7: float
    af8: float
    tp10: float
    aux_right: float | None = None
    headband_on: bool | None = None
    hsi_tp9: int | None = None
    hsi_af7: int | None = None
    hsi_af8: int | None = None
    hsi_tp10: int | None = None
    acc_x: float | None = None
    acc_y: float | None = None
    acc_z: float | None = None
    gyro_x: float | None = None
    gyro_y: float | None = None
    gyro_z: float | None = None
    blink: bool = False
    jaw_clench: bool = False

    def csv_row(self) -> dict[str, Any]:
        return self.model_dump()
