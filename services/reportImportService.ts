/**
 * Reports 엑셀 Import 서비스
 * excelService.ts의 exportToExcel()이 생성하는 "Reports" 시트를 파싱하여
 * ReportHistory[] 객체로 변환한다.
 */
import * as XLSX from 'xlsx';
import { ReportHistory } from '../types';

export interface ReportImportResult {
  reports: ReportHistory[];
  errors: { row: number; error: string }[];
}

/**
 * 한국어 로케일 날짜 문자열을 ISO 문자열로 변환
 * 예: "2026. 1. 30. 오후 12:00:00" → ISO string
 */
function parseKoreanDate(dateStr: string | undefined | null): string {
  if (!dateStr || dateStr === '-' || dateStr === '') {
    return new Date().toISOString();
  }

  const str = String(dateStr).trim();

  // 1) 네이티브 Date 파싱 시도
  const native = new Date(str);
  if (!isNaN(native.getTime())) {
    return native.toISOString();
  }

  // 2) 한국어 형식: "2026. 1. 30. 오후 12:00:00"
  const koMatch = str.match(
    /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)?\s*(\d{1,2}):(\d{2}):?(\d{2})?/
  );
  if (koMatch) {
    const [, year, month, day, ampm, hourStr, min, sec] = koMatch;
    let hour = parseInt(hourStr, 10);
    if (ampm === '오후' && hour < 12) hour += 12;
    if (ampm === '오전' && hour === 12) hour = 0;
    const date = new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      hour,
      parseInt(min, 10),
      parseInt(sec || '0', 10)
    );
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  // 3) Excel 시리얼 넘버 처리 (숫자로 들어올 경우)
  if (typeof dateStr === 'number') {
    // Excel epoch: 1899-12-30
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + (dateStr as number) * 86400000);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  // fallback
  return new Date().toISOString();
}

/**
 * Base64 인코딩된 HTML을 디코딩
 * excelService.ts에서 btoa(unescape(encodeURIComponent(html)))로 인코딩하므로
 * 역순: decodeURIComponent(escape(atob(base64)))
 */
function decodeBase64Html(base64: string | undefined | null): string {
  if (!base64 || base64 === '-' || base64 === '') return '';
  const str = String(base64).trim();
  if (!str) return '';

  try {
    return decodeURIComponent(escape(atob(str)));
  } catch {
    // fallback: 직접 atob만 시도
    try {
      return atob(str);
    } catch {
      console.error('[reportImport] Base64 디코드 실패');
      return '';
    }
  }
}

/**
 * Status 문자열 정규화
 */
function mapStatus(status: string | undefined | null): 'Complete' | 'In Progress' | 'Pending' {
  const s = String(status || '').trim();
  if (s === 'Complete') return 'Complete';
  if (s === 'In Progress') return 'In Progress';
  return 'Pending';
}

/**
 * 엑셀 파일의 "Reports" 시트를 파싱하여 ReportHistory[] 반환
 *
 * 컬럼 매핑 (excelService.ts:279-292 기준):
 *   Col 0: PNL NO.           → boardId
 *   Col 1: Report ID         → reportId
 *   Col 2: Status            → status
 *   Col 3: 보고서 생성일      → generatedAt
 *   Col 4: 마지막 점검일      → skip
 *   Col 5: 부하 원인          → skip
 *   Col 6: 점검 조치 사항     → skip
 *   Col 7: HTML Content (Base64) → htmlContent
 *   Col 8~11: PJT명, 시공사, 관리번호, 점검자 → skip
 */
export function parseReportsExcel(data: ArrayBuffer): ReportImportResult {
  const reports: ReportHistory[] = [];
  const errors: { row: number; error: string }[] = [];

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: 'array' });
  } catch (err) {
    errors.push({ row: 0, error: '엑셀 파일을 읽을 수 없습니다: ' + String(err) });
    return { reports, errors };
  }

  // "Reports" 시트 찾기 (정확한 이름 먼저, 없으면 대소문자 무시)
  let sheetName = workbook.SheetNames.find(n => n === 'Reports');
  if (!sheetName) {
    sheetName = workbook.SheetNames.find(n => n.toLowerCase() === 'reports');
  }
  if (!sheetName) {
    errors.push({ row: 0, error: '"Reports" 시트를 찾을 수 없습니다. 시트 목록: ' + workbook.SheetNames.join(', ') });
    return { reports, errors };
  }

  const sheet = workbook.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rows.length < 2) {
    errors.push({ row: 0, error: '데이터 행이 없습니다 (헤더만 존재)' });
    return { reports, errors };
  }

  // 데이터 행 (row 1+) 처리
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    try {
      const boardId = String(row[0] || '').trim();
      const reportId = String(row[1] || '').trim();
      const statusRaw = String(row[2] || '').trim();
      const generatedAtRaw = row[3];
      const htmlBase64 = String(row[7] || '').trim();

      // 유효성 검증: 필수 필드
      if (!boardId || boardId === '-') {
        continue; // PNL NO. 없는 행 skip (빈 행일 수 있음)
      }
      if (!reportId || reportId === '-') {
        continue; // Report ID 없는 행 skip (보고서 미생성)
      }
      if (!htmlBase64 || htmlBase64 === '-') {
        continue; // HTML 콘텐츠 없는 행 skip
      }

      const htmlContent = decodeBase64Html(htmlBase64);
      if (!htmlContent) {
        errors.push({ row: i + 1, error: `PNL ${boardId}: HTML 콘텐츠 디코딩 실패` });
        continue;
      }

      reports.push({
        id: `report-import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        reportId,
        boardId,
        generatedAt: parseKoreanDate(generatedAtRaw),
        status: mapStatus(statusRaw),
        htmlContent,
        isGenerated: true, // Import된 보고서는 생성된 것으로 취급
      });
    } catch (err) {
      errors.push({ row: i + 1, error: `파싱 오류: ${String(err)}` });
    }
  }

  return { reports, errors };
}
