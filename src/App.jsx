import React, { useState, useEffect } from 'react';

// PapaParse will be loaded from CDN, so the direct import is removed.
import Papa from 'papaparse';

// --- Helper Functions ---
const getDaysInMonth = (year, month) => {
  return new Date(year, month, 0).getDate();
};

const formatDateToYyyyMmDd = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// --- Shift Definitions ---
const SHIFT_TYPES = {
  DAY: '日勤',
  NIGHT: '夜勤',
  HOLIDAY: '休み希望',
  OFF: '公休',
};

// --- Main Application Component ---
function App() {
  // Reinstate papaParseLoaded state and its useEffect for CDN loading
  const [papaParseLoaded, setPapaParseLoaded] = useState(typeof Papa !== 'undefined');

  useEffect(() => {
    // Load PapaParse from CDN if not already available
    if (typeof Papa === 'undefined' && !document.getElementById('papaparse-script')) {
      console.log("PapaParse not found, attempting to load from CDN...");
      const script = document.createElement('script');
      script.id = 'papaparse-script';
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.2/papaparse.min.js';
      script.async = true;
      script.onload = () => { setPapaParseLoaded(true); console.log("PapaParse loaded from CDN."); };
      script.onerror = () => { setPapaParseLoaded(false); console.error("Failed to load PapaParse from CDN."); };
      document.head.appendChild(script);
    } else if (typeof Papa !== 'undefined' && !papaParseLoaded) {
      setPapaParseLoaded(true); // Already loaded
    }
  }, [papaParseLoaded]); // Effect for PapaParse loading

  // Reinstate loading check for papaParseLoaded
  if (!papaParseLoaded) {
    let loadingMessage = "CSV解析ライブラリを読み込み中...";
    let errorMessage = "";
    if (document.getElementById('papaparse-script') && !papaParseLoaded) {
        errorMessage += "CSV解析ライブラリの読み込みに失敗しました。";
    }
    if (errorMessage) {
        return <div className="p-4 text-center text-red-600">{errorMessage} ページを再読み込みするか、ネットワーク環境を確認してください。</div>;
    }
    return <div className="p-4 text-center">{loadingMessage}</div>;
  }

  return (
    <div className="container mx-auto p-4 font-sans">
      <header className="text-center mb-8">
        <h1 className="text-3xl font-bold text-blue-600">シフト管理さん</h1>
      </header>
      <ShiftScheduler />
    </div>
  );
}

// --- Shift Scheduler Core Component ---
function ShiftScheduler() {
  const [selectedMonthYear, setSelectedMonthYear] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  });
  const [staffingConfig, setStaffingConfig] = useState({
    weekdayDay: 2, weekdayNight: 1, weekendDay: 1, weekendNight: 1, treatPublicHolidaysAsWeekends: true,
  });
  const [publicHolidaysInput, setPublicHolidaysInput] = useState('');
  const [employees, setEmployees] = useState([]);
  const [priorityEmployeeIds, setPriorityEmployeeIds] = useState([]);
  const [generatedSchedule, setGeneratedSchedule] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState([]);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      // Reinstate check for PapaParse if loaded via CDN
      if (typeof Papa === 'undefined') {
        setError('CSV解析ライブラリが読み込まれていません。ページを再読み込みしてください。');
        return;
      }
      Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: (results) => {
          try {
            const parsedEmployees = {};
            if (!results.meta || !results.meta.fields || !results.meta.fields.includes('ID') || !results.meta.fields.includes('Name') || !results.meta.fields.includes('Date')) {
              setError('CSVヘッダー不正: ID, Name, Date を含めてください。'); setEmployees([]); return;
            }
            results.data.forEach(row => {
              const employeeID = row.ID?.trim();
              const employeeName = row.Name?.trim();
              const requestedDate = row.Date?.trim();
              if (!employeeID || !employeeName || !requestedDate || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
                console.warn("Skipping invalid CSV row:", row); return;
              }
              if (!parsedEmployees[employeeID]) parsedEmployees[employeeID] = { id: employeeID, name: employeeName, rawRequests: [] };
              parsedEmployees[employeeID].rawRequests.push({ date: requestedDate, priority: String(row.Priority).toUpperCase() === 'TRUE' });
            });
            const finalEmployees = Object.values(parsedEmployees);
            setEmployees(finalEmployees);
            if (results.data.length > 0 && finalEmployees.length === 0) setError('有効な従業員データなし。形式確認を。');
            else if (results.data.length === 0 && results.meta.fields.length > 0) setError('データ行なし（ヘッダーのみ）。');
            else if (finalEmployees.length > 0) setError('');
            else if (results.errors.length > 0) setError(`CSV解析エラー: ${results.errors[0].message}`);
            else setError('CSV空か読取不可。');
          } catch (e) { console.error("CSV processing error:", e); setError('CSV処理エラー: ' + e.message); setEmployees([]); }
        },
        error: (err) => { console.error("PapaParse error:", err); setError('CSV読込エラー: ' + err.message); setEmployees([]); }
      });
    }
  };

  const generateScheduleLogic = () => {
    setIsLoading(true); setError(''); setWarnings([]); setGeneratedSchedule(null);
    if (employees.length === 0) { setError("従業員データなし。CSVをアップロードしてください。"); setIsLoading(false); return; }

    const [year, month] = selectedMonthYear.split('-').map(Number);
    const numDays = getDaysInMonth(year, month);
    const parsedPublicHolidays = publicHolidaysInput.split(',').map(d => d.trim()).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    let currentSchedule = {};
    let employeeStates = employees.map(emp => ({ ...emp, shifts: {}, totalDayShifts: 0, totalNightShifts: 0 }));

    for (let day = 1; day <= numDays; day++) {
      const dateStr = formatDateToYyyyMmDd(new Date(year, month - 1, day));
      currentSchedule[dateStr] = { day: [], night: [], off: [], holiday: [] };
      employeeStates.forEach(emp => {
        const request = emp.rawRequests.find(r => r.date === dateStr);
        if (request && (request.priority || priorityEmployeeIds.includes(emp.id))) {
          emp.shifts[dateStr] = SHIFT_TYPES.HOLIDAY; currentSchedule[dateStr].holiday.push(emp.id);
        }
      });
      employeeStates.forEach(emp => {
        const request = emp.rawRequests.find(r => r.date === dateStr);
        if (request && !emp.shifts[dateStr] && !priorityEmployeeIds.includes(emp.id) && !request.priority) {
          emp.shifts[dateStr] = SHIFT_TYPES.HOLIDAY; currentSchedule[dateStr].holiday.push(emp.id);
        }
      });
    }

    const localWarnings = [];
    for (let day = 1; day <= numDays; day++) {
      const currentDate = new Date(year, month - 1, day);
      const dateStr = formatDateToYyyyMmDd(currentDate);
      const dayOfWeek = currentDate.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isPublicHolidayDate = parsedPublicHolidays.includes(dateStr);
      let requiredDayStaff, requiredNightStaff;
      if ((isPublicHolidayDate && staffingConfig.treatPublicHolidaysAsWeekends) || isWeekend) {
        requiredDayStaff = staffingConfig.weekendDay; requiredNightStaff = staffingConfig.weekendNight;
      } else {
        requiredDayStaff = staffingConfig.weekdayDay; requiredNightStaff = staffingConfig.weekdayNight;
      }

      let assignedDayCount = currentSchedule[dateStr].day.length;
      const availableForDay = employeeStates.filter(emp => !emp.shifts[dateStr]).sort((a,b) => a.totalDayShifts - b.totalDayShifts || Math.random() - 0.5);
      for (const emp of availableForDay) {
        if (assignedDayCount >= requiredDayStaff) break;
        const prevDateStr = formatDateToYyyyMmDd(new Date(year, month - 1, day - 1));
        if (emp.shifts[prevDateStr] === SHIFT_TYPES.NIGHT) continue;
        emp.shifts[dateStr] = SHIFT_TYPES.DAY; currentSchedule[dateStr].day.push(emp.id); emp.totalDayShifts++; assignedDayCount++;
      }
      if (assignedDayCount < requiredDayStaff) localWarnings.push(`${dateStr} 日勤: 必要${requiredDayStaff}人に対し${assignedDayCount}人`);

      let assignedNightCount = currentSchedule[dateStr].night.length;
      const availableForNight = employeeStates.filter(emp => !emp.shifts[dateStr] || emp.shifts[dateStr] === SHIFT_TYPES.OFF).sort((a,b) => a.totalNightShifts - b.totalNightShifts || Math.random() - 0.5);
      for (const emp of availableForNight) {
        if (assignedNightCount >= requiredNightStaff) break;
        if (emp.shifts[dateStr] === SHIFT_TYPES.OFF && currentSchedule[dateStr] && currentSchedule[dateStr].off) {
             currentSchedule[dateStr].off = currentSchedule[dateStr].off.filter(id => id !== emp.id);
        }
        emp.shifts[dateStr] = SHIFT_TYPES.NIGHT; currentSchedule[dateStr].night.push(emp.id); emp.totalNightShifts++; assignedNightCount++;
      }
      if (assignedNightCount < requiredNightStaff) localWarnings.push(`${dateStr} 夜勤: 必要${requiredNightStaff}人に対し${assignedNightCount}人`);

      employeeStates.forEach(emp => {
        if (!emp.shifts[dateStr]) {
            emp.shifts[dateStr] = SHIFT_TYPES.OFF;
            if (currentSchedule[dateStr] && currentSchedule[dateStr].off) {
                currentSchedule[dateStr].off.push(emp.id);
            } else if (currentSchedule[dateStr]) {
                currentSchedule[dateStr].off = [emp.id];
            }
        }
      });
    }
    setGeneratedSchedule(currentSchedule); setWarnings(localWarnings); setIsLoading(false);
  };

  const getName = (id) => employees.find(e => e.id === id)?.name || '不明';

  const handleExportToTsv = () => {
    if (!generatedSchedule) {
      setError("スケジュールが生成されていません。");
      console.error("Schedule not generated for export.");
      return;
    }
    console.log("Starting TSV export...");
    const [year, monthNum] = selectedMonthYear.split('-').map(Number);
    const numDays = getDaysInMonth(year, monthNum);

    let tsvContent = "";
    const headerCells = ["従業員"];
    for (let day = 1; day <= numDays; day++) {
      headerCells.push(String(day));
    }
    tsvContent += headerCells.join("\t") + "\n";

    employees.forEach(emp => {
      const rowCells = [getName(emp.id)];
      for (let day = 1; day <= numDays; day++) {
        const dateStr = formatDateToYyyyMmDd(new Date(year, monthNum - 1, day));
        const daySchedule = generatedSchedule[dateStr];
        let shiftAssigned = SHIFT_TYPES.OFF;
        if (daySchedule) {
          if (daySchedule.holiday.includes(emp.id)) shiftAssigned = SHIFT_TYPES.HOLIDAY;
          else if (daySchedule.day.includes(emp.id)) shiftAssigned = SHIFT_TYPES.DAY;
          else if (daySchedule.night.includes(emp.id)) shiftAssigned = SHIFT_TYPES.NIGHT;
        }
        let cellText = '';
        if (shiftAssigned === SHIFT_TYPES.DAY) cellText = '日';
        else if (shiftAssigned === SHIFT_TYPES.NIGHT) cellText = '夜';
        else if (shiftAssigned === SHIFT_TYPES.HOLIDAY) cellText = '休';
        rowCells.push(cellText);
      }
      tsvContent += rowCells.join("\t") + "\n";
    });

    const blob = new Blob(["\uFEFF" + tsvContent], { type: 'text/tab-separated-values;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `シフト表_${selectedMonthYear}.tsv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } else {
        setError("お使いのブラウザではTSVダウンロード機能がサポートされていません。");
    }
    console.log("TSV export finished.");
  };

  return (
    <div className="space-y-6">
      <ConfigForm {...{selectedMonthYear, setSelectedMonthYear, staffingConfig, setStaffingConfig, publicHolidaysInput, setPublicHolidaysInput, handleFileUpload, employees, priorityEmployeeIds, setPriorityEmployeeIds, generateSchedule: generateScheduleLogic, isLoading}} />
      {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-md" role="alert">{error}</div>}
      {warnings.length > 0 && (
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded-md mt-4" role="alert">
          <strong className="font-bold">警告:</strong>
          <ul className="list-disc list-inside mt-1">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {isLoading && <div className="text-center py-4"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div><p className="mt-2">シフト生成中...</p></div>}
      {generatedSchedule && (
        <>
          <ScheduleDisplay {...{schedule: generatedSchedule, employees, selectedMonthYear, getName, publicHolidaysInput}} />
          <div className="mt-6 text-center">
            <button
              onClick={handleExportToTsv}
              disabled={isLoading}
              className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-gray-400 transition duration-150 ease-in-out"
            >
              TSV形式でエクスポート
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ConfigForm({ selectedMonthYear, setSelectedMonthYear, staffingConfig, setStaffingConfig, publicHolidaysInput, setPublicHolidaysInput, handleFileUpload, employees, priorityEmployeeIds, setPriorityEmployeeIds, generateSchedule, isLoading }) {
  const handleStaffingChange = (type, value) => setStaffingConfig(prev => ({ ...prev, [type]: Math.max(0, parseInt(value,10) || 0) }));
  const handlePriorityChange = (empId) => setPriorityEmployeeIds(prev => prev.includes(empId) ? prev.filter(id => id !== empId) : [...prev, empId]);
  const monthOptions = [];
  const currentYear = new Date().getFullYear();
  for (let y_offset = -1; y_offset <= 2; y_offset++) {
      const yearToConsider = currentYear + y_offset;
      for (let m = 1; m <= 12; m++) monthOptions.push(`${yearToConsider}-${String(m).padStart(2, '0')}`);
  }
  return (
    <div className="p-6 bg-white shadow-lg rounded-lg border border-gray-200">
      <h2 className="text-2xl font-semibold mb-6 text-gray-700">1. 設定入力</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label htmlFor="monthYear" className="block text-sm font-medium text-gray-700 mb-1">対象年月:</label>
          <select id="monthYear" value={selectedMonthYear} onChange={(e) => setSelectedMonthYear(e.target.value)} className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500">
            {monthOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="csvFile" className="block text-sm font-medium text-gray-700 mb-1">休み希望CSVファイル:</label>
          <input type="file" id="csvFile" accept=".csv,text/csv" onChange={handleFileUpload} className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer" />
          <p className="text-xs text-gray-500 mt-1">フォーマット: ID,Name,Date(YYYY-MM-DD),Priority(TRUE/FALSE)</p>
        </div>
      </div>
      <div className="mt-6">
        <h3 className="text-lg font-medium text-gray-700 mb-2">常駐人数設定:</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div><label htmlFor="wdDay" className="text-xs font-medium text-gray-600">平日 日勤:</label><input type="number" id="wdDay" min="0" value={staffingConfig.weekdayDay} onChange={e => handleStaffingChange('weekdayDay', e.target.value)} className="mt-1 p-2 w-full border rounded-md shadow-sm"/></div>
          <div><label htmlFor="wdNight" className="text-xs font-medium text-gray-600">平日 夜勤:</label><input type="number" id="wdNight" min="0" value={staffingConfig.weekdayNight} onChange={e => handleStaffingChange('weekdayNight', e.target.value)} className="mt-1 p-2 w-full border rounded-md shadow-sm"/></div>
          <div><label htmlFor="weDay" className="text-xs font-medium text-gray-600">土日祝 日勤:</label><input type="number" id="weDay" min="0" value={staffingConfig.weekendDay} onChange={e => handleStaffingChange('weekendDay', e.target.value)} className="mt-1 p-2 w-full border rounded-md shadow-sm"/></div>
          <div><label htmlFor="weNight" className="text-xs font-medium text-gray-600">土日祝 夜勤:</label><input type="number" id="weNight" min="0" value={staffingConfig.weekendNight} onChange={e => handleStaffingChange('weekendNight', e.target.value)} className="mt-1 p-2 w-full border rounded-md shadow-sm"/></div>
        </div>
        <div className="mt-3"><label className="flex items-center cursor-pointer"><input type="checkbox" checked={staffingConfig.treatPublicHolidaysAsWeekends} onChange={e => setStaffingConfig(prev => ({...prev, treatPublicHolidaysAsWeekends: e.target.checked}))} className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"/><span className="ml-2 text-sm text-gray-700">祝日を土日祝の人数設定で扱う</span></label></div>
      </div>
      <div className="mt-6">
        <label htmlFor="publicHolidays" className="block text-sm font-medium text-gray-700 mb-1">祝日リスト (YYYY-MM-DD, カンマ区切り):</label>
        <input type="text" id="publicHolidays" value={publicHolidaysInput} onChange={(e) => setPublicHolidaysInput(e.target.value)} placeholder="例: 2025-01-01,2025-01-13" className="mt-1 block w-full p-2 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"/>
      </div>
      {employees.length > 0 && (
        <div className="mt-6">
          <h3 className="text-lg font-medium text-gray-700 mb-2">休み希望優先従業員:</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-40 overflow-y-auto p-2 border rounded-md bg-gray-50">
            {employees.map(emp => (<label key={emp.id} className="flex items-center space-x-2 p-1.5 hover:bg-gray-100 rounded cursor-pointer"><input type="checkbox" checked={priorityEmployeeIds.includes(emp.id)} onChange={() => handlePriorityChange(emp.id)} className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500"/><span className="text-sm text-gray-700">{emp.name} ({emp.id})</span></label>))}
          </div>
        </div>
      )}
      <button onClick={generateSchedule} disabled={isLoading || employees.length === 0} className="mt-8 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-md focus:outline-none ring-offset-2 ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed">
        {isLoading ? '生成中...' : 'シフト表を生成'}
      </button>
    </div>
  );
}

function ScheduleDisplay({ schedule, employees, selectedMonthYear, getName, publicHolidaysInput }) {
  if (!schedule) return null;
  const [year, month] = selectedMonthYear.split('-').map(Number);
  const numDays = getDaysInMonth(year, month);
  const daysArray = Array.from({ length: numDays }, (_, i) => i + 1);
  const parsedPublicHolidays = publicHolidaysInput.split(',').map(d => d.trim()).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));

  const getDayCellStyle = (dayOfMonth) => {
    const date = new Date(year, month - 1, dayOfMonth); const dateStr = formatDateToYyyyMmDd(date); const dayOfWeek = date.getDay();
    let cellClass = "border px-1 py-1 text-center text-xs ";
    if (parsedPublicHolidays.includes(dateStr)) cellClass += "bg-pink-100 font-semibold text-pink-700"; // Public Holiday
    else if (dayOfWeek === 0) cellClass += "bg-red-50 text-red-700"; // Sunday
    else if (dayOfWeek === 6) cellClass += "bg-blue-50 text-blue-700"; // Saturday
    else cellClass += "bg-white"; // Weekday
    return cellClass;
  };
  const getShiftTextAndStyle = (shiftType) => {
    if (shiftType === SHIFT_TYPES.DAY) return { text: '日', style: "bg-yellow-200 text-yellow-800 font-medium" };
    if (shiftType === SHIFT_TYPES.NIGHT) return { text: '夜', style: "bg-indigo-200 text-indigo-800 font-medium" };
    if (shiftType === SHIFT_TYPES.HOLIDAY) return { text: '休', style: "bg-green-200 text-green-800 font-medium" };
    return { text: '', style: "text-gray-400" }; // OFF
  };

  return (
    <div className="mt-8 p-4 bg-white shadow-xl rounded-lg border border-gray-200 overflow-x-auto">
      <h2 className="text-2xl font-semibold mb-6 text-gray-800">2. 生成されたシフト表 ({selectedMonthYear})</h2>
      <div className="min-w-[1000px]">
        <table className="w-full border-collapse border-gray-300 table-fixed">
          <colgroup><col style={{ width: '120px' }} />{daysArray.map(day => <col key={`col-${day}`} style={{ width: '35px' }} />)}</colgroup>
          <thead><tr className="bg-gray-100"><th className="border sticky left-0 bg-gray-100 z-20 px-2 py-2 text-sm font-semibold text-gray-600">従業員</th>{daysArray.map(day => <th key={day} className={`${getDayCellStyle(day)} w-10 h-10`}>{day}</th>)}</tr></thead>
          <tbody>
            {employees.map(emp => (
              <tr key={emp.id} className="hover:bg-gray-50">
                <td className="border sticky left-0 bg-white hover:bg-gray-50 z-10 px-2 py-2 text-sm font-medium text-gray-700 whitespace-nowrap">{getName(emp.id)}</td>
                {daysArray.map(day => {
                  const dateStr = formatDateToYyyyMmDd(new Date(year, month - 1, day));
                  const daySchedule = schedule[dateStr]; let shiftAssigned = SHIFT_TYPES.OFF;
                  if (daySchedule) {
                    if (daySchedule.holiday.includes(emp.id)) shiftAssigned = SHIFT_TYPES.HOLIDAY;
                    else if (daySchedule.day.includes(emp.id)) shiftAssigned = SHIFT_TYPES.DAY;
                    else if (daySchedule.night.includes(emp.id)) shiftAssigned = SHIFT_TYPES.NIGHT;
                  }
                  const { text, style } = getShiftTextAndStyle(shiftAssigned);
                  return <td key={`${emp.id}-${day}`} className={`${getDayCellStyle(day)} ${style} h-10`}>{text}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-6 space-x-3 text-xs flex flex-wrap gap-y-2">
        <span className="px-2 py-1 rounded-md font-medium bg-yellow-200 text-yellow-800">日: 日勤</span>
        <span className="px-2 py-1 rounded-md font-medium bg-indigo-200 text-indigo-800">夜: 夜勤</span>
        <span className="px-2 py-1 rounded-md font-medium bg-green-200 text-green-800">休: 休み希望</span>
        <span className="px-2 py-1 rounded-md text-gray-500 border">空欄: 公休</span>
        <span className="px-2 py-1 rounded-md font-semibold bg-pink-100 text-pink-700">祝日</span>
        <span className="px-2 py-1 rounded-md bg-red-50 text-red-700">日曜</span>
        <span className="px-2 py-1 rounded-md bg-blue-50 text-blue-700">土曜</span>
      </div>
    </div>
  );
}

export default App;
