/**
 * Supabase CRUD 서비스
 * - snake_case DB ↔ camelCase TypeScript 변환
 * - 4개 테이블: inspections, qr_codes, floor_plan_images, reports
 * - Storage 헬퍼: panel-photos, floor-plans 버킷
 */

import { supabase } from './supabaseClient';
import type { InspectionRecord, QRCodeData, ReportHistory, InspectionHistoryEntry } from '../types';

// ─────────────────────────────────────────
// InspectionRecord ↔ DB 행 변환
// ─────────────────────────────────────────

// 빈 문자열·undefined·null → null, 숫자 변환 가능하면 number 반환
// numeric DB 컬럼에 빈 문자열을 전달하면 "invalid input syntax for type numeric" 오류 발생 방지
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function inspectionToRow(r: InspectionRecord, photoUrl?: string, thermalUrl?: string): Record<string, unknown> {
  const thermalForDb = r.thermalImage
    ? {
        temperature: r.thermalImage.temperature,
        max_temp: r.thermalImage.maxTemp,
        min_temp: r.thermalImage.minTemp,
        emissivity: r.thermalImage.emissivity,
        measurement_time: r.thermalImage.measurementTime,
        equipment: r.thermalImage.equipment,
        // imageUrl은 별도 컬럼(thermal_image_url)에 저장
      }
    : null;

  return {
    panel_no: r.panelNo,
    status: r.status,
    last_inspection_date: r.lastInspectionDate,
    loads: r.loads,
    photo_url: photoUrl ?? (r.photoUrl?.startsWith('https://') ? r.photoUrl : null),
    thermal_image_url: thermalUrl ?? (r.thermalImage?.imageUrl?.startsWith('https://') ? r.thermalImage.imageUrl : null),
    memo: r.memo,
    position: r.position ?? null,
    inspectors: r.inspectors ?? null,
    project_name: r.projectName ?? null,
    contractor: r.contractor ?? null,
    management_number: r.managementNumber ?? null,
    breakers: r.breakers ?? null,
    current_l1: toNum(r.currentL1),
    current_l2: toNum(r.currentL2),
    current_l3: toNum(r.currentL3),
    tr: r.tr ?? null,
    floor: r.floor ?? null,
    nominal_cross_section: r.nominalCrossSection ?? null,
    breaker_capacity: r.breakerCapacity ?? null,
    parent_panel_no: r.parentPanelNo ?? null,
    notes: r.notes ?? null,
    grounding: r.grounding ?? null,
    thermal_image: thermalForDb,
    load_summary: r.loadSummary ?? null,
    updated_at: r.updatedAt ?? new Date().toISOString(),
    acceptance_rate: toNum(r.acceptanceRate) ?? 100,
  };
}

function rowToInspection(row: Record<string, unknown>): InspectionRecord {
  const thermalRaw = row.thermal_image as Record<string, unknown> | null;
  const thermalImageUrl = (row.thermal_image_url as string | null) ?? null;

  return {
    panelNo: row.panel_no as string,
    status: row.status as InspectionRecord['status'],
    lastInspectionDate: (row.last_inspection_date as string) ?? '-',
    loads: (row.loads as InspectionRecord['loads']) ?? { welder: false, grinder: false, light: false, pump: false },
    photoUrl: (row.photo_url as string | null) ?? null,
    memo: (row.memo as string) ?? '',
    position: (row.position as InspectionRecord['position']) ?? undefined,
    inspectors: (row.inspectors as string[] | null) ?? undefined,
    projectName: (row.project_name as string | null) ?? undefined,
    contractor: (row.contractor as string | null) ?? undefined,
    managementNumber: (row.management_number as string | null) ?? undefined,
    breakers: (row.breakers as InspectionRecord['breakers']) ?? undefined,
    currentL1: (row.current_l1 as number | null) ?? undefined,
    currentL2: (row.current_l2 as number | null) ?? undefined,
    currentL3: (row.current_l3 as number | null) ?? undefined,
    tr: (row.tr as string | null) ?? undefined,
    floor: (row.floor as string | null) ?? undefined,
    nominalCrossSection: (row.nominal_cross_section as string | null) ?? undefined,
    breakerCapacity: (row.breaker_capacity as string | null) ?? undefined,
    parentPanelNo: (row.parent_panel_no as string | null) ?? undefined,
    notes: (row.notes as string | null) ?? undefined,
    grounding: (row.grounding as InspectionRecord['grounding']) ?? undefined,
    thermalImage: thermalRaw
      ? {
          imageUrl: thermalImageUrl,
          temperature: thermalRaw.temperature as number,
          maxTemp: (thermalRaw.max_temp as number) ?? 0,
          minTemp: (thermalRaw.min_temp as number) ?? 0,
          emissivity: (thermalRaw.emissivity as number) ?? 0,
          measurementTime: (thermalRaw.measurement_time as string) ?? '',
          equipment: (thermalRaw.equipment as string) ?? '',
        }
      : (thermalImageUrl ? {
          imageUrl: thermalImageUrl,
          temperature: 0,
          maxTemp: 0,
          minTemp: 0,
          emissivity: 0,
          measurementTime: '',
          equipment: '',
        } : undefined),
    loadSummary: (row.load_summary as InspectionRecord['loadSummary']) ?? undefined,
    updatedAt: (row.updated_at as string) ?? undefined,
    acceptanceRate: (row.acceptance_rate as number) ?? 100,
  };
}

// ─────────────────────────────────────────
// Inspections CRUD
// ─────────────────────────────────────────

export async function upsertInspection(
  r: InspectionRecord,
  photoUrl?: string,
  thermalUrl?: string
): Promise<void> {
  const row = inspectionToRow(r, photoUrl, thermalUrl);
  const { error } = await supabase.from('inspections').upsert(row, { onConflict: 'panel_no' });
  if (error) throw error;
}

export async function upsertInspections(records: InspectionRecord[]): Promise<void> {
  if (records.length === 0) return;
  const rows = records.map(r => inspectionToRow(r));
  const { error } = await supabase.from('inspections').upsert(rows, { onConflict: 'panel_no' });
  if (error) throw error;
}

export async function fetchAllInspections(): Promise<InspectionRecord[]> {
  const { data, error } = await supabase.from('inspections').select('*');
  if (error) throw error;
  return (data as Record<string, unknown>[]).map(rowToInspection);
}

/** 증분 동기화: since 이후 변경된 inspections만 가져오기 */
export async function fetchInspectionsSince(since: string): Promise<InspectionRecord[]> {
  const { data, error } = await supabase.from('inspections').select('*').gt('updated_at', since);
  if (error) throw error;
  return (data as Record<string, unknown>[]).map(rowToInspection);
}

/** 삭제 감지용: 전체 panel_no 목록만 (경량) */
export async function fetchAllInspectionIds(): Promise<string[]> {
  const { data, error } = await supabase.from('inspections').select('panel_no');
  if (error) throw error;
  return (data as Record<string, unknown>[]).map(r => r.panel_no as string);
}

export async function deleteInspectionFromSupabase(panelNo: string): Promise<void> {
  const { error } = await supabase.from('inspections').delete().eq('panel_no', panelNo);
  if (error) throw error;
}

// ─────────────────────────────────────────
// QR Codes CRUD
// ─────────────────────────────────────────

export async function upsertQRCodes(codes: QRCodeData[]): Promise<void> {
  if (codes.length === 0) return;
  const rows = codes.map(c => ({
    id: c.id,
    location: c.location,
    floor: c.floor,
    position: c.position,
    qr_data: c.qrData,
    created_at: c.createdAt,
  }));
  const { error } = await supabase.from('qr_codes').upsert(rows, { onConflict: 'id' });
  if (error) throw error;
}

export async function deleteQRCodeFromSupabase(id: string): Promise<void> {
  const { error } = await supabase.from('qr_codes').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchAllQRCodes(): Promise<QRCodeData[]> {
  const { data, error } = await supabase.from('qr_codes').select('*');
  if (error) throw error;
  return (data as Record<string, unknown>[]).map(row => ({
    id: row.id as string,
    location: row.location as string,
    floor: row.floor as string,
    position: row.position as string,
    qrData: row.qr_data as string,
    createdAt: row.created_at as string,
  }));
}

const rowToQRCode = (row: Record<string, unknown>): QRCodeData => ({
  id: row.id as string,
  location: row.location as string,
  floor: row.floor as string,
  position: row.position as string,
  qrData: row.qr_data as string,
  createdAt: row.created_at as string,
});

/** 증분 동기화: since 이후 변경된 QR codes만 가져오기 */
export async function fetchQRCodesSince(since: string): Promise<QRCodeData[]> {
  const { data, error } = await supabase.from('qr_codes').select('*').gt('updated_at', since);
  if (error) throw error;
  return (data as Record<string, unknown>[]).map(rowToQRCode);
}

/** 삭제 감지용: 전체 QR code ID 목록만 (경량) */
export async function fetchAllQRCodeIds(): Promise<string[]> {
  const { data, error } = await supabase.from('qr_codes').select('id');
  if (error) throw error;
  return (data as Record<string, unknown>[]).map(r => r.id as string);
}

// ─────────────────────────────────────────
// Reports CRUD
// ─────────────────────────────────────────

/**
 * 보고서를 Supabase에 저장
 * - htmlContent 제공 시: Storage에 업로드하고 메타데이터만 DB에 저장
 * - htmlContent 미제공: html_url로 조회한 기존 메타데이터 유지
 * @param r 보고서 객체
 * @param htmlContent HTML 컨텐츠 (제공 시 Storage 업로드)
 */
export async function upsertReport(r: ReportHistory, htmlContent?: string): Promise<void> {
  let htmlUrl: string | null = r.htmlUrl ?? null;
  let htmlSizeBytes: number | null = r.htmlSizeBytes ?? null;
  let migratedToStorage = r.migratedToStorage ?? false;
  let dbHtmlContent: string | null = r.htmlContent ?? null;

  // 새로운 htmlContent 제공: Storage에 업로드
  if (htmlContent && htmlContent.length > 0) {
    try {
      const htmlBlob = new Blob([htmlContent], { type: 'text/html; charset=utf-8' });
      htmlSizeBytes = htmlBlob.size;

      // Storage 경로: {boardId}/{reportId}.html
      const storagePath = `${r.boardId}/${r.reportId}.html`;
      htmlUrl = await uploadBlob('reports', storagePath, htmlBlob);
      migratedToStorage = true;

      // Storage 업로드 성공 시: DB html_content는 빈 문자열 (NOT NULL 제약 대응)
      dbHtmlContent = '';

      console.log(`[upsertReport] HTML → Storage 업로드 완료: ${storagePath} (${htmlSizeBytes} bytes)`);
    } catch (uploadError) {
      console.error('[upsertReport] Storage 업로드 실패, DB에 폴백:', uploadError);
      // 업로드 실패: 기존 htmlContent를 DB에 저장 (폴백)
      dbHtmlContent = htmlContent;
      migratedToStorage = false;
    }
  }

  const { error } = await supabase.from('reports').upsert({
    id: r.id,
    report_id: r.reportId,
    board_id: r.boardId,
    generated_at: r.generatedAt,
    status: r.status,
    html_content: dbHtmlContent,
    html_url: htmlUrl,
    html_size_bytes: htmlSizeBytes,
    migrated_to_storage: migratedToStorage,
    is_generated: r.isGenerated ?? false,
    inspection_group_id: r.inspectionGroupId ?? null,
  }, { onConflict: 'id' });
  if (error) throw error;
}

export async function fetchAllReports(): Promise<ReportHistory[]> {
  // 최적화: html_content 제외한 메타데이터만 조회 (네트워크 데이터 95% 절감)
  const { data, error } = await supabase
    .from('reports')
    .select('id,report_id,board_id,status,is_generated,html_url,html_size_bytes,migrated_to_storage,generated_at,inspection_group_id')
    .order('generated_at', { ascending: false });
  if (error) throw error;
  return (data as Record<string, unknown>[]).map(reportRowToMeta);
}

const reportRowToMeta = (row: Record<string, unknown>): ReportHistory => ({
  id: row.id as string,
  reportId: row.report_id as string,
  boardId: row.board_id as string,
  generatedAt: row.generated_at as string,
  status: row.status as ReportHistory['status'],
  htmlContent: '',
  isGenerated: row.is_generated as boolean,
  htmlUrl: (row.html_url as string) ?? undefined,
  htmlSizeBytes: (row.html_size_bytes as number) ?? undefined,
  migratedToStorage: (row.migrated_to_storage as boolean) ?? false,
  inspectionGroupId: (row.inspection_group_id as string) ?? undefined,
});

/** 증분 동기화: since 이후 변경된 reports 메타데이터만 가져오기 */
export async function fetchReportsSince(since: string): Promise<ReportHistory[]> {
  const { data, error } = await supabase
    .from('reports')
    .select('id,report_id,board_id,status,is_generated,html_url,html_size_bytes,migrated_to_storage,generated_at,inspection_group_id')
    .gt('updated_at', since)
    .order('generated_at', { ascending: false });
  if (error) throw error;
  return (data as Record<string, unknown>[]).map(reportRowToMeta);
}

/** 삭제 감지용: 전체 report ID 목록만 (경량) */
export async function fetchAllReportIds(): Promise<string[]> {
  const { data, error } = await supabase.from('reports').select('id');
  if (error) throw error;
  return (data as Record<string, unknown>[]).map(r => r.id as string);
}

/**
 * 보고서의 전체 HTML 컨텐츠 조회 (Storage/DB fallback 로직)
 * - html_url 존재: Storage에서 fetch (마이그레이션됨)
 * - html_url 없음: DB의 html_content 사용 (기존 보고서, 업로드 실패)
 * @param reportId 보고서 ID
 * @returns HTML 컨텐츠 문자열
 */
export async function fetchReportHtml(reportId: string): Promise<string> {
  // Step 1: html_url과 html_content 조회
  const { data: reportRow, error: fetchError } = await supabase
    .from('reports')
    .select('html_url,html_content')
    .eq('id', reportId)
    .single();

  if (fetchError) throw new Error(`[fetchReportHtml] DB 조회 실패: ${fetchError.message}`);
  if (!reportRow) throw new Error(`[fetchReportHtml] 보고서를 찾을 수 없음: ${reportId}`);

  // Step 2: Storage 우선 (html_url 존재) — SDK download 사용 (버킷 공개 여부 무관)
  if (reportRow.html_url) {
    try {
      // URL에서 스토리지 경로 추출: .../object/public/reports/{path} 또는 .../object/sign/reports/{path}
      const urlStr = reportRow.html_url as string;
      const match = urlStr.match(/\/object\/(?:public|sign)\/reports\/(.+)/);
      const storagePath = match ? match[1].split('?')[0] : null;

      if (storagePath) {
        const { data, error: dlError } = await supabase.storage.from('reports').download(storagePath);
        if (!dlError && data) {
          const htmlText = await data.text();
          console.log(`[fetchReportHtml] Storage SDK 로드 성공: ${storagePath}`);
          return htmlText;
        }
        console.warn('[fetchReportHtml] Storage SDK 실패:', dlError?.message);
      }
    } catch (storageError) {
      console.warn('[fetchReportHtml] Storage 로드 실패, DB 폴백:', storageError);
    }
  }

  // Step 3: DB 폴백 (html_content)
  const htmlContent = reportRow.html_content as string;
  if (!htmlContent) {
    throw new Error(`[fetchReportHtml] HTML 컨텐츠 없음: ${reportId}`);
  }
  console.log('[fetchReportHtml] DB에서 로드');
  return htmlContent;
}

// ─────────────────────────────────────────
// Floor Plan URLs
// ─────────────────────────────────────────

export async function upsertFloorPlanUrl(floor: string, url: string): Promise<void> {
  const { error } = await supabase.from('floor_plan_images').upsert(
    { floor, storage_url: url },
    { onConflict: 'floor' }
  );
  if (error) throw error;
}

export async function fetchAllFloorPlanUrls(): Promise<{ floor: string; url: string }[]> {
  const { data, error } = await supabase.from('floor_plan_images').select('floor, storage_url');
  if (error) throw error;
  return (data as Record<string, unknown>[]).map(row => ({
    floor: row.floor as string,
    url: row.storage_url as string,
  }));
}

// ─────────────────────────────────────────
// Storage 헬퍼
// ─────────────────────────────────────────

/**
 * 보고서를 Supabase DB + Storage에서 삭제
 * - reports 테이블 행 삭제
 * - html_url이 있으면 Storage 파일도 삭제 (best-effort)
 */
export async function deleteReport(reportId: string): Promise<void> {
  // 1. html_url 조회 (Storage 파일 삭제용)
  const { data: row } = await supabase
    .from('reports')
    .select('html_url')
    .eq('id', reportId)
    .single();

  // 2. DB 행 삭제
  const { error } = await supabase.from('reports').delete().eq('id', reportId);
  if (error) throw error;

  // 3. Storage 파일 삭제 (실패해도 무시 — orphan 파일 허용)
  if (row?.html_url) {
    try {
      const urlStr = row.html_url as string;
      const match = urlStr.match(/\/object\/(?:public|sign)\/reports\/(.+)/);
      const storagePath = match ? match[1].split('?')[0] : null;
      if (storagePath) {
        await supabase.storage.from('reports').remove([storagePath]);
      }
    } catch {
      // Storage 삭제 실패는 무시
    }
  }
}

// ─────────────────────────────────────────
// InspectionHistory CRUD
// ─────────────────────────────────────────

export async function upsertInspectionHistory(entry: InspectionHistoryEntry): Promise<void> {
  const { error } = await supabase.from('inspection_history').upsert({
    id: entry.id,
    group_id: entry.groupId,
    created_at: entry.createdAt,
    locked: entry.locked ?? false,
    stats: entry.stats,
  });
  if (error) throw error;
}

export async function fetchAllInspectionHistory(): Promise<InspectionHistoryEntry[]> {
  const { data, error } = await supabase
    .from('inspection_history')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    groupId: row.group_id as string,
    createdAt: row.created_at as string,
    locked: (row.locked as boolean) ?? false,
    stats: row.stats as InspectionHistoryEntry['stats'],
  }));
}

export async function deleteInspectionHistoryFromSupabase(id: string): Promise<void> {
  const { error } = await supabase.from('inspection_history').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Blob을 Supabase Storage에 업로드하고 공개 URL 반환
 */
export async function uploadBlob(bucket: string, path: string, blob: Blob): Promise<string> {
  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    upsert: true,
    contentType: blob.type || 'image/jpeg',
  });
  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Supabase Storage URL에서 Blob 다운로드
 */
export async function downloadBlobFromUrl(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Storage 다운로드 실패: ${res.status}`);
  return res.blob();
}
