from decimal import Decimal, ROUND_HALF_EVEN
from datetime import date
from dateutil.relativedelta import relativedelta
import calendar
from typing import List, Dict, Optional

def q(amount: Decimal) -> Decimal:
    return amount.quantize(Decimal('0.01'), rounding=ROUND_HALF_EVEN)

def get_annuity_payment(balance: Decimal, annual_rate: Decimal, months_left: int) -> Decimal:
    if annual_rate == 0:
        return q(balance / Decimal(months_left))
    
    monthly_rate = annual_rate / Decimal(100) / Decimal(12)
    payment = balance * (monthly_rate * (1 + monthly_rate)**months_left) / ((1 + monthly_rate)**months_left - 1)
    return q(payment)

def calculate_schedule(
    initial_amount: str,
    annual_rate: str,
    term_months: int,
    first_payment_date: date,
    payment_type: str,
    extra_payments: Optional[List[Dict]] = None # <--- Теперь это список (List)
) -> List[Dict]:
    
    balance = Decimal(initial_amount)
    rate = Decimal(annual_rate)
    extra_payments = extra_payments or []
    schedule = []
    
    current_date = first_payment_date
    prev_date = current_date - relativedelta(months=1)
    months_left = term_months
    
    monthly_payment = get_annuity_payment(balance, rate, months_left)
    fixed_principal_payment = q(balance / Decimal(term_months)) if payment_type == "DIFFERENTIATED" else Decimal(0)
    
    payment_number = 1

    while balance > 0 and months_left > 0:
        days_in_period = (current_date - prev_date).days
        days_in_year = 366 if calendar.isleap(current_date.year) else 365
        
        interest_payment = q(balance * (rate / Decimal(100)) * Decimal(days_in_period) / Decimal(days_in_year))
        
        if payment_type == "ANNUITY":
            principal_payment = monthly_payment - interest_payment
            if principal_payment < 0:
                principal_payment = Decimal(0)
        else:
            principal_payment = fixed_principal_payment
            monthly_payment = principal_payment + interest_payment

        if principal_payment >= balance:
            principal_payment = balance
            monthly_payment = principal_payment + interest_payment

        balance -= principal_payment
        
        # --- НОВАЯ ЛОГИКА ДОСРОЧЕК ---
        extra_amount = Decimal('0.00')
        applied_strategy = None
        
        for ep in extra_payments:
            # 1. Если платеж регулярный, он применяется каждый месяц после стартовой даты
            if ep.get('is_recurring'):
                if current_date >= ep['payment_date']:
                    extra_amount += Decimal(ep['amount'])
                    applied_strategy = ep['strategy']
            # 2. Если платеж разовый, он применяется только в точную дату
            else:
                if current_date == ep['payment_date']:
                    extra_amount += Decimal(ep['amount'])
                    applied_strategy = ep['strategy']
        
        if extra_amount > 0 and balance > 0:
            if extra_amount > balance:
                extra_amount = balance
                
            balance -= extra_amount
            
            if applied_strategy == "REDUCE_PAYMENT":
                if payment_type == "ANNUITY" and months_left - 1 > 0:
                    monthly_payment = get_annuity_payment(balance, rate, months_left - 1)
                elif payment_type == "DIFFERENTIATED" and months_left - 1 > 0:
                    fixed_principal_payment = q(balance / Decimal(months_left - 1))
        # -----------------------------

        schedule.append({
            "payment_number": payment_number,
            "date": current_date.isoformat(),
            "total_payment": float(principal_payment + interest_payment + extra_amount),
            "principal_payment": float(principal_payment),
            "interest_payment": float(interest_payment),
            "extra_payment": float(extra_amount),
            "remaining_balance": float(balance)
        })
        
        prev_date = current_date
        current_date += relativedelta(months=1)
        months_left -= 1
        payment_number += 1

    return schedule