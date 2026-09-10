from sqlalchemy import Column, String, Numeric, Integer, Date, Boolean, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid
import enum
from database import Base

class PaymentType(enum.Enum):
    ANNUITY = "ANNUITY"
    DIFFERENTIATED = "DIFFERENTIATED"

class StrategyType(enum.Enum):
    REDUCE_TERM = "REDUCE_TERM"
    REDUCE_PAYMENT = "REDUCE_PAYMENT"

# --- НОВАЯ ТАБЛИЦА ПОЛЬЗОВАТЕЛЕЙ ---
class User(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String) # Хэшированный пароль
    
    loans = relationship("Loan", back_populates="owner", cascade="all, delete-orphan")

class Loan(Base):
    __tablename__ = "loans"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Поле user_id может быть пустым (nullable=True), чтобы гости тоже могли пользоваться сервисом
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True) 
    name = Column(String)
    
    initial_amount = Column(Numeric(15, 2))
    interest_rate = Column(Numeric(5, 2))
    term_months = Column(Integer)
    
    start_date = Column(Date)
    first_payment_date = Column(Date)
    payment_type = Column(SQLEnum(PaymentType))
    
    owner = relationship("User", back_populates="loans")
    extra_payments = relationship("ExtraPayment", back_populates="loan", cascade="all, delete-orphan")
    paid_months = relationship("PaidMonth", back_populates="loan", cascade="all, delete-orphan")

class ExtraPayment(Base):
    __tablename__ = "extra_payments"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    loan_id = Column(UUID(as_uuid=True), ForeignKey("loans.id"))
    
    amount = Column(Numeric(15, 2))
    payment_date = Column(Date)
    strategy = Column(SQLEnum(StrategyType))
    is_recurring = Column(Boolean, default=False)
    is_executed = Column(Boolean, default=False)
    
    loan = relationship("Loan", back_populates="extra_payments")

class PaidMonth(Base):
    __tablename__ = "paid_months"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    loan_id = Column(UUID(as_uuid=True), ForeignKey("loans.id"))
    payment_number = Column(Integer)
    
    loan = relationship("Loan", back_populates="paid_months")