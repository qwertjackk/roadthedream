from database import engine, Base
import models  # Импортируем модели, чтобы SQLAlchemy знал о них

print("Удаляем старые таблицы...")
Base.metadata.drop_all(bind=engine)

print("Создаем таблицы заново с новыми колонками...")
Base.metadata.create_all(bind=engine)

print("Готово! База данных обновлена.")