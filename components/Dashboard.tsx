import React, { useState, useMemo, useEffect, useRef } from 'react';
import { InspectionRecord, StatData } from '../types';
import BoardList from './BoardList';
import InspectionDetail from './InspectionDetail';
import StatsChart from './StatsChart';
import { ScanLine, Search, FileSpreadsheet, FileUp } from 'lucide-react';
import { generateReport } from '../services/reportService';
import { exportToExcel } from '../services/excelService';
import * as XLSX from 'xlsx';

interface DashboardProps {
  inspections: InspectionRecord[];
  onUpdateInspections: (inspections: InspectionRecord[]) => void;
  onScan: () => void;
  selectedInspectionId?: string | null;
  onSelectionChange?: (id: string | null) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ 
  inspections, 
  onUpdateInspections, 
  onScan,
  selectedInspectionId,
  onSelectionChange
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Sync external selectedInspectionId with internal state
  useEffect(() => {
    if (selectedInspectionId !== undefined) {
      setSelectedId(selectedInspectionId);
    }
  }, [selectedInspectionId]);

  const handleSelectId = (id: string | null) => {
    setSelectedId(id);
    if (onSelectionChange) {
      onSelectionChange(id);
    }
  };

  const selectedRecord = useMemo(() => 
    inspections.find(i => i.id === selectedId) || null, 
  [inspections, selectedId]);

  const stats: StatData[] = useMemo(() => {
    const counts = inspections.reduce((acc, curr) => {
      acc[curr.status] = (acc[curr.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return [
      { name: 'Complete', value: counts['Complete'] || 0, color: '#10b981' },
      { name: 'In Progress', value: counts['In Progress'] || 0, color: '#3b82f6' },
      { name: 'Pending', value: counts['Pending'] || 0, color: '#94a3b8' },
    ].filter(d => d.value > 0);
  }, [inspections]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSave = (updated: InspectionRecord) => {
    const finalRecord = {
      ...updated,
      lastInspectionDate: updated.status === 'Complete' 
        ? new Date().toLocaleString() 
        : updated.lastInspectionDate
    };
    
    const updatedInspections = inspections.map(item => 
      item.id === finalRecord.id ? finalRecord : item
    );
    onUpdateInspections(updatedInspections);
    
    // Generate and download report
    generateReport(finalRecord);
    
    // Show success message
    setTimeout(() => {
      alert("Report generated and saved successfully!");
    }, 500);
  };

  const handleExcelImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // "검사 현황" 시트 또는 첫 번째 시트 읽기
        const sheetName = workbook.SheetNames.find(name => name.includes('검사')) || workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        if (jsonData.length < 2) {
          alert('엑셀 파일에 데이터가 없습니다.');
          return;
        }

        // 헤더 찾기
        const headers = jsonData[0] as string[];
        const idIndex = headers.findIndex(h => h.includes('ID') || h.includes('id'));
        const statusIndex = headers.findIndex(h => h.includes('검사') || h.includes('상황') || h.includes('status'));
        const dateIndex = headers.findIndex(h => h.includes('점검일') || h.includes('일') || h.includes('date'));
        const welderIndex = headers.findIndex(h => h.includes('용접') || h.includes('welder'));
        const grinderIndex = headers.findIndex(h => h.includes('연삭') || h.includes('grinder'));
        const lightIndex = headers.findIndex(h => h.includes('조명') || h.includes('light'));
        const pumpIndex = headers.findIndex(h => h.includes('펌프') || h.includes('pump'));
        const memoIndex = headers.findIndex(h => h.includes('조치') || h.includes('사항') || h.includes('memo'));
        const xIndex = headers.findIndex(h => h.includes('X') || h.includes('x'));
        const yIndex = headers.findIndex(h => h.includes('Y') || h.includes('y'));

        if (idIndex === -1) {
          alert('엑셀 파일에서 ID 열을 찾을 수 없습니다.');
          return;
        }

        // 데이터 파싱
        const importedRecords: InspectionRecord[] = [];
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || !row[idIndex]) continue;

          const id = String(row[idIndex]).trim();
          if (!id) continue;

          const status = statusIndex >= 0 ? String(row[statusIndex] || '').trim() : 'Pending';
          const validStatus = ['Complete', 'In Progress', 'Pending'].includes(status) 
            ? status as 'Complete' | 'In Progress' | 'Pending'
            : 'Pending';

          const lastInspectionDate = dateIndex >= 0 ? String(row[dateIndex] || '-').trim() : '-';
          
          const welder = welderIndex >= 0 ? String(row[welderIndex] || '').toLowerCase().includes('yes') : false;
          const grinder = grinderIndex >= 0 ? String(row[grinderIndex] || '').toLowerCase().includes('yes') : false;
          const light = lightIndex >= 0 ? String(row[lightIndex] || '').toLowerCase().includes('yes') : false;
          const pump = pumpIndex >= 0 ? String(row[pumpIndex] || '').toLowerCase().includes('yes') : false;

          const memo = memoIndex >= 0 ? String(row[memoIndex] || '').trim() : '';

          let position: { x: number; y: number } | undefined;
          if (xIndex >= 0 && yIndex >= 0) {
            const xStr = String(row[xIndex] || '').replace('%', '').trim();
            const yStr = String(row[yIndex] || '').replace('%', '').trim();
            const x = parseFloat(xStr);
            const y = parseFloat(yStr);
            if (!isNaN(x) && !isNaN(y)) {
              position = { x, y };
            }
          }

          importedRecords.push({
            id,
            status: validStatus,
            lastInspectionDate,
            loads: { welder, grinder, light, pump },
            photoUrl: null,
            memo,
            position: position || { x: 50, y: 50 }
          });
        }

        // 기존 데이터와 병합 (ID 기준으로 업데이트 또는 추가)
        const existingIds = new Set(inspections.map(i => i.id));
        const updatedInspections = [...inspections];

        importedRecords.forEach(record => {
          const existingIndex = updatedInspections.findIndex(i => i.id === record.id);
          if (existingIndex >= 0) {
            // 기존 항목 업데이트
            updatedInspections[existingIndex] = {
              ...updatedInspections[existingIndex],
              ...record,
              photoUrl: updatedInspections[existingIndex].photoUrl // 기존 사진 유지
            };
          } else {
            // 새 항목 추가
            updatedInspections.push(record);
          }
        });

        onUpdateInspections(updatedInspections);
        alert(`${importedRecords.length}개의 분전함 데이터를 가져왔습니다.`);
        
        // 파일 입력 초기화
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      } catch (error) {
        console.error('엑셀 파일 읽기 오류:', error);
        alert('엑셀 파일을 읽는 중 오류가 발생했습니다.');
      }
    };

    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full">
      {/* Left Panel: Stats & List */}
      <div className={`
        ${selectedId ? 'hidden lg:flex' : 'flex'} 
        lg:col-span-4 flex-col gap-6 h-full
      `}>
        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => exportToExcel(inspections)}
            className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-sm"
          >
            <FileSpreadsheet size={18} />
            엑셀 내보내기
          </button>
          <label className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-sm cursor-pointer">
            <FileUp size={18} />
            엑셀 입력
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleExcelImport}
              className="hidden"
            />
          </label>
        </div>

        {/* Stats Card */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Inspection Status</h3>
          <div className="flex items-center justify-between">
            <div className="w-1/2">
              <StatsChart data={stats} />
            </div>
            <div className="w-1/2 space-y-2">
              {stats.map(s => (
                <div key={s.name} className="flex justify-between items-center text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }}></span>
                    <span className="text-slate-600 font-medium">{s.name}</span>
                  </div>
                  <span className="font-bold text-slate-800">{s.value}</span>
                </div>
              ))}
              <div className="pt-2 mt-2 border-t border-slate-100 flex justify-between items-center text-sm">
                <span className="text-slate-500">Total</span>
                <span className="font-bold text-slate-900">{inspections.length}</span>
              </div>
            </div>
          </div>
        </div>

        {/* List Component */}
        <div className="flex-1 min-h-0">
          <BoardList 
            items={inspections} 
            selectedId={selectedId} 
            onSelect={handleSelectId} 
          />
        </div>
      </div>

      {/* Right Panel: Detail View */}
      <div className={`
        ${selectedId ? 'flex' : 'hidden lg:flex'} 
        lg:col-span-8 h-full flex-col
      `}>
        {selectedRecord ? (
          <InspectionDetail 
            record={selectedRecord} 
            onSave={handleSave}
            onCancel={() => handleSelectId(null)}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center bg-slate-100 rounded-xl border-2 border-dashed border-slate-300 text-slate-400">
            <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mb-4">
              <Search size={32} className="text-slate-400" />
            </div>
            <p className="font-medium">Select a Distribution Board to view details</p>
            <p className="text-sm mt-2">Or scan a new QR code</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
