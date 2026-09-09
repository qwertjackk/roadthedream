from calculator import calculate_schedule, PaymentType, StrategyType
from datetime import date

print("=== ТЕСТ: Ипотека 5 млн руб, 12%, на 20 лет (240 мес) ===")

schedule = calculate_schedule(
    initial_amount="5000000.00",
    annual_rate="12.0",
    term_months=240,
    first_payment_date=date(2024, 2, 15),
    payment_type=PaymentType.ANNUITY,
    extra_payments={
        # Делаем досрочку 100 000 рублей во второй месяц с уменьшением срока!
        date(2024, 3, 15): {"amount": "100000.00", "strategy": StrategyType.REDUCE_TERM}
    }
)

# Выводим первые 3 месяца
for row in schedule[:3]:
    print(f"Месяц {row['payment_number']} | Дата: {row['date']} | "
          f"Платеж: {row['total_payment']} (Тело: {row['principal_payment']}, Проценты: {row['interest_payment']}) | "
          f"Досрочно: {row['extra_payment']} | Остаток: {row['remaining_balance']}")

# Выводим общую переплату и реальное количество месяцев
total_interest = sum(row['interest_payment'] for row in schedule)
print(f"\nВсего месяцев платить: {len(schedule)} (было 240)")
print(f"Общая переплата по процентам: {total_interest:.2f} руб.")