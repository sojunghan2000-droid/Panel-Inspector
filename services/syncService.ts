/**
 * 동기화 오케스트레이션 서비스
 * - push: IDB → Supabase (fire-and-forget 형태로 사용)
 * - pull: Supabase → IDB (last-write-wins 병합)
 * - 오프라인 큐: localStorage 기반, 네트워크 복귀 시 재시도
 */

import {
  upsertInspection,
  upsertInspections,
  fetchAllInspections,
  upsertQRCodes,
  fetchAllQRCodes,
  upsertReport,
  fetchAllReports,
  uploadBlob,
  deleteQRCodeFromSupabase,
  deleteInspectionFromSupabase,
  upsertFloorPlanUrl,
  fetchAllFloorPlanUrls,
} from './supabaseService';
import { saveInspection, saveQRCode, saveAllQRCodes, saveReport, getAllInspections as getAllInspectionsFromIDB, getFloorPlanImage, saveFloorPlanImage } from './indexedDBService';
import type { InspectionRecord, QRCodeData, ReportHistory } from '../types';

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'offline';

const OFFLINE_QUEUE_KEY = 'panel-inspector-offline-queue';

interface OfflineQueueItem {
  type: 'inspection' | 'qrcodes' | 'report' | 'delete-qr' | 'delete-inspection' | 'floor-plan';
  key: string; // panelNo / qrId / 'all' / reportId / floor('F1'~'F6','B1','B2')
  timestamp: string;
}

// ─────────────────────────────────────────
// 동기화 상태 콜백 관리
// ─────────────────────────────────────────

let _syncStatusCallbacks: ((status: SyncStatus, msg?: string) => void)[] = [];

export function registerSyncStatusCallback(cb: (status: SyncStatus, msg?: string) => void): () => void {
  _syncStatusCallbacks.push(cb);
  return () => {
    _syncStatusCallbacks = _syncStatusCallbacks.filter(c => c !== cb);
  };
}

function notifyStatus(status: SyncStatus, msg?: string) {
  _syncStatusCallbacks.forEach(cb => cb(status, msg));
}

// ─────────────────────────────────────────
// 오프라인 큐
// ─────────────────────────────────────────

function addToOfflineQueue(item: OfflineQueueItem) {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    const queue: OfflineQueueItem[] = raw ? JSON.parse(raw) : [];
    // 같은 type+key 중복 제거 후 추가 (최신 타임스탬프 유지)
    const deduped = queue.filter(q => !(q.type === item.type && q.key === item.key));
    deduped.push(item);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(deduped));
  } catch {
    // localStorage 오류는 무시
  }
}

function clearOfflineQueue() {
  localStorage.removeItem(OFFLINE_QUEUE_KEY);
}

function getOfflineQueue(): OfflineQueueItem[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────
// Push 함수들
// ─────────────────────────────────────────

/**
 * 단일 Inspection을 Supabase에 push
 * - photoUrl / thermalImageUrl이 data: URL이면 Storage에 업로드 후 교체
 */
export async function pushInspection(record: InspectionRecord): Promise<void> {
  if (!navigator.onLine) {
    addToOfflineQueue({ type: 'inspection', key: record.panelNo, timestamp: new Date().toISOString() });
    return;
  }

  notifyStatus('syncing');
  try {
    let photoUrl: string | undefined;
    let thermalUrl: string | undefined;

    // 현장 사진: data: URL → Storage 업로드
    if (record.photoUrl?.startsWith('data:')) {
      const res = await fetch(record.photoUrl);
      const blob = await res.blob();
      photoUrl = await uploadBlob('panel-photos', `${record.panelNo}/photo.jpg`, blob);
    }

    // 열화상 사진: data: URL → Storage 업로드
    if (record.thermalImage?.imageUrl?.startsWith('data:')) {
      const res = await fetch(record.thermalImage.imageUrl);
      const blob = await res.blob();
      thermalUrl = await uploadBlob('panel-photos', `${record.panelNo}/thermal.jpg`, blob);
    }

    await upsertInspection(record, photoUrl, thermalUrl);
    notifyStatus('success');
  } catch (err) {
    console.error('[syncService] pushInspection 오류:', err);
    addToOfflineQueue({ type: 'inspection', key: record.panelNo, timestamp: new Date().toISOString() });
    notifyStatus('error', String(err));
  }
}

/**
 * 모든 QR Codes를 Supabase에 push
 */
export async function pushAllQRCodes(codes: QRCodeData[]): Promise<void> {
  if (!navigator.onLine) {
    addToOfflineQueue({ type: 'qrcodes', key: 'all', timestamp: new Date().toISOString() });
    return;
  }

  try {
    await upsertQRCodes(codes);
  } catch (err) {
    console.error('[syncService] pushAllQRCodes 오류:', err);
    addToOfflineQueue({ type: 'qrcodes', key: 'all', timestamp: new Date().toISOString() });
  }
}

/**
 * QR 코드 삭제를 Supabase에 push (오프라인 큐 지원)
 * - 오프라인 또는 실패 시 큐에 저장 → 네트워크 복귀 시 재시도
 */
export async function pushDeleteQRCode(id: string): Promise<void> {
  if (!navigator.onLine) {
    addToOfflineQueue({ type: 'delete-qr', key: id, timestamp: new Date().toISOString() });
    notifyStatus('offline');
    return;
  }
  try {
    await deleteQRCodeFromSupabase(id);
  } catch (err) {
    console.error('[syncService] QR 삭제 오류:', err);
    addToOfflineQueue({ type: 'delete-qr', key: id, timestamp: new Date().toISOString() });
    notifyStatus('error', String(err));
    throw err;
  }
}

/**
 * Inspection 삭제를 Supabase에 push (오프라인 큐 지원)
 * - 오프라인 또는 실패 시 큐에 저장 → 네트워크 복귀 시 재시도
 */
export async function pushDeleteInspection(panelNo: string): Promise<void> {
  if (!navigator.onLine) {
    addToOfflineQueue({ type: 'delete-inspection', key: panelNo, timestamp: new Date().toISOString() });
    notifyStatus('offline');
    return;
  }
  try {
    await deleteInspectionFromSupabase(panelNo);
  } catch (err) {
    console.error('[syncService] Inspection 삭제 오류:', err);
    addToOfflineQueue({ type: 'delete-inspection', key: panelNo, timestamp: new Date().toISOString() });
    notifyStatus('error', String(err));
    throw err;
  }
}

/**
 * 도면 이미지를 Supabase Storage + DB에 push (오프라인 큐 지원)
 * - Storage: floor-plans/{floor}.jpg 업로드
 * - DB: floor_plan_images 테이블에 URL 저장
 * - 실패 시 오프라인 큐 저장 → 네트워크 복귀 시 재시도
 */
export async function pushFloorPlanImage(floor: string, blob: Blob): Promise<void> {
  if (!navigator.onLine) {
    addToOfflineQueue({ type: 'floor-plan', key: floor, timestamp: new Date().toISOString() });
    notifyStatus('offline');
    return;
  }
  try {
    const url = await uploadBlob('floor-plans', `${floor}.jpg`, blob);
    await upsertFloorPlanUrl(floor, url);
  } catch (err) {
    console.error('[syncService] 도면 업로드 오류:', err);
    addToOfflineQueue({ type: 'floor-plan', key: floor, timestamp: new Date().toISOString() });
    notifyStatus('error', String(err));
    throw err;
  }
}

/**
 * 보고서를 Supabase로 push (Storage 마이그레이션 지원)
 * - report.htmlContent가 있으면 Storage에 업로드
 * - 업로드 후 DB에는 메타데이터만 저장
 */
export async function pushReport(report: ReportHistory): Promise<void> {
  if (!navigator.onLine) {
    addToOfflineQueue({ type: 'report', key: report.reportId, timestamp: new Date().toISOString() });
    return;
  }

  try {
    // htmlContent 분리: Storage 업로드용으로 전달, DB에는 메타데이터만 저장
    const htmlContent = report.htmlContent;
    await upsertReport(report, htmlContent);
  } catch (err) {
    console.error('[syncService] pushReport 오류:', err);
    addToOfflineQueue({ type: 'report', key: report.reportId, timestamp: new Date().toISOString() });
  }
}


// ─────────────────────────────────────────
// Pull (Supabase → IDB, last-write-wins 병합)
// ─────────────────────────────────────────

export interface PullCallbacks {
  onInspectionsUpdated: (records: InspectionRecord[]) => void;
  onQRCodesUpdated: (codes: QRCodeData[]) => void;
  onReportsUpdated: (reports: ReportHistory[]) => void;
  onSyncStatusChange: (status: SyncStatus, msg?: string) => void;
}

/**
 * Supabase에서 전체 데이터를 가져와 IDB와 병합
 */
export async function pullAll(
  localInspections: InspectionRecord[],
  localQRCodes: QRCodeData[],
  localReports: ReportHistory[],
  callbacks: PullCallbacks
): Promise<void> {
  if (!navigator.onLine) {
    callbacks.onSyncStatusChange('offline');
    return;
  }

  callbacks.onSyncStatusChange('syncing');
  notifyStatus('syncing');

  try {
    // 오프라인 큐에서 삭제 예정 ID 수집 (병합 시 부활 방지)
    const offlineQueue = getOfflineQueue();
    const pendingDeleteQRIds = new Set(
      offlineQueue.filter(q => q.type === 'delete-qr').map(q => q.key)
    );
    const pendingDeleteInspectionIds = new Set(
      offlineQueue.filter(q => q.type === 'delete-inspection').map(q => q.key)
    );

    // ── Inspections ──
    const remoteInspections = await fetchAllInspections();

    // IDB를 직접 읽어 실제 최신 로컬 상태를 가져온다.
    // useEffect 클로저 stale 문제로 localInspections가 [] 일 수 있기 때문.
    const idbInspections = await getAllInspectionsFromIDB().catch(() => [] as typeof localInspections);
    const effectiveLocal = idbInspections.length > 0 ? idbInspections : localInspections;

    const localMap = new Map(effectiveLocal.map(r => [r.panelNo, r]));

    for (const remote of remoteInspections) {
      // 삭제 예정 항목은 병합에서 제외 (부활 방지)
      if (pendingDeleteInspectionIds.has(remote.panelNo)) continue;

      const local = localMap.get(remote.panelNo);
      if (!local) {
        // 원격에만 존재 → 로컬에 추가
        localMap.set(remote.panelNo, remote);
        await saveInspection(remote);
      } else {
        const remoteTs = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
        const localTs = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
        if (remoteTs > localTs) {
          // 원격이 더 최신 → 덮어쓰기
          localMap.set(remote.panelNo, remote);
          await saveInspection(remote);
        }
        // 로컬이 더 최신 또는 동일 → 유지
      }
    }

    const mergedInspections = Array.from(localMap.values());
    callbacks.onInspectionsUpdated(mergedInspections);

    // ── 로컬 → Supabase 역방향 push (로컬에만 있거나, 로컬이 더 최신인 항목) ──
    const remotePanelNos = new Set(remoteInspections.map(r => r.panelNo));
    const inspectionsToPush = effectiveLocal.filter(insp => {
      if (!remotePanelNos.has(insp.panelNo)) return true; // 로컬에만 있음
      const remote = remoteInspections.find(r => r.panelNo === insp.panelNo)!;
      const localTs = insp.updatedAt ? new Date(insp.updatedAt).getTime() : 0;
      const remoteTs = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
      return localTs > remoteTs; // 로컬이 더 최신
    });
    if (inspectionsToPush.length > 0) {
      console.log(`[syncService] 로컬→Supabase 역방향 push: ${inspectionsToPush.length}건`);
      await upsertInspections(inspectionsToPush);
    }

    // ── QR Codes — Inspection과 동일한 양방향 병합 (createdAt 기준 last-write-wins) ──
    const remoteQRCodes = await fetchAllQRCodes();
    const localQRMap = new Map(localQRCodes.map(q => [q.id, q]));

    for (const remote of remoteQRCodes) {
      // 삭제 예정 항목은 병합에서 제외 (부활 방지)
      if (pendingDeleteQRIds.has(remote.id)) continue;

      const local = localQRMap.get(remote.id);
      if (!local) {
        // 원격에만 존재 → 로컬에 추가
        localQRMap.set(remote.id, remote);
        await saveQRCode(remote);
      } else {
        // createdAt을 updatedAt 대용으로 사용 (수정 시 갱신됨)
        const remoteTs = new Date(remote.createdAt).getTime();
        const localTs = new Date(local.createdAt).getTime();
        if (remoteTs > localTs) {
          // 원격이 더 최신 → 덮어쓰기
          localQRMap.set(remote.id, remote);
          await saveQRCode(remote);
        }
        // 로컬이 더 최신 또는 동일 → 유지
      }
    }
    const mergedQRCodes = Array.from(localQRMap.values());
    callbacks.onQRCodesUpdated(mergedQRCodes);

    // 로컬 → Supabase 역방향 push (로컬에만 있는 QR 코드)
    const remoteQRIds = new Set(remoteQRCodes.map(q => q.id));
    const qrsToPush = localQRCodes.filter(q => {
      if (!remoteQRIds.has(q.id)) return true; // 로컬에만 존재
      const remote = remoteQRCodes.find(r => r.id === q.id)!;
      const localTs = new Date(q.createdAt).getTime();
      const remoteTs = new Date(remote.createdAt).getTime();
      return localTs > remoteTs; // 로컬이 더 최신
    });
    if (qrsToPush.length > 0) {
      console.log(`[syncService] QR Codes 로컬→Supabase push: ${qrsToPush.length}건`);
      await upsertQRCodes(qrsToPush);
    }

    // ── Reports ── (id 기준 병합 - 같은 날 Complete 재발행 시 두 레코드 모두 유지)
    const remoteReports = await fetchAllReports();
    if (remoteReports.length > 0) {
      const reportMap = new Map(localReports.map(r => [r.id, r]));
      for (const remote of remoteReports) {
        if (!reportMap.has(remote.id)) {
          // 로컬에 없는 원격 보고서 → 추가
          reportMap.set(remote.id, remote);
          await saveReport(remote);
        }
        // 로컬에 있으면 로컬 우선 (이미 최신 상태)
      }
      const mergedReports = Array.from(reportMap.values())
        .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
      callbacks.onReportsUpdated(mergedReports);
    }

    // ── 로컬에만 있는 report → Supabase push ──
    const remoteIds = new Set(remoteReports.map(r => r.id));
    const localOnlyReports = localReports.filter(r => !remoteIds.has(r.id));
    if (localOnlyReports.length > 0) {
      console.log(`[syncService] Reports 로컬→Supabase push: ${localOnlyReports.length}건`);
      for (const report of localOnlyReports) {
        await upsertReport(report);
      }
    }

    // ── Floor Plan Images — Supabase → IndexedDB 복원 ──
    // 새 기기 접속 시 도면이 없으면 Supabase Storage에서 다운로드
    try {
      const remoteFloorPlans = await fetchAllFloorPlanUrls();
      for (const { floor, url } of remoteFloorPlans) {
        const existing = await getFloorPlanImage(floor);
        if (!existing) {
          const res = await fetch(url);
          if (res.ok) {
            const blob = await res.blob();
            await saveFloorPlanImage(floor, blob);
            console.log(`[syncService] 도면 복원: ${floor}`);
          }
        }
      }
    } catch (err) {
      // 도면 복원 실패는 치명적이지 않으므로 다음 pullAll 때 재시도
      console.warn('[syncService] 도면 복원 오류 (무시):', err);
    }

    callbacks.onSyncStatusChange('success');
    notifyStatus('success');
  } catch (err) {
    console.error('[syncService] pullAll 오류:', err);
    callbacks.onSyncStatusChange('error', String(err));
    notifyStatus('error', String(err));
  }
}

// ─────────────────────────────────────────
// 오프라인 큐 플러시
// ─────────────────────────────────────────

/**
 * 네트워크 복귀 시 큐에 쌓인 항목을 현재 IDB 상태로 재Push
 */
export async function flushOfflineQueue(
  localInspections: InspectionRecord[],
  localQRCodes: QRCodeData[],
  localReports: ReportHistory[]
): Promise<void> {
  const queue = getOfflineQueue();
  if (queue.length === 0) return;

  notifyStatus('syncing');

  try {
    const inspectionItems = queue.filter(q => q.type === 'inspection');
    const qrcodesItems = queue.filter(q => q.type === 'qrcodes');
    const reportItems = queue.filter(q => q.type === 'report');

    // Inspections push
    const inspectionsToPush = localInspections.filter(r =>
      inspectionItems.some(q => q.key === r.panelNo)
    );
    if (inspectionsToPush.length > 0) {
      await upsertInspections(inspectionsToPush);
    }

    // QR Codes push
    if (qrcodesItems.length > 0 && localQRCodes.length > 0) {
      await upsertQRCodes(localQRCodes);
    }

    // Reports push
    const reportsToPush = localReports.filter(r =>
      reportItems.some(q => q.key === r.reportId)
    );
    for (const report of reportsToPush) {
      await upsertReport(report);
    }

    // QR 삭제 큐 처리
    const deleteQRItems = queue.filter(q => q.type === 'delete-qr');
    for (const item of deleteQRItems) {
      await deleteQRCodeFromSupabase(item.key);
    }

    // Inspection 삭제 큐 처리
    const deleteInspectionItems = queue.filter(q => q.type === 'delete-inspection');
    for (const item of deleteInspectionItems) {
      await deleteInspectionFromSupabase(item.key);
    }

    // 도면 이미지 업로드 큐 처리 (IndexedDB에서 Blob 읽어 재업로드)
    const floorPlanItems = queue.filter(q => q.type === 'floor-plan');
    for (const item of floorPlanItems) {
      const blob = await getFloorPlanImage(item.key);
      if (blob) {
        const url = await uploadBlob('floor-plans', `${item.key}.jpg`, blob);
        await upsertFloorPlanUrl(item.key, url);
      }
    }

    clearOfflineQueue();
    notifyStatus('success');
  } catch (err) {
    console.error('[syncService] flushOfflineQueue 오류:', err);
    notifyStatus('error', String(err));
  }
}
