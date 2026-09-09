import axios from 'axios';

// Создаем клиент, который будет стучаться на наш локальный сервер FastAPI
export const apiClient = axios.create({
  baseURL: 'http://localhost:8000',
  headers: {
    'Content-Type': 'application/json',
  },
});