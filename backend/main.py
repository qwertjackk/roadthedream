from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
import uuid

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

@app.post("/loans", response_model=schemas.LoanResponse, tags=["Loans"])
def create_loan(loan: schemas.LoanCreate, db: Session = Depends(get_db)):
    db_loan = models.Loan(**loan.model_dump())
    db.add(db_loan)
    db.commit()
    db.refresh(db_loan)
    return db_loan

@app.put("/loans/{loan_id}", response_model=schemas.LoanResponse, tags=["Loans"])
def update_loan(loan_id: uuid.UUID, loan_update: schemas.LoanCreate, db: Session = Depends(get_db)):
    """Обновить параметры существующего кредита (перерасчет)"""
    db_loan = db.query(models.Loan).filter(models.Loan.id == loan_id).first()
    if not db_loan:
        raise HTTPException(status_code=404, detail="Кредит не найден")
    
    # Обновляем все поля
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

@app.get("/loans", response_model=List[schemas.LoanResponse], tags=["Loans"])
def get_all_loans(db: Session = Depends(get_db)):
    """Получить список всех кредитов"""
    return db.query(models.Loan).all()

@app.delete("/loans/{loan_id}", tags=["Loans"])
def delete_loan(loan_id: uuid.UUID, db: Session = Depends(get_db)):
    """Удалить кредит и все его данные"""
    db_loan = db.query(models.Loan).filter(models.Loan.id == loan_id).first()
    if not db_loan:
        raise HTTPException(status_code=404, detail="Кредит не найден")
    
    # Сначала удаляем все связанные с кредитом платежи и галочки (чтобы не было конфликта в базе)
    db.query(models.ExtraPayment).filter(models.ExtraPayment.loan_id == loan_id).delete()
    db.query(models.PaidMonth).filter(models.PaidMonth.loan_id == loan_id).delete()
    
    # Теперь удаляем сам кредит
    db.delete(db_loan)
    db.commit()
    return {"status": "success", "message": "Кредит удален"}

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

    # 1. Фактический график
    schedule = calculate_schedule(
        initial_amount=str(db_loan.initial_amount),
        annual_rate=str(db_loan.interest_rate),
        term_months=db_loan.term_months,
        first_payment_date=db_loan.first_payment_date,
        payment_type=ptype,
        extra_payments=ep_list
    )

    # 2. Базовый график
    base_schedule = calculate_schedule(
        initial_amount=str(db_loan.initial_amount),
        annual_rate=str(db_loan.interest_rate),
        term_months=db_loan.term_months,
        first_payment_date=db_loan.first_payment_date,
        payment_type=ptype,
        extra_payments=[]
    )

    # 3. Склеиваем их вместе, чтобы график на фронтенде рисовался до конца базового срока
    merged_schedule = []
    max_len = max(len(schedule), len(base_schedule))
    
    for i in range(max_len):
        base_bal = base_schedule[i]["remaining_balance"] if i < len(base_schedule) else 0.0
        
        if i < len(schedule):
            row = schedule[i].copy()
            row["base_remaining_balance"] = base_bal
            merged_schedule.append(row)
        else:
            # Заполняем нулями месяцы, когда мы уже всё погасили, а базовый график еще тянется
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
        schedule=merged_schedule,      # Отдаем склеенный массив
        total_months=len(schedule),    # А реальный срок отдаем по фактическому графику
        total_interest=total_interest,
        saved_interest=saved_interest,
        saved_months=saved_months,
        paid_payment_numbers=paid_payment_numbers
    )

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

@app.get("/loans/{loan_id}/extra-payments", response_model=List[schemas.ExtraPaymentResponse], tags=["Extra Payments"])
def get_extra_payments(loan_id: uuid.UUID, db: Session = Depends(get_db)):
    """Получить список всех добавленных досрочных платежей по кредиту"""
    return db.query(models.ExtraPayment).filter(models.ExtraPayment.loan_id == loan_id).all()

@app.delete("/extra-payments/{payment_id}", tags=["Extra Payments"])
def delete_extra_payment(payment_id: uuid.UUID, db: Session = Depends(get_db)):
    """Удалить досрочный платеж (откатить)"""
    db_extra = db.query(models.ExtraPayment).filter(models.ExtraPayment.id == payment_id).first()
    if db_extra:
        db.delete(db_extra)
        db.commit()
    return {"status": "success", "message": "Платеж удален"}