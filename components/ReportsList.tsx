import React, { useState, useMemo } from 'react';
import { ReportHistory, InspectionRecord } from '../types';
import { viewReport, exportReportToExcel } from '../services/reportService';
import { FileText, Trash2, Calendar, CheckCircle2, Clock, AlertCircle, Search, Download, Edit2, Printer, ChevronLeft } from 'lucide-react';

interface ReportsListProps {
  reports: ReportHistory[];
  onDeleteReport: (id: string) => void;
  inspections: InspectionRecord[];
  /** Report 수정 버튼 클릭 시 호출 - Inspection 페이지로 이동 */
  onEditReport?: (boardId: string) => void;
}

const ReportsList: React.FC<ReportsListProps> = ({ reports, onDeleteReport, inspections, onEditReport }) => {
  const [selectedReport, setSelectedReport] = useState<ReportHistory | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Natural sort for PNL NO.
  const naturalSort = (a: string, b: string) => {
    const aParts = a.split(/(\d+)/);
    const bParts = b.split(/(\d+)/);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aPart = aParts[i] || '';
      const bPart = bParts[i] || '';
      const aNum = parseInt(aPart, 10);
      const bNum = parseInt(bPart, 10);
      if (!isNaN(aNum) && !isNaN(bNum)) {
        if (aNum !== bNum) return aNum - bNum;
      } else {
        if (aPart !== bPart) return aPart.localeCompare(bPart);
      }
    }
    return 0;
  };

  // 승인된 Report만 필터링 (isGenerated === true) 및 PNL NO. 순 정렬
  const approvedReports = useMemo(() => {
    return reports
      .filter(r => (r as ReportHistory & { isGenerated?: boolean }).isGenerated === true)
      .sort((a, b) => naturalSort(a.boardId, b.boardId));
  }, [reports]);

  // 보고서 출력 핸들러
  const handlePrintAllReports = () => {
    if (approvedReports.length === 0) {
      alert('출력할 승인된 보고서가 없습니다.');
      return;
    }

    // 모든 승인된 보고서의 HTML을 결합
    const combinedHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>가설분전반 점검 보고서 - 전체 출력</title>
        <style>
          @media print {
            .report-page { page-break-after: always; }
            .report-page:last-child { page-break-after: auto; }
          }
          body { font-family: 'Malgun Gothic', sans-serif; margin: 0; padding: 20px; }
          .report-page { margin-bottom: 40px; border: 1px solid #ddd; padding: 20px; }
          .report-header { text-align: center; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #333; }
          .report-title { font-size: 24px; font-weight: bold; }
          .report-meta { color: #666; font-size: 14px; margin-top: 8px; }
        </style>
      </head>
      <body>
        <div class="print-header" style="text-align: center; margin-bottom: 30px;">
          <h1 style="margin: 0; font-size: 28px;">성수동 K-PJT 가설분전반 점검 보고서</h1>
          <p style="color: #666; margin-top: 10px;">총 ${approvedReports.length}개 패널 | 출력일: ${new Date().toLocaleDateString('ko-KR')}</p>
        </div>
        ${approvedReports.map((report, index) => `
          <div class="report-page">
            <div class="report-header">
              <div class="report-title">PNL NO. ${report.boardId}</div>
              <div class="report-meta">${index + 1} / ${approvedReports.length} | ${new Date(report.generatedAt).toLocaleString('ko-KR')}</div>
            </div>
            ${report.htmlContent.replace(/<html[^>]*>|<\/html>|<head[^>]*>[\s\S]*?<\/head>|<body[^>]*>|<\/body>/gi, '')}
          </div>
        `).join('')}
      </body>
      </html>
    `;

    // 새 창에서 출력
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(combinedHtml);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 500);
    }
  };

  // Edit 버튼 클릭 핸들러
  const handleEditReport = (boardId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onEditReport) {
      onEditReport(boardId);
    }
  };

  const handleViewReport = (report: ReportHistory) => {
    viewReport(report);
  };

  const handleExportExcel = (report: ReportHistory, e: React.MouseEvent) => {
    e.stopPropagation();
    exportReportToExcel(report, inspections);
  };

  const handleDeleteReport = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('이 보고서를 삭제하시겠습니까?')) {
      onDeleteReport(id);
      if (selectedReport?.id === id) {
        setSelectedReport(null);
      }
    }
  };

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

  const filteredReports = reports
    .filter(report => report.status !== 'In Progress') // In Progress 상태 리포트 제외
    .filter(report =>
      report.boardId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      report.reportId.toLowerCase().includes(searchTerm.toLowerCase())
    );

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-slate-800">Generated Reports</h2>
          {/* 보고서 출력 버튼 */}
          <button
            onClick={handlePrintAllReports}
            disabled={approvedReports.length === 0}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              approvedReports.length > 0
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
            title={approvedReports.length > 0 ? `${approvedReports.length}개 승인된 보고서 출력` : '승인된 보고서가 없습니다'}
          >
            <Printer size={18} />
            <span>보고서 출력 ({approvedReports.length})</span>
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search by PNL NO. or Report ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-0 overflow-hidden min-h-0">
        {/* Reports List */}
        <div className={`${selectedReport ? 'hidden lg:flex' : 'flex'} lg:col-span-4 flex-col border-r border-slate-200 bg-white overflow-y-auto h-full min-h-0`}>
          {filteredReports.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8">
              <FileText size={48} className="mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">
                {searchTerm ? 'No reports found' : 'No reports generated yet'}
              </p>
              <p className="text-sm text-center">
                {searchTerm 
                  ? 'Try a different search term' 
                  : 'Generate reports from the Dashboard to see them here'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredReports.map((report) => (
                <div
                  key={report.id}
                  onClick={() => setSelectedReport(report)}
                  className={`
                    p-4 cursor-pointer transition-colors hover:bg-slate-50
                    ${selectedReport?.id === report.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}
                  `}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {getStatusIcon(report.status)}
                        <span className="font-semibold text-slate-800">{report.reportId}</span>
                      </div>
                      <p className="text-sm text-slate-600 mb-2">PNL NO.: {report.boardId}</p>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Calendar size={12} />
                        <span>{formatDate(report.generatedAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded text-xs font-medium border ${getStatusColor(report.status)}`}>
                        {report.status}
                      </span>
                      {/* Edit 버튼 - Inspection으로 이동 */}
                      <button
                        onClick={(e) => handleEditReport(report.boardId, e)}
                        className="p-1.5 hover:bg-blue-50 rounded text-slate-400 hover:text-blue-600 transition-colors"
                        title="Inspection에서 수정"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={(e) => handleExportExcel(report, e)}
                        disabled={!(report as ReportHistory & { isGenerated?: boolean }).isGenerated}
                        className={`p-1.5 rounded transition-colors ${
                          (report as ReportHistory & { isGenerated?: boolean }).isGenerated
                            ? 'hover:bg-green-50 text-slate-400 hover:text-green-600'
                            : 'text-slate-300 cursor-not-allowed'
                        }`}
                        title={(report as ReportHistory & { isGenerated?: boolean }).isGenerated ? "Excel로 다운로드" : "Report Generate 필요"}
                      >
                        <Download size={16} />
                      </button>
                      <button
                        onClick={(e) => handleDeleteReport(report.id, e)}
                        className="p-1.5 hover:bg-red-50 rounded text-slate-400 hover:text-red-600 transition-colors"
                        title="Delete report"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Report Preview */}
        <div className={`${selectedReport ? 'flex' : 'hidden lg:flex'} lg:col-span-8 flex-col bg-slate-50 overflow-y-auto h-full min-h-0`}>
          {/* 목록으로 버튼 - 모바일에서만 표시 */}
          <button
            onClick={() => setSelectedReport(null)}
            className="lg:hidden flex items-center gap-2 text-slate-600 hover:text-slate-800 px-4 pt-3 text-sm font-medium"
          >
            <ChevronLeft size={18} />
            목록으로
          </button>
          {selectedReport ? (
            <div className="flex-1 min-h-0">
              {/* HTML 보고서 렌더링 */}
              <iframe
                srcDoc={selectedReport.htmlContent}
                className="w-full h-full border-0"
                title={selectedReport.reportId}
                sandbox="allow-same-origin"
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 p-6">
              <FileText size={48} className="mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">Select a report</p>
              <p className="text-sm text-center">Choose a report from the list to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportsList;
