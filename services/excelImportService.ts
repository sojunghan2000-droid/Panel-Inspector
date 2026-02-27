import * as XLSX from 'xlsx';
import { InspectionRecord, BreakerInfo, LoadSummary } from '../types';

/** 파싱된 패널 데이터 (1개 시트 = 1개 패널) */
export interface ParsedPanelData {
  // 헤더 메타
  panelNo: string;
  projectName?: string;
  contractor?: string;
  managementNumber?: string;
  // 차단기 No.1 → 패널 수준 필드
  breakerCapacity?: string;
  currentL1?: number;
  currentL2?: number;
  currentL3?: number;
  // 차단기 No.2~10 → breakers[]
  breakers: BreakerInfo[];
  loadSummary?: LoadSummary;
}

/** 전체 Import 결과 */
export interface ExcelImportResult {
  panels: ParsedPanelData[];
  errors: { sheet: string; error: string }[];
}

/** PNL NO. 정규화: 공백 제거, 앞자리 0 제거 */
export function normalizePanelNo(raw: string): string {
  return String(raw).trim().replace(/\s+/g, '').replace(/^0+/, '') || '0';
}

/** 안전한 숫자 파싱 */
function safeNum(val: unknown): number {
  if (val === null || val === undefined || val === '') return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

/** 안전한 문자열 파싱 */
function safeStr(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

/**
 * 2D 배열에서 특정 라벨이 있는 셀의 오른쪽 값을 찾기
 */
function findCellValue(rows: unknown[][], label: string): string | null {
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (let col = 0; col < row.length; col++) {
      const cellStr = safeStr(row[col]).toLowerCase();
      if (cellStr.includes(label.toLowerCase())) {
        // 오른쪽의 첫 번째 비어있지 않은 셀 반환
        for (let nextCol = col + 1; nextCol < row.length; nextCol++) {
          const val = row[nextCol];
          if (val !== null && val !== undefined && safeStr(val) !== '') {
            return safeStr(val);
          }
        }
        return null;
      }
    }
  }
  return null;
}

/**
 * 단일 시트를 ParsedPanelData로 파싱
 *
 * 엑셀 구조 (reportService.ts:150~233 기반):
 * Row 0: "공사용 가설 분전반" ... "가설 전기 점검"
 * Row 2: "PNL NO." | panelNo
 * Row 3: "PJT명" | projectName
 * Row 4: "시공사" | contractor
 * Row 5: "관리번호 (판넬명)" | managementNumber
 * Row 6: "점검자" | inspectors
 * Row 8: 차단기 헤더 ("차단기 No.", "구분", ...)
 * Row 9: 서브 헤더 ("L1", "L2", "L3", "R", "S", "T", "N")
 * Row 10+: 차단기 데이터 행
 *   Col 0=breakerNo, 1=category, 2=capacity, 3=loadName,
 *   4=type, 5=kind, 6=L1, 7=L2, 8=L3, 9=R, 10=S, 11=T, 12=N
 * 하단: "상별 부하 합계 [AV]" | A | B | C
 *       "총 연결 부하 합계[AV]" | total
 *       "상별 부하 분담 [%]" | A% | B% | C%
 */
function parseSheet(rows: unknown[][]): ParsedPanelData | null {
  // 메타데이터 추출
  const panelNo = findCellValue(rows, 'PNL NO.');
  if (!panelNo) return null;

  const projectName = findCellValue(rows, 'PJT명') || undefined;
  const contractor = findCellValue(rows, '시공사') || undefined;
  const managementNumber = findCellValue(rows, '관리번호') || undefined;

  // 차단기 헤더 행 찾기
  let breakerHeaderRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const firstCell = safeStr(row[0]).toLowerCase();
    if (firstCell.includes('차단기 no') || firstCell.includes('차단기 no.')) {
      breakerHeaderRow = i;
      break;
    }
  }

  const result: ParsedPanelData = {
    panelNo,
    projectName,
    contractor,
    managementNumber,
    breakers: [],
  };

  if (breakerHeaderRow === -1) return result;

  // 서브 헤더 행 확인 (breakerHeaderRow + 1)
  const subHeaderRow = breakerHeaderRow + 1;
  let dataStartRow = subHeaderRow + 1;

  // 서브 헤더 확인: "L1"이 있는지 체크
  if (subHeaderRow < rows.length) {
    const subRow = rows[subHeaderRow];
    if (Array.isArray(subRow)) {
      const hasSubHeader = subRow.some(cell => safeStr(cell).toUpperCase() === 'L1');
      if (!hasSubHeader) {
        dataStartRow = subHeaderRow; // 서브 헤더가 없으면 바로 데이터
      }
    }
  }

  // 차단기 데이터 행 파싱
  let isFirstBreaker = true;
  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    // 빈 행이나 요약 섹션에 도달하면 중지
    const firstCell = safeStr(row[0]);
    if (firstCell === '') {
      // 완전히 빈 행이면 중지
      const hasData = row.some(cell => safeStr(cell) !== '');
      if (!hasData) break;
      // "열화상", "상별 부하" 등 요약 섹션 키워드 체크
      const rowText = row.map(c => safeStr(c)).join(' ').toLowerCase();
      if (rowText.includes('열화상') || rowText.includes('상별 부하')) break;
      continue;
    }
    if (firstCell.includes('열화상') || firstCell.includes('상별 부하')) break;

    // 차단기 No. 값이 숫자가 아니면 건너뜀
    const breakerNo = safeStr(row[0]);
    if (breakerNo === '' || isNaN(Number(breakerNo))) continue;

    if (isFirstBreaker) {
      // 차단기 No.1 → 패널 수준 필드
      result.breakerCapacity = String(safeNum(row[2]) || '');
      result.currentL1 = safeNum(row[6]);
      result.currentL2 = safeNum(row[7]);
      result.currentL3 = safeNum(row[8]);
      isFirstBreaker = false;
    } else {
      // 차단기 No.2~10 → breakers[]
      const breaker: BreakerInfo = {
        breakerNo,
        category: (safeStr(row[1]) as '1차' | '2차') || '2차',
        breakerCapacity: safeNum(row[2]),
        loadName: safeStr(row[3]),
        type: safeStr(row[4]),
        kind: (safeStr(row[5]) as 'MCCB' | 'ELB') || 'MCCB',
        currentL1: safeNum(row[6]),
        currentL2: safeNum(row[7]),
        currentL3: safeNum(row[8]),
        loadCapacityR: safeNum(row[9]),
        loadCapacityS: safeNum(row[10]),
        loadCapacityT: safeNum(row[11]),
        loadCapacityN: safeNum(row[12]),
      };
      result.breakers.push(breaker);
    }
  }

  // 부하 합계 파싱
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const firstCell = safeStr(row[0]).toLowerCase();

    if (firstCell.includes('상별 부하 합계')) {
      if (!result.loadSummary) {
        result.loadSummary = {
          phaseLoadSumA: 0, phaseLoadSumB: 0, phaseLoadSumC: 0,
          totalLoadSum: 0,
          phaseLoadShareA: 0, phaseLoadShareB: 0, phaseLoadShareC: 0,
        };
      }
      result.loadSummary.phaseLoadSumA = safeNum(row[1]);
      result.loadSummary.phaseLoadSumB = safeNum(row[2]);
      result.loadSummary.phaseLoadSumC = safeNum(row[3]);
    } else if (firstCell.includes('총 연결 부하 합계')) {
      if (!result.loadSummary) {
        result.loadSummary = {
          phaseLoadSumA: 0, phaseLoadSumB: 0, phaseLoadSumC: 0,
          totalLoadSum: 0,
          phaseLoadShareA: 0, phaseLoadShareB: 0, phaseLoadShareC: 0,
        };
      }
      result.loadSummary.totalLoadSum = safeNum(row[1]);
    } else if (firstCell.includes('상별 부하 분담')) {
      if (!result.loadSummary) {
        result.loadSummary = {
          phaseLoadSumA: 0, phaseLoadSumB: 0, phaseLoadSumC: 0,
          totalLoadSum: 0,
          phaseLoadShareA: 0, phaseLoadShareB: 0, phaseLoadShareC: 0,
        };
      }
      result.loadSummary.phaseLoadShareA = safeNum(row[1]);
      result.loadSummary.phaseLoadShareB = safeNum(row[2]);
      result.loadSummary.phaseLoadShareC = safeNum(row[3]);
    }
  }

  return result;
}

/**
 * 엑셀 파일 파싱 — 각 시트 = 1개 패널
 */
export function parseInspectionExcel(data: ArrayBuffer): ExcelImportResult {
  const workbook = XLSX.read(data, { type: 'array' });
  const panels: ParsedPanelData[] = [];
  const errors: { sheet: string; error: string }[] = [];

  for (const sheetName of workbook.SheetNames) {
    try {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
      const parsed = parseSheet(rows);
      if (parsed) {
        panels.push(parsed);
      } else {
        errors.push({ sheet: sheetName, error: 'PNL NO.를 찾을 수 없음' });
      }
    } catch (err) {
      errors.push({
        sheet: sheetName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { panels, errors };
}

/**
 * 파싱된 패널 데이터를 기존 InspectionRecord에 비파괴적으로 머지
 *
 * - No.1: breakerCapacity, currentL1/2/3, metadata 덮어씀
 * - No.2~: breakers[] 교체
 * - 기존 position, status, photo, floor, tr 등 유지
 */
export function mergeImportedData(
  parsedPanels: ParsedPanelData[],
  existingInspections: InspectionRecord[]
): {
  mergedInspections: InspectionRecord[];
  stats: { updated: string[]; skipped: string[] };
} {
  const mergedInspections = [...existingInspections];
  const stats = { updated: [] as string[], skipped: [] as string[] };

  // 정규화된 PNL NO. → 인덱스 맵
  const normalizedMap = new Map<string, number>();
  mergedInspections.forEach((ins, idx) => {
    normalizedMap.set(normalizePanelNo(ins.panelNo), idx);
  });

  for (const panel of parsedPanels) {
    const normalizedKey = normalizePanelNo(panel.panelNo);
    const existingIdx = normalizedMap.get(normalizedKey);

    if (existingIdx !== undefined) {
      const existing = mergedInspections[existingIdx];
      mergedInspections[existingIdx] = {
        ...existing,
        // No.1 → 패널 수준 필드
        breakerCapacity: panel.breakerCapacity || existing.breakerCapacity,
        currentL1: panel.currentL1 ?? existing.currentL1,
        currentL2: panel.currentL2 ?? existing.currentL2,
        currentL3: panel.currentL3 ?? existing.currentL3,
        // 메타데이터
        projectName: panel.projectName || existing.projectName,
        contractor: panel.contractor || existing.contractor,
        managementNumber: panel.managementNumber || existing.managementNumber,
        // No.2~ → breakers[]
        breakers: panel.breakers.length > 0 ? panel.breakers : existing.breakers,
        // 부하 합계
        loadSummary: panel.loadSummary || existing.loadSummary,
      };
      stats.updated.push(panel.panelNo);
    } else {
      stats.skipped.push(panel.panelNo);
    }
  }

  return { mergedInspections, stats };
}
