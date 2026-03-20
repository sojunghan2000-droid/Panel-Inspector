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
  fetchInspectionsSince,
  fetchAllInspectionIds,
  upsertQRCodes,
  fetchAllQRCodes,
  fetchQRCodesSince,
  fetchAllQRCodeIds,
  upsertReport,
  fetchAllReports,
  fetchReportsSince,
  fetchAllReportIds,
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
 * 다수의 Inspection을 Supabase에 배치 push
 * - 사진(data: URL) 없는 항목: 단일 배치 POST → 커넥션 1개
 * - 사진 있는 항목: 순차 개별 push (Storage 업로드 필요)
 * - 개별 pushInspection() 반복 호출 대신 사용하여 커넥션 풀 고갈 방지
 */
export async function pushInspectionsBatch(records: InspectionRecord[]): Promise<void> {
  if (records.length === 0) return;
  if (!navigator.onLine) {
    records.forEach(r =>
      addToOfflineQueue({ type: 'inspection', key: r.panelNo, timestamp: new Date().toISOString() })
    );
    return;
  }
  notifyStatus('syncing');
  try {
    // 사진 업로드가 필요한 항목(data: URL) vs 일반 항목 분리
    const withPhotos = records.filter(
      r => r.photoUrl?.startsWith('data:') || r.thermalImage?.imageUrl?.startsWith('data:')
    );
    const noPhotos = records.filter(
      r => !r.photoUrl?.startsWith('data:') && !r.thermalImage?.imageUrl?.startsWith('data:')
    );

    // 사진 없는 항목: 단일 배치 POST (커넥션 1개)
    if (noPhotos.length > 0) {
      await upsertInspections(noPhotos);
    }

    // 사진 있는 항목: 순차 처리 (동시 Storage 업로드 방지)
    for (const record of withPhotos) {
      await pushInspection(record);
    }

    notifyStatus('success');
  } catch (err) {
    console.error('[syncService] pushInspectionsBatch 오류:', err);
    records.forEach(r =>
      addToOfflineQueue({ type: 'inspection', key: r.panelNo, timestamp: new Date().toISOString() })
    );
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
  onFloorPlanUrlsUpdated?: (urls: { floor: string; url: string }[]) => void;
}

// ─────────────────────────────────────────
// 증분 동기화 타임스탬프 관리
// ─────────────────────────────────────────

const LAST_SYNC_KEY = 'panel-inspector-last-sync';

function getLastSyncTimestamp(): string | null {
  return localStorage.getItem(LAST_SYNC_KEY);
}

function setLastSyncTimestamp(ts: string): void {
  localStorage.setItem(LAST_SYNC_KEY, ts);
}

/** 강제 전체 동기화 (로그아웃, 데이터 리셋 시 호출) */
export function resetSyncTimestamp(): void {
  localStorage.removeItem(LAST_SYNC_KEY);
}

/**
 * Supabase에서 데이터를 가져와 IDB와 병합
 * - 초회(lastSync 없음): 전체 데이터 로드
 * - 이후: 변경분만 증분 로드 + ID 목록으로 삭제 감지
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
    const lastSync = getLastSyncTimestamp();
    const syncStartTime = new Date().toISOString();

    // 오프라인 큐에서 삭제 예정 ID 수집 (병합 시 부활 방지)
    const offlineQueue = getOfflineQueue();
    const pendingDeleteQRIds = new Set(
      offlineQueue.filter(q => q.type === 'delete-qr').map(q => q.key)
    );
    const pendingDeleteInspectionIds = new Set(
      offlineQueue.filter(q => q.type === 'delete-inspection').map(q => q.key)
    );

    // IDB를 직접 읽어 실제 최신 로컬 상태를 가져온다.
    const idbInspections = await getAllInspectionsFromIDB().catch(() => [] as typeof localInspections);
    const effectiveLocal = idbInspections.length > 0 ? idbInspections : localInspections;

    if (!lastSync) {
      // ═══════════════════════════════════════
      // 초회: 전체 동기화 (기존 로직)
      // ═══════════════════════════════════════
      console.log('[syncService] 초회 전체 동기화 시작');

      // ── Inspections ──
      const remoteInspections = await fetchAllInspections();
      const localMap = new Map(effectiveLocal.map(r => [r.panelNo, r]));

      for (const remote of remoteInspections) {
        if (pendingDeleteInspectionIds.has(remote.panelNo)) continue;
        const local = localMap.get(remote.panelNo);
        if (!local) {
          localMap.set(remote.panelNo, remote);
          await saveInspection(remote);
        } else {
          const remoteTs = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
          const localTs = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
          if (remoteTs > localTs) {
            localMap.set(remote.panelNo, remote);
            await saveInspection(remote);
          }
        }
      }
      callbacks.onInspectionsUpdated(Array.from(localMap.values()));

      // 로컬 → Supabase 역방향 push
      const remotePanelNos = new Set(remoteInspections.map(r => r.panelNo));
      const inspectionsToPush = effectiveLocal.filter(insp => {
        if (!remotePanelNos.has(insp.panelNo)) return true;
        const remote = remoteInspections.find(r => r.panelNo === insp.panelNo)!;
        const localTs = insp.updatedAt ? new Date(insp.updatedAt).getTime() : 0;
        const remoteTs = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
        return localTs > remoteTs;
      });
      if (inspectionsToPush.length > 0) {
        console.log(`[syncService] 로컬→Supabase 역방향 push: ${inspectionsToPush.length}건`);
        await upsertInspections(inspectionsToPush);
      }

      // ── QR Codes ──
      const remoteQRCodes = await fetchAllQRCodes();
      const localQRMap = new Map(localQRCodes.map(q => [q.id, q]));

      for (const remote of remoteQRCodes) {
        if (pendingDeleteQRIds.has(remote.id)) continue;
        const local = localQRMap.get(remote.id);
        if (!local) {
          localQRMap.set(remote.id, remote);
          await saveQRCode(remote);
        } else {
          const remoteTs = new Date(remote.createdAt).getTime();
          const localTs = new Date(local.createdAt).getTime();
          if (remoteTs > localTs) {
            localQRMap.set(remote.id, remote);
            await saveQRCode(remote);
          }
        }
      }
      callbacks.onQRCodesUpdated(Array.from(localQRMap.values()));

      // 로컬 → Supabase push (QR)
      const remoteQRIds = new Set(remoteQRCodes.map(q => q.id));
      const qrsToPush = localQRCodes.filter(q => {
        if (!remoteQRIds.has(q.id)) return true;
        const remote = remoteQRCodes.find(r => r.id === q.id)!;
        return new Date(q.createdAt).getTime() > new Date(remote.createdAt).getTime();
      });
      if (qrsToPush.length > 0) {
        console.log(`[syncService] QR Codes 로컬→Supabase push: ${qrsToPush.length}건`);
        await upsertQRCodes(qrsToPush);
      }

      // ── Reports ──
      const remoteReports = await fetchAllReports();
      if (remoteReports.length > 0) {
        const reportMap = new Map(localReports.map(r => [r.id, r]));
        for (const remote of remoteReports) {
          if (!reportMap.has(remote.id)) {
            reportMap.set(remote.id, remote);
            await saveReport(remote);
          }
        }
        callbacks.onReportsUpdated(
          Array.from(reportMap.values()).sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
        );
      }

      // 로컬에만 있는 report → push
      const remoteIds = new Set(remoteReports.map(r => r.id));
      const localOnlyReports = localReports.filter(r => !remoteIds.has(r.id));
      if (localOnlyReports.length > 0) {
        console.log(`[syncService] Reports 로컬→Supabase push: ${localOnlyReports.length}건`);
        for (const report of localOnlyReports) {
          await upsertReport(report);
        }
      }

    } else {
      // ═══════════════════════════════════════
      // 증분: 변경분만 동기화
      // ═══════════════════════════════════════
      console.log(`[syncService] 증분 동기화 시작 (since: ${lastSync})`);

      // ── Inspections (변경분) ──
      const changedInspections = await fetchInspectionsSince(lastSync);
      const localMap = new Map(effectiveLocal.map(r => [r.panelNo, r]));
      let inspectionsChanged = false;

      if (changedInspections.length > 0) {
        console.log(`[syncService] 증분 inspections: ${changedInspections.length}건`);
        for (const remote of changedInspections) {
          if (pendingDeleteInspectionIds.has(remote.panelNo)) continue;
          const local = localMap.get(remote.panelNo);
          const remoteTs = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
          const localTs = local?.updatedAt ? new Date(local.updatedAt).getTime() : 0;
          if (!local || remoteTs > localTs) {
            localMap.set(remote.panelNo, remote);
            await saveInspection(remote);
            inspectionsChanged = true;
          }
        }
      }

      // 삭제 감지: ID 목록만 가져와 비교 (경량)
      const remoteInspectionIds = new Set(await fetchAllInspectionIds());
      for (const local of effectiveLocal) {
        if (!remoteInspectionIds.has(local.panelNo) && !pendingDeleteInspectionIds.has(local.panelNo)) {
          localMap.delete(local.panelNo);
          inspectionsChanged = true;
          console.log(`[syncService] 원격 삭제 감지: ${local.panelNo}`);
        }
      }

      if (inspectionsChanged) {
        callbacks.onInspectionsUpdated(Array.from(localMap.values()));
      }

      // 로컬 → Supabase push (로컬에만 있는 항목)
      const inspectionsToPush = effectiveLocal.filter(insp => !remoteInspectionIds.has(insp.panelNo));
      if (inspectionsToPush.length > 0) {
        console.log(`[syncService] 로컬→Supabase 역방향 push: ${inspectionsToPush.length}건`);
        await upsertInspections(inspectionsToPush);
      }

      // ── QR Codes (변경분) ──
      const changedQRCodes = await fetchQRCodesSince(lastSync);
      const localQRMap = new Map(localQRCodes.map(q => [q.id, q]));
      let qrChanged = false;

      if (changedQRCodes.length > 0) {
        console.log(`[syncService] 증분 QR codes: ${changedQRCodes.length}건`);
        for (const remote of changedQRCodes) {
          if (pendingDeleteQRIds.has(remote.id)) continue;
          const local = localQRMap.get(remote.id);
          if (!local) {
            localQRMap.set(remote.id, remote);
            await saveQRCode(remote);
            qrChanged = true;
          } else {
            const remoteTs = new Date(remote.createdAt).getTime();
            const localTs = new Date(local.createdAt).getTime();
            if (remoteTs > localTs) {
              localQRMap.set(remote.id, remote);
              await saveQRCode(remote);
              qrChanged = true;
            }
          }
        }
      }

      // 삭제 감지 (QR)
      const remoteQRIdSet = new Set(await fetchAllQRCodeIds());
      for (const local of localQRCodes) {
        if (!remoteQRIdSet.has(local.id) && !pendingDeleteQRIds.has(local.id)) {
          localQRMap.delete(local.id);
          qrChanged = true;
          console.log(`[syncService] QR 원격 삭제 감지: ${local.id}`);
        }
      }

      if (qrChanged) {
        callbacks.onQRCodesUpdated(Array.from(localQRMap.values()));
      }

      // 로컬 → Supabase push (QR)
      const qrsToPush = localQRCodes.filter(q => !remoteQRIdSet.has(q.id));
      if (qrsToPush.length > 0) {
        console.log(`[syncService] QR Codes 로컬→Supabase push: ${qrsToPush.length}건`);
        await upsertQRCodes(qrsToPush);
      }

      // ── Reports (변경분) ──
      const changedReports = await fetchReportsSince(lastSync);
      if (changedReports.length > 0) {
        console.log(`[syncService] 증분 reports: ${changedReports.length}건`);
        const reportMap = new Map(localReports.map(r => [r.id, r]));
        for (const remote of changedReports) {
          if (!reportMap.has(remote.id)) {
            reportMap.set(remote.id, remote);
            await saveReport(remote);
          }
        }
        callbacks.onReportsUpdated(
          Array.from(reportMap.values()).sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
        );
      }

      // 로컬에만 있는 report → push
      const remoteReportIdSet = new Set(await fetchAllReportIds());
      const localOnlyReports = localReports.filter(r => !remoteReportIdSet.has(r.id));
      if (localOnlyReports.length > 0) {
        console.log(`[syncService] Reports 로컬→Supabase push: ${localOnlyReports.length}건`);
        for (const report of localOnlyReports) {
          await upsertReport(report);
        }
      }
    }

    // ── Floor Plan Images — 소량이므로 항상 전체 fetch ──
    try {
      const remoteFloorPlans = await fetchAllFloorPlanUrls();
      // URL 목록을 콜백으로 전달 (FloorPlanView에서 사용)
      if (callbacks.onFloorPlanUrlsUpdated) {
        callbacks.onFloorPlanUrlsUpdated(remoteFloorPlans);
      }
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
      console.warn('[syncService] 도면 복원 오류 (무시):', err);
    }

    // 동기화 타임스탬프 저장
    setLastSyncTimestamp(syncStartTime);

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
