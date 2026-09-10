from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import date
from decimal import Decimal
import uuid

from models import PaymentType, StrategyType

# --- Схемы для Досрочных платежей ---
class ExtraPaymentCreate(BaseModel):
    amount: Decimal = Field(gt=0, description="Сумма досрочного платежа должна быть больше 0")
    payment_date: date
    strategy: StrategyType
    is_recurring: bool = False
    is_executed: bool = False

class ExtraPaymentResponse(ExtraPaymentCreate):
    id: uuid.UUID
    loan_id: uuid.UUID

    model_config = {"from_attributes": True}

class UserCreate(BaseModel):
    username: str
    password: str

class UserResponse(BaseModel):
    id: uuid.UUID
    username: str
    
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

# --- Схемы для Кредита ---
class LoanCreate(BaseModel):
    name: str
    initial_amount: Decimal = Field(gt=0)
    interest_rate: Decimal = Field(gt=0, le=100)
    term_months: int = Field(gt=0)
    start_date: date
    first_payment_date: date
    payment_type: PaymentType

class LoanResponse(LoanCreate):
    id: uuid.UUID
    
    model_config = {"from_attributes": True}

# --- Схемы для Графика ---
class ScheduleRow(BaseModel):
    payment_number: int
    date: date
    total_payment: float
    principal_payment: float
    interest_payment: float
    extra_payment: float
    remaining_balance: float
    base_remaining_balance: float

class ScheduleResponse(BaseModel):
    loan_info: LoanResponse
    schedule: List[ScheduleRow]
    total_months: int
    total_interest: float
    saved_interest: float
    saved_months: int
    paid_payment_numbers: List[int]