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
} from './supabaseService';
import { saveInspection, saveAllQRCodes, saveReport } from './indexedDBService';
import type { InspectionRecord, QRCodeData, ReportHistory } from '../types';

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'offline';

const OFFLINE_QUEUE_KEY = 'panel-inspector-offline-queue';

interface OfflineQueueItem {
  type: 'inspection' | 'qrcodes' | 'report';
  key: string; // panelNo / 'all' / reportId
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
 * 보고서를 Supabase에 push
 */
export async function pushReport(report: ReportHistory): Promise<void> {
  if (!navigator.onLine) {
    addToOfflineQueue({ type: 'report', key: report.reportId, timestamp: new Date().toISOString() });
    return;
  }

  try {
    await upsertReport(report);
  } catch (err) {
    console.error('[syncService] pushReport 오류:', err);
    addToOfflineQueue({ type: 'report', key: report.reportId, timestamp: new Date().toISOString() });
  }
}

/**
 * 도면 이미지를 Supabase Storage에 push
 */
export async function pushFloorPlan(floor: string, blob: Blob): Promise<string> {
  const url = await uploadBlob('floor-plans', `${floor}.jpg`, blob);
  return url;
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
    // ── Inspections ──
    const remoteInspections = await fetchAllInspections();
    const localMap = new Map(localInspections.map(r => [r.panelNo, r]));

    for (const remote of remoteInspections) {
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

    // ── QR Codes ──
    const remoteQRCodes = await fetchAllQRCodes();
    if (remoteQRCodes.length > 0) {
      await saveAllQRCodes(remoteQRCodes);
      callbacks.onQRCodesUpdated(remoteQRCodes);
    } else if (localQRCodes.length > 0) {
      // 원격이 비어있고 로컬이 있으면 로컬 유지 (첫 동기화 전 상태)
    }

    // ── Reports ──
    const remoteReports = await fetchAllReports();
    if (remoteReports.length > 0) {
      const reportMap = new Map(localReports.map(r => [r.reportId, r]));
      for (const remote of remoteReports) {
        const local = reportMap.get(remote.reportId);
        if (!local || new Date(remote.generatedAt) > new Date(local.generatedAt)) {
          reportMap.set(remote.reportId, remote);
          await saveReport(remote);
        }
      }
      const mergedReports = Array.from(reportMap.values())
        .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
      callbacks.onReportsUpdated(mergedReports);
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

    clearOfflineQueue();
    notifyStatus('success');
  } catch (err) {
    console.error('[syncService] flushOfflineQueue 오류:', err);
    notifyStatus('error', String(err));
  }
}
