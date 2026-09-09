from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Строка подключения к локальному Postgres из Docker
SQLALCHEMY_DATABASE_URL = "postgresql://admin:password@localhost:5432/roadthedream"

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Зависимость для получения сессии базы данных в API
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()