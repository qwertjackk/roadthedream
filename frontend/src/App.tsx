import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend 
} from 'recharts';
import { Calculator, DollarSign, Zap, Trash2, RotateCcw, CheckCircle2, FileText, Plus, User, LogOut, X, Download } from 'lucide-react';

const API_URL = 'http://localhost:8000';

const formatNumber = (num: number) => {
  if (num === 0) return '0';
  if (!num) return '';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
};

const parseNumber = (str: string) => {
  return Number(str.replace(/\D/g, ''));
};

const formatMoney = (amount: number) => {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(amount);
};

const saveLoanInputs = (id: string, price: number, down: number) => {
  localStorage.setItem(`loanInputs_${id}`, JSON.stringify({ price, down }));
};
const getLoanInputs = (id: string) => {
  const data = localStorage.getItem(`loanInputs_${id}`);
  return data ? JSON.parse(data) : null;
};

export default function App() {
  const defaultForm = {
    name: 'Новая Ипотека',
    property_price: 6000000,
    down_payment: 1000000,
    interest_rate: 12.0,
    term_years: 20,
    start_date: new Date().toISOString().split('T')[0],
    first_payment_date: new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString().split('T')[0],
    payment_type: 'ANNUITY'
  };

  const [authToken, setAuthToken] = useState<string | null>(localStorage.getItem('authToken'));
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [authForm, setAuthForm] = useState({ username: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [guestLoanIds, setGuestLoanIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('guestLoanIds');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    if (authToken) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
      localStorage.setItem('authToken', authToken);
    } else {
      delete axios.defaults.headers.common['Authorization'];
      localStorage.removeItem('authToken');
    }
  }, [authToken]);

  const [formData, setFormData] = useState(() => {
    const saved = localStorage.getItem('mortgageFormData');
    return saved ? JSON.parse(saved) : defaultForm;
  });

  const [currentLoanId, setCurrentLoanId] = useState<string | null>(() => {
    return localStorage.getItem('currentLoanId') || null;
  });

  const [loansList, setLoansList] = useState<any[]>([]);
  const [scheduleData, setScheduleData] = useState<any>(null);
  const [activeExtraPayments, setActiveExtraPayments] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(false);
  const [extraLoading, setExtraLoading] = useState(false);
  
  const [extraPayment, setExtraPayment] = useState({
    amount: 10000,
    payment_date: formData.first_payment_date,
    strategy: 'REDUCE_TERM',
    is_recurring: false
  });

  const currentFormLoanAmount = formData.property_price - formData.down_payment;
  const activeLoanAmount = scheduleData ? Number(scheduleData.loan_info.initial_amount) : currentFormLoanAmount;

  useEffect(() => {
    localStorage.setItem('mortgageFormData', JSON.stringify(formData));
  }, [formData]);

  useEffect(() => {
    if (currentLoanId) {
      localStorage.setItem('currentLoanId', currentLoanId);
    } else {
      localStorage.removeItem('currentLoanId');
    }
  }, [currentLoanId]);

  useEffect(() => {
    fetchAllLoans();
  }, [authToken]); 

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      if (isLoginMode) {
        const params = new URLSearchParams();
        params.append('username', authForm.username);
        params.append('password', authForm.password);
        
        const res = await axios.post(`${API_URL}/login`, params);
        setAuthToken(res.data.access_token);
        setIsAuthModalOpen(false);
      } else {
        await axios.post(`${API_URL}/register`, authForm);
        const params = new URLSearchParams();
        params.append('username', authForm.username);
        params.append('password', authForm.password);
        const res = await axios.post(`${API_URL}/login`, params);
        setAuthToken(res.data.access_token);
        setIsAuthModalOpen(false);
      }
    } catch (error: any) {
      setAuthError(error.response?.data?.detail || 'Ошибка авторизации');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setAuthToken(null);
    setCurrentLoanId(null);
    setScheduleData(null);
    setLoansList([]);
    setFormData(defaultForm);
  };

  const fetchAllLoans = async (selectId?: string, forceFallback?: boolean) => {
    try {
      let url = `${API_URL}/loans`;
      
      if (!authToken) {
        if (guestLoanIds.length > 0) {
          url += `?ids=${guestLoanIds.join(',')}`;
        } else {
          setLoansList([]);
          handleNewLoanClick();
          return;
        }
      }

      const res = await axios.get(url);
      setLoansList(res.data);
      
      if (forceFallback) {
        if (res.data.length > 0) {
          handleSelectLoan(res.data[0]);
        } else {
          handleNewLoanClick();
        }
        return;
      }

      const targetId = selectId || currentLoanId;
      if (targetId && res.data.some((l: any) => l.id === targetId)) {
        loadLoanData(targetId);
      } else if (res.data.length > 0) {
        handleSelectLoan(res.data[0]);
      } else {
        handleNewLoanClick();
      }
    } catch (error) {
      console.error("Ошибка при загрузке списка кредитов", error);
    }
  };

  const loadLoanData = async (loanId: string) => {
    try {
      setCurrentLoanId(loanId);
      const scheduleRes = await axios.get(`${API_URL}/loans/${loanId}/schedule`);
      setScheduleData(scheduleRes.data);
      
      const extraRes = await axios.get(`${API_URL}/loans/${loanId}/extra-payments`);
      setActiveExtraPayments(extraRes.data);

      const loanInfo = scheduleRes.data.loan_info;
      
      const savedInputs = getLoanInputs(loanId);
      let priceToSet = Number(loanInfo.initial_amount);
      let downToSet = 0;

      if (savedInputs && (savedInputs.price - savedInputs.down === Number(loanInfo.initial_amount))) {
        priceToSet = savedInputs.price;
        downToSet = savedInputs.down;
      }

      setFormData({
        name: loanInfo.name,
        property_price: priceToSet,
        down_payment: downToSet,
        interest_rate: Number(loanInfo.interest_rate),
        term_years: loanInfo.term_months / 12,
        start_date: loanInfo.start_date,
        first_payment_date: loanInfo.first_payment_date,
        payment_type: loanInfo.payment_type
      });

    } catch (error) {
      console.error("Не удалось загрузить данные", error);
      handleNewLoanClick();
    }
  };

  const handleSelectLoan = (loan: any) => {
    loadLoanData(loan.id);
  };

  const handleNewLoanClick = () => {
    setCurrentLoanId(null);
    setScheduleData(null);
    setFormData(defaultForm);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentFormLoanAmount <= 0) {
      alert("Сумма кредита должна быть больше нуля!");
      return;
    }
    
    setLoading(true);
    try {
      const payload = {
        name: formData.name || 'Новая ипотека',
        initial_amount: currentFormLoanAmount,
        interest_rate: formData.interest_rate,
        term_months: formData.term_years * 12,
        start_date: formData.start_date,
        first_payment_date: formData.first_payment_date,
        payment_type: formData.payment_type
      };

      if (currentLoanId) {
        await axios.put(`${API_URL}/loans/${currentLoanId}`, payload);
        saveLoanInputs(currentLoanId, formData.property_price, formData.down_payment);
        await fetchAllLoans(currentLoanId);
      } else {
        const loanRes = await axios.post(`${API_URL}/loans`, payload);
        const newLoanId = loanRes.data.id;
        
        if (!authToken) {
          const updatedGuestIds = [...guestLoanIds, newLoanId];
          setGuestLoanIds(updatedGuestIds);
          localStorage.setItem('guestLoanIds', JSON.stringify(updatedGuestIds));
        }

        saveLoanInputs(newLoanId, formData.property_price, formData.down_payment);
        await fetchAllLoans(newLoanId);
      }
    } catch (error) {
      alert("Ошибка при расчете. Проверьте консоль.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLoan = async () => {
    if (!currentLoanId) return;
    if (!window.confirm(`Вы уверены, что хотите удалить кредит "${formData.name}"? Это действие необратимо.`)) return;

    try {
      await axios.delete(`${API_URL}/loans/${currentLoanId}`);
      localStorage.removeItem(`loanInputs_${currentLoanId}`);
      
      if (!authToken) {
        const updatedGuestIds = guestLoanIds.filter(id => id !== currentLoanId);
        setGuestLoanIds(updatedGuestIds);
        localStorage.setItem('guestLoanIds', JSON.stringify(updatedGuestIds));
      }
      await fetchAllLoans(undefined, true);
    } catch (error) {
      console.error("Ошибка при удалении", error);
      alert("Ошибка при удалении кредита");
    }
  };

  const handleAddExtraPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentLoanId) return;
    setExtraLoading(true);
    try {
      await axios.post(`${API_URL}/loans/${currentLoanId}/extra-payments`, extraPayment);
      await loadLoanData(currentLoanId);
    } catch (error) {
      alert("Ошибка при добавлении досрочного платежа");
    } finally {
      setExtraLoading(false);
    }
  };

  const handleDeleteExtraPayment = async (paymentId: string) => {
    try {
      await axios.delete(`${API_URL}/extra-payments/${paymentId}`);
      await loadLoanData(currentLoanId!);
    } catch (error) {
      alert("Ошибка при удалении платежа");
    }
  };

  const handleTogglePaidMonth = async (loanId: string, paymentNumber: number, isPaid: boolean) => {
    if (!loanId) return;
    try {
      if (isPaid) {
        await axios.delete(`${API_URL}/loans/${loanId}/paid-months/${paymentNumber}`);
      } else {
        await axios.post(`${API_URL}/loans/${loanId}/paid-months/${paymentNumber}`);
      }
      await loadLoanData(loanId);
    } catch (error) {
      console.error("Ошибка при обновлении статуса", error);
    }
  };

  const handlePriceChange = (valStr: string) => {
    let val = parseNumber(valStr);
    if (val > 100000000) val = 100000000;
    
    let dp = formData.down_payment;
    if (dp > val) dp = val; 
    
    setFormData({...formData, property_price: val, down_payment: dp});
  };

  const handleDownPaymentChange = (valStr: string) => {
    let val = parseNumber(valStr);
    if (val > formData.property_price) val = formData.property_price;
    setFormData({...formData, down_payment: val});
  };

  const handleRateChange = (valStr: string) => {
    let val = Number(valStr);
    if (val > 30) val = 30;
    setFormData({...formData, interest_rate: val});
  };

  const handleTermChange = (valStr: string) => {
    let val = Number(valStr);
    if (val > 30) val = 30;
    setFormData({...formData, term_years: val});
  };

  const exportToExcel = () => {
    if (!scheduleData) return;

    const wsData = scheduleData.schedule.map((row: any) => ({
      '№ Месяца': row.payment_number,
      'Дата': new Date(row.date).toLocaleDateString('ru-RU'),
      'Общий платеж (₽)': row.total_payment,
      'Тело долга (₽)': row.principal_payment,
      'Проценты (₽)': row.interest_payment,
      'Досрочно (₽)': row.extra_payment,
      'Остаток долга (₽)': row.remaining_balance
    }));

    const ws = XLSX.utils.json_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "График платежей");

    const colWidths = [
      { wch: 10 }, { wch: 15 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 20 }
    ];
    ws['!cols'] = colWidths;

    XLSX.writeFile(wb, `${formData.name}_График.xlsx`);
  };

  const chartComponent = useMemo(() => {
    if (!scheduleData) return null;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={scheduleData.schedule}>
          <defs>
            <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.5}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient>
            <linearGradient id="colorBase" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#64748b" stopOpacity={0.2}/><stop offset="95%" stopColor="#64748b" stopOpacity={0}/></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
          <XAxis dataKey="payment_number" tick={{fontSize: 12}} stroke="#64748b" />
          <YAxis tick={{fontSize: 12}} stroke="#64748b" tickFormatter={(value) => `${(value / 1000000).toFixed(1)}M`} />
          <Tooltip formatter={(value: any, name: any) => [formatMoney(Number(value)), name === 'remaining_balance' ? 'Текущий долг' : 'Базовый сценарий']} labelFormatter={(label) => `Месяц ${label}`} contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f1f5f9', borderRadius: '0.5rem' }} itemStyle={{ color: '#93c5fd' }} />
          <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px', color: '#94a3b8' }} />
          <Area type="monotone" dataKey="base_remaining_balance" stroke="#64748b" strokeDasharray="5 5" strokeWidth={2} fillOpacity={1} fill="url(#colorBase)" name="Базовый сценарий" />
          <Area type="monotone" dataKey="remaining_balance" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorBalance)" name="Текущий остаток долга" />
        </AreaChart>
      </ResponsiveContainer>
    );
  }, [scheduleData]);

  const tableComponent = useMemo(() => {
    if (!scheduleData) return null;
    return (
      <div className="bg-slate-900 rounded-2xl shadow-lg border border-slate-800 overflow-hidden">
        <div className="flex flex-col sm:flex-row justify-between items-center p-4 border-b border-slate-800 bg-slate-950/50 gap-4">
          <h3 className="text-lg font-semibold text-white">Детальный график</h3>
          <div className="flex space-x-3 w-full sm:w-auto">
            <button 
              onClick={exportToExcel} 
              className="flex-1 sm:flex-none flex items-center justify-center space-x-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors bg-emerald-950/40 hover:bg-emerald-900/60 px-4 py-2 rounded-lg border border-emerald-900/50 shadow-sm"
            >
              <Download size={16} />
              <span>В Excel</span>
            </button>
          </div>
        </div>
        
        <div className="overflow-x-auto h-[500px]">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-950 text-slate-400 sticky top-0 shadow-sm z-10">
              <tr>
                <th className="p-4 font-medium border-b border-slate-800 text-center w-16">✅</th>
                <th className="p-4 font-medium border-b border-slate-800">№ / Дата</th>
                <th className="p-4 font-medium border-b border-slate-800">Платеж</th>
                <th className="p-4 font-medium border-b border-slate-800">Тело долга</th>
                <th className="p-4 font-medium border-b border-slate-800">Проценты</th>
                <th className="p-4 font-medium text-indigo-400 border-b border-slate-800">Досрочно</th>
                <th className="p-4 font-medium border-b border-slate-800">Остаток</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {scheduleData.schedule.filter((row: any) => row.total_payment > 0).map((row: any) => {
                const isPaid = scheduleData.paid_payment_numbers.includes(row.payment_number);
                return (
                  <tr key={row.payment_number} className={`hover:bg-slate-800/50 transition-colors ${isPaid ? 'bg-emerald-950/20 opacity-75' : row.extra_payment > 0 ? 'bg-indigo-900/10' : ''}`}>
                    <td className="p-4 text-center">
                      <button onClick={() => handleTogglePaidMonth(currentLoanId!, row.payment_number, isPaid)} className={`p-1 rounded-lg transition-colors ${isPaid ? 'text-emerald-400 bg-emerald-900/40' : 'text-slate-600 hover:text-slate-400'}`}><CheckCircle2 size={20} /></button>
                    </td>
                    <td className="p-4 text-slate-400">
                      <div className="flex items-center space-x-2"><span>{row.payment_number} мес.</span>{isPaid && <span className="text-[10px] bg-emerald-950 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-800/50">Оплачено</span>}</div>
                      <span className="text-xs text-slate-500">{new Date(row.date).toLocaleDateString('ru-RU')}</span>
                    </td>
                    <td className="p-4 font-medium text-white">{formatMoney(row.total_payment - row.extra_payment)}</td>
                    <td className="p-4 text-emerald-400">{formatMoney(row.principal_payment)}</td>
                    <td className="p-4 text-red-400">{formatMoney(row.interest_payment)}</td>
                    <td className="p-4 text-indigo-400 font-medium">{row.extra_payment > 0 ? `+ ${formatMoney(row.extra_payment)}` : '-'}</td>
                    <td className="p-4 text-slate-300 font-medium">{formatMoney(row.remaining_balance)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }, [scheduleData, currentLoanId, formData.name]);

  return (
    <div className="min-h-screen bg-slate-950 p-4 md:p-8 font-sans text-slate-200">
      
      {isAuthModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl relative">
            <button onClick={() => setIsAuthModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors">
              <X size={20} />
            </button>
            <h3 className="text-2xl font-bold text-white mb-2">{isLoginMode ? 'С возвращением' : 'Регистрация'}</h3>
            <p className="text-slate-400 text-sm mb-6">{isLoginMode ? 'Войдите, чтобы получить доступ к своим кредитам' : 'Создайте аккаунт для облачного сохранения'}</p>

            <form onSubmit={handleAuthSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Имя пользователя</label>
                <input 
                  type="text" 
                  value={authForm.username}
                  onChange={(e) => setAuthForm({...authForm, username: e.target.value})}
                  className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Пароль</label>
                <input 
                  type="password" 
                  value={authForm.password}
                  onChange={(e) => setAuthForm({...authForm, password: e.target.value})}
                  className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-white"
                  required
                />
              </div>
              {authError && <div className="text-red-400 text-sm">{authError}</div>}
              <button type="submit" disabled={authLoading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition-colors mt-2 shadow-lg disabled:bg-blue-800">
                {authLoading ? 'Обработка...' : (isLoginMode ? 'Войти' : 'Зарегистрироваться')}
              </button>
            </form>
            <div className="mt-6 text-center text-sm text-slate-400">
              {isLoginMode ? "Нет аккаунта? " : "Уже есть аккаунт? "}
              <button onClick={() => {setIsLoginMode(!isLoginMode); setAuthError('');}} className="text-blue-400 hover:text-blue-300 font-medium">
                {isLoginMode ? 'Создать' : 'Войти'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto space-y-6">
        
        <header className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-600 p-2 rounded-lg text-white shadow-lg shadow-indigo-900/20">
              <Calculator size={28} />
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">zproject</h1>
          </div>
          <div className="flex items-center space-x-4">
            {scheduleData && scheduleData.saved_interest > 0 && (
              <div className="hidden lg:flex items-center space-x-4 bg-emerald-950/40 border border-emerald-900/50 px-4 py-2 rounded-xl">
                <div className="text-emerald-400 font-bold flex items-center space-x-1">
                  <span>🎉 Сэкономлено: {formatMoney(scheduleData.saved_interest)}</span>
                </div>
                <div className="text-xs text-emerald-300/80 bg-emerald-900/40 px-2 py-1 rounded">
                  Срок сокращен на {scheduleData.saved_months} мес.
                </div>
              </div>
            )}
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1">
              {authToken ? (
                <button onClick={handleLogout} className="flex items-center space-x-2 px-3 py-1.5 text-slate-400 hover:text-white transition-colors text-sm font-medium">
                  <LogOut size={16} />
                  <span className="hidden sm:inline">Выйти</span>
                </button>
              ) : (
                <button onClick={() => setIsAuthModalOpen(true)} className="flex items-center space-x-2 px-3 py-1.5 text-indigo-400 hover:text-indigo-300 transition-colors text-sm font-medium">
                  <User size={16} />
                  <span className="hidden sm:inline">Войти</span>
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="flex space-x-2 overflow-x-auto pb-2 custom-scrollbar">
          {loansList.map(loan => (
            <button
              key={loan.id}
              onClick={() => handleSelectLoan(loan)}
              className={`px-4 py-2 rounded-lg whitespace-nowrap text-sm font-medium transition-all duration-200 ${currentLoanId === loan.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' : 'bg-slate-900 text-slate-400 hover:bg-slate-800 border border-slate-800'}`}
            >
              {loan.name}
            </button>
          ))}
          <button onClick={handleNewLoanClick} className={`flex items-center space-x-1 px-4 py-2 rounded-lg whitespace-nowrap text-sm font-medium transition-all duration-200 border border-dashed ${!currentLoanId && loansList.length > 0 ? 'border-indigo-500 text-indigo-400 bg-indigo-950/30' : 'border-slate-700 text-slate-400 hover:bg-slate-900 hover:text-slate-300'}`}>
            <Plus size={16} />
            <span>Добавить</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          <div className="bg-slate-900 p-6 rounded-2xl shadow-xl border border-slate-800 h-fit sticky top-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-white">Параметры ипотеки</h2>
              {currentLoanId && (
                <button onClick={handleDeleteLoan} className="text-slate-500 hover:text-red-400 hover:bg-red-950/30 p-2 rounded-lg transition-all" title="Удалить кредит">
                  <Trash2 size={18} />
                </button>
              )}
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-6">
              
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Название (цель)</label>
                <div className="relative">
                  <FileText className="absolute left-3 top-2.5 text-slate-500" size={18} />
                  <input 
                    type="text" 
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    placeholder="Например: Квартира на Ленина"
                    className="w-full pl-10 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-white font-medium"
                    required
                  />
                </div>
              </div>

              <div className="relative bg-slate-950 border border-slate-800 rounded-lg p-3 pt-2 focus-within:border-indigo-500 transition-colors pb-4">
                <label className="block text-xs font-medium text-slate-500 mb-1">Стоимость недвижимости (₽)</label>
                <div className="flex justify-between items-center">
                  <input 
                    type="text" 
                    value={formatNumber(formData.property_price)}
                    onChange={(e) => handlePriceChange(e.target.value)}
                    className="w-full bg-transparent outline-none text-white font-bold text-lg"
                  />
                </div>
                <input 
                  type="range" min="100000" max="100000000" step="100000"
                  value={formData.property_price}
                  onChange={(e) => handlePriceChange(e.target.value)}
                  className="absolute bottom-0 left-0 w-full h-1 translate-y-1/2 cursor-pointer appearance-none bg-slate-800 rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-indigo-600 m-0"
                />
              </div>

              <div className="relative bg-slate-950 border border-slate-800 rounded-lg p-3 pt-2 focus-within:border-indigo-500 transition-colors pb-4">
                <label className="block text-xs font-medium text-slate-500 mb-1">Первоначальный взнос (₽)</label>
                <div className="flex justify-between items-center">
                  <input 
                    type="text" 
                    value={formatNumber(formData.down_payment)}
                    onChange={(e) => handleDownPaymentChange(e.target.value)}
                    className="w-2/3 bg-transparent outline-none text-white font-bold text-lg"
                  />
                  <span className="text-indigo-400 font-semibold text-sm">
                    {formData.property_price > 0 ? ((formData.down_payment / formData.property_price) * 100).toFixed(1) : 0} %
                  </span>
                </div>
                <input 
                  type="range" min="0" max={formData.property_price} step="10000"
                  value={formData.down_payment}
                  onChange={(e) => handleDownPaymentChange(e.target.value)}
                  className="absolute bottom-0 left-0 w-full h-1 translate-y-1/2 cursor-pointer appearance-none bg-slate-800 rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-indigo-600 m-0"
                />
              </div>

              <div className="text-sm bg-slate-800/40 p-2.5 rounded-lg border border-slate-700/50 flex justify-between items-center">
                <span className="text-slate-400">Сумма кредита (долг):</span>
                <span className="font-bold text-white text-base">{formatMoney(currentFormLoanAmount)}</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                
                <div className="relative bg-slate-950 border border-slate-800 rounded-lg p-3 pt-2 focus-within:border-indigo-500 transition-colors pb-4">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Ставка (%)</label>
                  <input 
                    type="number" step="0.1"
                    value={formData.interest_rate}
                    onChange={(e) => handleRateChange(e.target.value)}
                    className="w-full bg-transparent outline-none text-white font-bold text-lg [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <input 
                    type="range" min="0.1" max="30" step="0.1"
                    value={formData.interest_rate}
                    onChange={(e) => handleRateChange(e.target.value)}
                    className="absolute bottom-0 left-0 w-full h-1 translate-y-1/2 cursor-pointer appearance-none bg-slate-800 rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-indigo-600 m-0"
                  />
                </div>

                <div className="relative bg-slate-950 border border-slate-800 rounded-lg p-3 pt-2 focus-within:border-indigo-500 transition-colors pb-4">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Срок (лет)</label>
                  <input 
                    type="number" 
                    value={formData.term_years}
                    onChange={(e) => handleTermChange(e.target.value)}
                    className="w-full bg-transparent outline-none text-white font-bold text-lg [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <input 
                    type="range" min="1" max="30" step="1"
                    value={formData.term_years}
                    onChange={(e) => handleTermChange(e.target.value)}
                    className="absolute bottom-0 left-0 w-full h-1 translate-y-1/2 cursor-pointer appearance-none bg-slate-800 rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-indigo-600 m-0"
                  />
                </div>

              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Тип платежа</label>
                <select 
                  value={formData.payment_type}
                  onChange={(e) => setFormData({...formData, payment_type: e.target.value})}
                  className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-white font-medium"
                >
                  <option value="ANNUITY">Аннуитетный</option>
                  <option value="DIFFERENTIATED">Дифференцированный</option>
                </select>
              </div>

              <button 
                type="submit" 
                disabled={loading}
                className={`w-full text-white font-medium py-3 rounded-lg transition-colors mt-2 shadow-lg disabled:opacity-50 ${
                  currentLoanId ? 'bg-slate-700 hover:bg-slate-600 shadow-none border border-slate-600' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-900/20'
                }`}
              >
                {loading ? 'Обработка...' : (currentLoanId ? 'Сохранить изменения' : 'Создать и рассчитать')}
              </button>
            </form>
          </div>

          <div className="lg:col-span-2 space-y-6">
            {scheduleData ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-slate-900 p-5 rounded-2xl shadow-lg border border-slate-800">
                    <div className="text-sm text-slate-400 mb-1">Осталось платить</div>
                    <div className="text-2xl font-bold text-white">
                      {scheduleData.total_months} мес. <span className="text-sm font-normal text-slate-500">({(scheduleData.total_months / 12).toFixed(1)} лет)</span>
                    </div>
                  </div>
                  <div className="bg-slate-900 p-5 rounded-2xl shadow-lg border border-slate-800">
                    <div className="text-sm text-slate-400 mb-1">Переплата (проценты)</div>
                    <div className="text-2xl font-bold text-red-400">
                      {formatMoney(scheduleData.total_interest)}
                    </div>
                  </div>
                  <div className="bg-slate-900 p-5 rounded-2xl shadow-lg border border-slate-800">
                    <div className="text-sm text-slate-400 mb-1">Итого к выплате (без ПВ)</div>
                    <div className="text-2xl font-bold text-white">
                      {formatMoney(activeLoanAmount + scheduleData.total_interest)}
                    </div>
                  </div>
                </div>

                <div className="bg-indigo-950/30 p-5 rounded-2xl border border-indigo-900/50 shadow-lg">
                  <div className="flex items-center space-x-2 mb-4">
                    <Zap className="text-indigo-400" size={20} />
                    <h3 className="font-semibold text-indigo-300">Внести досрочный платеж</h3>
                  </div>
                  
                  <form onSubmit={handleAddExtraPayment} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                      <div>
                        <label className="block text-xs font-medium text-indigo-400/80 mb-1">Дата платежа</label>
                        <input type="date" value={extraPayment.payment_date} onChange={(e) => setExtraPayment({...extraPayment, payment_date: e.target.value})} className="w-full px-3 py-2 bg-slate-950 border border-indigo-900/50 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm text-white"/>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-indigo-400/80 mb-1">Сумма (₽)</label>
                        <div className="relative">
                           <DollarSign className="absolute left-2.5 top-2 text-indigo-500" size={16} />
                           <input type="text" value={formatNumber(extraPayment.amount)} onChange={(e) => setExtraPayment({...extraPayment, amount: parseNumber(e.target.value)})} className="w-full pl-8 pr-3 py-2 bg-slate-950 border border-indigo-900/50 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-medium text-white"/>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-indigo-400/80 mb-1">Стратегия</label>
                        <select value={extraPayment.strategy} onChange={(e) => setExtraPayment({...extraPayment, strategy: e.target.value})} className="w-full px-3 py-2 bg-slate-950 border border-indigo-900/50 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm text-white">
                          <option value="REDUCE_TERM">Уменьшить срок</option>
                          <option value="REDUCE_PAYMENT">Уменьшить платеж</option>
                        </select>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between pt-3 border-t border-indigo-900/30">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input type="checkbox" checked={extraPayment.is_recurring} onChange={(e) => setExtraPayment({...extraPayment, is_recurring: e.target.checked})} className="w-4 h-4 text-indigo-500 bg-slate-950 border-slate-700 rounded focus:ring-indigo-500 focus:ring-offset-slate-900"/>
                        <span className="text-sm font-medium text-indigo-300">Повторять каждый месяц</span>
                      </label>
                      <button type="submit" disabled={extraLoading} className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2 px-6 rounded-lg transition-colors text-sm shadow-lg shadow-indigo-900/20 disabled:bg-indigo-900">
                        {extraLoading ? 'Добавляем...' : 'Добавить'}
                      </button>
                    </div>
                  </form>

                  {activeExtraPayments.length > 0 && (
                    <div className="mt-6 pt-4 border-t border-indigo-900/30">
                      <h4 className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-3">Запланированные платежи</h4>
                      <div className="space-y-2">
                        {activeExtraPayments.map((ep: any) => (
                          <div key={ep.id} className="flex items-center justify-between bg-slate-950 border border-indigo-900/30 rounded-lg p-3 group">
                            <div className="flex items-center space-x-4">
                              <div className="text-sm text-slate-300 font-medium w-24">{new Date(ep.payment_date).toLocaleDateString('ru-RU')}</div>
                              <div className="text-sm font-bold text-emerald-400">{formatMoney(Number(ep.amount))}</div>
                              <div className="hidden sm:flex text-xs text-indigo-300/70 items-center space-x-2">
                                <span>{ep.strategy === 'REDUCE_TERM' ? 'Срок' : 'Платеж'}</span>
                                {ep.is_recurring && <RotateCcw size={12} className="text-indigo-400 ml-2" />}
                              </div>
                            </div>
                            <button onClick={() => handleDeleteExtraPayment(ep.id)} className="text-slate-500 hover:text-red-400 transition-colors p-1"><Trash2 size={16} /></button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-slate-900 p-6 rounded-2xl shadow-lg border border-slate-800 h-80">
                  <h3 className="text-lg font-semibold mb-4 text-white">График убывания долга</h3>
                  {chartComponent}
                </div>

                {tableComponent}
                
              </>
            ) : (
              <div className="h-full flex items-center justify-center border-2 border-dashed border-slate-800 rounded-2xl text-slate-500 p-10 text-center">
                Введите параметры кредита слева и нажмите «Создать и рассчитать», <br/> чтобы увидеть детальную аналитику.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}