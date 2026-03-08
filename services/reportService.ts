import { InspectionRecord, ReportHistory } from '../types';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { getThermalImage, blobToDataURL } from './indexedDBService';

const STORAGE_KEY = 'safetyguard_reports';

// Create report object (no storage)
export const createReportFromRecord = (record: InspectionRecord, htmlContent: string): ReportHistory => ({
  id: `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  reportId: `RPT-${record.panelNo}-${new Date().toISOString().split('T')[0]}`,
  boardId: record.panelNo,
  generatedAt: new Date().toISOString(),
  status: record.status,
  htmlContent: htmlContent
});

// Save report to localStorage (legacy; use onReportSaved for in-memory)
const saveReportToStorage = (report: ReportHistory): void => {
  const reports: ReportHistory[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  reports.unshift(report);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
};

// ID에서 "1st"를 "F1"으로 변경하는 함수
const migrateIdFloor = (id: string): string => {
  if (id && typeof id === 'string') {
    if (id.includes('-1st-')) {
      return id.replace(/-1st-/g, '-F1-');
    }
    if (id.startsWith('DB-1st-')) {
      return id.replace(/^DB-1st-/, 'DB-F1-');
    }
  }
  return id;
};

// Reports 데이터 마이그레이션
const migrateReports = (reports: ReportHistory[]): ReportHistory[] => {
  return reports.map(report => {
    const migrated: ReportHistory = { ...report };
    
    if (migrated.boardId) {
      migrated.boardId = migrateIdFloor(migrated.boardId);
    }
    
    if (migrated.reportId && migrated.reportId.includes('1st')) {
      migrated.reportId = migrateIdFloor(migrated.reportId);
    }
    
    if (migrated.htmlContent && migrated.htmlContent.includes('1st')) {
      migrated.htmlContent = migrated.htmlContent.replace(/DB-1st-/g, 'DB-F1-');
    }
    
    return migrated;
  });
};

// Get all saved reports
export const getSavedReports = (): ReportHistory[] => {
  const reports = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const migrated = migrateReports(reports);
  
  if (JSON.stringify(reports) !== JSON.stringify(migrated)) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    } catch (e) {
      console.error('Failed to save migrated reports to localStorage:', e);
    }
  }
  
  return migrated;
};

// Get report by ID
export const getReportById = (id: string): ReportHistory | null => {
  const reports = getSavedReports();
  return reports.find(r => r.id === id) || null;
};

// Delete report (in-memory: pass options; otherwise localStorage)
export const deleteReport = (
  id: string,
  options?: { reports: ReportHistory[]; setReports: (reports: ReportHistory[]) => void }
): void => {
  if (options) {
    const filtered = options.reports.filter(r => r.id !== id);
    options.setReports(filtered);
    return;
  }
  const reports = getSavedReports();
  const filtered = reports.filter(r => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
};

/**
 * 이미지 URL을 Base64로 변환하는 헬퍼 함수 (ExcelJS용 - 브라우저 환경)
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

// Excel 파일 생성 함수 (ExcelJS 사용)
export const generateExcelReport = async (record: InspectionRecord): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('점검 보고서');

  // 기본 정보 행
  const basicInfoRows: any[][] = [
    ['공사용 가설 분전반', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '가설 전기 점검'],
    [],
    ['PNL NO.', record.panelNo, '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['PJT명', record.projectName || '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['시공사', record.contractor || '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['관리번호 (판넬명)', record.managementNumber || '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['점검자', (record.inspectors || []).join(', ') || '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    [],
  ];

  // 차단기 목록: record.breakers[] (정렬 없이 그대로 사용, No.1부터)
  const breakerList = record.breakers || [];

  // 차단기 정보 헤더
  const breakerHeader = [
    '차단기 No.',
    '구분 (1차, 2차)',
    '차단기 용량[A]',
    '부하명 (고정부하, 이동부하X)',
    '형식',
    '종류 (MCCB, ELB)',
    '전류 (A) (후크메가)',
    '',
    '',
    '부하 용량[W]',
    '',
    '',
    '',
    '접지 (외관 점검)',
    '상태',
    '비고'
  ];

  const breakerSubHeader = [
    '', '', '', '', '', '',
    'L1', 'L2', 'L3',
    'R', 'S', 'T', 'N',
    '', '', ''
  ];

  // 차단기 데이터: No.0 = 1차 메인 (최상위 필드), No.1~ = record.breakers[]
  const breakerDataRows: any[][] = [];
  // No.0: 1차 메인 차단기 (record 최상위 필드)
  breakerDataRows.push([
    '0',
    '1차',
    Number(record.breakerCapacity) || 0,
    '메인 차단기',
    '',
    '',
    record.currentL1 || 0,
    record.currentL2 || 0,
    record.currentL3 || 0,
    0, 0, 0, 0,
    record.grounding || '미점검',
    record.status === 'Complete' ? '양호' : record.status === 'In Progress' ? '점검 중' : '미점검',
    ''
  ]);
  // No.1~: record.breakers[]
  breakerList.forEach((breaker, index) => {
    breakerDataRows.push([
      (index + 1).toString(),
      breaker.category || '2차',
      breaker.breakerCapacity || 0,
      breaker.loadName || '',
      breaker.type || '',
      breaker.kind || 'MCCB',
      breaker.currentL1 || 0,
      breaker.currentL2 || 0,
      breaker.currentL3 || 0,
      breaker.loadCapacityR || 0,
      breaker.loadCapacityS || 0,
      breaker.loadCapacityT || 0,
      breaker.loadCapacityN || 0,
      record.grounding || '미점검',
      record.status === 'Complete' ? '양호' : record.status === 'In Progress' ? '점검 중' : '미점검',
      ''
    ]);
  });

  const breakerRows: any[][] = [breakerHeader, breakerSubHeader, ...breakerDataRows];

  // 행 번호 계산 (1-based)
  const basicInfoRowCount = basicInfoRows.length; // = 8
  const firstDataRowNum = basicInfoRowCount + 3;  // header(+1) + subheader(+2) + 1 = 11
  const mainBreakerRowNum = firstDataRowNum;       // No.0 = row 11 (항상 고정)
  const lastDataRowNum = firstDataRowNum + breakerList.length; // 1차(1행) + 2차N행

  // thermalRows는 아래에서 정의되지만 길이는 3 (빈행, 제목, 내용)
  const thermalRowsLength = 3;

  // Summary 행 시작: 마지막 차단기 행 + thermalRows(3) + 빈행(1) + 1(1-based offset)
  const summaryStart = lastDataRowNum + thermalRowsLength + 2;

  // 열화상 측정 섹션 (summary 뒤)
  const thermalRows: any[][] = [
    [],
    ['열화상 측정 (측정기 : ' + (record.thermalImage?.equipment || 'KT-352') + ')', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['점검 내용', '변대/가설분전반 전류 및 발열', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ];

  // Summary 라벨 행 (수식은 addRow 후 worksheet.getCell()로 설정)
  const summaryLabelRows: any[][] = [
    [], // 빈 구분 행
    ['각 R/S/T 상별 부하 합계 [AV]', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['총 연결 부하 합계[AV]', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['상별 부하 분담 [%]', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['단상 A', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['3상 B', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['수용율(%)', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['수용부하(VA)', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['전류(A)', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ];

  // 모든 행 결합
  const allRows = [
    ...basicInfoRows,
    ...breakerRows,
    ...thermalRows,
    ...summaryLabelRows
  ];

  // ExcelJS 워크시트에 데이터 추가
  let thermalImageRow = -1; // 열화상 이미지가 삽입될 행 번호 (1-based)

  allRows.forEach((row, rowIndex) => {
    const worksheetRow = worksheet.addRow(row);
    const rowNumber = rowIndex + 1; // 1-based 행 번호

    // 스타일 설정
    if (rowIndex === 0) {
      // 헤더 행
      worksheetRow.font = { bold: true, size: 14 };
      worksheetRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE8F5E9' }
      };
      worksheet.mergeCells(`A1:O1`); // 공사용 가설 분전반
      worksheet.getCell('P1').value = '가설 전기 점검';
    } else if (rowIndex >= 2 && rowIndex <= 6) {
      // 기본 정보 행 병합
      const colMap = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'];
      worksheet.mergeCells(`${colMap[1]}${rowNumber}:${colMap[15]}${rowNumber}`);
    }

    // No.0 (1차 메인 차단기) 행: 노란색 배경
    const breakerDataStartIndex = basicInfoRowCount + 2; // 0-based index of first data row (No.0)
    if (rowIndex === breakerDataStartIndex) {
      worksheetRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFF00' } // 노란색
      };
      worksheetRow.font = { bold: true };
    }

    // 열화상 섹션의 "점검 내용" 행 찾기
    const thermalSectionStart = basicInfoRows.length + breakerRows.length;
    if (rowIndex === thermalSectionStart + 2) {
      thermalImageRow = rowNumber;
    }
  });

  // 열 너비 설정
  worksheet.columns = [
    { width: 12 }, // A: 차단기 No.
    { width: 12 }, // B: 구분
    { width: 12 }, // C: 차단기 용량
    { width: 30 }, // D: 부하명
    { width: 10 }, // E: 형식
    { width: 12 }, // F: 종류
    { width: 10 }, // G: L1
    { width: 10 }, // H: L2
    { width: 10 }, // I: L3
    { width: 12 }, // J: R
    { width: 12 }, // K: S
    { width: 12 }, // L: T
    { width: 10 }, // M: N
    { width: 15 }, // N: 접지
    { width: 10 }, // O: 상태
    { width: 20 }, // P: 비고
  ];

  // 차단기 헤더 병합
  const breakerHeaderRow = basicInfoRows.length + 1; // 1-based = 9
  worksheet.mergeCells(`G${breakerHeaderRow}:I${breakerHeaderRow}`); // 전류 (A) (후크메가)
  worksheet.mergeCells(`J${breakerHeaderRow}:M${breakerHeaderRow}`); // 부하 용량[W]

  // ── Summary 수식 행 설정 ──────────────────────────────────────────────────
  const yellowFill = {
    type: 'pattern' as const,
    pattern: 'solid' as const,
    fgColor: { argb: 'FFFFFF00' }
  };
  const labelFont = { bold: true };

  // 각 summary 행 번호
  const r0 = summaryStart;       // 각 R/S/T 상별 부하 합계 [AV]
  const r1 = summaryStart + 1;   // 총 연결 부하 합계[AV]
  const r2 = summaryStart + 2;   // 상별 부하 분담 [%]
  const r3 = summaryStart + 3;   // 단상 A
  const r4 = summaryStart + 4;   // 3상 B
  const r5 = summaryStart + 5;   // 수용율(%)
  const r6 = summaryStart + 6;   // 수용부하(VA)
  const r7 = summaryStart + 7;   // 전류(A)

  const applyLabelStyle = (rowNum: number) => {
    const row = worksheet.getRow(rowNum);
    row.fill = yellowFill;
    row.font = labelFont;
    worksheet.mergeCells(`A${rowNum}:I${rowNum}`);
    worksheet.getCell(`A${rowNum}`).alignment = { horizontal: 'left', vertical: 'middle' };
  };

  // ── r0: 각 R/S/T 상별 부하 합계 [AV] ──────────────────────────
  applyLabelStyle(r0);
  worksheet.mergeCells(`M${r0}:P${r0}`); // N,O,P 빈 병합
  worksheet.getCell(`J${r0}`).value = { formula: `SUM(J${firstDataRowNum}:J${lastDataRowNum})`, result: 0 };
  worksheet.getCell(`K${r0}`).value = { formula: `SUM(K${firstDataRowNum}:K${lastDataRowNum})`, result: 0 };
  worksheet.getCell(`L${r0}`).value = { formula: `SUM(L${firstDataRowNum}:L${lastDataRowNum})`, result: 0 };
  ['J', 'K', 'L'].forEach(col => {
    const cell = worksheet.getCell(`${col}${r0}`);
    cell.fill = yellowFill;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // ── r1: 총 연결 부하 합계[AV] ──────────────────────────────────
  applyLabelStyle(r1);
  worksheet.mergeCells(`J${r1}:P${r1}`);
  worksheet.getCell(`J${r1}`).value = { formula: `J${r0}+K${r0}+L${r0}`, result: 0 };
  worksheet.getCell(`J${r1}`).fill = yellowFill;
  worksheet.getCell(`J${r1}`).alignment = { horizontal: 'center', vertical: 'middle' };

  // ── r2: 상별 부하 분담 [%] ─────────────────────────────────────
  applyLabelStyle(r2);
  worksheet.mergeCells(`M${r2}:P${r2}`);
  worksheet.getCell(`J${r2}`).value = { formula: `IF(J${r1}=0,0,J${r0}/J${r1})`, result: 0 };
  worksheet.getCell(`K${r2}`).value = { formula: `IF(J${r1}=0,0,K${r0}/J${r1})`, result: 0 };
  worksheet.getCell(`L${r2}`).value = { formula: `IF(J${r1}=0,0,L${r0}/J${r1})`, result: 0 };
  ['J', 'K', 'L'].forEach(col => {
    const cell = worksheet.getCell(`${col}${r2}`);
    cell.fill = yellowFill;
    cell.numFmt = '0.0%';
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // ── r3: 단상 A (형식 2P) ───────────────────────────────────────
  applyLabelStyle(r3);
  worksheet.mergeCells(`J${r3}:P${r3}`);
  worksheet.getCell(`J${r3}`).value = {
    formula: `(SUMIF(E${firstDataRowNum}:E${lastDataRowNum},"2P",J${firstDataRowNum}:J${lastDataRowNum})+SUMIF(E${firstDataRowNum}:E${lastDataRowNum},"2P",K${firstDataRowNum}:K${lastDataRowNum})+SUMIF(E${firstDataRowNum}:E${lastDataRowNum},"2P",L${firstDataRowNum}:L${lastDataRowNum}))/(1.732*380*0.9)`,
    result: 0
  };
  worksheet.getCell(`J${r3}`).fill = yellowFill;
  worksheet.getCell(`J${r3}`).alignment = { horizontal: 'center', vertical: 'middle' };

  // ── r4: 3상 B (형식 3P 또는 4P) ───────────────────────────────
  applyLabelStyle(r4);
  worksheet.mergeCells(`J${r4}:P${r4}`);
  worksheet.getCell(`J${r4}`).value = {
    formula: `(SUMIF(E${firstDataRowNum}:E${lastDataRowNum},"3P",J${firstDataRowNum}:J${lastDataRowNum})+SUMIF(E${firstDataRowNum}:E${lastDataRowNum},"4P",J${firstDataRowNum}:J${lastDataRowNum})+SUMIF(E${firstDataRowNum}:E${lastDataRowNum},"3P",K${firstDataRowNum}:K${lastDataRowNum})+SUMIF(E${firstDataRowNum}:E${lastDataRowNum},"4P",K${firstDataRowNum}:K${lastDataRowNum})+SUMIF(E${firstDataRowNum}:E${lastDataRowNum},"3P",L${firstDataRowNum}:L${lastDataRowNum})+SUMIF(E${firstDataRowNum}:E${lastDataRowNum},"4P",L${firstDataRowNum}:L${lastDataRowNum}))/(1.732*380*0.9)`,
    result: 0
  };
  worksheet.getCell(`J${r4}`).fill = yellowFill;
  worksheet.getCell(`J${r4}`).alignment = { horizontal: 'center', vertical: 'middle' };

  // ── r5: 수용율(%) ─────────────────────────────────────────────
  applyLabelStyle(r5);
  worksheet.mergeCells(`J${r5}:P${r5}`);
  worksheet.getCell(`J${r5}`).value = 100; // 기본값 100%, 직접 입력 수정 가능
  worksheet.getCell(`J${r5}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD700' } }; // 진한 노란색 (수정 가능 표시)
  worksheet.getCell(`J${r5}`).alignment = { horizontal: 'center', vertical: 'middle' };

  // ── r6: 수용부하(VA) ───────────────────────────────────────────
  applyLabelStyle(r6);
  worksheet.mergeCells(`J${r6}:P${r6}`);
  worksheet.getCell(`J${r6}`).value = {
    formula: `C${mainBreakerRowNum}*J${r5}/100`,
    result: 0
  };
  worksheet.getCell(`J${r6}`).fill = yellowFill;
  worksheet.getCell(`J${r6}`).alignment = { horizontal: 'center', vertical: 'middle' };

  // ── r7: 전류(A) ────────────────────────────────────────────────
  applyLabelStyle(r7);
  worksheet.mergeCells(`J${r7}:P${r7}`);
  worksheet.getCell(`J${r7}`).value = {
    formula: `MAX(G${mainBreakerRowNum},H${mainBreakerRowNum},I${mainBreakerRowNum})`,
    result: 0
  };
  worksheet.getCell(`J${r7}`).fill = yellowFill;
  worksheet.getCell(`J${r7}`).alignment = { horizontal: 'center', vertical: 'middle' };

  // 테두리 적용 (summary 행)
  [r0, r1, r2, r3, r4, r5, r6, r7].forEach(rowNum => {
    const row = worksheet.getRow(rowNum);
    row.eachCell({ includeEmpty: true }, cell => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
  });

  // IndexedDB에서 열화상 이미지 가져오기 (excelService.ts와 동일한 패턴)
  let thermalImageUrl = record.thermalImage?.imageUrl;
  try {
    const thermalImageBlob = await getThermalImage(record.panelNo);
    if (thermalImageBlob) {
      thermalImageUrl = await blobToDataURL(thermalImageBlob);
    }
  } catch (error) {
    console.log('IndexedDB에서 열화상 이미지 가져오기 실패, imageUrl 사용:', error);
  }

  if (thermalImageUrl) {
    try {
      const imageData = await imageUrlToBase64(thermalImageUrl);
      if (imageData) {
        const imageId = workbook.addImage({
          base64: imageData.base64,
          extension: imageData.extension,
        });
        const imgRow = thermalImageRow > 0 ? thermalImageRow : lastDataRowNum + thermalRowsLength;
        worksheet.addImage(imageId, `O${imgRow}:P${imgRow}`);
        worksheet.getRow(imgRow).height = 120;
        worksheet.getColumn(15).width = 25;
      } else {
        console.error('이미지 데이터 변환 실패');
      }
    } catch (error) {
      console.error('열화상 이미지 삽입 오류:', error);
    }
  } else {
    console.log('열화상 이미지 없음:', record.panelNo);
  }

  // 파일 다운로드
  const fileName = `가설전기점검_${record.panelNo}_${new Date().toISOString().split('T')[0]}.xlsx`;
  const buffer = await workbook.xlsx.writeBuffer();
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
};

export const generateReport = (
  record: InspectionRecord,
  onReportSaved?: (report: ReportHistory) => void
): void => {
  // In Progress 상태는 리포트 생성하지 않음
  if (record.status === 'In Progress') {
    return;
  }

  const reportDate = new Date().toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Excel 파일 생성 (async 처리)
  generateExcelReport(record).catch((error) => {
    console.error('Excel 생성 오류:', error);
    alert('Excel 파일 생성 중 오류가 발생했습니다.');
  });

  // HTML Report용 사전 계산 변수
  // 1차 메인 차단기: record 최상위 필드 사용
  const mainCapacity = Number(record.breakerCapacity) || 0;
  const mainCurrent = Math.max(
    record.currentL1 || 0,
    record.currentL2 || 0,
    record.currentL3 || 0
  );
  const acceptedLoad = mainCapacity * (100 / 100); // 기본 수용율 100%

  // 상별 부하 합계: record.breakers[] (2차 차단기)에서만 합산
  const rSum = (record.breakers || []).reduce((s, b) => s + (b.loadCapacityR || 0), 0);
  const sSum = (record.breakers || []).reduce((s, b) => s + (b.loadCapacityS || 0), 0);
  const tSum = (record.breakers || []).reduce((s, b) => s + (b.loadCapacityT || 0), 0);
  const totalSum = rSum + sSum + tSum;

  const rShare = totalSum > 0 ? (rSum / totalSum * 100).toFixed(1) : '0.0';
  const sShare = totalSum > 0 ? (sSum / totalSum * 100).toFixed(1) : '0.0';
  const tShare = totalSum > 0 ? (tSum / totalSum * 100).toFixed(1) : '0.0';

  const singleLoad = (record.breakers || []).filter(b => b.type === '2P')
    .reduce((s, b) => s + (b.loadCapacityR || 0) + (b.loadCapacityS || 0) + (b.loadCapacityT || 0), 0);
  const singlePhaseA = (singleLoad / (1.732 * 380 * 0.9)).toFixed(2);

  const threeLoad = (record.breakers || []).filter(b => b.type === '3P' || b.type === '4P')
    .reduce((s, b) => s + (b.loadCapacityR || 0) + (b.loadCapacityS || 0) + (b.loadCapacityT || 0), 0);
  const threePhaseB = (threeLoad / (1.732 * 380 * 0.9)).toFixed(2);

  // HTML Report 생성 (사진의 엑셀 보고서 형태)
  const htmlContent = `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>가설 전기 점검 보고서 - ${record.panelNo}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Malgun Gothic', '맑은 고딕', Arial, sans-serif;
      background: #f5f5f5;
      padding: 20px;
      color: #000;
    }
    .report-container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      padding: 20px;
    }
    .header-section {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding: 15px;
      background: #e8f5e9;
      border: 2px solid #4caf50;
    }
    .header-left {
      font-size: 18px;
      font-weight: bold;
      color: #2e7d32;
    }
    .header-right {
      font-size: 18px;
      font-weight: bold;
      color: #2e7d32;
    }
    .basic-info {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 15px;
      margin-bottom: 20px;
      padding: 15px;
      background: #f1f8e9;
      border: 1px solid #8bc34a;
    }
    .info-item {
      display: flex;
      flex-direction: column;
    }
    .info-label {
      font-size: 11px;
      font-weight: bold;
      color: #558b2f;
      margin-bottom: 5px;
    }
    .info-value {
      font-size: 14px;
      color: #000;
    }
    .breaker-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 11px;
    }
    .breaker-table th,
    .breaker-table td {
      border: 1px solid #ccc;
      padding: 8px 4px;
      text-align: center;
    }
    .breaker-table th {
      background: #e3f2fd;
      font-weight: bold;
      font-size: 10px;
    }
    .breaker-table .sub-header {
      background: #f5f5f5;
      font-size: 9px;
    }
    .thermal-section {
      margin: 20px 0;
      padding: 15px;
      background: #fff3e0;
      border: 1px solid #ff9800;
    }
    .thermal-title {
      font-weight: bold;
      margin-bottom: 10px;
    }
    .thermal-image {
      max-width: 300px;
      margin-top: 10px;
    }
    .thermal-image img {
      width: 100%;
      height: auto;
      border: 1px solid #ccc;
    }
    .summary-section {
      margin-top: 20px;
      padding: 15px;
      background: #f5f5f5;
      border: 1px solid #9e9e9e;
    }
    .summary-row {
      display: flex;
      gap: 20px;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .summary-label {
      font-weight: bold;
      min-width: 150px;
    }
    @media print {
      body {
        padding: 0;
        background: white;
      }
      .report-container {
        box-shadow: none;
      }
    }
  </style>
</head>
<body>
  <div class="report-container">
    <div class="header-section">
      <div class="header-left">공사용 가설 분전반</div>
      <div class="header-right">가설 전기 점검</div>
    </div>

    <div class="basic-info">
      <div class="info-item">
        <div class="info-label">PNL NO.</div>
        <div class="info-value">${record.panelNo || ''}</div>
      </div>
      <div class="info-item">
        <div class="info-label">PJT명</div>
        <div class="info-value">${record.projectName || ''}</div>
      </div>
      <div class="info-item">
        <div class="info-label">시공사</div>
        <div class="info-value">${record.contractor || ''}</div>
      </div>
      <div class="info-item">
        <div class="info-label">관리번호 (판넬명)</div>
        <div class="info-value">${record.managementNumber || record.id || ''}</div>
      </div>
    </div>

    <div class="basic-info">
      <div class="info-item" style="grid-column: 1 / -1;">
        <div class="info-label">점검자</div>
        <div class="info-value">${(record.inspectors || []).join(', ') || ''}</div>
      </div>
    </div>

    <table class="breaker-table">
      <thead>
        <tr>
          <th rowspan="2">차단기 No.</th>
          <th rowspan="2">구분<br>(1차, 2차)</th>
          <th rowspan="2">차단기<br>용량[A]</th>
          <th rowspan="2">부하명<br>(고정부하, 이동부하X)</th>
          <th rowspan="2">형식</th>
          <th rowspan="2">종류<br>(MCCB, ELB)</th>
          <th colspan="3">전류 (A)<br>(후크메가)</th>
          <th colspan="4">부하 용량[W]</th>
          <th rowspan="2">접지<br>(외관 점검)</th>
          <th rowspan="2">상태</th>
          <th rowspan="2">비고</th>
        </tr>
        <tr class="sub-header">
          <th>L1</th>
          <th>L2</th>
          <th>L3</th>
          <th>R</th>
          <th>S</th>
          <th>T</th>
          <th>N</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>0</td>
          <td>1차</td>
          <td>${record.breakerCapacity || 0}</td>
          <td>메인 차단기</td>
          <td></td>
          <td></td>
          <td>${record.currentL1 || 0}</td>
          <td>${record.currentL2 || 0}</td>
          <td>${record.currentL3 || 0}</td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
          <td>${record.grounding || '미점검'}</td>
          <td>${record.status === 'Complete' ? '양호' : record.status === 'In Progress' ? '점검 중' : '미점검'}</td>
          <td></td>
        </tr>
        ${(record.breakers || []).map((breaker, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${breaker.category || '2차'}</td>
          <td>${breaker.breakerCapacity || 0}</td>
          <td>${breaker.loadName || ''}</td>
          <td>${breaker.type || ''}</td>
          <td>${breaker.kind || 'MCCB'}</td>
          <td>${breaker.currentL1 || 0}</td>
          <td>${breaker.currentL2 || 0}</td>
          <td>${breaker.currentL3 || 0}</td>
          <td>${breaker.loadCapacityR || 0}</td>
          <td>${breaker.loadCapacityS || 0}</td>
          <td>${breaker.loadCapacityT || 0}</td>
          <td>${breaker.loadCapacityN || 0}</td>
          <td>${record.grounding || '미점검'}</td>
          <td>${record.status === 'Complete' ? '양호' : record.status === 'In Progress' ? '점검 중' : '미점검'}</td>
          <td></td>
        </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="summary-section">
      <div class="summary-row">
        <span class="summary-label">각 R/S/T 상별 부하 합계 [AV]</span>
        <span>R: ${rSum}</span>
        <span>S: ${sSum}</span>
        <span>T: ${tSum}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">총 연결 부하 합계[AV]</span>
        <span>${totalSum}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">상별 부하 분담 [%]</span>
        <span>R: ${rShare}%</span>
        <span>S: ${sShare}%</span>
        <span>T: ${tShare}%</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">단상 A</span>
        <span>${singlePhaseA} A</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">3상 B</span>
        <span>${threePhaseB} A</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">수용율(%)</span>
        <span>100</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">수용부하(VA)</span>
        <span>${acceptedLoad}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">전류(A)</span>
        <span>${mainCurrent}</span>
      </div>
    </div>

    <div class="thermal-section">
      <div class="thermal-title">열화상 측정 (측정기 : ${record.thermalImage?.equipment || 'KT-352'})</div>
      <div style="margin-top: 5px; font-size: 11px;">점검 내용 : 변대/가설분전반 전류 및 발열</div>
      ${record.thermalImage?.imageUrl ? `
      <div class="thermal-image">
        <img src="${record.thermalImage.imageUrl}" alt="열화상 이미지" />
        <div style="margin-top: 5px; font-size: 10px;">
          온도: ${record.thermalImage.temperature || 0}°C |
          최대: ${record.thermalImage.maxTemp || 0}°C |
          최소: ${record.thermalImage.minTemp || 0}°C |
          방사율: e=${record.thermalImage.emissivity || 0.95} |
          측정시간: ${record.thermalImage.measurementTime || ''}
        </div>
      </div>
      ` : '<div style="margin-top: 10px; color: #999;">열화상 이미지 없음</div>'}
    </div>

    <div style="margin-top: 30px; padding: 15px; text-align: center; font-size: 11px; color: #666; border-top: 1px solid #ddd;">
      <p>점검일: ${record.lastInspectionDate || ''}</p>
      <p style="margin-top: 5px;">보고서 생성일: ${reportDate}</p>
    </div>
  </div>
</body>
</html>
  `;

  const newReport = createReportFromRecord(record, htmlContent);
  // Generate 버튼으로 생성된 Report는 isGenerated = true
  (newReport as ReportHistory & { isGenerated?: boolean }).isGenerated = true;
  if (onReportSaved) {
    onReportSaved(newReport);
  } else {
    saveReportToStorage(newReport);
  }

  // Open report in new window
  const reportWindow = window.open('', '_blank');
  if (reportWindow) {
    reportWindow.document.write(htmlContent);
    reportWindow.document.close();
  }
};

// View report in new window
export const viewReport = (report: ReportHistory): void => {
  const viewWindow = window.open('', '_blank');
  if (viewWindow) {
    viewWindow.document.write(report.htmlContent);
    viewWindow.document.close();
  }
};

// Export report to Excel (inspections: in-memory list; omit to fallback to localStorage)
export const exportReportToExcel = (report: ReportHistory, inspections?: InspectionRecord[]): void => {
  const list = inspections ?? JSON.parse(localStorage.getItem('safetyguard_inspections') || '[]');
  const record = list.find((i: InspectionRecord) => i.panelNo === report.boardId);
  if (record) {
    generateExcelReport(record).catch((error) => {
      console.error('Excel 생성 오류:', error);
      alert('Excel 파일 생성 중 오류가 발생했습니다.');
    });
  } else {
    alert('해당 분전반 정보를 찾을 수 없습니다.');
  }
};
