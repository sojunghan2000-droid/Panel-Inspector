import * as XLSX from 'xlsx';
import { InspectionRecord, QRCodeData, ReportHistory } from '../types';

const STORAGE_KEY = 'safetyguard_qrcodes';
const REPORTS_STORAGE_KEY = 'safetyguard_reports';

interface ExcelExportData {
  id: string;
  status: string;
  lastInspectionDate: string;
  welder: string;
  grinder: string;
  light: string;
  pump: string;
  memo: string;
  positionX: string;
  positionY: string;
  qrLocation: string;
  qrFloor: string;
  qrPosition: string;
  qrId: string;
  reportId: string;
  reportGeneratedAt: string;
  loadCause: string; // 부하 원인
}

export const exportToExcel = (
  inspections: InspectionRecord[],
  qrCodesFromProps?: QRCodeData[],
  reportsFromProps?: ReportHistory[]
) => {
  const savedQRCodes: QRCodeData[] = qrCodesFromProps ?? JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const reports: ReportHistory[] = reportsFromProps ?? JSON.parse(localStorage.getItem(REPORTS_STORAGE_KEY) || '[]');
  
  // Reports를 ID로 매핑
  const reportMap = new Map<string, ReportHistory>();
  reports.forEach(report => {
    reportMap.set(report.boardId, report);
  });
  
  // QR 코드를 ID로 매핑 (QR과 ID는 하나의 객체이므로 ID로 직접 매칭)
  const qrMap = new Map<string, QRCodeData>();
  savedQRCodes.forEach(qr => {
    try {
      const qrData = JSON.parse(qr.qrData);
      if (qrData.id) {
        const matchingInspection = inspections.find(inspection => inspection.panelNo === qrData.id);
        if (matchingInspection) {
          qrMap.set(matchingInspection.panelNo, qr);
        }
      }
    } catch (e) {
      console.error('QR 데이터 파싱 오류:', e);
    }
  });

  // 엑셀 데이터 준비
  const excelData: ExcelExportData[] = inspections.map(inspection => {
    const qr = qrMap.get(inspection.panelNo);
    const report = reportMap.get(inspection.panelNo);
    let qrLocation = '';
    let qrFloor = '';
    let qrPosition = '';
    let qrId = '';

    if (qr) {
      try {
        const qrData = JSON.parse(qr.qrData);
        qrId = qrData.id || inspection.panelNo;
        qrLocation = qrData.location || qr.location || '';
        qrFloor = qrData.floor || qr.floor || '';
        if (typeof qrData.position === 'string') {
          qrPosition = qrData.position;
        } else if (qrData.position && qrData.position.description) {
          qrPosition = qrData.position.description;
        } else {
          qrPosition = qr.position || '';
        }
      } catch (e) {
        qrLocation = qr.location || '';
        qrFloor = qr.floor || '';
        qrPosition = qr.position || '';
        qrId = inspection.panelNo;
      }
    } else {
      qrId = inspection.panelNo;
    }

    // 부하 원인 문자열 생성
    const connectedLoads = [];
    if (inspection.loads.welder) connectedLoads.push('Welder');
    if (inspection.loads.grinder) connectedLoads.push('Grinder');
    if (inspection.loads.light) connectedLoads.push('Light');
    if (inspection.loads.pump) connectedLoads.push('Pump');
    const loadCause = connectedLoads.length > 0 ? connectedLoads.join(', ') : 'None';

    return {
      id: inspection.panelNo,
      status: inspection.status,
      lastInspectionDate: inspection.lastInspectionDate,
      welder: inspection.loads.welder ? 'Yes' : 'No',
      grinder: inspection.loads.grinder ? 'Yes' : 'No',
      light: inspection.loads.light ? 'Yes' : 'No',
      pump: inspection.loads.pump ? 'Yes' : 'No',
      memo: inspection.memo || '',
      positionX: inspection.position ? `${inspection.position.x}%` : '',
      positionY: inspection.position ? `${inspection.position.y}%` : '',
      qrLocation: qrLocation,
      qrFloor: qrFloor,
      qrPosition: qrPosition,
      qrId: qrId,
      reportId: report ? report.reportId : '',
      reportGeneratedAt: report ? new Date(report.generatedAt).toLocaleString('ko-KR') : '',
      loadCause: loadCause, // 부하 원인 추가
    };
  });

  // 워크북 생성
  const wb = XLSX.utils.book_new();

  // 1. Inspection Sheet (검사 현황)
  const inspectionSheetData = [
    ['PNL NO.', '검사 현황', '점검일', '용접기', '연삭기', '조명', '펌프', '부하 원인', '점검 조치 사항', 'X 좌표 (%)', 'Y 좌표 (%)'],
    ...excelData.map(row => [
      row.id,
      row.status,
      row.lastInspectionDate,
      row.welder,
      row.grinder,
      row.light,
      row.pump,
      row.loadCause,
      row.memo,
      row.positionX,
      row.positionY,
    ])
  ];

  const inspectionWs = XLSX.utils.aoa_to_sheet(inspectionSheetData);
  
  // 열 너비 설정
  inspectionWs['!cols'] = [
    { wch: 15 }, // ID
    { wch: 12 }, // 검사 현황
    { wch: 18 }, // 점검일
    { wch: 8 },  // 용접기
    { wch: 8 },  // 연삭기
    { wch: 8 },  // 조명
    { wch: 8 },  // 펌프
    { wch: 25 }, // 부하 원인
    { wch: 30 }, // 조치 사항
    { wch: 12 }, // X 좌표
    { wch: 12 }, // Y 좌표
  ];

  XLSX.utils.book_append_sheet(wb, inspectionWs, '검사 현황');

  // 2. QR List Sheet (위치 정보 및 QR)
  const qrListSheetData = [
    ['PNL NO.', 'QR ID', 'X 좌표 (%)', 'Y 좌표 (%)', 'QR 위치', 'QR 층수', 'QR 위치 정보'],
    ...excelData.map(row => [
      row.id,
      row.qrId || row.id,
      row.positionX,
      row.positionY,
      row.qrLocation || '-',
      row.qrFloor || '-',
      row.qrPosition || '-',
    ])
  ];

  const qrListWs = XLSX.utils.aoa_to_sheet(qrListSheetData);
  
  // 열 너비 설정
  qrListWs['!cols'] = [
    { wch: 15 }, // 분전함 ID
    { wch: 15 }, // QR ID
    { wch: 12 }, // X 좌표
    { wch: 12 }, // Y 좌표
    { wch: 15 }, // QR 위치
    { wch: 10 }, // QR 층수
    { wch: 20 }, // QR 위치 정보
  ];

  XLSX.utils.book_append_sheet(wb, qrListWs, 'QR List');

  // 3. Reports Sheet (완료된 검사만 포함)
  const completeInspections = inspections.filter(i => i.status === 'Complete');
  const reportsSheetData = [
    ['PNL NO.', 'Report ID', '보고서 생성일', '마지막 점검일', '부하 원인', '점검 조치 사항'],
    ...completeInspections.map(inspection => {
      const report = reportMap.get(inspection.panelNo);
      const connectedLoads = [];
      if (inspection.loads.welder) connectedLoads.push('Welder');
      if (inspection.loads.grinder) connectedLoads.push('Grinder');
      if (inspection.loads.light) connectedLoads.push('Light');
      if (inspection.loads.pump) connectedLoads.push('Pump');
      const loadCause = connectedLoads.length > 0 ? connectedLoads.join(', ') : 'None';
      
      return [
        inspection.panelNo,
        report ? report.reportId : '-',
        report ? new Date(report.generatedAt).toLocaleString('ko-KR') : '-',
        inspection.lastInspectionDate !== '-' ? inspection.lastInspectionDate : '-',
        loadCause,
        inspection.memo || '-',
      ];
    })
  ];

  const reportsWs = XLSX.utils.aoa_to_sheet(reportsSheetData);
  
  // 열 너비 설정
  reportsWs['!cols'] = [
    { wch: 15 }, // 분전함 ID
    { wch: 25 }, // Report ID
    { wch: 20 }, // 보고서 생성일
    { wch: 20 }, // 마지막 점검일
    { wch: 30 }, // 부하 원인
    { wch: 40 }, // 점검 조치 사항
  ];

  XLSX.utils.book_append_sheet(wb, reportsWs, 'Reports');

  // 파일 다운로드
  const fileName = `분전함_검사현황_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, fileName);
};
