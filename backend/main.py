from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid
import jwt
from datetime import datetime, timedelta
import bcrypt  # <--- ИСПОЛЬЗУЕМ ЧИСТЫЙ BCRYPT

import models, schemas
from database import engine, Base, get_db
from calculator import calculate_schedule

Base.metadata.create_all(bind=engine)

app = FastAPI(title="RoadTheDream API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SECRET_KEY = "road_the_dream_super_secret"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login", auto_error=False)

def verify_password(plain_password: str, hashed_password: str):
    # Конвертируем строки в байты (требование чистого bcrypt)
    password_bytes = plain_password.encode('utf-8')
    hash_bytes = hashed_password.encode('utf-8')
    return bcrypt.checkpw(password_bytes, hash_bytes)

def get_password_hash(password: str):
    # Генерируем соль и хэшируем напрямую
    password_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed_password = bcrypt.hashpw(password_bytes, salt)
    return hashed_password.decode('utf-8') # Возвращаем как строку для БД

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

# Далее идут эндпоинты @app.post("/register" ... (их не трогаем)
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            return None
    except jwt.PyJWTError:
        return None
    user = db.query(models.User).filter(models.User.username == username).first()
    return user

@app.post("/register", response_model=schemas.UserResponse, tags=["Auth"])
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.username == user.username).first():
        raise HTTPException(status_code=400, detail="Этот логин уже занят")
    
    hashed_pw = get_password_hash(user.password)
    new_user = models.User(username=user.username, hashed_password=hashed_pw)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.post("/login", response_model=schemas.Token, tags=["Auth"])
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")
    
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/loans", response_model=List[schemas.LoanResponse], tags=["Loans"])
def get_all_loans(
    ids: Optional[str] = None, 
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(models.Loan)
    if current_user:
        return query.filter(models.Loan.user_id == current_user.id).all()
    else:
        if ids:
            id_list = [uuid.UUID(i.strip()) for i in ids.split(",") if i.strip()]
            return query.filter(models.Loan.id.in_(id_list)).all()
        return []

@app.post("/loans", response_model=schemas.LoanResponse, tags=["Loans"])
def create_loan(
    loan: schemas.LoanCreate, 
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    db_loan = models.Loan(**loan.model_dump())
    if current_user:
        db_loan.user_id = current_user.id
    db.add(db_loan)
    db.commit()
    db.refresh(db_loan)
    return db_loan

@app.put("/loans/{loan_id}", response_model=schemas.LoanResponse, tags=["Loans"])
def update_loan(loan_id: uuid.UUID, loan_update: schemas.LoanCreate, db: Session = Depends(get_db)):
    db_loan = db.query(models.Loan).filter(models.Loan.id == loan_id).first()
    if not db_loan:
        raise HTTPException(status_code=404, detail="Кредит не найден")
    
    db_loan.name = loan_update.name
    db_loan.initial_amount = loan_update.initial_amount
    db_loan.interest_rate = loan_update.interest_rate
    db_loan.term_months = loan_update.term_months
    db_loan.start_date = loan_update.start_date
    db_loan.first_payment_date = loan_update.first_payment_date
    db_loan.payment_type = loan_update.payment_type
    
    db.commit()
    db.refresh(db_loan)
    return db_loan

@app.delete("/loans/{loan_id}", tags=["Loans"])
def delete_loan(loan_id: uuid.UUID, db: Session = Depends(get_db)):
    db_loan = db.query(models.Loan).filter(models.Loan.id == loan_id).first()
    if not db_loan:
        raise HTTPException(status_code=404, detail="Кредит не найден")
    
    db.query(models.ExtraPayment).filter(models.ExtraPayment.loan_id == loan_id).delete()
    db.query(models.PaidMonth).filter(models.PaidMonth.loan_id == loan_id).delete()
    db.delete(db_loan)
    db.commit()
    return {"status": "success"}

@app.post("/loans/{loan_id}/extra-payments", response_model=schemas.ExtraPaymentResponse, tags=["Extra Payments"])
def add_extra_payment(loan_id: uuid.UUID, extra_payment: schemas.ExtraPaymentCreate, db: Session = Depends(get_db)):
    db_loan = db.query(models.Loan).filter(models.Loan.id == loan_id).first()
    if not db_loan:
        raise HTTPException(status_code=404, detail="Кредит не найден")
    
    db_extra = models.ExtraPayment(**extra_payment.model_dump(), loan_id=loan_id)
    db.add(db_extra)
    db.commit()
    db.refresh(db_extra)
    return db_extra

@app.get("/loans/{loan_id}/extra-payments", response_model=List[schemas.ExtraPaymentResponse], tags=["Extra Payments"])
def get_extra_payments(loan_id: uuid.UUID, db: Session = Depends(get_db)):
    return db.query(models.ExtraPayment).filter(models.ExtraPayment.loan_id == loan_id).all()

@app.delete("/extra-payments/{payment_id}", tags=["Extra Payments"])
def delete_extra_payment(payment_id: uuid.UUID, db: Session = Depends(get_db)):
    db_extra = db.query(models.ExtraPayment).filter(models.ExtraPayment.id == payment_id).first()
    if db_extra:
        db.delete(db_extra)
        db.commit()
    return {"status": "success"}

@app.post("/loans/{loan_id}/paid-months/{payment_number}", tags=["Tracking"])
def mark_month_as_paid(loan_id: uuid.UUID, payment_number: int, db: Session = Depends(get_db)):
    existing = db.query(models.PaidMonth).filter_by(loan_id=loan_id, payment_number=payment_number).first()
    if not existing:
        new_paid = models.PaidMonth(loan_id=loan_id, payment_number=payment_number)
        db.add(new_paid)
        db.commit()
    return {"status": "ok"}

@app.delete("/loans/{loan_id}/paid-months/{payment_number}", tags=["Tracking"])
def unmark_month_as_paid(loan_id: uuid.UUID, payment_number: int, db: Session = Depends(get_db)):
    existing = db.query(models.PaidMonth).filter_by(loan_id=loan_id, payment_number=payment_number).first()
    if existing:
        db.delete(existing)
        db.commit()
    return {"status": "ok"}

@app.get("/loans/{loan_id}/schedule", response_model=schemas.ScheduleResponse, tags=["Analytics"])
def get_loan_schedule(loan_id: uuid.UUID, db: Session = Depends(get_db)):
    db_loan = db.query(models.Loan).filter(models.Loan.id == loan_id).first()
    if not db_loan:
        raise HTTPException(status_code=404, detail="Кредит не найден")

    extra_payments = db.query(models.ExtraPayment).filter(models.ExtraPayment.loan_id == loan_id).all()
    ep_list = [
        {
            "payment_date": ep.payment_date,
            "amount": str(ep.amount), 
            "strategy": ep.strategy.value if hasattr(ep.strategy, 'value') else ep.strategy,
            "is_recurring": ep.is_recurring
        }
        for ep in extra_payments
    ]

    ptype = db_loan.payment_type.value if hasattr(db_loan.payment_type, 'value') else db_loan.payment_type

    schedule = calculate_schedule(
        initial_amount=str(db_loan.initial_amount),
        annual_rate=str(db_loan.interest_rate),
        term_months=db_loan.term_months,
        first_payment_date=db_loan.first_payment_date,
        payment_type=ptype,
        extra_payments=ep_list
    )

    base_schedule = calculate_schedule(
        initial_amount=str(db_loan.initial_amount),
        annual_rate=str(db_loan.interest_rate),
        term_months=db_loan.term_months,
        first_payment_date=db_loan.first_payment_date,
        payment_type=ptype,
        extra_payments=[]
    )

    merged_schedule = []
    max_len = max(len(schedule), len(base_schedule))
    
    for i in range(max_len):
        base_bal = base_schedule[i]["remaining_balance"] if i < len(base_schedule) else 0.0
        
        if i < len(schedule):
            row = schedule[i].copy()
            row["base_remaining_balance"] = base_bal
            merged_schedule.append(row)
        else:
            merged_schedule.append({
                "payment_number": base_schedule[i]["payment_number"],
                "date": base_schedule[i]["date"],
                "total_payment": 0.0,
                "principal_payment": 0.0,
                "interest_payment": 0.0,
                "extra_payment": 0.0,
                "remaining_balance": 0.0,
                "base_remaining_balance": base_bal
            })

    total_interest = sum(row['interest_payment'] for row in schedule)
    base_interest = sum(row['interest_payment'] for row in base_schedule)

    saved_interest = base_interest - total_interest
    saved_months = len(base_schedule) - len(schedule)

    paid_records = db.query(models.PaidMonth).filter(models.PaidMonth.loan_id == loan_id).all()
    paid_payment_numbers = [record.payment_number for record in paid_records]

    return schemas.ScheduleResponse(
        loan_info=db_loan,
        schedule=merged_schedule,
        total_months=len(schedule),
        total_interest=total_interest,
        saved_interest=saved_interest,
        saved_months=saved_months,
        paid_payment_numbers=paid_payment_numbers
    )