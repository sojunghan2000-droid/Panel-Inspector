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
import { saveInspection, saveQRCode, saveAllQRCodes, saveReport, getAllInspections as getAllInspectionsFromIDB, getFloorPlanImage, saveFloorPlanImage, deleteInspection as deleteInspectionFromIDB, deleteQRCode as deleteQRCodeFromIDB, saveSyncMetadata, getSyncMetadata, updateSyncMetadata } from './indexedDBService';
import type { InspectionRecord, QRCodeData, ReportHistory, SyncMetadata, AutoSyncConfig } from '../types';

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'offline';

const OFFLINE_QUEUE_KEY = 'panel-inspector-offline-queue';

// @MX:NOTE: Phase 2 - 저장소별 캐시 TTL (분 단위)
const CACHE_TTL_MINUTES = {
  inspections: 30,           // 검사 데이터: 30분
  photos: 60,                // 사진: 60분
  qrCodes: 60,               // QR 코드: 60분
  floorPlanImages: 120,      // 층 평면도: 120분 (거의 변경 없음)
  reports: 15,               // 보고서: 15분 (자주 변경)
  inspectionHistory: 45,     // 검사 히스토리: 45분
};

// 개발 모드 TTL 설정 (환경변수로 오버라이드 가능)
const getDevCacheTTLSeconds = (): number => {
  const devTTL = process.env.REACT_APP_DEV_CACHE_TTL;
  return devTTL ? parseInt(devTTL, 10) : 30; // 기본값: 30초
};

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

// @MX:NOTE: Phase 1 - 저장소별 동기화 메타데이터 관리
/**
 * 특정 저장소의 마지막 동기화 시간 조회
 * @param storeType 저장소 타입
 * @returns ISO 8601 형식의 타임스탬프 또는 null
 */
export async function getLastSyncTimeForStore(storeType: string): Promise<string | null> {
  const metadata = await getSyncMetadata(storeType);
  return metadata?.lastSyncTime ?? null;
}

/**
 * 특정 저장소의 마지막 동기화 시간 업데이트
 * @param storeType 저장소 타입
 * @param recordCount 현재 레코드 수
 */
export async function setLastSyncTimeForStore(storeType: string, recordCount: number = 0): Promise<void> {
  const now = new Date().toISOString();
  const existing = await getSyncMetadata(storeType);
  
  if (existing) {
    // 기존 메타데이터 업데이트
    await updateSyncMetadata(storeType, {
      lastSyncTime: now,
      recordCount,
      syncStatus: 'success',
    });
  } else {
    // 새로운 메타데이터 생성
    const newMetadata: SyncMetadata = {
      id: `sync-meta-${storeType}`,
      storeType: storeType as any,
      lastSyncTime: now,
      recordCount,
      syncStatus: 'success',
      createdAt: now,
      updatedAt: now,
    };
    await saveSyncMetadata(newMetadata);
  }
}

/**
 * 특정 저장소의 동기화 상태 업데이트
 * @param storeType 저장소 타입
 * @param status 동기화 상태 ('idle' | 'syncing' | 'success' | 'error')
 * @param error 에러 메시지 (status === 'error'인 경우)
 */
export async function updateStoreSyncStatus(
  storeType: string,
  status: 'idle' | 'syncing' | 'success' | 'error',
  error?: string
): Promise<void> {
  const updates: any = { syncStatus: status };
  if (error) updates.lastError = error;
  
  const existing = await getSyncMetadata(storeType);
  if (existing) {
    await updateSyncMetadata(storeType, updates);
  } else {
    const now = new Date().toISOString();
    const newMetadata: SyncMetadata = {
      id: `sync-meta-${storeType}`,
      storeType: storeType as any,
      lastSyncTime: existing?.lastSyncTime ?? now,
      recordCount: 0,
      syncStatus: status,
      lastError: error,
      createdAt: now,
      updatedAt: now,
    };
    await saveSyncMetadata(newMetadata);
  }
}

// @MX:NOTE: Phase 2 - 캐시 TTL 검증 함수들
/**
 * 캐시가 만료되었는지 확인
 * @param storeType 저장소 타입
 * @param isDevelopmentMode 개발 모드 여부
 * @returns true = 캐시 만료 (refresh 필요), false = 캐시 유효
 */
export async function isCacheExpired(storeType: string, isDevelopmentMode: boolean = false): Promise<boolean> {
  const metadata = await getSyncMetadata(storeType);
  if (!metadata || !metadata.lastSyncTime) {
    return true; // 메타데이터 없음 = 캐시 없음 = 만료
  }

  const lastSyncTime = new Date(metadata.lastSyncTime).getTime();
  const now = new Date().getTime();
  
  // 개발 모드 TTL
  if (isDevelopmentMode) {
    const devTTLMs = getDevCacheTTLSeconds() * 1000;
    return now - lastSyncTime > devTTLMs;
  }

  // 프로덕션 모드 TTL
  const ttlMinutes = CACHE_TTL_MINUTES[storeType as keyof typeof CACHE_TTL_MINUTES] || 30;
  const ttlMs = ttlMinutes * 60 * 1000;
  return now - lastSyncTime > ttlMs;
}

/**
 * 저장소를 새로고침해야 하는지 확인
 * - 캐시 만료
 * - 동기화 에러 상태
 * - 강제 새로고침 플래그 (forceRefresh)
 * 
 * @param storeType 저장소 타입
 * @param forceRefresh 강제 새로고침 플래그
 * @returns true = refresh 필요, false = 캐시 사용 가능
 */
export async function shouldRefreshStore(storeType: string, forceRefresh: boolean = false): Promise<boolean> {
  if (forceRefresh) {
    return true;
  }

  // 현재 syncing 상태 확인
  const metadata = await getSyncMetadata(storeType);
  if (metadata?.syncStatus === 'syncing') {
    return false; // 현재 동기화 중이면 skip
  }

  // 이전 에러 상태 확인
  if (metadata?.syncStatus === 'error') {
    return true; // 에러 상태면 재시도
  }

  // 캐시 만료 확인
  const isDev = process.env.NODE_ENV === 'development';
  return await isCacheExpired(storeType, isDev);
}

// @MX:NOTE: Phase 2 - pullAll() 통합을 위한 헬퍼 함수들
/**
 * pullAll() 내부에서 호출할 캐시 체크 헬퍼
 * - 캐시 유효하면 false 반환 (fetch 스킵)
 * - 캐시 만료하면 true 반환 (fetch 수행)
 */
async function shouldFetchStore(
  storeType: 'inspections' | 'qrCodes' | 'reports' | 'floorPlanImages'
): Promise<boolean> {
  return await shouldRefreshStore(storeType, false);
}

/**
 * 저장소 동기화 완료 시 호출
 * - SyncMetadata 업데이트 (lastSyncTime, recordCount)
 * - 동기화 상태를 'success'로 설정
 */
async function markStoreSyncComplete(
  storeType: 'inspections' | 'qrCodes' | 'reports' | 'floorPlanImages',
  recordCount: number
): Promise<void> {
  await setLastSyncTimeForStore(storeType, recordCount);
}

/**
 * 저장소 동기화 실패 시 호출
 * - SyncMetadata 업데이트 (syncStatus = 'error', lastError)
 */
async function markStoreSyncError(
  storeType: 'inspections' | 'qrCodes' | 'reports' | 'floorPlanImages',
  error: string
): Promise<void> {
  await updateStoreSyncStatus(storeType, 'error', error);
}

// @MX:NOTE: Phase 3 - 자동 주기 동기화 관리
const AUTO_SYNC_CONFIG_KEY = 'sync-auto-settings';
const LAST_AUTO_SYNC_KEY = 'last-auto-sync';

// 자동 동기화 타이머 ID 및 활동 상태 추적
let _autoSyncIntervalId: NodeJS.Timeout | null = null;
let _activityState: any = null;

/**
 * 기본 자동 동기화 설정
 */
const DEFAULT_AUTO_SYNC_CONFIG: AutoSyncConfig = {
  enabled: false,
  intervalMinutes: 15,
  respectIdleState: true,
  idleThresholdMinutes: 3,
  respectTabVisibility: true,
  respectBatteryStatus: true,
  batteryLevelThreshold: 20,
};

/**
 * 자동 동기화 설정 조회
 */
export function getAutoSyncConfig(): AutoSyncConfig {
  try {
    const raw = localStorage.getItem(AUTO_SYNC_CONFIG_KEY);
    if (!raw) return DEFAULT_AUTO_SYNC_CONFIG;
    return { ...DEFAULT_AUTO_SYNC_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_AUTO_SYNC_CONFIG;
  }
}

/**
 * 자동 동기화 설정 저장
 */
export function saveAutoSyncConfig(config: Partial<AutoSyncConfig>): void {
  try {
    const current = getAutoSyncConfig();
    const updated = { ...current, ...config };
    localStorage.setItem(AUTO_SYNC_CONFIG_KEY, JSON.stringify(updated));
  } catch {
    console.error('[syncService] 자동 동기화 설정 저장 실패');
  }
}

/**
 * Supabase에서 데이터를 가져와 IDB와 병합
 * - 초회(lastSync 없음): 전체 데이터 로드
 * - 이후: 변경분만 증분 로드 + ID 목록으로 삭제 감지
 * 
 * @MX:NOTE Phase 2 캐시 TTL 통합
 * 각 저장소별로 shouldRefreshStore() 호출하여 캐시 유효성 확인:
 * - inspections: 30분 (dev: 30초)
 * - qrCodes: 60분 (dev: 30초)  
 * - reports: 15분 (dev: 30초)
 * - floorPlanImages: 120분 (dev: 30초)
 * 
 * 캐시 유효 시 fetch 스킵, 메타데이터만 업데이트
 * 캐시 만료 시 fetch 수행 후 setLastSyncTimeForStore() 호출
 */
// BUG-1 수정: pullAll 중복 실행 방지 뮤텍스
// - session 상태 변경(INITIAL_SESSION, SIGNED_IN 등)마다 useEffect 재실행 → 3번 동시 실행 문제
// - _isPullRunning 플래그로 동시 중복 실행 차단
let _isPullRunning = false;

export async function pullAll(
  localInspections: InspectionRecord[],
  localQRCodes: QRCodeData[],
  localReports: ReportHistory[],
  callbacks: PullCallbacks
): Promise<void> {
  if (_isPullRunning) return; // 이미 실행 중이면 즉시 리턴
  if (!navigator.onLine) {
    callbacks.onSyncStatusChange('offline');
    return;
  }
  _isPullRunning = true;

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
            // position 보존: remote가 이겨도 position이 null이면 local position 유지
            const merged = { ...remote, position: remote.position ?? local.position };
            localMap.set(remote.panelNo, merged);
            await saveInspection(merged);
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
            // position 보존: remote가 이겨도 position이 null이면 local position 유지
            const merged = { ...remote, position: remote.position ?? local?.position };
            localMap.set(remote.panelNo, merged);
            await saveInspection(merged);
            inspectionsChanged = true;
          }
        }
      }

      // 삭제 감지: ID 목록만 가져와 비교 (경량)
      const remoteInspectionIds = new Set(await fetchAllInspectionIds());
      // BUG-2 수정: 삭제 감지된 항목을 추적하여 역방향 push에서 제외
      // 이전: 삭제 감지 후 즉시 역방향 push 필터에서 동일 항목 선택 → Supabase 재생성 루프
      const deletedLocalIds = new Set<string>();
      for (const local of effectiveLocal) {
        if (!remoteInspectionIds.has(local.panelNo) && !pendingDeleteInspectionIds.has(local.panelNo)) {
          localMap.delete(local.panelNo);
          deletedLocalIds.add(local.panelNo); // 삭제된 ID 추적
          inspectionsChanged = true;
          // IDB에서도 실제 삭제 (미삭제 시 다음 sync에서 반복 감지 문제 방지)
          deleteInspectionFromIDB(local.panelNo).catch(console.error);
          console.log(`[syncService] 원격 삭제 감지: ${local.panelNo}`);
        }
      }

      if (inspectionsChanged) {
        callbacks.onInspectionsUpdated(Array.from(localMap.values()));
      }

      // 로컬 → Supabase push (로컬에만 있는 항목, 원격 삭제 항목 제외)
      const inspectionsToPush = effectiveLocal.filter(
        insp => !remoteInspectionIds.has(insp.panelNo) && !deletedLocalIds.has(insp.panelNo)
      );
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
          // IDB에서도 실제 삭제 (미삭제 시 다음 sync에서 반복 감지 문제 방지)
          deleteQRCodeFromIDB(local.id).catch(console.error);
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
  } finally {
    _isPullRunning = false; // 성공/실패 모두 플래그 해제
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

/**
 * @MX:NOTE Phase 2 pullAll() 통합 가이드
 * 
 * ============================================
 * pullAll() 함수의 각 fetch 지점에 다음과 같이 통합:
 * ============================================
 * 
 * **1. 초회 Inspections 로드 전에:**
 * ```typescript
 * if (await shouldFetchStore('inspections')) {
 *   const remoteInspections = await fetchAllInspections();
 *   // ... 기존 로직 ...
 *   await markStoreSyncComplete('inspections', localMap.size);
 * } else {
 *   console.log('[syncService] inspections 캐시 유효 - fetch 스킵');
 * }
 * ```
 * 
 * **2. 초회 QR Codes 로드 전에:**
 * ```typescript
 * if (await shouldFetchStore('qrCodes')) {
 *   const remoteQRCodes = await fetchAllQRCodes();
 *   // ... 기존 로직 ...
 *   await markStoreSyncComplete('qrCodes', localQRMap.size);
 * }
 * ```
 * 
 * **3. 초회 Reports 로드 전에:**
 * ```typescript
 * if (await shouldFetchStore('reports')) {
 *   const remoteReports = await fetchAllReports();
 *   // ... 기존 로직 ...
 *   await markStoreSyncComplete('reports', remoteReports.length);
 * }
 * ```
 * 
 * **4. 증분 동기화 섹션도 동일하게 적용:**
 * - fetchInspectionsSince() 호출 전 shouldFetchStore('inspections')
 * - fetchQRCodesSince() 호출 전 shouldFetchStore('qrCodes')
 * - fetchReportsSince() 호출 전 shouldFetchStore('reports')
 * 
 * **5. 에러 처리:**
 * ```typescript
 * try {
 *   if (await shouldFetchStore('inspections')) {
 *     // fetch 수행
 *   }
 * } catch (error) {
 *   await markStoreSyncError('inspections', error.message);
 *   throw;
 * }
 * ```
 * 
 * ============================================
 * 환경 변수 설정 (개발 모드 TTL):
 * ============================================
 * .env.local:
 *   REACT_APP_DEV_CACHE_TTL=10  # 10초 (기본값: 30초)
 * 
 * ============================================
 * 캐시 TTL 값 변경:
 * ============================================
 * syncService.ts의 CACHE_TTL_MINUTES 상수 수정:
 * - inspections: 30분 (검사 데이터)
 * - qrCodes: 60분 (QR 코드)
 * - reports: 15분 (보고서 - 자주 변경)
 * - floorPlanImages: 120분 (층 평면도)
 * - photos: 60분
 * - inspectionHistory: 45분
 */

/**
 * 마지막 자동 동기화 시간 조회
 */
export function getLastAutoSyncTime(): string | null {
  return localStorage.getItem(LAST_AUTO_SYNC_KEY);
}

/**
 * 마지막 자동 동기화 시간 업데이트
 */
function setLastAutoSyncTime(): void {
  try {
    localStorage.setItem(LAST_AUTO_SYNC_KEY, new Date().toISOString());
  } catch {
    // localStorage 오류 무시
  }
}

/**
 * 현재 활동 상태로 자동 동기화 실행 가능 여부 판정
 */
function canExecuteAutoSync(config: AutoSyncConfig, isSyncing: boolean): boolean {
  if (isSyncing || _syncStatusCallbacks.length === 0) {
    return false;
  }

  if (_activityState) {
    if (config.respectTabVisibility && !_activityState.isTabVisible) {
      return false;
    }

    if (config.respectIdleState && !_activityState.isActive) {
      return false;
    }

    if (config.respectBatteryStatus && _activityState.batteryLevel !== null) {
      const batteryOK =
        _activityState.isCharging ||
        _activityState.batteryLevel >= config.batteryLevelThreshold;
      if (!batteryOK) {
        return false;
      }
    }
  }

  return true;
}

/**
 * 자동 동기화 시작
 */
export function startAutoSync(
  activityState: any,
  pullAllFn: (cb: any) => Promise<void>
): () => void {
  _activityState = activityState;
  const config = getAutoSyncConfig();

  if (!config.enabled || config.intervalMinutes <= 0) {
    return stopAutoSync;
  }

  if (_autoSyncIntervalId) {
    clearInterval(_autoSyncIntervalId);
  }

  _autoSyncIntervalId = setInterval(async () => {
    try {
      const currentConfig = getAutoSyncConfig();
      const isSyncing = _syncStatusCallbacks.length > 0;

      if (!canExecuteAutoSync(currentConfig, isSyncing)) {
        console.log('[syncService] 자동 동기화 조건 불만족 - 스킵');
        return;
      }

      const lastAutoSync = getLastAutoSyncTime();
      if (lastAutoSync) {
        const lastSyncMs = new Date(lastAutoSync).getTime();
        const nowMs = Date.now();
        const elapsedMs = nowMs - lastSyncMs;
        const intervalMs = currentConfig.intervalMinutes * 60 * 1000;

        if (elapsedMs < intervalMs) {
          console.log('[syncService] 자동 동기화 주기 미달 - 스킵');
          return;
        }
      }

      console.log('[syncService] 자동 동기화 시작');
      await pullAllFn({
        onInspectionsUpdated: () => {},
        onQRCodesUpdated: () => {},
        onReportsUpdated: () => {},
        onSyncStatusChange: (status: SyncStatus) => notifyStatus(status),
      });
      setLastAutoSyncTime();
    } catch (error) {
      console.error('[syncService] 자동 동기화 실패:', error);
    }
  }, config.intervalMinutes * 60 * 1000);

  return stopAutoSync;
}

/**
 * 자동 동기화 중지
 */
export function stopAutoSync(): void {
  if (_autoSyncIntervalId) {
    clearInterval(_autoSyncIntervalId);
    _autoSyncIntervalId = null;
  }
  _activityState = null;
  console.log('[syncService] 자동 동기화 중지');
}
