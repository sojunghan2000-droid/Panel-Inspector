/**
 * Supabase CRUD 서비스
 * - snake_case DB ↔ camelCase TypeScript 변환
 * - 4개 테이블: inspections, qr_codes, floor_plan_images, reports
 * - Storage 헬퍼: panel-photos, floor-plans 버킷
 */

import { supabase } from './supabaseClient';
import type { InspectionRecord, QRCodeData, ReportHistory } from '../types';

// ─────────────────────────────────────────
// InspectionRecord ↔ DB 행 변환
// ─────────────────────────────────────────

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
    current_l1: r.currentL1 ?? null,
    current_l2: r.currentL2 ?? null,
    current_l3: r.currentL3 ?? null,
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

// ─────────────────────────────────────────
// Reports CRUD
// ─────────────────────────────────────────

export async function upsertReport(r: ReportHistory): Promise<void> {
  const { error } = await supabase.from('reports').upsert({
    id: r.id,
    report_id: r.reportId,
    board_id: r.boardId,
    generated_at: r.generatedAt,
    status: r.status,
    html_content: r.htmlContent,
    is_generated: r.isGenerated ?? false,
  }, { onConflict: 'id' });
  if (error) throw error;
}

export async function fetchAllReports(): Promise<ReportHistory[]> {
  const { data, error } = await supabase.from('reports').select('*').order('generated_at', { ascending: false });
  if (error) throw error;
  return (data as Record<string, unknown>[]).map(row => ({
    id: row.id as string,
    reportId: row.report_id as string,
    boardId: row.board_id as string,
    generatedAt: row.generated_at as string,
    status: row.status as ReportHistory['status'],
    htmlContent: row.html_content as string,
    isGenerated: row.is_generated as boolean,
  }));
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
