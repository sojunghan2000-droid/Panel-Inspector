import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { InspectionRecord, StatData, ReportHistory } from '../types';
import StatsChart from './StatsChart';
import FloorPlanView from './FloorPlanView';
import InspectionDetail from './InspectionDetail';
import { CheckCircle2, Clock, AlertCircle, TrendingUp, Activity, ShieldCheck, X } from 'lucide-react';

interface DashboardOverviewProps {
  inspections: InspectionRecord[];
  onUpdateInspections?: (inspections: InspectionRecord[]) => void;
  selectedInspectionId?: string | null;
  onSelectionChange?: (id: string | null) => void;
  reports?: ReportHistory[];
  floorPlanUrls?: { floor: string; url: string }[];
}

const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  inspections,
  onUpdateInspections,
  selectedInspectionId,
  onSelectionChange,
  reports = [],
  floorPlanUrls = []
}) => {
  // InspectionDetail Modal 상태
  const [showInspectionModal, setShowInspectionModal] = useState(false);
  const [modalInspection, setModalInspection] = useState<InspectionRecord | null>(null);

  const handleShowInspectionModal = (inspection: InspectionRecord) => {
    setModalInspection(inspection);
    setShowInspectionModal(true);
  };

  // Report HTML 생성 (기존 Report가 있으면 사용, 없으면 빈 양식 생성)
  const getReportHtml = (inspection: InspectionRecord): string => {
    // 기존 Report 찾기
    const existingReport = reports
      .filter(r => r.boardId === inspection.panelNo)
      .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())[0];

    if (existingReport?.htmlContent) {
      return existingReport.htmlContent;
    }

    // 빈 Report 양식 생성
    const connectedLoads = [];
    if (inspection.loads.welder) connectedLoads.push('Welder');
    if (inspection.loads.grinder) connectedLoads.push('Grinder');
    if (inspection.loads.light) connectedLoads.push('Light');
    if (inspection.loads.pump) connectedLoads.push('Pump');
    const loadCause = connectedLoads.length > 0 ? connectedLoads.join(', ') : '-';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>공사용 가설 분전반 점검 보고서</title>
  <style>
    body { font-family: 'Malgun Gothic', Arial, sans-serif; padding: 20px; background-color: #f5f5f5; }
    .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { color: #1e40af; border-bottom: 3px solid #1e40af; padding-bottom: 10px; margin-bottom: 20px; }
    .draft-badge { display: inline-block; background: #fbbf24; color: #92400e; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; margin-bottom: 15px; }
    .info { margin: 15px 0; padding: 10px; background-color: #f9fafb; border-left: 4px solid #3b82f6; border-radius: 4px; }
    .label { font-weight: bold; color: #374151; display: inline-block; min-width: 150px; }
    .value { color: #1f2937; }
    .empty { color: #9ca3af; font-style: italic; }
  </style>
</head>
<body>
  <div class="container">
    <h1>공사용 가설 분전반 점검 보고서</h1>
    <div class="draft-badge">미생성 (Draft)</div>
    ${inspection.projectName ? `<div class="info"><span class="label">PJT명:</span><span class="value">${inspection.projectName}</span></div>` : `<div class="info"><span class="label">PJT명:</span><span class="empty">-</span></div>`}
    ${inspection.contractor ? `<div class="info"><span class="label">시공사:</span><span class="value">${inspection.contractor}</span></div>` : `<div class="info"><span class="label">시공사:</span><span class="empty">-</span></div>`}
    ${inspection.managementNumber ? `<div class="info"><span class="label">관리번호:</span><span class="value">${inspection.managementNumber}</span></div>` : `<div class="info"><span class="label">관리번호:</span><span class="empty">-</span></div>`}
    <div class="info"><span class="label">PNL NO.:</span><span class="value">${inspection.panelNo}</span></div>
    <div class="info"><span class="label">TR:</span><span class="${inspection.tr ? 'value' : 'empty'}">${inspection.tr === 'A' ? 'TR-1 900KVA' : inspection.tr === 'B' ? 'TR-2 950KVA' : '-'}</span></div>
    <div class="info"><span class="label">층수:</span><span class="${inspection.floor ? 'value' : 'empty'}">${inspection.floor || '-'}</span></div>
    <div class="info"><span class="label">공칭 단면적:</span><span class="${inspection.nominalCrossSection ? 'value' : 'empty'}">${inspection.nominalCrossSection || '-'}</span></div>
    <div class="info"><span class="label">상태:</span><span class="value">${inspection.status}</span></div>
    <div class="info"><span class="label">마지막 점검일:</span><span class="value">${inspection.lastInspectionDate !== '-' ? inspection.lastInspectionDate : '-'}</span></div>
    <div class="info"><span class="label">부하 원인:</span><span class="value">${loadCause}</span></div>
    <div class="info"><span class="label">점검 조치 사항:</span><span class="${inspection.memo ? 'value' : 'empty'}">${inspection.memo || '-'}</span></div>
    ${inspection.inspectors && inspection.inspectors.length > 0 ? `<div class="info"><span class="label">점검자:</span><span class="value">${inspection.inspectors.join(', ')}</span></div>` : `<div class="info"><span class="label">점검자:</span><span class="empty">-</span></div>`}
  </div>
</body>
</html>`.trim();
  };

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

  const totalInspections = inspections.length;
  const completeCount = inspections.filter(i => i.status === 'Complete').length;
  const inProgressCount = inspections.filter(i => i.status === 'In Progress').length;
  const pendingCount = inspections.filter(i => i.status === 'Pending').length;
  const completionRate = totalInspections > 0 ? Math.round((completeCount / totalInspections) * 100) : 0;

  const recentInspections = useMemo(() => {
    return inspections
      .filter(i => i.status === 'Complete' || i.status === 'In Progress')
      .sort((a, b) => {
        const dateA = a.lastInspectionDate === '-' ? 0 : new Date(a.lastInspectionDate).getTime();
        const dateB = b.lastInspectionDate === '-' ? 0 : new Date(b.lastInspectionDate).getTime();
        return dateB - dateA;
      })
      .slice(0, 5);
  }, [inspections]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Complete':
        return <CheckCircle2 size={16} className="text-emerald-600" />;
      case 'In Progress':
        return <Clock size={16} className="text-blue-600" />;
      default:
        return <AlertCircle size={16} className="text-slate-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Complete':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'In Progress':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      default:
        return 'bg-slate-50 text-slate-600 border-slate-200';
    }
  };

  // 차단기 용량별 수량 집계 + 정보 부재 수
  const breakerCapacitySummary = useMemo(() => {
    const capacityMap: Record<string, number> = {};
    let missingCount = 0;
    inspections.forEach(ins => {
      const cap = ins.breakerCapacity?.trim();
      if (cap) {
        capacityMap[cap] = (capacityMap[cap] || 0) + 1;
      } else {
        missingCount++;
      }
    });
    const items = Object.entries(capacityMap)
      .map(([capacity, count]) => ({ capacity, count }))
      .sort((a, b) => parseFloat(a.capacity) - parseFloat(b.capacity));
    return { items, missingCount };
  }, [inspections]);

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="space-y-4 md:space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-800 mb-2">Dashboard Overview</h1>
          <p className="text-sm md:text-base text-slate-600">Safety inspection status and statistics</p>
        </div>

        {/* Floor Plan View - Dashboard 모드 (읽기 전용, 클릭 시 InspectionDetail Modal) */}
        <FloorPlanView
          inspections={inspections}
          onUpdateInspections={onUpdateInspections}
          selectedInspectionId={selectedInspectionId}
          onSelectionChange={onSelectionChange}
          mode="dashboard"
          readOnly={true}
          onShowInspectionModal={handleShowInspectionModal}
          floorPlanUrls={floorPlanUrls}
        />

        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-3 md:gap-4">
          <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-blue-100 rounded-lg">
                <Activity size={24} className="text-blue-600" />
              </div>
              <span className="text-2xl font-bold text-slate-800">{totalInspections}</span>
            </div>
            <p className="text-sm text-slate-600 font-medium">Total Inspections</p>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-emerald-100 rounded-lg">
                <CheckCircle2 size={24} className="text-emerald-600" />
              </div>
              <span className="text-2xl font-bold text-slate-800">{completeCount}</span>
            </div>
            <p className="text-sm text-slate-600 font-medium">Completed</p>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-amber-100 rounded-lg">
                <Clock size={24} className="text-amber-600" />
              </div>
              <span className="text-2xl font-bold text-slate-800">{inProgressCount}</span>
            </div>
            <p className="text-sm text-slate-600 font-medium">In Progress</p>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-purple-100 rounded-lg">
                <TrendingUp size={24} className="text-purple-600" />
              </div>
              <span className="text-2xl font-bold text-slate-800">{completionRate}%</span>
            </div>
            <p className="text-sm text-slate-600 font-medium">Completion Rate</p>
          </div>
        </div>

        {/* Charts and Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          {/* Status Chart */}
          <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-slate-200">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">Inspection Status</h3>
            <div className="flex items-center justify-center">
              <div className="w-40 h-40 md:w-48 md:h-48">
                <StatsChart data={stats} />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {stats.map(s => (
                <div key={s.name} className="flex justify-between items-center text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }}></span>
                    <span className="text-slate-600 font-medium">{s.name}</span>
                  </div>
                  <span className="font-bold text-slate-800">{s.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Inspections */}
          <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-slate-200">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">Recent Inspections</h3>
            {recentInspections.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <ShieldCheck size={48} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">No recent inspections</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentInspections.map((inspection) => (
                  <div
                    key={inspection.panelNo}
                    className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {getStatusIcon(inspection.status)}
                      <div>
                        <p className="font-medium text-slate-800">{inspection.panelNo}</p>
                        <p className="text-xs text-slate-500">
                          {inspection.lastInspectionDate !== '-' 
                            ? new Date(inspection.lastInspectionDate).toLocaleDateString()
                            : 'Not inspected'}
                        </p>
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-medium border ${getStatusColor(inspection.status)}`}>
                      {inspection.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 차단기 용량별 현황 - Recent Inspections 아래 배치 */}
        <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-slate-200">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">차단기 용량별 현황</h3>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
            {breakerCapacitySummary.items.map(item => (
              <span key={item.capacity}>{item.capacity}A = {item.count}대</span>
            ))}
            {breakerCapacitySummary.missingCount > 0 && (
              <span>정보 부재 = {breakerCapacitySummary.missingCount}대</span>
            )}
            {breakerCapacitySummary.items.length > 0 && (
              <span className="text-slate-900 font-medium">총 {breakerCapacitySummary.items.reduce((sum, i) => sum + i.count, 0)}대</span>
            )}
          </div>
        </div>

        {/* Pending Inspections Alert */}
        {pendingCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="p-2 bg-amber-100 rounded-lg">
                <AlertCircle size={24} className="text-amber-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-amber-900 mb-1">Pending Inspections</h3>
                <p className="text-sm text-amber-700">
                  {pendingCount} distribution board{pendingCount > 1 ? 's' : ''} require inspection.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* InspectionDetail Modal - Dashboard 위젯 클릭 시 표시 (읽기 전용) */}
      {showInspectionModal && modalInspection && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setShowInspectionModal(false)}
          />
          {/* Modal Content */}
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto z-10">
            {/* Close Button */}
            <button
              onClick={() => setShowInspectionModal(false)}
              className="absolute top-4 right-4 p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors z-20"
              title="닫기"
            >
              <X size={20} />
            </button>
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 z-10">
              <h2 className="text-lg font-semibold text-slate-800">
                패널 상세 정보 - {modalInspection.panelNo}
              </h2>
              <p className="text-sm text-slate-500 mt-1">읽기 전용 모드</p>
            </div>
            {/* Report 양식 표시 */}
            <div className="p-6">
              <iframe
                srcDoc={getReportHtml(modalInspection)}
                className="w-full border border-slate-200 rounded-lg"
                style={{ minHeight: '500px' }}
                title={`Report - ${modalInspection.panelNo}`}
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default DashboardOverview;
