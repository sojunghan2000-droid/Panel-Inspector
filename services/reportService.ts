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
// 레이아웃: A-D(판넬정보 수직병합) | E-J(차단기정보) | K-M(전류L1/L2/L3) | N-Q(부하용량R/S/T/N) | R-S(열화상 수직병합) | T-V(접지/상태/비고)
export const generateExcelReport = async (record: InspectionRecord): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('점검 보고서');

  // 22개 열 너비 설정 (A-V)
  worksheet.columns = [
    { width: 10 },  // A: PNL NO.
    { width: 18 },  // B: PJT명
    { width: 14 },  // C: 시공사
    { width: 16 },  // D: 관리번호
    { width: 10 },  // E: 차단기 No.
    { width: 8 },   // F: 구분
    { width: 10 },  // G: 차단기 용량[A]
    { width: 24 },  // H: 부하명
    { width: 8 },   // I: 형식
    { width: 10 },  // J: 종류
    { width: 8 },   // K: L1 전류
    { width: 8 },   // L: L2 전류
    { width: 8 },   // M: L3 전류
    { width: 10 },  // N: R 부하용량
    { width: 10 },  // O: S 부하용량
    { width: 10 },  // P: T 부하용량
    { width: 10 },  // Q: N 부하용량
    { width: 18 },  // R: 열화상
    { width: 18 },  // S: 열화상(span)
    { width: 14 },  // T: 접지
    { width: 10 },  // U: 상태
    { width: 18 },  // V: 비고
  ];

  const thinBorder = {
    top: { style: 'thin' as const },
    left: { style: 'thin' as const },
    bottom: { style: 'thin' as const },
    right: { style: 'thin' as const }
  };
  const applyBorderToRow = (rowNum: number, colCount: number = 22) => {
    for (let c = 1; c <= colCount; c++) {
      worksheet.getCell(rowNum, c).border = thinBorder;
    }
  };

  const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE3F2FD' } };
  const titleFill  = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE8F5E9' } };

  // ── Row 1: 타이틀 ──────────────────────────────────────────────
  worksheet.addRow(new Array(22).fill(''));
  worksheet.mergeCells('A1:U1');
  worksheet.getCell('A1').value = '공사용 가설 분전반';
  worksheet.getCell('V1').value = '가설 전기 점검';
  const titleRow = worksheet.getRow(1);
  titleRow.height = 26;
  titleRow.font = { bold: true, size: 14 };
  titleRow.fill = titleFill;
  titleRow.alignment = { horizontal: 'center', vertical: 'middle' };
  applyBorderToRow(1);

  // ── Rows 2-3: 헤더 2행 ────────────────────────────────────────
  worksheet.addRow(new Array(22).fill(''));
  worksheet.addRow(new Array(22).fill(''));

  // Row 2 헤더 셀 값
  const hdr2Values: Record<string, string> = {
    A2: 'PNL NO.', B2: 'PJT명', C2: '시공사', D2: '관리번호\n(판넬명)',
    E2: '차단기\nNo.', F2: '구분\n(1차,2차)', G2: '차단기\n용량[A]',
    H2: '부하명\n(고정,이동X)', I2: '형식', J2: '종류\n(MCCB,ELB)',
    K2: '전류 (A)\n(후크메가)', N2: '부하 용량[W]',
    R2: '열화상\n측정', T2: '접지\n(외관)', U2: '상태', V2: '비고'
  };
  Object.entries(hdr2Values).forEach(([addr, val]) => {
    worksheet.getCell(addr).value = val;
  });

  // Row 3 서브헤더 셀 값
  const hdr3Values: Record<string, string> = {
    K3: 'L1', L3: 'L2', M3: 'L3',
    N3: 'R', O3: 'S', P3: 'T', Q3: 'N'
  };
  Object.entries(hdr3Values).forEach(([addr, val]) => {
    worksheet.getCell(addr).value = val;
  });

  // Row 2 병합 (rowspan 2)
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'T', 'U', 'V'].forEach(col => {
    worksheet.mergeCells(`${col}2:${col}3`);
  });
  worksheet.mergeCells('K2:M2'); // 전류 colspan 3
  worksheet.mergeCells('N2:Q2'); // 부하용량 colspan 4
  worksheet.mergeCells('R2:S2'); // 열화상 colspan 2

  [2, 3].forEach(rowNum => {
    const row = worksheet.getRow(rowNum);
    row.font = { bold: true, size: 10 };
    row.fill = headerFill;
    row.height = rowNum === 2 ? 32 : 18;
    row.alignment = { wrapText: true, horizontal: 'center', vertical: 'middle' };
    applyBorderToRow(rowNum);
  });

  // ── 데이터 행 ─────────────────────────────────────────────────
  const breakerList = record.breakers || [];
  const totalBreakerRows = 1 + breakerList.length; // No.0(1차 메인) + 2차 N개
  const dataStartRow = 4;
  const dataEndRow = dataStartRow + totalBreakerRows - 1;

  const statusText  = record.status === 'Complete' ? '양호' : record.status === 'In Progress' ? '점검 중' : '미점검';
  const groundingText = record.grounding || '미점검';

  // No.0: 1차 메인 차단기
  worksheet.addRow([
    record.panelNo || '', record.projectName || '',
    record.contractor || '', record.managementNumber || '',
    '0', '1차',
    Number(record.breakerCapacity) || 0,
    '메인 차단기', '', '',
    record.currentL1 || 0, record.currentL2 || 0, record.currentL3 || 0,
    0, 0, 0, 0,
    '', '',
    groundingText, statusText, ''
  ]);

  // No.1~: 2차 차단기
  breakerList.forEach((breaker, index) => {
    worksheet.addRow([
      record.panelNo || '', record.projectName || '',
      record.contractor || '', record.managementNumber || '',
      (index + 1).toString(), breaker.category || '2차',
      breaker.breakerCapacity || 0,
      breaker.loadName || '', breaker.type || '', breaker.kind || 'MCCB',
      breaker.currentL1 || 0, breaker.currentL2 || 0, breaker.currentL3 || 0,
      breaker.loadCapacityR || 0, breaker.loadCapacityS || 0,
      breaker.loadCapacityT || 0, breaker.loadCapacityN || 0,
      '', '',
      groundingText, statusText, ''
    ]);
  });

  // 판넬 정보(A-D) 및 열화상(R-S), 접지/상태(T-U) 수직 병합
  if (totalBreakerRows > 1) {
    ['A', 'B', 'C', 'D'].forEach(col => {
      worksheet.mergeCells(`${col}${dataStartRow}:${col}${dataEndRow}`);
    });
    worksheet.mergeCells(`R${dataStartRow}:S${dataEndRow}`);
    ['T', 'U'].forEach(col => {
      worksheet.mergeCells(`${col}${dataStartRow}:${col}${dataEndRow}`);
    });
  } else {
    worksheet.mergeCells(`R${dataStartRow}:S${dataStartRow}`);
  }

  // 데이터 행 스타일
  for (let r = dataStartRow; r <= dataEndRow; r++) {
    const row = worksheet.getRow(r);
    row.height = 20;
    row.alignment = { horizontal: 'center', vertical: 'middle' };
    if (r === dataStartRow) {
      row.font = { bold: true };
    }
    applyBorderToRow(r);
  }
  // 병합 셀 정렬 재설정
  ['A', 'B', 'C', 'D', 'R', 'T', 'U'].forEach(col => {
    worksheet.getCell(`${col}${dataStartRow}`).alignment = {
      horizontal: 'center', vertical: 'middle', wrapText: true
    };
  });

  // ── Summary 행 ────────────────────────────────────────────────
  const blankRowNum = dataEndRow + 1;
  worksheet.addRow(new Array(22).fill(''));
  worksheet.getRow(blankRowNum).height = 6;

  const summaryStart = dataEndRow + 2;
  const summaryLabels = [
    '각 R/S/T 상별 부하 합계 [AV]',
    '총 연결 부하 합계[AV]',
    '상별 부하 분담 [%]',
    '단상 A',
    '3상 B',
    '수용율(%)',
    '수용부하(VA)',
    '전류(A)'
  ];
  summaryLabels.forEach(() => {
    worksheet.addRow(new Array(22).fill(''));
  });

  const r0 = summaryStart;
  const r1 = summaryStart + 1;
  const r2 = summaryStart + 2;
  const r3 = summaryStart + 3;
  const r4 = summaryStart + 4;
  const r5 = summaryStart + 5;
  const r6 = summaryStart + 6;
  const r7 = summaryStart + 7;

  const applySummaryLabelStyle = (rowNum: number, label: string) => {
    worksheet.getCell(rowNum, 1).value = label;
    const row = worksheet.getRow(rowNum);
    row.font = { bold: true };
    row.height = 20;
    worksheet.mergeCells(`A${rowNum}:M${rowNum}`);
    worksheet.getCell(`A${rowNum}`).alignment = { horizontal: 'left', vertical: 'middle' };
    applyBorderToRow(rowNum);
  };

  // r0: 각 R/S/T 상별 부하 합계 [AV] — 값: N(R합계), O(S합계), P(T합계)
  applySummaryLabelStyle(r0, summaryLabels[0]);
  worksheet.mergeCells(`Q${r0}:V${r0}`);
  ['N', 'O', 'P'].forEach(col => {
    const cell = worksheet.getCell(`${col}${r0}`);
    cell.value = { formula: `SUM(${col}${dataStartRow}:${col}${dataEndRow})`, result: 0 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // r1: 총 연결 부하 합계
  applySummaryLabelStyle(r1, summaryLabels[1]);
  worksheet.mergeCells(`N${r1}:V${r1}`);
  worksheet.getCell(`N${r1}`).value = { formula: `N${r0}+O${r0}+P${r0}`, result: 0 };
  worksheet.getCell(`N${r1}`).alignment = { horizontal: 'center', vertical: 'middle' };

  // r2: 상별 부하 분담 [%]
  applySummaryLabelStyle(r2, summaryLabels[2]);
  worksheet.mergeCells(`Q${r2}:V${r2}`);
  ['N', 'O', 'P'].forEach(col => {
    const cell = worksheet.getCell(`${col}${r2}`);
    cell.value = { formula: `IF(N${r1}=0,0,${col}${r0}/N${r1})`, result: 0 };
    cell.numFmt = '0.0%';
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // r3: 단상 A (형식 I열 = "2P")
  applySummaryLabelStyle(r3, summaryLabels[3]);
  worksheet.mergeCells(`N${r3}:V${r3}`);
  worksheet.getCell(`N${r3}`).value = {
    formula: `(SUMIF(I${dataStartRow}:I${dataEndRow},"2P",N${dataStartRow}:N${dataEndRow})+SUMIF(I${dataStartRow}:I${dataEndRow},"2P",O${dataStartRow}:O${dataEndRow})+SUMIF(I${dataStartRow}:I${dataEndRow},"2P",P${dataStartRow}:P${dataEndRow}))/(1.732*380*0.9)`,
    result: 0
  };
  worksheet.getCell(`N${r3}`).alignment = { horizontal: 'center', vertical: 'middle' };

  // r4: 3상 B (형식 "3P" 또는 "4P")
  applySummaryLabelStyle(r4, summaryLabels[4]);
  worksheet.mergeCells(`N${r4}:V${r4}`);
  worksheet.getCell(`N${r4}`).value = {
    formula: `(SUMIF(I${dataStartRow}:I${dataEndRow},"3P",N${dataStartRow}:N${dataEndRow})+SUMIF(I${dataStartRow}:I${dataEndRow},"4P",N${dataStartRow}:N${dataEndRow})+SUMIF(I${dataStartRow}:I${dataEndRow},"3P",O${dataStartRow}:O${dataEndRow})+SUMIF(I${dataStartRow}:I${dataEndRow},"4P",O${dataStartRow}:O${dataEndRow})+SUMIF(I${dataStartRow}:I${dataEndRow},"3P",P${dataStartRow}:P${dataEndRow})+SUMIF(I${dataStartRow}:I${dataEndRow},"4P",P${dataStartRow}:P${dataEndRow}))/(1.732*380*0.9)`,
    result: 0
  };
  worksheet.getCell(`N${r4}`).alignment = { horizontal: 'center', vertical: 'middle' };

  // r5: 수용율(%) — 기본 100%, 직접 수정 가능
  applySummaryLabelStyle(r5, summaryLabels[5]);
  worksheet.mergeCells(`N${r5}:V${r5}`);
  worksheet.getCell(`N${r5}`).value = 100;
  worksheet.getCell(`N${r5}`).alignment = { horizontal: 'center', vertical: 'middle' };

  // r6: 수용부하(VA) — G열(차단기용량) × 수용율
  applySummaryLabelStyle(r6, summaryLabels[6]);
  worksheet.mergeCells(`N${r6}:V${r6}`);
  worksheet.getCell(`N${r6}`).value = { formula: `G${dataStartRow}*N${r5}/100`, result: 0 };
  worksheet.getCell(`N${r6}`).alignment = { horizontal: 'center', vertical: 'middle' };

  // r7: 전류(A) — K/L/M열(L1/L2/L3) MAX
  applySummaryLabelStyle(r7, summaryLabels[7]);
  worksheet.mergeCells(`N${r7}:V${r7}`);
  worksheet.getCell(`N${r7}`).value = {
    formula: `MAX(K${dataStartRow},L${dataStartRow},M${dataStartRow})`,
    result: 0
  };
  worksheet.getCell(`N${r7}`).alignment = { horizontal: 'center', vertical: 'middle' };

  // ── 열화상 이미지 삽입 (R:S 열, 데이터 전체 행 span) ──────────
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
        // R:S 열에 데이터 행 전체 span으로 삽입
        worksheet.addImage(imageId, `R${dataStartRow}:S${dataEndRow}`);
        // 이미지 영역 행 높이 설정 (최소 80px 확보)
        const perRowHeight = Math.max(80 / totalBreakerRows, 20);
        for (let r = dataStartRow; r <= dataEndRow; r++) {
          worksheet.getRow(r).height = perRowHeight;
        }
      } else {
        console.error('이미지 데이터 변환 실패');
      }
    } catch (error) {
      console.error('열화상 이미지 삽입 오류:', error);
    }
  } else {
    console.log('열화상 이미지 없음:', record.panelNo);
  }

  // ── 파일 다운로드 ─────────────────────────────────────────────
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
