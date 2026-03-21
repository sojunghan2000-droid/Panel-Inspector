import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { InspectionRecord, QRCodeData, ReportHistory } from '../types';
import { getPhoto, getThermalImage, blobToDataURL } from './indexedDBService';

const STORAGE_KEY = 'safetyguard_qrcodes';
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
 * @param qrCodesFromProps QR 코드 데이터 (옵션)
 * @param reportsFromProps 보고서 데이터 (옵션)
 * @returns 내보낸 PNL NO 목록 (사진 삭제용)
 */
export const exportToExcel = async (
  inspections: InspectionRecord[],
  qrCodesFromProps?: QRCodeData[],
  reportsFromProps?: ReportHistory[]
): Promise<string[]> => {
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
          qrPosition = qr.position ? `${qr.position.x},${qr.position.y}` : '';
        }
      } catch (e) {
        qrLocation = qr.location || '';
        qrFloor = qr.floor || '';
        qrPosition = qr.position ? `${qr.position.x},${qr.position.y}` : '';
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
    const trValue = inspection.tr === 'A' ? 'TR-1 900KVA' : inspection.tr === 'B' ? 'TR-2 950KVA' : '-';
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
 * QR 코드 일괄 엑셀 출력 (A4 세로 2열)
 * 각 셀: PNL NO. 라벨 행 + QR 이미지 행
 */
export async function exportQRBatchToExcel(
  items: Array<{ panelNo: string; dataUrl: string; floor?: string; trNo?: string }>
): Promise<void> {
  if (items.length === 0) return;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Panel Inspector';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('QR 코드');

  // A4 세로 2열 페이지 설정
  sheet.pageSetup.paperSize = 9; // A4
  sheet.pageSetup.orientation = 'portrait';
  sheet.pageSetup.margins = {
    left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0, footer: 0,
  };
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = 1;

  // 2열 너비 균등 (A4 절반씩)
  sheet.getColumn(1).width = 26;
  sheet.getColumn(2).width = 26;

  const LABEL_ROW_HEIGHT = 20; // pts
  const QR_ROW_HEIGHT = 128;   // pts (~45mm)
  const COLS = 2;

  for (let i = 0; i < items.length; i++) {
    const { panelNo, dataUrl, floor, trNo } = items[i];
    const col = (i % COLS) + 1;          // 1 or 2
    const groupRow = Math.floor(i / COLS); // 0-based
    const labelRowNum = groupRow * 2 + 1;  // 1, 3, 5, ...
    const qrRowNum = groupRow * 2 + 2;     // 2, 4, 6, ...

    // 라벨 셀 (PNL NO. + 층 + TR)
    const labelCell = sheet.getCell(labelRowNum, col);
    const labelParts = [panelNo];
    if (floor) labelParts.push(floor);
    if (trNo) {
      // "TR-1(A) 900KVA" → "TR-1(A)" 축약 표시
      const shortTr = trNo.split(' ')[0];
      labelParts.push(shortTr);
    }
    labelCell.value = labelParts.join('  ');
    labelCell.alignment = { horizontal: 'center', vertical: 'middle' };
    labelCell.font = { bold: true, size: 10 };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    labelCell.border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };
    sheet.getRow(labelRowNum).height = LABEL_ROW_HEIGHT;

    // QR 이미지 셀
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const imageId = workbook.addImage({ base64, extension: 'png' });
    const colLetter = col === 1 ? 'A' : 'B';
    sheet.addImage(imageId, `${colLetter}${qrRowNum}:${colLetter}${qrRowNum}`);

    // QR 셀 테두리
    const qrCell = sheet.getCell(qrRowNum, col);
    qrCell.border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };
    sheet.getRow(qrRowNum).height = QR_ROW_HEIGHT;
  }

  // 다운로드 (웹 환경)
  const date = new Date().toISOString().split('T')[0];
  const fileName = `QR코드_출력_${date}.xlsx`;
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
