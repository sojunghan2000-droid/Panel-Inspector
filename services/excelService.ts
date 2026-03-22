import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { InspectionRecord, ReportHistory } from '../types';
import { getPhoto, getThermalImage, blobToDataURL } from './indexedDBService';

const REPORTS_STORAGE_KEY = 'safetyguard_reports';
const INSPECTIONS_STORAGE_KEY = 'safetyguard_inspections';

// 포맷 버전 정보
const FORMAT_VERSION = '1.0';
const SUPPORTED_FORMAT_VERSION = '1.0';

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

/**
 * 이미지 URL을 Base64로 변환하는 헬퍼 함수 (ExcelJS용 - 브라우저 환경)
 * ExcelJS는 브라우저에서 base64를 사용하는 것이 더 안전합니다.
 */
const imageUrlToBase64 = async (url: string): Promise<{ base64: string; extension: 'jpeg' | 'png' | 'gif' } | null> => {
  try {
    let base64String: string;
    let extension: 'jpeg' | 'png' | 'gif' = 'jpeg';

    // Base64 데이터 URL인 경우
    if (url.startsWith('data:image')) {
      base64String = url.split(',')[1];
      const mimeType = url.split(',')[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
      if (mimeType.includes('png')) {
        extension = 'png';
      } else if (mimeType.includes('gif')) {
        extension = 'gif';
      } else {
        extension = 'jpeg';
      }
    } else {
      // 외부 URL인 경우 fetch로 가져오기
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }
      const blob = await response.blob();
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('png')) {
        extension = 'png';
      } else if (contentType.includes('gif')) {
        extension = 'gif';
      } else {
        extension = 'jpeg';
      }

      // Blob을 Base64로 변환
      base64String = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          // data:image/jpeg;base64, 부분 제거
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    return { base64: base64String, extension };
  } catch (error) {
    console.error('이미지 변환 오류:', error);
    return null;
  }
};

/**
 * 엑셀 내보내기 함수
 * 스펙 버전 1.0에 맞춰 엑셀 파일을 생성합니다.
 * 
 * @param inspections 검사 기록 배열
 * @param reportsFromProps 보고서 데이터 (옵션)
 * @returns 내보낸 PNL NO 목록 (사진 삭제용)
 */
export const exportToExcel = async (
  inspections: InspectionRecord[],
  reportsFromProps?: ReportHistory[]
): Promise<string[]> => {
  const reports: ReportHistory[] = reportsFromProps ?? JSON.parse(localStorage.getItem(REPORTS_STORAGE_KEY) || '[]');

  // Reports를 ID로 매핑
  const reportMap = new Map<string, ReportHistory>();
  reports.forEach(report => {
    reportMap.set(report.boardId, report);
  });

  // 엑셀 데이터 준비
  const excelData: ExcelExportData[] = inspections.map(inspection => {
    const report = reportMap.get(inspection.panelNo);
    const qrId = inspection.panelNo;
    const qrLocation = inspection.tr || '';
    const qrFloor = inspection.floor || '';
    const qrPosition = inspection.position ? `${inspection.position.x},${inspection.position.y}` : '';

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

  // ExcelJS 워크북 생성
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Panel Inspector';
  workbook.created = new Date();
  workbook.modified = new Date();

  // 0. Meta 시트 생성 (포맷 버전 정보)
  const metaSheet = workbook.addWorksheet('Meta');
  metaSheet.getColumn(1).width = 20;
  metaSheet.getColumn(2).width = 30;
  metaSheet.addRow(['포맷 버전', FORMAT_VERSION]);
  metaSheet.addRow(['지원 포맷 버전', SUPPORTED_FORMAT_VERSION]);
  metaSheet.addRow(['생성일', new Date().toISOString()]);
  metaSheet.addRow(['생성 시간', new Date().toLocaleString('ko-KR')]);

  // 1. Inspection Sheet (검사 현황)
  const inspectionSheet = workbook.addWorksheet('검사 현황');
  inspectionSheet.columns = [
    { header: 'PNL NO.', key: 'id', width: 15 },
    { header: '검사 현황', key: 'status', width: 12 },
    { header: '점검일', key: 'date', width: 18 },
    { header: '용접기', key: 'welder', width: 8 },
    { header: '연삭기', key: 'grinder', width: 8 },
    { header: '조명', key: 'light', width: 8 },
    { header: '펌프', key: 'pump', width: 8 },
    { header: '부하 원인', key: 'loadCause', width: 25 },
    { header: '점검 조치 사항', key: 'memo', width: 30 },
    { header: 'X 좌표 (%)', key: 'positionX', width: 12 },
    { header: 'Y 좌표 (%)', key: 'positionY', width: 12 },
  ];

  // 헤더 스타일 설정
  inspectionSheet.getRow(1).font = { bold: true };
  inspectionSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8F5E9' }
  };

  excelData.forEach(row => {
    inspectionSheet.addRow({
      id: row.id,
      status: row.status,
      date: row.lastInspectionDate,
      welder: row.welder,
      grinder: row.grinder,
      light: row.light,
      pump: row.pump,
      loadCause: row.loadCause,
      memo: row.memo,
      positionX: row.positionX,
      positionY: row.positionY,
    });
  });

  // 2. PNL List Sheet (패널 목록 및 위치 정보)
  const pnlListSheet = workbook.addWorksheet('PNL List');
  pnlListSheet.columns = [
    { header: 'PNL NO.', key: 'id', width: 15 },
    { header: 'TR', key: 'tr', width: 15 },
    { header: '층수', key: 'floor', width: 10 },
    { header: '관리번호 (판넬명)', key: 'managementNumber', width: 20 },
    { header: '공칭 단면적', key: 'nominalCrossSection', width: 15 },
    { header: 'X 좌표 (%)', key: 'positionX', width: 12 },
    { header: 'Y 좌표 (%)', key: 'positionY', width: 12 },
  ];

  pnlListSheet.getRow(1).font = { bold: true };
  pnlListSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8F5E9' }
  };

  inspections.forEach(inspection => {
    const trValue = inspection.tr || '-';
    pnlListSheet.addRow({
      id: inspection.panelNo,
      tr: trValue,
      floor: inspection.floor || '-',
      managementNumber: inspection.managementNumber || inspection.panelNo,
      nominalCrossSection: inspection.nominalCrossSection || '-',
      positionX: inspection.position ? `${inspection.position.x}%` : '-',
      positionY: inspection.position ? `${inspection.position.y}%` : '-',
    });
  });

  // 3. Reports Sheet (모든 검사 포함 - Complete뿐 아니라 모든 상태)
  const reportsSheet = workbook.addWorksheet('Reports');
  reportsSheet.columns = [
    { header: 'PNL NO.', key: 'id', width: 15 },
    { header: 'Report ID', key: 'reportId', width: 25 },
    { header: 'Status', key: 'status', width: 15 },
    { header: '보고서 생성일', key: 'generatedAt', width: 20 },
    { header: '마지막 점검일', key: 'lastInspectionDate', width: 20 },
    { header: '부하 원인', key: 'loadCause', width: 30 },
    { header: '점검 조치 사항', key: 'memo', width: 40 },
    { header: 'HTML Content (Base64)', key: 'htmlContentBase64', width: 50 },
    { header: 'PJT명', key: 'projectName', width: 20 },
    { header: '시공사', key: 'contractor', width: 20 },
    { header: '관리번호', key: 'managementNumber', width: 20 },
    { header: '점검자', key: 'inspectors', width: 30 },
  ];

  reportsSheet.getRow(1).font = { bold: true };
  reportsSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8F5E9' }
  };

  inspections.forEach(inspection => {
    const report = reportMap.get(inspection.panelNo);
    const connectedLoads = [];
    if (inspection.loads.welder) connectedLoads.push('Welder');
    if (inspection.loads.grinder) connectedLoads.push('Grinder');
    if (inspection.loads.light) connectedLoads.push('Light');
    if (inspection.loads.pump) connectedLoads.push('Pump');
    const loadCause = connectedLoads.length > 0 ? connectedLoads.join(', ') : 'None';

    // HTML 콘텐츠를 Base64로 인코딩
    let htmlContentBase64 = '';
    if (report?.htmlContent) {
      try {
        // UTF-8 문자열을 Base64로 인코딩
        htmlContentBase64 = btoa(unescape(encodeURIComponent(report.htmlContent)));
      } catch (error) {
        console.error('HTML 콘텐츠 인코딩 오류:', error);
        htmlContentBase64 = '';
      }
    }

    reportsSheet.addRow({
      id: inspection.panelNo,
      reportId: report ? report.reportId : '-',
      status: inspection.status,
      generatedAt: report ? new Date(report.generatedAt).toLocaleString('ko-KR') : '-',
      lastInspectionDate: inspection.lastInspectionDate !== '-' ? inspection.lastInspectionDate : '-',
      loadCause: loadCause,
      memo: inspection.memo || '-',
      htmlContentBase64: htmlContentBase64,
      projectName: inspection.projectName || '-',
      contractor: inspection.contractor || '-',
      managementNumber: inspection.managementNumber || '-',
      inspectors: (inspection.inspectors || []).join(', ') || '-',
    });
  });

  // 4. Photos 시트 생성 (이미지 삽입)
  const photosSheet = workbook.addWorksheet('Photos');
  photosSheet.columns = [
    { header: 'PNL NO.', key: 'id', width: 15 },
    { header: '사진 종류', key: 'photoType', width: 15 },
    { header: '사진', key: 'photo', width: 30 },
    { header: '사진 존재 여부', key: 'hasPhoto', width: 15 },
  ];

  photosSheet.getRow(1).font = { bold: true };
  photosSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8F5E9' }
  };

  // 이미지 삽입을 위한 행 높이 설정
  photosSheet.getRow(1).height = 20;

  // 열 너비 조정
  photosSheet.getColumn(1).width = 15; // A열: PNL NO.
  photosSheet.getColumn(2).width = 15; // B열: 사진 종류
  photosSheet.getColumn(3).width = 30; // C열: 사진
  photosSheet.getColumn(4).width = 15; // D열: 사진 존재 여부

  // 이미지 추가 (각 PNL NO마다 현장사진과 열화상 이미지 모두 처리)
  let currentRow = 2; // 헤더 다음 행부터 시작 (1-based)

  for (let i = 0; i < inspections.length; i++) {
    const inspection = inspections[i];
    let hasAnyPhoto = false;

    // 1. 현장사진 처리
    // IndexedDB에서 사진 가져오기 시도, 없으면 inspection.photoUrl 사용
    let photoUrl = inspection.photoUrl;
    try {
      const photoBlob = await getPhoto(inspection.panelNo);
      if (photoBlob) {
        photoUrl = await blobToDataURL(photoBlob);
      }
    } catch (error) {
      console.log(`IndexedDB에서 사진 가져오기 실패 (${inspection.panelNo}), photoUrl 사용:`, error);
    }

    if (photoUrl) {
      hasAnyPhoto = true;
      photosSheet.addRow({
        id: inspection.panelNo,
        photoType: '현장사진',
        photo: '',
        hasPhoto: 'Yes',
      });

      try {
        const imageData = await imageUrlToBase64(photoUrl);
        if (imageData) {
          const imageId = workbook.addImage({
            base64: imageData.base64,
            extension: imageData.extension,
          });

          // C열에 이미지 삽입 (셀 범위: C행:D행)
          photosSheet.addImage(imageId, `C${currentRow}:D${currentRow}`);
          photosSheet.getRow(currentRow).height = 120;
        } else {
          photosSheet.getCell(`D${currentRow}`).value = 'No (로드 실패)';
        }
      } catch (error) {
        console.error(`현장사진 삽입 오류 (${inspection.panelNo}):`, error);
        photosSheet.getCell(`D${currentRow}`).value = 'No (오류: ' + (error instanceof Error ? error.message : String(error)) + ')';
      }
      currentRow++;
    }

    // 2. 열화상 이미지 처리
    // IndexedDB에서 열화상 이미지 가져오기 시도, 없으면 inspection.thermalImage.imageUrl 사용
    let thermalImageUrl = inspection.thermalImage?.imageUrl;
    try {
      const thermalImageBlob = await getThermalImage(inspection.panelNo);
      if (thermalImageBlob) {
        thermalImageUrl = await blobToDataURL(thermalImageBlob);
      }
    } catch (error) {
      console.log(`IndexedDB에서 열화상 이미지 가져오기 실패 (${inspection.panelNo}), imageUrl 사용:`, error);
    }

    if (thermalImageUrl) {
      hasAnyPhoto = true;
      photosSheet.addRow({
        id: inspection.panelNo,
        photoType: '열화상 이미지',
        photo: '',
        hasPhoto: 'Yes',
      });

      try {
        const imageData = await imageUrlToBase64(thermalImageUrl);
        if (imageData) {
          const imageId = workbook.addImage({
            base64: imageData.base64,
            extension: imageData.extension,
          });

          // C열에 이미지 삽입 (셀 범위: C행:D행)
          photosSheet.addImage(imageId, `C${currentRow}:D${currentRow}`);
          photosSheet.getRow(currentRow).height = 120;
        } else {
          photosSheet.getCell(`D${currentRow}`).value = 'No (로드 실패)';
        }
      } catch (error) {
        console.error(`열화상 이미지 삽입 오류 (${inspection.panelNo}):`, error);
        photosSheet.getCell(`D${currentRow}`).value = 'No (오류: ' + (error instanceof Error ? error.message : String(error)) + ')';
      }
      currentRow++;
    }

    // 사진이 하나도 없는 경우
    if (!hasAnyPhoto) {
      photosSheet.addRow({
        id: inspection.panelNo,
        photoType: '-',
        photo: '',
        hasPhoto: 'No',
      });
      currentRow++;
    }
  }

  // 파일 다운로드
  const fileName = `분전함_검사현황_v${FORMAT_VERSION}_${new Date().toISOString().split('T')[0]}.xlsx`;
  const buffer = await workbook.xlsx.writeBuffer();
  
  // Electron 환경 확인
  const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;
  
  if (isElectron) {
    // Electron 환경: 파일 다이얼로그 사용
    try {
      const result = await window.electronAPI!.saveExcelFile(
        Array.from(new Uint8Array(buffer)),
        fileName
      );
      
      if (result.success && !result.canceled) {
        console.log('파일 저장 완료:', result.filePath);
      } else if (result.canceled) {
        console.log('파일 저장 취소됨');
        throw new Error('파일 저장이 취소되었습니다.');
      } else {
        throw new Error(result.error || '파일 저장 실패');
      }
    } catch (error) {
      console.error('Electron 파일 저장 오류:', error);
      throw error;
    }
  } else {
    // 웹 환경: Blob 다운로드
    const blob = new Blob([buffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  // 내보낸 PNL NO 목록 반환
  return inspections.map(i => i.panelNo);
};

/**
 * QR 코드 일괄 출력 엑셀 파일 생성
 * 선택된 패널의 qr_data 정보와 QR 코드 이미지를 포함한 별도 파일 생성
 */
export const exportQRBatchToExcel = async (
  items: Array<{ inspection: InspectionRecord; imageDataUrl: string }>
): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Panel Inspector';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('QR 코드 출력');

  // 열 너비 설정
  sheet.getColumn(1).width = 18;  // PNL NO.
  sheet.getColumn(2).width = 22;  // TR
  sheet.getColumn(3).width = 10;  // 층수
  sheet.getColumn(4).width = 22;  // QR 이미지

  // 헤더
  const headerRow = sheet.addRow(['PNL NO.', 'TR', '층수', 'QR 코드']);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 22;

  let currentRow = 2;

  for (const { inspection, imageDataUrl } of items) {
    const pnlNo = inspection.panelNo || '';
    const trNo = inspection.tr || '';
    const floor = inspection.floor || '';

    const row = sheet.addRow([pnlNo, trNo, floor, '']);
    row.alignment = { vertical: 'middle', horizontal: 'center' };
    row.height = 128;

    // A~C 셀 스타일
    row.getCell(1).font = { bold: true, size: 11 };
    row.getCell(2).font = { size: 10 };
    row.getCell(3).font = { size: 10 };

    // QR 이미지 삽입
    if (imageDataUrl && imageDataUrl.startsWith('data:image')) {
      try {
        const base64 = imageDataUrl.split(',')[1];
        const imageId = workbook.addImage({ base64, extension: 'png' });
        // D열에 이미지 삽입 (셀 범위 인덱스는 0-based)
        sheet.addImage(imageId, {
          tl: { col: 3, row: currentRow - 1 },
          br: { col: 4, row: currentRow },
        });
      } catch (e) {
        console.error('QR 이미지 삽입 오류:', e);
      }
    }

    currentRow++;
  }

  // 파일 다운로드
  const today = new Date().toISOString().split('T')[0];
  const fileName = `QR코드_출력_${today}.xlsx`;
  const buffer = await workbook.xlsx.writeBuffer();

  const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;
  if (isElectron) {
    const result = await window.electronAPI!.saveExcelFile(Array.from(new Uint8Array(buffer)), fileName);
    if (!result.success && !result.canceled) throw new Error(result.error || '파일 저장 실패');
  } else {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }
};
