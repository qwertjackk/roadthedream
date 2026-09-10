import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend 
} from 'recharts';
import { Calculator, Zap, Trash2, RotateCcw, CheckCircle2, FileText, Plus, User, LogOut, X, Download, Shield, ChevronDown, Pencil } from 'lucide-react';

const API_URL = 'http://localhost:8000';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const currentYear = new Date().getFullYear();
const YEARS = Array.from({length: 31}, (_, i) => currentYear + i);

const formatNumber = (num: number) => {
  if (num === 0) return '0';
  if (!num) return '';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
};

const parseNumber = (str: string) => Number(str.replace(/\D/g, ''));

const formatMoney = (amount: number) => {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(amount);
};

// Обновленная функция сохранения: теперь хранит целый объект
const saveLoanInputs = (id: string, data: any) => {
  localStorage.setItem(`loanInputs_${id}`, JSON.stringify(data));
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
  const [isEpModalOpen, setIsEpModalOpen] = useState(false);
  const [isInsModalOpen, setIsInsModalOpen] = useState(false);
  
  const [editingEpGroupIds, setEditingEpGroupIds] = useState<string[] | null>(null);
  const [editingInsGroupId, setEditingInsGroupId] = useState<string | null>(null);
  
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

  const [currentLoanId, setCurrentLoanId] = useState<string | null>(() => localStorage.getItem('currentLoanId') || null);
  const [loansList, setLoansList] = useState<any[]>([]);
  const [scheduleData, setScheduleData] = useState<any>(null);
  const [activeExtraPayments, setActiveExtraPayments] = useState<any[]>([]);
  
  // Хранилище независимых страховок
  const [activeInsurances, setActiveInsurances] = useState<any[]>(() => {
    const saved = localStorage.getItem('mortgageInsurancesData');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [loading, setLoading] = useState(false);
  const [extraLoading, setExtraLoading] = useState(false);
  
  const [epForm, setEpForm] = useState({ amount: 10000, frequency: 'ONCE', strategy: 'REDUCE_TERM', startYear: currentYear, startMonth: MONTHS[new Date().getMonth()] });
  const [insForm, setInsForm] = useState({ amount: 15000, frequency: 'YEARLY', startYear: currentYear, startMonth: MONTHS[new Date().getMonth()] });

  const currentFormLoanAmount = formData.property_price - formData.down_payment;
  const activeLoanAmount = scheduleData ? Number(scheduleData.loan_info.initial_amount) : currentFormLoanAmount;

  // ОПТИМИЗАЦИЯ: Быстрый поиск страховки для месяца
  const insuranceMap = useMemo(() => {
    const map: Record<string, number> = {};
    activeInsurances.forEach(ins => {
      const d = new Date(ins.payment_date);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      map[key] = (map[key] || 0) + ins.amount;
    });
    return map;
  }, [activeInsurances]);

  const getInsuranceForMonth = (dateStr: string) => {
    const d = new Date(dateStr);
    return insuranceMap[`${d.getFullYear()}-${d.getMonth()}`] || 0;
  };

  let totalInsurance = 0;
  if (scheduleData) {
    scheduleData.schedule.forEach((row: any) => {
      if (row.total_payment > 0) totalInsurance += getInsuranceForMonth(row.date);
    });
  }

  // УМНАЯ ГРУППИРОВКА ДОСРОЧНЫХ ПЛАТЕЖЕЙ + РАСЧЕТ ЭКОНОМИИ
  const groupedPayments = useMemo(() => {
    const groups: any[] = [];
    const usedIds = new Set();
    const sorted = [...activeExtraPayments].sort((a, b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime());
    
    // Предварительный расчет весов для вычисления экономии
    const groupsRaw: any[] = [];
    let totalWeight = 0;

    sorted.forEach(ep => {
      if (usedIds.has(ep.id)) return;
      let ids = [ep.id];
      let freqStr = 'Разово';
      let freqValue = 'ONCE';

      if (ep.is_recurring) {
        freqStr = 'Ежемесячно'; freqValue = 'MONTHLY'; usedIds.add(ep.id);
      } else {
        const candidates = sorted.filter(c => !usedIds.has(c.id) && c.amount === ep.amount && c.strategy === ep.strategy);
        if (candidates.length <= 1) usedIds.add(ep.id);
        else {
          const d1 = new Date(candidates[0].payment_date), d2 = new Date(candidates[1].payment_date);
          const monthsDiff = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
          freqStr = 'Каскад платежей';
          if (monthsDiff === 3) { freqStr = 'Раз в 3 месяца'; freqValue = 'QUARTERLY'; }
          else if (monthsDiff === 6) { freqStr = 'Раз в полгода'; freqValue = 'HALFYEARLY'; }
          else if (monthsDiff === 12) { freqStr = 'Раз в год'; freqValue = 'YEARLY'; }
          else if (monthsDiff === 1) { freqStr = 'Ежемесячно'; freqValue = 'MONTHLY'; }
          ids = candidates.map(c => c.id);
          ids.forEach(id => usedIds.add(id));
        }
      }

      // Математика вклада платежа
      let weight = 0;
      if (ep.is_recurring && scheduleData) {
        const d = new Date(ep.payment_date), start = new Date(formData.start_date);
        const elapsed = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
        weight = ep.amount * Math.max(1, scheduleData.total_months - elapsed);
      } else {
        weight = ep.amount * ids.length;
      }
      totalWeight += weight;

      groupsRaw.push({ ...ep, displayFreq: freqStr, internalFreq: freqValue, ids, weight });
    });

    groupsRaw.forEach(g => {
      const share = totalWeight > 0 ? (g.weight / totalWeight) : 0;
      const savedInterest = scheduleData ? share * scheduleData.saved_interest : 0;
      const savedMonths = scheduleData ? Math.round(share * scheduleData.saved_months) : 0;
      groups.push({ ...g, savedInterest, savedMonths });
    });

    return groups;
  }, [activeExtraPayments, scheduleData, formData.start_date]);

  // ГРУППИРОВКА СТРАХОВОК
  const groupedInsurances = useMemo(() => {
    const groups: any[] = [];
    const groupedByGroupId = activeInsurances.reduce((acc, ins) => {
      if (!acc[ins.groupId]) acc[ins.groupId] = [];
      acc[ins.groupId].push(ins);
      return acc;
    }, {});
    
    for (const [gId, items] of Object.entries(groupedByGroupId)) {
      const sorted = (items as any[]).sort((a,b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime());
      groups.push({
         groupId: gId, amount: sorted[0].amount,
         displayFreq: sorted.length > 1 ? 'Раз в год' : 'Разово',
         internalFreq: sorted.length > 1 ? 'YEARLY' : 'ONCE',
         payment_date: sorted[0].payment_date,
      });
    }
    return groups.sort((a,b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime());
  }, [activeInsurances]);

  useEffect(() => { localStorage.setItem('mortgageFormData', JSON.stringify(formData)); }, [formData]);
  useEffect(() => { localStorage.setItem('mortgageInsurancesData', JSON.stringify(activeInsurances)); }, [activeInsurances]);
  useEffect(() => {
    if (currentLoanId) localStorage.setItem('currentLoanId', currentLoanId);
    else localStorage.removeItem('currentLoanId');
  }, [currentLoanId]);
  useEffect(() => { fetchAllLoans(); }, [authToken]); 

  const openEpModal = (group: any = null) => {
    if (group) {
      const d = new Date(group.payment_date);
      setEpForm({ amount: Number(group.amount), frequency: group.internalFreq, strategy: group.strategy, startYear: d.getFullYear(), startMonth: MONTHS[d.getMonth()] });
      setEditingEpGroupIds(group.ids);
    } else {
      setEpForm({ amount: 10000, frequency: 'ONCE', strategy: 'REDUCE_TERM', startYear: currentYear, startMonth: MONTHS[new Date().getMonth()] });
      setEditingEpGroupIds(null);
    }
    setIsEpModalOpen(true);
  };

  const openInsModal = (group: any = null) => {
    if (group) {
      const d = new Date(group.payment_date);
      setInsForm({ amount: Number(group.amount), frequency: group.internalFreq, startYear: d.getFullYear(), startMonth: MONTHS[d.getMonth()] });
      setEditingInsGroupId(group.groupId);
    } else {
      setInsForm({ amount: 15000, frequency: 'YEARLY', startYear: currentYear, startMonth: MONTHS[new Date().getMonth()] });
      setEditingInsGroupId(null);
    }
    setIsInsModalOpen(true);
  };

  const handleSaveInsurance = (e: React.FormEvent) => {
    e.preventDefault();
    const payDay = new Date(formData.first_payment_date).getDate();
    const startMonthIndex = MONTHS.indexOf(insForm.startMonth);
    let currentPayDate = new Date(Number(insForm.startYear), startMonthIndex, payDay);
    
    const end = new Date(formData.start_date); 
    end.setFullYear(end.getFullYear() + formData.term_years);
    
    const newInsurances = [];
    const groupId = editingInsGroupId || Date.now().toString();
    
    if (insForm.frequency === 'ONCE') {
       newInsurances.push({ id: Date.now().toString() + Math.random(), groupId, amount: insForm.amount, payment_date: currentPayDate.toISOString().split('T')[0] });
    } else {
       while(currentPayDate <= end) {
         newInsurances.push({ id: Date.now().toString() + Math.random(), groupId, amount: insForm.amount, payment_date: currentPayDate.toISOString().split('T')[0] });
         currentPayDate.setFullYear(currentPayDate.getFullYear() + 1);
       }
    }
    
    const filtered = activeInsurances.filter(ins => ins.groupId !== editingInsGroupId);
    const updated = [...filtered, ...newInsurances];
    
    setActiveInsurances(updated);
    if (currentLoanId) saveLoanInputs(currentLoanId, { price: formData.property_price, down: formData.down_payment, insurances: updated });
    setIsInsModalOpen(false);
  };

  const handleDeleteInsuranceGroup = (groupId: string) => {
    const updated = activeInsurances.filter(ins => ins.groupId !== groupId);
    setActiveInsurances(updated);
    if (currentLoanId) saveLoanInputs(currentLoanId, { price: formData.property_price, down: formData.down_payment, insurances: updated });
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setAuthError(''); setAuthLoading(true);
    try {
      if (!isLoginMode) await axios.post(`${API_URL}/register`, authForm);
      const params = new URLSearchParams(); params.append('username', authForm.username); params.append('password', authForm.password);
      const res = await axios.post(`${API_URL}/login`, params);
      setAuthToken(res.data.access_token); setIsAuthModalOpen(false);
    } catch (error: any) { setAuthError(error.response?.data?.detail || 'Ошибка авторизации'); } 
    finally { setAuthLoading(false); }
  };

  const handleLogout = () => {
    setAuthToken(null); setCurrentLoanId(null); setScheduleData(null); setLoansList([]); setFormData(defaultForm); setActiveInsurances([]);
  };

  const fetchAllLoans = async (selectId?: string, forceFallback?: boolean) => {
    try {
      let url = `${API_URL}/loans`;
      if (!authToken) {
        if (guestLoanIds.length > 0) url += `?ids=${guestLoanIds.join(',')}`;
        else { setLoansList([]); handleNewLoanClick(); return; }
      }
      const res = await axios.get(url);
      setLoansList(res.data);
      if (forceFallback) {
        if (res.data.length > 0) handleSelectLoan(res.data[0]);
        else handleNewLoanClick(); return;
      }
      const targetId = selectId || currentLoanId;
      if (targetId && res.data.some((l: any) => l.id === targetId)) loadLoanData(targetId);
      else if (res.data.length > 0) handleSelectLoan(res.data[0]);
      else handleNewLoanClick();
    } catch (error) { console.error(error); }
  };

  const loadLoanData = async (loanId: string) => {
    try {
      setCurrentLoanId(loanId);
      const scheduleRes = await axios.get(`${API_URL}/loans/${loanId}/schedule`); setScheduleData(scheduleRes.data);
      const extraRes = await axios.get(`${API_URL}/loans/${loanId}/extra-payments`); setActiveExtraPayments(extraRes.data);
      const loanInfo = scheduleRes.data.loan_info;
      const savedInputs = getLoanInputs(loanId);
      
      let priceToSet = Number(loanInfo.initial_amount);
      let downToSet = 0;
      let insToSet = [];

      if (savedInputs) {
        if (savedInputs.price) priceToSet = savedInputs.price;
        if (savedInputs.down) downToSet = savedInputs.down;
        if (savedInputs.insurances) insToSet = savedInputs.insurances;
      }

      setActiveInsurances(insToSet);
      setFormData({
        name: loanInfo.name, property_price: priceToSet, down_payment: downToSet,
        interest_rate: Number(loanInfo.interest_rate), term_years: loanInfo.term_months / 12,
        start_date: loanInfo.start_date, first_payment_date: loanInfo.first_payment_date, payment_type: loanInfo.payment_type
      });
    } catch (error) { handleNewLoanClick(); }
  };

  const handleSelectLoan = (loan: any) => loadLoanData(loan.id);
  const handleNewLoanClick = () => { setCurrentLoanId(null); setScheduleData(null); setFormData(defaultForm); setActiveInsurances([]); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentFormLoanAmount <= 0) { alert("Сумма кредита должна быть больше нуля!"); return; }
    setLoading(true);
    try {
      const payload = {
        name: formData.name || 'Новая ипотека', initial_amount: currentFormLoanAmount, interest_rate: formData.interest_rate,
        term_months: formData.term_years * 12, start_date: formData.start_date, first_payment_date: formData.first_payment_date, payment_type: formData.payment_type
      };
      if (currentLoanId) {
        await axios.put(`${API_URL}/loans/${currentLoanId}`, payload);
        saveLoanInputs(currentLoanId, { price: formData.property_price, down: formData.down_payment, insurances: activeInsurances });
        await fetchAllLoans(currentLoanId);
      } else {
        const loanRes = await axios.post(`${API_URL}/loans`, payload);
        const newLoanId = loanRes.data.id;
        if (!authToken) {
          const updatedGuestIds = [...guestLoanIds, newLoanId]; setGuestLoanIds(updatedGuestIds); localStorage.setItem('guestLoanIds', JSON.stringify(updatedGuestIds));
        }
        saveLoanInputs(newLoanId, { price: formData.property_price, down: formData.down_payment, insurances: activeInsurances });
        await fetchAllLoans(newLoanId);
      }
    } catch (error) { alert("Ошибка при расчете."); } finally { setLoading(false); }
  };

  const handleDeleteLoan = async () => {
    if (!currentLoanId) return;
    if (!window.confirm(`Вы уверены, что хотите удалить кредит "${formData.name}"? Это действие необратимо.`)) return;
    try {
      await axios.delete(`${API_URL}/loans/${currentLoanId}`);
      localStorage.removeItem(`loanInputs_${currentLoanId}`);
      if (!authToken) {
        const updatedGuestIds = guestLoanIds.filter(id => id !== currentLoanId);
        setGuestLoanIds(updatedGuestIds); localStorage.setItem('guestLoanIds', JSON.stringify(updatedGuestIds));
      }
      await fetchAllLoans(undefined, true);
    } catch (error) { alert("Ошибка при удалении кредита"); }
  };

  const handleAddExtraPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentLoanId) return;
    if (epForm.amount <= 0) { alert("Введите сумму досрочного платежа"); return; }
    
    setExtraLoading(true);
    try {
      if (editingEpGroupIds) await Promise.all(editingEpGroupIds.map(id => axios.delete(`${API_URL}/extra-payments/${id}`)));

      const payDay = new Date(formData.first_payment_date).getDate();
      const startMonthIndex = MONTHS.indexOf(epForm.startMonth);
      let currentPayDate = new Date(Number(epForm.startYear), startMonthIndex, payDay);
      const freq = epForm.frequency;

      if (freq === 'ONCE') {
        const dStr = `${currentPayDate.getFullYear()}-${String(currentPayDate.getMonth() + 1).padStart(2, '0')}-${String(currentPayDate.getDate()).padStart(2, '0')}`;
        await axios.post(`${API_URL}/loans/${currentLoanId}/extra-payments`, { amount: epForm.amount, payment_date: dStr, strategy: epForm.strategy, is_recurring: false });
      } else if (freq === 'MONTHLY') {
        const dStr = `${currentPayDate.getFullYear()}-${String(currentPayDate.getMonth() + 1).padStart(2, '0')}-${String(currentPayDate.getDate()).padStart(2, '0')}`;
        await axios.post(`${API_URL}/loans/${currentLoanId}/extra-payments`, { amount: epForm.amount, payment_date: dStr, strategy: epForm.strategy, is_recurring: true });
      } else {
        const monthsToAdd = freq === 'QUARTERLY' ? 3 : freq === 'HALFYEARLY' ? 6 : 12;
        const end = new Date(formData.start_date); end.setFullYear(end.getFullYear() + formData.term_years);
        const promises = [];
        while(currentPayDate <= end) {
          const dStr = `${currentPayDate.getFullYear()}-${String(currentPayDate.getMonth() + 1).padStart(2, '0')}-${String(currentPayDate.getDate()).padStart(2, '0')}`;
          promises.push(axios.post(`${API_URL}/loans/${currentLoanId}/extra-payments`, { amount: epForm.amount, payment_date: dStr, strategy: epForm.strategy, is_recurring: false }));
          currentPayDate.setMonth(currentPayDate.getMonth() + monthsToAdd);
        }
        await Promise.all(promises);
      }
      await loadLoanData(currentLoanId);
      setIsEpModalOpen(false);
    } catch (error) { alert("Ошибка при сохранении платежа"); } finally { setExtraLoading(false); }
  };

  const handleDeleteExtraPaymentGroup = async (ids: string[]) => {
    try {
      await Promise.all(ids.map(id => axios.delete(`${API_URL}/extra-payments/${id}`)));
      await loadLoanData(currentLoanId!);
    } catch (error) { alert("Ошибка при удалении платежей"); }
  };

  const handleTogglePaidMonth = async (loanId: string, paymentNumber: number, isPaid: boolean) => {
    if (!loanId) return;
    try {
      if (isPaid) await axios.delete(`${API_URL}/loans/${loanId}/paid-months/${paymentNumber}`);
      else await axios.post(`${API_URL}/loans/${loanId}/paid-months/${paymentNumber}`);
      await loadLoanData(loanId);
    } catch (error) {}
  };

  const handlePriceChange = (valStr: string) => {
    let val = parseNumber(valStr); if (val > 100000000) val = 100000000;
    let dp = formData.down_payment; if (dp > val) dp = val; 
    setFormData({...formData, property_price: val, down_payment: dp});
  };
  const handleDownPaymentChange = (valStr: string) => {
    let val = parseNumber(valStr); if (val > formData.property_price) val = formData.property_price;
    setFormData({...formData, down_payment: val});
  };
  const handleRateChange = (valStr: string) => {
    let val = Number(valStr); if (val > 30) val = 30;
    setFormData({...formData, interest_rate: val});
  };
  const handleTermChange = (valStr: string) => {
    let val = Number(valStr); if (val > 30) val = 30;
    setFormData({...formData, term_years: val});
  };

  const exportToExcel = () => {
    if (!scheduleData) return;
    const wsData = scheduleData.schedule.filter((r:any) => r.total_payment > 0).map((row: any) => {
      const currentInsurance = getInsuranceForMonth(row.date);
      return {
        '№ Месяца': row.payment_number, 'Дата': new Date(row.date).toLocaleDateString('ru-RU'), 'Общий платеж (₽)': row.total_payment + currentInsurance,
        'Страховка (₽)': currentInsurance, 'Тело долга (₽)': row.principal_payment, 'Проценты (₽)': row.interest_payment,
        'Досрочно (₽)': row.extra_payment, 'Остаток долга (₽)': row.remaining_balance
      };
    });
    const ws = XLSX.utils.json_to_sheet(wsData); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "График платежей");
    ws['!cols'] = [{ wch: 10 }, { wch: 15 }, { wch: 18 }, { wch: 15 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 20 }];
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
      <div className="bg-slate-900 rounded-2xl shadow-lg border border-slate-800 overflow-hidden mt-6">
        <div className="flex flex-col sm:flex-row justify-between items-center p-4 border-b border-slate-800 bg-slate-950/50 gap-4">
          <h3 className="text-lg font-semibold text-white">Детальный график</h3>
          <button onClick={exportToExcel} className="flex-1 sm:flex-none flex items-center justify-center space-x-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors bg-emerald-950/40 hover:bg-emerald-900/60 px-4 py-2 rounded-lg border border-emerald-900/50 shadow-sm">
            <Download size={16} /><span>В Excel</span>
          </button>
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
                const currentInsurance = getInsuranceForMonth(row.date);
                const isInsMonth = currentInsurance > 0;
                
                let rowClass = 'transition-colors ';
                if (isPaid) rowClass += 'bg-emerald-950/20 opacity-75 ';
                else if (isInsMonth) rowClass += 'bg-amber-900/20 border-l-2 border-l-amber-500 ';
                else if (row.extra_payment > 0) rowClass += 'bg-indigo-900/10 hover:bg-slate-800/50 ';
                else rowClass += 'hover:bg-slate-800/50 ';

                return (
                  <tr key={row.payment_number} className={rowClass}>
                    <td className="p-4 text-center">
                      <button onClick={() => handleTogglePaidMonth(currentLoanId!, row.payment_number, isPaid)} className={`p-1 rounded-lg transition-colors ${isPaid ? 'text-emerald-400 bg-emerald-900/40' : 'text-slate-600 hover:text-slate-400'}`}><CheckCircle2 size={20} /></button>
                    </td>
                    <td className="p-4 text-slate-400">
                      <div className="flex items-center space-x-2">
                        <span>{row.payment_number} мес.</span>
                        {isPaid && <span className="text-[10px] bg-emerald-950 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-800/50">Оплачено</span>}
                      </div>
                      <span className="text-xs text-slate-500">{new Date(row.date).toLocaleDateString('ru-RU')}</span>
                    </td>
                    <td className="p-4 font-medium text-white">
                      <div className="flex flex-col">
                        <span>{formatMoney(row.total_payment - row.extra_payment + currentInsurance)}</span>
                        {isInsMonth && <span className="text-[10px] text-amber-500 flex items-center gap-1 mt-0.5"><Shield size={10} /> + страховка</span>}
                      </div>
                    </td>
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
  }, [scheduleData, currentLoanId, activeInsurances]);

  return (
    <div className="min-h-screen bg-slate-950 p-4 md:p-8 font-sans text-slate-200">
      
      {/* МОДАЛКА: АВТОРИЗАЦИЯ */}
      {isAuthModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl relative">
            <button onClick={() => setIsAuthModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"><X size={20} /></button>
            <h3 className="text-2xl font-bold text-white mb-2">{isLoginMode ? 'С возвращением' : 'Регистрация'}</h3>
            <p className="text-slate-400 text-sm mb-6">{isLoginMode ? 'Войдите, чтобы получить доступ к своим кредитам' : 'Создайте аккаунт для облачного сохранения'}</p>
            <form onSubmit={handleAuthSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Имя пользователя</label>
                <input type="text" value={authForm.username} onChange={(e) => setAuthForm({...authForm, username: e.target.value})} className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-white" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Пароль</label>
                <input type="password" value={authForm.password} onChange={(e) => setAuthForm({...authForm, password: e.target.value})} className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-white" required />
              </div>
              {authError && <div className="text-red-400 text-sm">{authError}</div>}
              <button type="submit" disabled={authLoading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition-colors mt-2 shadow-lg disabled:bg-blue-800">
                {authLoading ? 'Обработка...' : (isLoginMode ? 'Войти' : 'Зарегистрироваться')}
              </button>
            </form>
            <div className="mt-6 text-center text-sm text-slate-400">
              {isLoginMode ? "Нет аккаунта? " : "Уже есть аккаунт? "}
              <button onClick={() => {setIsLoginMode(!isLoginMode); setAuthError('');}} className="text-blue-400 hover:text-blue-300 font-medium">{isLoginMode ? 'Создать' : 'Войти'}</button>
            </div>
          </div>
        </div>
      )}

      {/* МОДАЛКА: ДОСРОЧНЫЙ ПЛАТЕЖ */}
      {isEpModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl relative">
            <button onClick={() => setIsEpModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"><X size={20} /></button>
            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <Zap className="text-indigo-400" size={24}/> {editingEpGroupIds ? 'Редактировать платёж' : 'Досрочное погашение'}
            </h3>
            <form onSubmit={handleAddExtraPayment} className="space-y-4">
              <div className="relative bg-slate-950 border border-indigo-900/50 rounded-xl p-2 focus-within:border-indigo-500 transition-colors">
                <label className="text-[10px] text-slate-500 absolute top-2 left-3 uppercase tracking-wider font-medium">Сумма платежа</label>
                <input type="text" value={formatNumber(epForm.amount)} onChange={(e) => setEpForm({...epForm, amount: parseNumber(e.target.value)})} className="w-full bg-transparent pt-5 pb-1 px-3 outline-none text-white font-medium text-lg" />
                <span className="absolute right-3 top-4 text-slate-500">₽</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="relative bg-slate-950 border border-indigo-900/50 rounded-xl focus-within:border-indigo-500 transition-colors">
                  <select value={epForm.frequency} onChange={(e) => setEpForm({...epForm, frequency: e.target.value})} className="w-full appearance-none bg-transparent text-slate-200 py-3 pl-4 pr-10 outline-none font-medium text-sm cursor-pointer">
                    <option value="ONCE">Разово</option>
                    <option value="MONTHLY">Ежемесячно</option>
                    <option value="QUARTERLY">Раз в 3 месяца</option>
                    <option value="HALFYEARLY">Раз в полгода</option>
                    <option value="YEARLY">Раз в год</option>
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-3.5 text-slate-500 pointer-events-none" />
                </div>
                <div className="relative bg-slate-950 border border-indigo-900/50 rounded-xl focus-within:border-indigo-500 transition-colors">
                  <select value={epForm.strategy} onChange={(e) => setEpForm({...epForm, strategy: e.target.value})} className="w-full appearance-none bg-transparent text-slate-200 py-3 pl-4 pr-10 outline-none font-medium text-sm cursor-pointer">
                    <option value="REDUCE_TERM">Уменьшить срок</option>
                    <option value="REDUCE_PAYMENT">Уменьшить платеж</option>
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-3.5 text-slate-500 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-medium text-slate-500 mb-2 mt-2">Первый досрочный платёж</label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="relative bg-slate-950 border border-indigo-900/50 rounded-xl focus-within:border-indigo-500 transition-colors">
                    <select value={epForm.startYear} onChange={(e) => setEpForm({...epForm, startYear: Number(e.target.value)})} className="w-full appearance-none bg-transparent text-slate-200 py-3 pl-4 pr-10 outline-none font-medium text-sm cursor-pointer">
                      {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <ChevronDown size={16} className="absolute right-3 top-3.5 text-slate-500 pointer-events-none" />
                  </div>
                  <div className="relative bg-slate-950 border border-indigo-900/50 rounded-xl focus-within:border-indigo-500 transition-colors">
                    <select value={epForm.startMonth} onChange={(e) => setEpForm({...epForm, startMonth: e.target.value})} className="w-full appearance-none bg-transparent text-slate-200 py-3 pl-4 pr-10 outline-none font-medium text-sm cursor-pointer">
                      {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <ChevronDown size={16} className="absolute right-3 top-3.5 text-slate-500 pointer-events-none" />
                  </div>
                </div>
              </div>
              <button type="submit" disabled={extraLoading} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3 rounded-xl transition-all mt-4 shadow-lg shadow-indigo-900/20 disabled:bg-indigo-900">
                {extraLoading ? 'Сохранение...' : 'Сохранить'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* МОДАЛКА: СТРАХОВКА */}
      {isInsModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl relative">
            <button onClick={() => setIsInsModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"><X size={20} /></button>
            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <Shield className="text-amber-500" size={24}/> {editingInsGroupId ? 'Редактировать страховку' : 'Новая страховка'}
            </h3>
            <form onSubmit={handleSaveInsurance} className="space-y-4">
              <div className="relative bg-slate-950 border border-amber-900/40 rounded-xl p-2 focus-within:border-amber-500 transition-colors">
                <label className="text-[10px] text-slate-500 absolute top-2 left-3 uppercase tracking-wider font-medium">Сумма страховки</label>
                <input type="text" value={formatNumber(insForm.amount)} onChange={(e) => setInsForm({...insForm, amount: parseNumber(e.target.value)})} className="w-full bg-transparent pt-5 pb-1 px-3 outline-none text-white font-medium text-xl" />
                <span className="absolute right-3 top-4 text-slate-500">₽</span>
              </div>
              <div className="relative bg-slate-950 border border-amber-900/40 rounded-xl focus-within:border-amber-500 transition-colors">
                <select value={insForm.frequency} onChange={(e) => setInsForm({...insForm, frequency: e.target.value})} className="w-full appearance-none bg-transparent text-slate-200 py-3 pl-4 pr-10 outline-none font-medium text-sm cursor-pointer">
                  <option value="ONCE">Разово</option>
                  <option value="YEARLY">Раз в год</option>
                </select>
                <ChevronDown size={16} className="absolute right-3 top-3.5 text-slate-500 pointer-events-none" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-medium text-slate-500 mb-2 mt-2">Первый платёж</label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="relative bg-slate-950 border border-amber-900/40 rounded-xl focus-within:border-amber-500 transition-colors">
                    <select value={insForm.startYear} onChange={(e) => setInsForm({...insForm, startYear: Number(e.target.value)})} className="w-full appearance-none bg-transparent text-slate-200 py-3 pl-4 pr-10 outline-none font-medium text-sm cursor-pointer">
                      {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <ChevronDown size={16} className="absolute right-3 top-3.5 text-slate-500 pointer-events-none" />
                  </div>
                  <div className="relative bg-slate-950 border border-amber-900/40 rounded-xl focus-within:border-amber-500 transition-colors">
                    <select value={insForm.startMonth} onChange={(e) => setInsForm({...insForm, startMonth: e.target.value})} className="w-full appearance-none bg-transparent text-slate-200 py-3 pl-4 pr-10 outline-none font-medium text-sm cursor-pointer">
                      {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <ChevronDown size={16} className="absolute right-3 top-3.5 text-slate-500 pointer-events-none" />
                  </div>
                </div>
              </div>
              <button type="submit" className="w-full bg-amber-600 hover:bg-amber-500 text-white font-medium py-3 rounded-xl transition-all mt-4 shadow-lg shadow-amber-900/20">
                Сохранить
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ОСНОВНОЙ ИНТЕРФЕЙС */}
      <div className="max-w-7xl mx-auto space-y-6">
        
        <header className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-600 p-2 rounded-lg text-white shadow-lg shadow-indigo-900/20"><Calculator size={28} /></div>
            <h1 className="text-3xl font-bold text-white tracking-tight">zproject</h1>
          </div>
          <div className="flex items-center space-x-4">
            {scheduleData && scheduleData.saved_interest > 0 && (
              <div className="hidden lg:flex items-center space-x-4 bg-emerald-950/40 border border-emerald-900/50 px-4 py-2 rounded-xl">
                <div className="text-emerald-400 font-bold flex items-center space-x-1"><span>🎉 Сэкономлено: {formatMoney(scheduleData.saved_interest)}</span></div>
                <div className="text-xs text-emerald-300/80 bg-emerald-900/40 px-2 py-1 rounded">Срок сокращен на {scheduleData.saved_months} мес.</div>
              </div>
            )}
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1">
              {authToken ? (
                <button onClick={handleLogout} className="flex items-center space-x-2 px-3 py-1.5 text-slate-400 hover:text-white transition-colors text-sm font-medium"><LogOut size={16} /><span className="hidden sm:inline">Выйти</span></button>
              ) : (
                <button onClick={() => setIsAuthModalOpen(true)} className="flex items-center space-x-2 px-3 py-1.5 text-indigo-400 hover:text-indigo-300 transition-colors text-sm font-medium"><User size={16} /><span className="hidden sm:inline">Войти</span></button>
              )}
            </div>
          </div>
        </header>

        <div className="flex space-x-2 overflow-x-auto pb-2 custom-scrollbar">
          {loansList.map(loan => (
            <button key={loan.id} onClick={() => handleSelectLoan(loan)} className={`px-4 py-2 rounded-lg whitespace-nowrap text-sm font-medium transition-all duration-200 ${currentLoanId === loan.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' : 'bg-slate-900 text-slate-400 hover:bg-slate-800 border border-slate-800'}`}>
              {loan.name}
            </button>
          ))}
          <button onClick={handleNewLoanClick} className={`flex items-center space-x-1 px-4 py-2 rounded-lg whitespace-nowrap text-sm font-medium transition-all duration-200 border border-dashed ${!currentLoanId && loansList.length > 0 ? 'border-indigo-500 text-indigo-400 bg-indigo-950/30' : 'border-slate-700 text-slate-400 hover:bg-slate-900 hover:text-slate-300'}`}>
            <Plus size={16} /><span>Добавить</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-slate-900 p-6 rounded-2xl shadow-xl border border-slate-800 h-fit sticky top-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-white">Параметры ипотеки</h2>
              {currentLoanId && (
                <button onClick={handleDeleteLoan} className="text-slate-500 hover:text-red-400 hover:bg-red-950/30 p-2 rounded-lg transition-all" title="Удалить кредит"><Trash2 size={18} /></button>
              )}
            </div>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Название (цель)</label>
                <div className="relative">
                  <FileText className="absolute left-3 top-2.5 text-slate-500" size={18} />
                  <input type="text" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} placeholder="Например: Квартира на Ленина" className="w-full pl-10 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-white font-medium" required />
                </div>
              </div>
              <div className="relative bg-slate-950 border border-slate-800 rounded-lg p-3 pt-2 focus-within:border-indigo-500 transition-colors pb-4">
                <label className="block text-xs font-medium text-slate-500 mb-1">Стоимость недвижимости (₽)</label>
                <div className="flex justify-between items-center">
                  <input type="text" value={formatNumber(formData.property_price)} onChange={(e) => handlePriceChange(e.target.value)} className="w-full bg-transparent outline-none text-white font-bold text-lg" />
                </div>
                <input type="range" min="100000" max="100000000" step="100000" value={formData.property_price} onChange={(e) => handlePriceChange(e.target.value)} className="absolute bottom-0 left-0 w-full h-1 translate-y-1/2 cursor-pointer appearance-none bg-slate-800 rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-indigo-600 m-0" />
              </div>
              <div className="relative bg-slate-950 border border-slate-800 rounded-lg p-3 pt-2 focus-within:border-indigo-500 transition-colors pb-4">
                <label className="block text-xs font-medium text-slate-500 mb-1">Первоначальный взнос (₽)</label>
                <div className="flex justify-between items-center">
                  <input type="text" value={formatNumber(formData.down_payment)} onChange={(e) => handleDownPaymentChange(e.target.value)} className="w-2/3 bg-transparent outline-none text-white font-bold text-lg" />
                  <span className="text-indigo-400 font-semibold text-sm">{formData.property_price > 0 ? ((formData.down_payment / formData.property_price) * 100).toFixed(1) : 0} %</span>
                </div>
                <input type="range" min="0" max={formData.property_price} step="10000" value={formData.down_payment} onChange={(e) => handleDownPaymentChange(e.target.value)} className="absolute bottom-0 left-0 w-full h-1 translate-y-1/2 cursor-pointer appearance-none bg-slate-800 rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-indigo-600 m-0" />
              </div>
              <div className="text-sm bg-slate-800/40 p-2.5 rounded-lg border border-slate-700/50 flex justify-between items-center">
                <span className="text-slate-400">Сумма кредита (долг):</span>
                <span className="font-bold text-white text-base">{formatMoney(currentFormLoanAmount)}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="relative bg-slate-950 border border-slate-800 rounded-lg p-3 pt-2 focus-within:border-indigo-500 transition-colors pb-4">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Ставка (%)</label>
                  <input type="number" step="0.1" value={formData.interest_rate} onChange={(e) => handleRateChange(e.target.value)} className="w-full bg-transparent outline-none text-white font-bold text-lg [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                  <input type="range" min="0.1" max="30" step="0.1" value={formData.interest_rate} onChange={(e) => handleRateChange(e.target.value)} className="absolute bottom-0 left-0 w-full h-1 translate-y-1/2 cursor-pointer appearance-none bg-slate-800 rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-indigo-600 m-0" />
                </div>
                <div className="relative bg-slate-950 border border-slate-800 rounded-lg p-3 pt-2 focus-within:border-indigo-500 transition-colors pb-4">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Срок (лет)</label>
                  <input type="number" value={formData.term_years} onChange={(e) => handleTermChange(e.target.value)} className="w-full bg-transparent outline-none text-white font-bold text-lg [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                  <input type="range" min="1" max="30" step="1" value={formData.term_years} onChange={(e) => handleTermChange(e.target.value)} className="absolute bottom-0 left-0 w-full h-1 translate-y-1/2 cursor-pointer appearance-none bg-slate-800 rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-indigo-600 m-0" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Тип платежа</label>
                <div className="relative">
                  <select value={formData.payment_type} onChange={(e) => setFormData({...formData, payment_type: e.target.value})} className="w-full appearance-none px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-white font-medium">
                    <option value="ANNUITY">Аннуитетный</option>
                    <option value="DIFFERENTIATED">Дифференцированный</option>
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-3.5 text-slate-500 pointer-events-none" />
                </div>
              </div>
              <button type="submit" disabled={loading} className={`w-full text-white font-medium py-3 rounded-xl transition-colors mt-2 shadow-lg disabled:opacity-50 ${currentLoanId ? 'bg-slate-700 hover:bg-slate-600 shadow-none border border-slate-600' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-900/20'}`}>
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
                    {totalInsurance > 0 && (
                      <div className="text-xs text-amber-500 mt-1 flex items-center space-x-1">
                        <Shield size={12}/><span>+ Страховки: {formatMoney(totalInsurance)}</span>
                      </div>
                    )}
                  </div>
                  <div className="bg-slate-900 p-5 rounded-2xl shadow-lg border border-slate-800">
                    <div className="text-sm text-slate-400 mb-1">Итого к выплате (с ПВ)</div>
                    <div className="text-2xl font-bold text-white">
                      {formatMoney(activeLoanAmount + scheduleData.total_interest + formData.down_payment + totalInsurance)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  
                  {/* КОМПАКТНЫЙ БЛОК: ДОСРОЧНЫЕ ПЛАТЕЖИ (НЕОН) */}
                  <div className="bg-indigo-950/40 p-5 rounded-2xl border border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.15)] flex flex-col h-full">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-semibold text-indigo-300 flex items-center gap-2">
                        <Zap className="text-indigo-400" size={20} /> Досрочные платежи
                      </h3>
                      <button onClick={() => openEpModal(null)} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium shadow-lg shadow-indigo-900/20">
                        + Добавить
                      </button>
                    </div>
                    
                    <div className="flex-1">
                      {groupedPayments.length === 0 ? (
                        <div className="text-indigo-400/50 text-sm text-center py-6 border-2 border-dashed border-indigo-900/50 rounded-xl h-full flex items-center justify-center">
                          Нет запланированных платежей
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-[160px] overflow-y-auto custom-scrollbar pr-2">
                          {groupedPayments.map((group: any, idx: number) => (
                            <div key={idx} className="flex items-center justify-between bg-slate-950 border border-indigo-900/50 rounded-lg p-3 group-item transition-colors">
                              <div className="flex flex-col">
                                <div className="text-sm font-bold text-emerald-400">{formatMoney(Number(group.amount))}</div>
                                <div className="text-[10px] text-slate-400">
                                  {group.displayFreq} <span className="opacity-70">({new Date(group.payment_date).toLocaleDateString('ru-RU', {month: 'short', year: 'numeric'})})</span>
                                </div>
                                {group.savedInterest > 0 && (
                                  <div className="text-[10px] text-emerald-400 mt-1 font-medium">
                                    Экономия: ~{formatMoney(group.savedInterest)} {group.savedMonths > 0 ? `и ${group.savedMonths} мес.` : ''}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center space-x-1">
                                <button onClick={() => openEpModal(group)} className="text-slate-500 hover:text-indigo-400 transition-colors p-2 rounded-md" title="Редактировать">
                                  <Pencil size={16} />
                                </button>
                                <button onClick={() => handleDeleteExtraPaymentGroup(group.ids)} className="text-slate-500 hover:text-red-400 transition-colors p-2 rounded-md" title="Удалить">
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* КОМПАКТНЫЙ БЛОК: СТРАХОВКА (НЕОН) */}
                  <div className="bg-amber-950/30 p-5 rounded-2xl border border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.15)] flex flex-col h-full">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-semibold text-amber-500 flex items-center gap-2">
                        <Shield className="text-amber-500" size={20} /> Страхование
                      </h3>
                      <button onClick={() => openInsModal(null)} className="bg-amber-600 hover:bg-amber-500 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium shadow-lg shadow-amber-900/20">
                        + Добавить
                      </button>
                    </div>
                    
                    <div className="flex-1">
                      {groupedInsurances.length === 0 ? (
                        <div className="text-amber-500/50 text-sm text-center py-6 border-2 border-dashed border-amber-900/50 rounded-xl h-full flex items-center justify-center">
                          Страховка не настроена
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-[160px] overflow-y-auto custom-scrollbar pr-2">
                          {groupedInsurances.map((group: any, idx: number) => (
                            <div key={idx} className="flex items-center justify-between bg-slate-950 border border-amber-900/50 rounded-lg p-3 group-item transition-colors">
                              <div className="flex flex-col">
                                <div className="text-sm font-bold text-amber-500">{formatMoney(Number(group.amount))}</div>
                                <div className="text-[10px] text-slate-400 flex items-center gap-1">
                                  {group.displayFreq} <span className="opacity-70">(с {new Date(group.payment_date).toLocaleDateString('ru-RU', {month: 'short', year: 'numeric'})})</span>
                                </div>
                              </div>
                              <div className="flex items-center space-x-1">
                                <button onClick={() => openInsModal(group)} className="text-slate-500 hover:text-amber-400 transition-colors p-2 rounded-md" title="Редактировать">
                                  <Pencil size={16} />
                                </button>
                                <button onClick={() => handleDeleteInsuranceGroup(group.groupId)} className="text-slate-500 hover:text-red-400 transition-colors p-2 rounded-md" title="Удалить">
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-slate-900 p-6 rounded-2xl shadow-lg border border-slate-800 h-80 mt-6">
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