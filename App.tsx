//의미없는 주석

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { InspectionRecord, QRCodeData, ReportHistory } from './types';
import Dashboard from './components/Dashboard';
import DashboardOverview from './components/DashboardOverview';
import ReportsList from './components/ReportsList';
import QRGenerator from './components/QRGenerator';
import QRScanner from './components/QRScanner';
import ErrorBoundary from './components/ErrorBoundary';
import { LayoutDashboard, ScanLine, Bell, Menu, ShieldCheck, ClipboardList, BarChart3, QrCode, X, FileSpreadsheet, FileUp, Download, Smartphone, MoreVertical, AlertTriangle, LogOut } from 'lucide-react';
import { initIndexedDB, getAllInspectionsWithPhotos, saveInspection, savePhoto, dataURLToBlob, getAllQRCodes, saveAllQRCodes, getAllReports, saveReport, deleteReport as deleteReportFromDB, saveFloorPlanImage, getFloorPlanImage } from './services/indexedDBService';
import { exportToExcel } from './services/excelService';
import ExportReviewModal from './components/ExportReviewModal';
import { INITIAL_INSPECTIONS, generateInitialQRCodes } from './data/initialData';
import { parseInspectionExcel, mergeImportedData } from './services/excelImportService';
import { supabase, isConfigured, getSession, Session } from './services/supabaseClient';
import LoginPage from './components/LoginPage';
import SyncStatusBadge from './components/SyncStatusBadge';
import { pushInspection, pushAllQRCodes, pushReport, pullAll, flushOfflineQueue, SyncStatus } from './services/syncService';

type Page = 'dashboard' | 'dashboard-overview' | 'reports' | 'qr-generator';

// 유틸리티 함수: 날짜 포맷팅 (YYYY-MM-DD hh:mm:ss)
const formatDateTime = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

// ID에서 "1st"를 "F1"으로 변경하는 함수
const migrateIdFloor = (id: string): string => {
  if (id && typeof id === 'string') {
    // DB-1st-001 -> DB-F1-001 형식으로 변경
    // 모든 경우를 처리: DB-1st-001, DB-1st-002 등
    if (id.includes('-1st-')) {
      return id.replace(/-1st-/g, '-F1-');
    }
    // DB-1st-로 시작하는 경우도 처리
    if (id.startsWith('DB-1st-')) {
      return id.replace(/^DB-1st-/, 'DB-F1-');
    }
  }
  return id;
};

// id → panelNo 마이그레이션: 기존 저장 데이터를 새 구조로 변환
const migrateRecordToPanelNo = (item: any): InspectionRecord => {
  const panelNo = (item.panelNo ?? item.id ?? '').toString();
  const { id, ...rest } = item;
  return { ...rest, panelNo: panelNo || 'UNKNOWN' } as InspectionRecord;
};

// 층수 마이그레이션 함수: "1st" -> "F1"
const migrateFloorFormat = (data: any): any => {
  if (typeof data === 'string') {
    if (data.startsWith('DB-')) {
      return migrateIdFloor(data);
    }
    return data === '1st' ? 'F1' : data;
  }
  if (Array.isArray(data)) {
    return data.map(item => migrateFloorFormat(item));
  }
  if (data && typeof data === 'object') {
    const migrated: any = {};
    for (const key in data) {
      if (key === 'floor' && data[key] === '1st') {
        migrated[key] = 'F1';
      } else if (key === 'qrData' && typeof data[key] === 'string') {
        try {
          const qrData = JSON.parse(data[key]);
          if (qrData.id) {
            qrData.id = migrateIdFloor(qrData.id);
          }
          if (qrData.floor === '1st') {
            qrData.floor = 'F1';
          }
          migrated[key] = JSON.stringify(qrData);
        } catch {
          migrated[key] = data[key];
        }
      } else if (key === 'boardId' && typeof data[key] === 'string') {
        migrated[key] = migrateIdFloor(data[key]);
      } else {
        migrated[key] = migrateFloorFormat(data[key]);
      }
    }
    return migrated;
  }
  return data;
};

/**
 * position이 없는 패널에 층별 그리드 좌표를 자동 배정한다.
 * 이미 position이 있는 패널은 변경하지 않는다.
 * @returns [업데이트된 전체 목록, 새로 position이 부여된 panelNo 목록]
 */
function assignDefaultPositions(
  inspections: InspectionRecord[]
): [InspectionRecord[], string[]] {
  // 층별로 position 없는 패널 그룹화
  const unpositioned = inspections.filter(ins => !ins.position);
  if (unpositioned.length === 0) return [inspections, []];

  const byFloor: Record<string, InspectionRecord[]> = {};
  for (const ins of unpositioned) {
    const floor = ins.floor || 'F1';
    if (!byFloor[floor]) byFloor[floor] = [];
    byFloor[floor].push(ins);
  }

  const positionMap: Record<string, { x: number; y: number }> = {};
  for (const [, panels] of Object.entries(byFloor)) {
    const count = panels.length;
    const cols = Math.min(8, count);
    const rows = Math.ceil(count / cols);
    const xStep = 80 / cols;   // 좌우 10% 마진
    const yStep = 80 / rows;   // 상하 10% 마진
    panels.forEach((ins, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      positionMap[ins.panelNo] = {
        x: Math.round(10 + col * xStep + xStep / 2),
        y: Math.round(10 + row * yStep + yStep / 2),
      };
    });
  }

  const updated = inspections.map(ins =>
    positionMap[ins.panelNo]
      ? { ...ins, position: positionMap[ins.panelNo] }
      : ins
  );
  return [updated, Object.keys(positionMap)];
}

const App: React.FC = () => {
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [qrCodes, setQrCodesState] = useState<QRCodeData[]>([]);

  // QR Codes 변경 시 IndexedDB에도 저장
  const setQrCodes = useCallback(async (newQrCodes: QRCodeData[] | ((prev: QRCodeData[]) => QRCodeData[])) => {
    setQrCodesState(prev => {
      const updatedQrCodes = typeof newQrCodes === 'function' ? newQrCodes(prev) : newQrCodes;
      // 비동기로 IndexedDB에 저장
      saveAllQRCodes(updatedQrCodes).catch(error => {
        console.error('QR Codes IndexedDB 저장 오류:', error);
      });
      // Supabase push (fire-and-forget)
      if (session && isConfigured) {
        pushAllQRCodes(updatedQrCodes).catch(console.error);
      }
      return updatedQrCodes;
    });
  }, [session]);
  const [currentPage, setCurrentPage] = useState<Page>('dashboard-overview');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showScanner, setShowScanner] = useState(false);
  const [selectedInspectionId, setSelectedInspectionId] = useState<string | null>(null);
  const [editingReport, setEditingReport] = useState<ReportHistory | null>(null);
  const mainScrollRef = useRef<HTMLElement>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [reports, setReports] = useState<ReportHistory[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showExportPreview, setShowExportPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showUnregisteredModal, setShowUnregisteredModal] = useState(false);
  const [unregisteredPanelNo, setUnregisteredPanelNo] = useState<string>('');

  // PWA 설치 프롬프트 상태
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  // IndexedDB 초기화 및 데이터 로드 (IndexedDB 전용)
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        await initIndexedDB();

        // 1. IndexedDB에서 기존 데이터 로드
        const savedInspections = await getAllInspectionsWithPhotos();
        const savedQRCodes = await getAllQRCodes();

        // 2. 최초 접속 시 초기 데이터 시드 (IndexedDB 비어있을 때만)
        let currentInspections: InspectionRecord[];
        if (savedInspections.length === 0 && savedQRCodes.length === 0) {
          console.log('[초기화] 최초 접속 - 초기 데이터 65면 시드');
          const initialQRCodes = generateInitialQRCodes(INITIAL_INSPECTIONS);

          await Promise.all(INITIAL_INSPECTIONS.map(ins => saveInspection(ins)));
          await saveAllQRCodes(initialQRCodes);

          currentInspections = INITIAL_INSPECTIONS;
          setQrCodesState(initialQRCodes);
        } else {
          currentInspections = savedInspections;
          setQrCodesState(savedQRCodes);
        }

        // 3. Floor Plan 기본 배경 이미지 시드 (8개 층 중 하나라도 없을 때만)
        try {
          const floorImages = await Promise.all([
            getFloorPlanImage('F1'),
            getFloorPlanImage('F2'),
            getFloorPlanImage('F3'),
            getFloorPlanImage('F4'),
            getFloorPlanImage('F5'),
            getFloorPlanImage('F6'),
            getFloorPlanImage('B1'),
            getFloorPlanImage('B2'),
          ]);
          const allFloorsExist = floorImages.every(img => img !== null);

          if (!allFloorsExist) {
            const [basementRes, firstFloorRes] = await Promise.all([
              fetch('/Basement.jpg'),
              fetch('/1st%20Floor.jpg'),
            ]);

            if (basementRes.ok && firstFloorRes.ok) {
              const [basementBlob, firstFloorBlob] = await Promise.all([
                basementRes.blob(),
                firstFloorRes.blob(),
              ]);

              // Basement → B1, B2
              await Promise.all([
                saveFloorPlanImage('B1', basementBlob),
                saveFloorPlanImage('B2', basementBlob),
              ]);

              // 1st Floor → F1~F6
              await Promise.all([
                saveFloorPlanImage('F1', firstFloorBlob),
                saveFloorPlanImage('F2', firstFloorBlob),
                saveFloorPlanImage('F3', firstFloorBlob),
                saveFloorPlanImage('F4', firstFloorBlob),
                saveFloorPlanImage('F5', firstFloorBlob),
                saveFloorPlanImage('F6', firstFloorBlob),
              ]);

              console.log('[초기화] Floor Plan 기본 배경 이미지 8개 층 시드 완료');
            }
          }
        } catch (err) {
          console.warn('[초기화] Floor Plan 이미지 시드 실패 (무시):', err);
        }

        // 4. 차단기 데이터 엑셀 시드 (차단기 데이터가 하나도 없을 때만)
        try {
          const hasBreakers = currentInspections.some(ins => ins.breakers && ins.breakers.length > 0);
          if (!hasBreakers) {
            const excelRes = await fetch('/%EA%B0%80%EC%84%A4%EC%A0%84%EA%B8%B0%EC%A0%90%EA%B2%80_5_2026-01-30.xlsx');
            const contentType = excelRes.headers.get('content-type') || '';
            if (excelRes.ok && !contentType.includes('text/html')) {
              const excelData = await excelRes.arrayBuffer();
              const { panels, errors } = parseInspectionExcel(excelData);

              if (panels.length > 0) {
                const { mergedInspections, stats } = mergeImportedData(panels, currentInspections);

                // IndexedDB에 업데이트된 레코드만 저장
                for (const panelNo of stats.updated) {
                  const updated = mergedInspections.find(ins => ins.panelNo === panelNo);
                  if (updated) await saveInspection(updated);
                }

                currentInspections = mergedInspections;
                console.log(`[초기화] 차단기 엑셀 시드 완료: ${stats.updated.length}개 패널 업데이트`);
                if (errors.length > 0) {
                  console.warn('[초기화] 차단기 엑셀 시드 일부 시트 오류:', errors);
                }
              }
            }
          }
        } catch (err) {
          console.warn('[초기화] 차단기 엑셀 시드 실패 (무시):', err);
        }

        // 4-b. INITIAL_INSPECTIONS 기반 누락 패널 추가 + 차단기 데이터 패치
        try {
          const existingNos = new Set(currentInspections.map(i => i.panelNo));

          // 신규 패널: INITIAL_INSPECTIONS에 있지만 현재 DB에 없는 것 (예: 6-2-4)
          const newPanels = INITIAL_INSPECTIONS.filter(i => !existingNos.has(i.panelNo));

          // 차단기 패치: 기존 패널인데 breakers 없고 INITIAL_INSPECTIONS에는 있는 경우
          const toPatch: InspectionRecord[] = [];
          const patchTimestamp = new Date().toISOString(); // pullAll last-write-wins 대비
          for (const ins of currentInspections) {
            if (ins.breakers && ins.breakers.length > 0) continue;
            const seed = INITIAL_INSPECTIONS.find(i => i.panelNo === ins.panelNo);
            if (seed?.breakers && seed.breakers.length > 0) {
              toPatch.push({
                ...ins,
                breakers: seed.breakers,
                // seed 값을 우선 적용 (예: 5-2-2의 '125'→'150' 수정)
                breakerCapacity: seed.breakerCapacity || ins.breakerCapacity,
                currentL1: seed.currentL1 ?? ins.currentL1,
                currentL2: seed.currentL2 ?? ins.currentL2,
                currentL3: seed.currentL3 ?? ins.currentL3,
                managementNumber: seed.managementNumber || ins.managementNumber,
                // updatedAt을 지금으로 갱신 → pullAll에서 Supabase 구버전이 덮어쓰지 않도록
                updatedAt: patchTimestamp,
              });
            }
          }

          if (newPanels.length > 0 || toPatch.length > 0) {
            await Promise.all([
              ...newPanels.map(ins => saveInspection(ins)),
              ...toPatch.map(ins => saveInspection(ins)),
            ]);
            const patchedNos = new Set(toPatch.map(i => i.panelNo));
            currentInspections = [
              ...currentInspections.map(ins =>
                patchedNos.has(ins.panelNo)
                  ? toPatch.find(p => p.panelNo === ins.panelNo)!
                  : ins
              ),
              ...newPanels,
            ];
            console.log(`[초기화] 패치 완료 - 신규: ${newPanels.length}개 (${newPanels.map(i=>i.panelNo).join(',')}), 차단기 업데이트: ${toPatch.length}개 (${toPatch.map(i=>i.panelNo).join(',')})`);
          }
        } catch (err) {
          console.warn('[초기화] 패널 패치 실패 (무시):', err);
        }

        // 5. position 없는 패널에 기본 위치 자동 배정
        try {
          const [withPositions, assigned] = assignDefaultPositions(currentInspections);
          if (assigned.length > 0) {
            // updatedAt을 현재 시각으로 갱신 → pullAll 때 Supabase 데이터가 덮어쓰지 않도록
            const now = new Date().toISOString();
            const toSave = withPositions
              .filter(ins => assigned.includes(ins.panelNo))
              .map(ins => ({ ...ins, updatedAt: now }));
            await Promise.all(toSave.map(ins => saveInspection(ins)));
            currentInspections = withPositions.map(ins =>
              assigned.includes(ins.panelNo) ? { ...ins, updatedAt: now } : ins
            );
            console.log(`[초기화] 기본 위치 배정 완료: ${assigned.length}개 패널`);
          }
        } catch (err) {
          console.warn('[초기화] 기본 위치 배정 실패 (무시):', err);
        }

        setInspections(currentInspections);

        // 6. Reports 로드
        const savedReports = await getAllReports();
        if (savedReports && savedReports.length > 0) {
          setReports(savedReports);
        }

        console.log(`[데이터 로드] IndexedDB: ${savedInspections.length || INITIAL_INSPECTIONS.length}개 패널, ${savedQRCodes.length || 65}개 QR 코드, ${savedReports.length}개 보고서`);
      } catch (error) {
        console.error('IndexedDB 로드 오류:', error);
        // 오류 발생 시 빈 배열로 시작 (Panel Master에서 등록 필요)
        setInspections([]);
        alert('데이터 로드 중 오류가 발생했습니다.\n새로 시작하려면 Panel Master에서 패널을 등록해주세요.');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, []);

  // PWA 설치 프롬프트 이벤트 리스너
  useEffect(() => {
    // 이미 설치된 앱인지 확인
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    // "다시 보지 않기" 확인
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed) {
      const dismissedTime = parseInt(dismissed, 10);
      // 7일 후에 다시 표시
      if (Date.now() - dismissedTime < 7 * 24 * 60 * 60 * 1000) {
        return;
      }
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // 3초 후에 프롬프트 표시
      setTimeout(() => {
        setShowInstallPrompt(true);
      }, 3000);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // 설치 완료 이벤트
    window.addEventListener('appinstalled', () => {
      setIsInstalled(true);
      setShowInstallPrompt(false);
      setDeferredPrompt(null);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  // Supabase Auth 상태 감지
  useEffect(() => {
    if (!isConfigured) {
      setIsAuthLoading(false);
      return;
    }
    getSession().then(s => {
      setSession(s);
      setIsAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setIsAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  // pullAll 후 position 없는 패널에 기본 위치 재배정
  // + Supabase 구버전이 breaker 데이터를 덮어쓴 경우 재패치
  const applyPositionsAfterSync = useCallback((merged: InspectionRecord[]) => {
    // Supabase pullAll이 breakers 없는 구버전을 가져온 경우 INITIAL_INSPECTIONS로 재패치
    const patchTs = new Date().toISOString();
    const toBePushed: InspectionRecord[] = [];
    const repatchedMerged = merged.map(ins => {
      if (ins.breakers && ins.breakers.length > 0) return ins;
      const seed = INITIAL_INSPECTIONS.find(i => i.panelNo === ins.panelNo);
      if (seed?.breakers && seed.breakers.length > 0) {
        const patched: InspectionRecord = {
          ...ins,
          breakers: seed.breakers,
          breakerCapacity: seed.breakerCapacity || ins.breakerCapacity,
          currentL1: seed.currentL1 ?? ins.currentL1,
          currentL2: seed.currentL2 ?? ins.currentL2,
          currentL3: seed.currentL3 ?? ins.currentL3,
          managementNumber: seed.managementNumber || ins.managementNumber,
          updatedAt: patchTs,
        };
        toBePushed.push(patched);
        return patched;
      }
      return ins;
    });
    // 재패치된 항목을 IDB에 저장 (pullAll 역방향 push가 누락된 경우 대비)
    if (toBePushed.length > 0) {
      Promise.all(toBePushed.map(ins => saveInspection(ins))).catch(console.error);
      console.log(`[syncAfter] breaker 재패치: ${toBePushed.map(i => i.panelNo).join(',')}`);
    }

    const [withPositions, assigned] = assignDefaultPositions(repatchedMerged);
    setInspections(withPositions);
    if (assigned.length > 0) {
      const now = new Date().toISOString();
      const toSave = withPositions
        .filter(ins => assigned.includes(ins.panelNo))
        .map(ins => ({ ...ins, updatedAt: now }));
      Promise.all(toSave.map(ins => saveInspection(ins))).catch(console.error);
    }
  }, []);

  // 로그인 후 pullAll() 실행
  useEffect(() => {
    if (!session || !isConfigured) return;
    pullAll(inspections, qrCodes, reports, {
      onInspectionsUpdated: applyPositionsAfterSync,
      onQRCodesUpdated: (merged) => setQrCodesState(merged),
      onReportsUpdated: (merged) => setReports(merged),
      onSyncStatusChange: (status) => setSyncStatus(status),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // 오프라인 → 온라인 전환 시 큐 플러시
  useEffect(() => {
    if (!isConfigured) return;
    const handleOnline = () => {
      flushOfflineQueue(inspections, qrCodes, reports).catch(console.error);
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspections, qrCodes, reports]);

  // PWA 설치 핸들러
  const handleInstallApp = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;

    if (result.outcome === 'accepted') {
      setShowInstallPrompt(false);
    }
    setDeferredPrompt(null);
  };

  // "다시 보지 않기" 핸들러
  const handleDismissInstall = () => {
    setShowInstallPrompt(false);
    localStorage.setItem('pwa-install-dismissed', Date.now().toString());
  };

  /**
   * inspections 업데이트 함수: panelNo 기준 중복 제거 + IndexedDB 저장
   * PNL NO당 저장 데이터는 항상 1개만 유지 (덮어쓰기 정책)
   * 같은 panelNo가 여러 개 있으면 마지막 항목만 유지
   */
  const updateInspections = useCallback(async (newInspections: InspectionRecord[]) => {
    // panelNo 기준으로 중복 제거: 같은 panelNo가 여러 개 있으면 마지막 항목만 유지
    const seen = new Set<string>();
    const uniqueInspections: InspectionRecord[] = [];
    
    // 역순으로 순회하여 마지막 항목만 유지
    for (let i = newInspections.length - 1; i >= 0; i--) {
      const inspection = newInspections[i];
      if (!seen.has(inspection.panelNo)) {
        seen.add(inspection.panelNo);
        uniqueInspections.unshift(inspection);
      }
    }
    
    setInspections(uniqueInspections);

    // IndexedDB에 저장
    try {
      await Promise.all(
        uniqueInspections.map(async (inspection) => {
          // Inspection 데이터 저장
          await saveInspection(inspection);

          // 사진이 있으면 Blob으로 변환하여 저장 (현장사진 또는 열화상 중 하나라도 있으면 저장)
          const hasPhotoUrl = inspection.photoUrl?.startsWith?.('data:image');
          const hasThermalUrl = inspection.thermalImage?.imageUrl?.startsWith?.('data:image');

          if (hasPhotoUrl || hasThermalUrl) {
            try {
              let photoBlob: Blob | null = null;
              let thermalImageBlob: Blob | null = null;

              if (hasPhotoUrl) {
                photoBlob = dataURLToBlob(inspection.photoUrl!);
              } else if (inspection.photoUrl && !inspection.photoUrl.startsWith('data:image')) {
                console.warn(`PNL NO ${inspection.panelNo}: photoUrl이 Data URL 형식이 아닙니다. 저장하지 않습니다.`);
              }

              if (hasThermalUrl) {
                thermalImageBlob = dataURLToBlob(inspection.thermalImage!.imageUrl!);
              } else if (inspection.thermalImage?.imageUrl && !inspection.thermalImage.imageUrl.startsWith('data:image')) {
                console.warn(`PNL NO ${inspection.panelNo}: thermalImage.imageUrl이 Data URL 형식이 아닙니다. 저장하지 않습니다.`);
              }

              await savePhoto(inspection.panelNo, photoBlob, thermalImageBlob);
            } catch (error) {
              console.error(`PNL NO ${inspection.panelNo} 사진 저장 오류:`, error);
              try {
                await savePhoto(inspection.panelNo, null, null);
              } catch (saveError) {
                console.error(`PNL NO ${inspection.panelNo} 사진 삭제 오류:`, saveError);
              }
            }
          } else {
            // 사진이 없으면 null로 저장 (덮어쓰기)
            await savePhoto(inspection.panelNo, null, null);
          }
        })
      );
    } catch (error) {
      console.error('IndexedDB 저장 오류:', error);
    }

    // Supabase push (fire-and-forget)
    if (session && isConfigured) {
      for (const inspection of uniqueInspections) {
        pushInspection(inspection).catch(console.error);
      }
    }
  }, [session]);

  // 엑셀 Import 후 Reports 병합 핸들러
  const handleReportsImported = useCallback(async (importedReports: ReportHistory[]) => {
    setReports(prev => {
      // reportId 기준 Map으로 병합
      const map = new Map(prev.map(r => [r.reportId, r]));

      importedReports.forEach(r => {
        const existing = map.get(r.reportId);
        if (!existing || new Date(r.generatedAt) >= new Date(existing.generatedAt)) {
          // 기존 항목이 있으면 id 유지 (IndexedDB 키), 없으면 새로 추가
          map.set(r.reportId, existing ? { ...r, id: existing.id } : r);
        }
      });

      return Array.from(map.values())
        .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
    });

    // IndexedDB에도 저장
    for (const r of importedReports) {
      try {
        await saveReport(r);
      } catch (error) {
        console.error(`Report IndexedDB 저장 오류 (${r.reportId}):`, error);
      }
    }
  }, []);

  // 알림 드롭다운 및 더보기 메뉴 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showNotifications && !target.closest('.notification-dropdown')) {
        setShowNotifications(false);
      }
      if (showMoreMenu && !target.closest('.more-menu-dropdown')) {
        setShowMoreMenu(false);
      }
    };

    if (showNotifications || showMoreMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNotifications, showMoreMenu]);

  const handleQRScanSuccess = (qrData: string) => {
    console.log('🔍 QR 스캔 시작:', qrData);
    try {
      // QR 코드 데이터 파싱
      let data: any;
      try {
        data = JSON.parse(qrData);
      } catch (parseError) {
        // JSON이 아닌 경우 직접 파싱 시도
        data = { raw: qrData };
      }

      console.log('📦 파싱된 데이터:', data);

      // 스캔 시간 생성 (YYYY-MM-DD hh:mm:ss 형식)
      const scanTime = formatDateTime();

      // QR 코드에서 PNL NO. 찾기 (id 또는 panelNo)
      const qrPanelNo = data.panelNo || data.pnlNo || data.id || (data.raw && data.raw.includes('DB-') ? data.raw : null) || data.raw || 'UNKNOWN';
      console.log('🏷️ PNL NO:', qrPanelNo);

      // qrCodes에서 매칭되는 QR 찾기 (Panel Master에서 등록한 QR)
      const matchedQR = qrCodes.find((qr: any) => {
        try {
          const qrDataObj = JSON.parse(qr.qrData || '{}');
          // QR 데이터의 id/panelNo와 비교
          const matches = qrDataObj.id === qrPanelNo ||
                         qrDataObj.panelNo === qrPanelNo ||
                         qr.location === data.location;
          console.log('  - 비교:', qrDataObj.id, qrDataObj.panelNo, '===', qrPanelNo, '결과:', matches);
          return matches;
        } catch {
          return false;
        }
      });
      console.log('🔗 matchedQR:', matchedQR);

      // matchedQR에서 데이터 추출
      let matchedQRData: any = {};
      if (matchedQR) {
        try {
          matchedQRData = JSON.parse(matchedQR.qrData || '{}');
          console.log('📋 matchedQRData:', matchedQRData);
        } catch {
          matchedQRData = {};
        }
      }

      // 기존 보드 찾기 (panelNo 기준)
      const existingBoard = inspections.find(i => i.panelNo === qrPanelNo || i.panelNo.includes(qrPanelNo));
      console.log('📋 existingBoard:', existingBoard);

      // 최종 PNL NO 결정
      const finalPanelNo = data.panelNo || data.pnlNo || data.id || matchedQRData.id || matchedQRData.panelNo || qrPanelNo;
      console.log('🎯 최종 PNL NO:', finalPanelNo);

      if (existingBoard) {
        // 기존 보드가 있으면 업데이트
        const updatedBoard: InspectionRecord = {
          ...existingBoard,
          lastInspectionDate: scanTime,
          projectName: data.projectName || matchedQRData.projectName || existingBoard.projectName || '',
          contractor: data.contractor || matchedQRData.contractor || existingBoard.contractor || '',
          managementNumber: data.managementNumber || matchedQRData.managementNumber || existingBoard.managementNumber || finalPanelNo,
          floor: data.floor || matchedQRData.floor || existingBoard.floor,
          tr: data.tr || matchedQRData.tr || matchedQRData.location || existingBoard.tr,
          nominalCrossSection: data.nominalCrossSection || matchedQRData.nominalCrossSection || existingBoard.nominalCrossSection || '',
          breakerCapacity: data.breakerCapacity || matchedQRData.breakerCapacity || existingBoard.breakerCapacity || '',
        };
        setInspections(prev => prev.map(item => item.panelNo === existingBoard.panelNo ? updatedBoard : item));
        console.log('✅ 기존 보드 업데이트, dashboard로 이동');
        setCurrentPage('dashboard');
        setSelectedInspectionId(existingBoard.panelNo);
        setShowScanner(false);
      } else {
        // 미등록 패널 - Modal 표시
        console.log('⚠️ 미등록 패널:', finalPanelNo);
        setUnregisteredPanelNo(finalPanelNo);
        setShowUnregisteredModal(true);
        setShowScanner(false);
      }
    } catch (error) {
      console.error('❌ QR 데이터 처리 오류:', error);
      alert(`QR 코드 스캔 완료!\n데이터: ${qrData}`);
      setShowScanner(false);
    }
  };

  const handleScanButtonClick = useCallback(() => {
    // QR 스캔 버튼 클릭 순간의 시간 생성
    const scanTime = formatDateTime();
    
    if (selectedInspectionId) {
      setInspections(prev => prev.map(item =>
        item.panelNo === selectedInspectionId
          ? { ...item, lastInspectionDate: scanTime }
          : item
      ));
    }
    
    setShowScanner(true);
  }, [selectedInspectionId, setInspections, setShowScanner]);

  // Auth 로딩 중
  if (isAuthLoading && isConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-slate-300 text-sm">인증 확인 중...</p>
        </div>
      </div>
    );
  }

  // 로그인 게이트 (Supabase가 설정된 경우에만)
  if (!session && isConfigured) {
    return <LoginPage onLoginSuccess={() => {}} />;
  }

  return (
    <div className="flex h-screen min-h-[100dvh] bg-slate-50 text-slate-800 overflow-hidden font-sans">
      
      {/* 모바일: 사이드바 열릴 때 배경 클릭 시 닫기 */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      
      {/* Sidebar - 모바일: 오버레이, 데스크톱: 인라인 */}
      <aside className={`
        ${isSidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full w-0 md:translate-x-0'}
        ${isSidebarOpen ? 'md:w-64' : 'md:w-0'}
        fixed md:relative inset-y-0 left-0 z-50 md:z-20
        bg-slate-900 text-white transition-all duration-300 flex flex-col overflow-hidden shadow-xl
      `}>
        <div className="p-6 border-b border-slate-800 flex items-center gap-3">
          <div 
            className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center shrink-0 cursor-pointer hover:bg-blue-600 transition-colors"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          >
            <ShieldCheck size={20} className="text-white" />
          </div>
          <h1
            className="font-bold text-lg tracking-tight whitespace-nowrap cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => {
              setCurrentPage('dashboard-overview');
              setSelectedInspectionId(null);
              setIsSidebarOpen(prev => !prev);
            }}
          >성수동 <span className="text-blue-400">K-PJT</span> <span className="text-slate-500 text-sm font-normal">Ver.30</span></h1>
        </div>
        
        <nav className="flex-1 py-6 px-3 space-y-1">
          <div 
            onClick={() => { setCurrentPage('dashboard-overview'); setIsSidebarOpen(prev => !prev); }}
            className={`px-3 py-2 rounded-lg font-medium flex items-center gap-3 cursor-pointer transition-colors ${
              currentPage === 'dashboard-overview' 
                ? 'bg-slate-800 text-white' 
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <BarChart3 size={20} />
            Dashboard
          </div>
          <div 
            onClick={() => { setCurrentPage('dashboard'); setIsSidebarOpen(prev => !prev); }}
            className={`px-3 py-2 rounded-lg font-medium flex items-center gap-3 cursor-pointer transition-colors ${
              currentPage === 'dashboard' 
                ? 'bg-slate-800 text-white' 
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <LayoutDashboard size={20} />
            Inspection
          </div>
          <div 
            onClick={() => { setCurrentPage('reports'); setIsSidebarOpen(prev => !prev); }}
            className={`px-3 py-2 rounded-lg font-medium flex items-center gap-3 cursor-pointer transition-colors ${
              currentPage === 'reports' 
                ? 'bg-slate-800 text-white' 
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <ClipboardList size={20} className={currentPage === 'reports' ? '' : 'opacity-70'}/>
            Reports
          </div>
          <div 
            onClick={() => { setCurrentPage('qr-generator'); setIsSidebarOpen(prev => !prev); }}
            className={`px-3 py-2 rounded-lg font-medium flex items-center gap-3 cursor-pointer transition-colors ${
              currentPage === 'qr-generator' 
                ? 'bg-slate-800 text-white' 
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <QrCode size={20} className={currentPage === 'qr-generator' ? '' : 'opacity-70'}/>
            Panel Master
          </div>
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-3">
          {/* 설치 파일 다운로드 버튼 - 웹에서만 표시 (Electron에서는 숨김) */}
          {!(window as any).electronAPI && (
            <a
              href="https://github.com/sojunghan2000-droid/Panel-Inspector/releases/download/v1.1.0/Panel.Inspector.Setup.1.1.0.exe"
              download
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm transition-colors bg-blue-600 hover:bg-blue-700 text-white cursor-pointer no-underline"
            >
              <Download size={18} />
              앱 설치 다운로드
            </a>
          )}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 shrink-0"></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{session?.user?.email ?? 'Admin User'}</p>
              <p className="text-xs text-slate-500">Facility Manager</p>
            </div>
            {session && (
              <button
                onClick={() => supabase.auth.signOut()}
                title="로그아웃"
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors shrink-0"
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-0 h-screen overflow-hidden relative">
        
        {/* Topbar */}
        <header className="h-16 min-h-[44px] shrink-0 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6 shadow-sm z-10">
          <div className="flex items-center gap-2 md:gap-4 min-w-0">
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center">
              <Menu size={20} />
            </button>
            <h2 className="text-sm md:text-lg font-semibold text-slate-800 truncate">Distribution Board Manager</h2>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            {/* 동기화 상태 배지 */}
            <SyncStatusBadge
              status={syncStatus}
              isConfigured={isConfigured}
              onManualSync={() => {
                if (!session) return;
                pullAll(inspections, qrCodes, reports, {
                  onInspectionsUpdated: applyPositionsAfterSync,
                  onQRCodesUpdated: (merged) => setQrCodesState(merged),
                  onReportsUpdated: (merged) => setReports(merged),
                  onSyncStatusChange: (status) => setSyncStatus(status),
                });
              }}
            />

            {/* QR Scan 버튼 - 헤더 */}
            <button
              onClick={() => setShowScanner(true)}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg shadow-sm hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              <ScanLine size={16} />
              <span>QR Scan</span>
            </button>

            {/* 더보기 메뉴 버튼 - 항상 표시 */}
            <div className="relative more-menu-dropdown">
              <button
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
              >
                <MoreVertical size={20} />
              </button>

              {/* 더보기 드롭다운 메뉴 */}
              {showMoreMenu && (
                <div className="absolute right-0 top-10 w-52 bg-white rounded-lg shadow-xl border border-slate-200 z-50 py-1">
                  {/* 엑셀 내보내기 */}
                  <button
                    onClick={() => {
                      setShowExportPreview(true);
                      setShowMoreMenu(false);
                    }}
                    disabled={isExporting}
                    className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3 disabled:opacity-50"
                  >
                    <FileSpreadsheet size={18} className="text-emerald-600" />
                    {isExporting ? '내보내는 중...' : '엑셀 내보내기'}
                  </button>

                  {/* 엑셀 입력 */}
                  <label className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3 cursor-pointer">
                    <FileUp size={18} className="text-blue-600" />
                    {isImporting ? '로딩 중...' : '엑셀 입력'}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;

                        setIsImporting(true);
                        setShowMoreMenu(false);

                        try {
                          const reader = new FileReader();
                          reader.onload = async (event) => {
                            try {
                              const data = event.target?.result as ArrayBuffer;
                              if (!data) {
                                alert('파일을 읽을 수 없습니다.');
                                setIsImporting(false);
                                return;
                              }

                              // Dashboard 페이지로 이동
                              setCurrentPage('dashboard');

                              // Dashboard의 파일 입력을 트리거
                              setTimeout(() => {
                                const dashboardExcelInput = document.querySelector('[data-excel-import-button] input[type="file"]') as HTMLInputElement;
                                if (dashboardExcelInput) {
                                  // 파일을 Dashboard의 input에 설정
                                  const dataTransfer = new DataTransfer();
                                  dataTransfer.items.add(new File([data], file.name));
                                  dashboardExcelInput.files = dataTransfer.files;
                                  dashboardExcelInput.dispatchEvent(new Event('change', { bubbles: true }));
                                }
                              }, 300);
                            } catch (error) {
                              console.error('엑셀 파일 읽기 오류:', error);
                              alert('엑셀 파일을 읽는 중 오류가 발생했습니다.');
                            } finally {
                              setIsImporting(false);
                              if (fileInputRef.current) {
                                fileInputRef.current.value = '';
                              }
                            }
                          };
                          reader.onerror = () => {
                            alert('파일 읽기 중 오류가 발생했습니다.');
                            setIsImporting(false);
                            if (fileInputRef.current) {
                              fileInputRef.current.value = '';
                            }
                          };
                          reader.readAsArrayBuffer(file);
                        } catch (error) {
                          console.error('엑셀 파일 처리 오류:', error);
                          alert('엑셀 파일 처리 중 오류가 발생했습니다.');
                          setIsImporting(false);
                          if (fileInputRef.current) {
                            fileInputRef.current.value = '';
                          }
                        }
                      }}
                      className="hidden"
                      disabled={isImporting}
                    />
                  </label>

                </div>
              )}
            </div>

            {/* 알림 아이콘 - 항상 표시 */}
            <div className="relative notification-dropdown">
              <Bell 
                size={20} 
                className="text-slate-500 cursor-pointer hover:text-slate-700" 
                onClick={() => setShowNotifications(!showNotifications)}
              />
              {reports.length > 0 && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
              )}
              
              {/* 알림 드롭다운 */}
              {showNotifications && (
                <div className="absolute right-0 top-10 w-80 bg-white rounded-lg shadow-xl border border-slate-200 z-50 max-h-96 overflow-y-auto notification-dropdown">
                  <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-semibold text-slate-800">알림</h3>
                    <button
                      onClick={() => setShowNotifications(false)}
                      className="p-1 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-700"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  
                  {reports.length === 0 ? (
                    <div className="p-6 text-center text-slate-500">
                      <p className="text-sm">알림이 없습니다</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {reports.slice(0, 10).map((report) => (
                        <div
                          key={report.id}
                          className="p-4 hover:bg-slate-50 cursor-pointer transition-colors"
                          onClick={() => {
                            setCurrentPage('reports');
                            setShowNotifications(false);
                          }}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-slate-800 mb-1">
                                {report.reportId}
                              </p>
                              <p className="text-xs text-slate-600 mb-1">
                                PNL NO.: {report.boardId}
                              </p>
                              <p className="text-xs text-slate-500">
                                {new Date(report.generatedAt).toLocaleString('ko-KR', {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </p>
                            </div>
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              report.status === 'Complete' 
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : report.status === 'In Progress'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-slate-50 text-slate-600 border border-slate-200'
                            }`}>
                              {report.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {reports.length > 10 && (
                    <div className="p-3 border-t border-slate-200 text-center">
                      <button
                        onClick={() => {
                          setCurrentPage('reports');
                          setShowNotifications(false);
                        }}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                      >
                        모든 알림 보기 ({reports.length})
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main ref={mainScrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 md:p-6 relative">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mx-auto mb-4"></div>
                <p className="text-slate-600">데이터를 불러오는 중...</p>
              </div>
            </div>
          ) : (
            <>
              {currentPage === 'dashboard-overview' ? (
                <DashboardOverview
                  inspections={inspections}
                  onUpdateInspections={updateInspections}
                  selectedInspectionId={selectedInspectionId}
                  onSelectionChange={setSelectedInspectionId}
                  reports={reports}
                />
              ) : currentPage === 'dashboard' ? (
                <ErrorBoundary>
                  <Dashboard
                    inspections={inspections}
                    onUpdateInspections={updateInspections}
                    onScan={() => setShowScanner(true)}
                    selectedInspectionId={selectedInspectionId}
                    onSelectionChange={setSelectedInspectionId}
                    onReportGenerated={async (report) => {
                      // Non-Complete 수정 시 기존 보고서 교체, Complete 시 신규 추가
                      setReports(prev => {
                        const idx = prev.findIndex(r => r.id === report.id);
                        if (idx >= 0) {
                          const next = [...prev];
                          next[idx] = report;
                          return next;
                        }
                        return [report, ...prev];
                      });
                      await saveReport(report); // IndexedDB에도 저장
                      if (session && isConfigured) pushReport(report).catch(console.error);
                    }}
                    onReportsUpdate={(newReports) => setReports(newReports)}
                    qrCodes={qrCodes}
                    reports={reports}
                    editingReport={editingReport}
                    onEditingReportClear={() => setEditingReport(null)}
                  />
                </ErrorBoundary>
              ) : currentPage === 'reports' ? (
                <ReportsList
                  reports={reports}
                  onDeleteReport={async (id) => {
                    setReports(prev => prev.filter(r => r.id !== id));
                    await deleteReportFromDB(id); // IndexedDB에서도 삭제
                  }}
                  inspections={inspections}
                  onEditReport={(boardId, report) => {
                    // Inspection 페이지로 이동하면서 해당 패널 선택
                    // Complete/Non-Complete 모두 editingReport에 전달 (handleSave에서 분기 처리)
                    setEditingReport(report);
                    setSelectedInspectionId(boardId);
                    setCurrentPage('dashboard');
                  }}
                  onReportsImported={handleReportsImported}
                />
              ) : (
                <QRGenerator 
                  inspections={inspections}
                  qrCodes={qrCodes}
                  onQrCodesChange={setQrCodes}
                  onSelectInspection={(inspectionId) => {
                    setSelectedInspectionId(inspectionId);
                  }}
                  onUpdateInspections={updateInspections}
                  mainScrollRef={mainScrollRef}
                />
              )}
            </>
          )}
        </main>

        {/* QR Scanner Modal */}
        {showScanner && (
          <QRScanner
            onScanSuccess={handleQRScanSuccess}
            onClose={() => setShowScanner(false)}
          />
        )}

        {/* 미등록 패널 Modal */}
        {showUnregisteredModal && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-[90%] max-w-md mx-4 overflow-hidden animate-fade-in">
              {/* Header */}
              <div className="flex items-center gap-3 px-6 py-4 bg-amber-50 border-b border-amber-200">
                <div className="p-2 bg-amber-100 rounded-full">
                  <AlertTriangle size={24} className="text-amber-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-800">미등록 패널</h3>
              </div>
              {/* Body */}
              <div className="px-6 py-5">
                <p className="text-gray-700 text-sm leading-relaxed">
                  스캔된 패널 <span className="font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded">{unregisteredPanelNo}</span> 은(는) 등록되지 않은 패널입니다.
                </p>
                <p className="text-gray-500 text-xs mt-3">
                  Panel Master에서 해당 패널을 먼저 등록해주세요.
                </p>
              </div>
              {/* Footer */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
                <button
                  onClick={() => {
                    // 신규 패널 등록 후 Inspection으로 이동
                    const newItem: InspectionRecord = {
                      panelNo: unregisteredPanelNo,
                      status: 'Pending' as const,
                      lastInspectionDate: formatDateTime(),
                      loads: { welder: false, grinder: false, light: false, pump: false },
                      photoUrl: null,
                      memo: '',
                      floor: 'F1',
                      breakerCapacity: '',
                    };
                    setInspections(prev => [newItem, ...prev]);
                    setShowUnregisteredModal(false);
                    setUnregisteredPanelNo('');
                    setCurrentPage('dashboard');
                    setSelectedInspectionId(newItem.panelNo);
                  }}
                  className="px-6 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
                >
                  신규 등록
                </button>
                <button
                  onClick={() => {
                    setShowUnregisteredModal(false);
                    setUnregisteredPanelNo('');
                  }}
                  className="px-6 py-2.5 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 엑셀 내보내기 검토 모달 */}
        {showExportPreview && (
          <ExportReviewModal
            inspections={inspections}
            onConfirm={async () => {
              setIsExporting(true);
              try {
                await exportToExcel(inspections, qrCodes, reports);
                setShowExportPreview(false);
                alert(`엑셀 내보내기가 완료되었습니다.\n${inspections.length}개의 분전반 데이터가 내보내졌습니다.`);
              } catch (error) {
                console.error('엑셀 내보내기 오류:', error);
                alert('엑셀 내보내기 중 오류가 발생했습니다.\n오류: ' + (error instanceof Error ? error.message : String(error)));
              } finally {
                setIsExporting(false);
              }
            }}
            onCancel={() => setShowExportPreview(false)}
            isExporting={isExporting}
          />
        )}

        {/* PWA 설치 프롬프트 배너 */}
        {showInstallPrompt && !isInstalled && (
          <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg animate-fade-in-up">
            <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg">
                  <Smartphone size={24} />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">앱으로 설치하기</h3>
                  <p className="text-blue-100 text-sm">홈 화면에 추가하여 더 빠르게 접근하세요</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDismissInstall}
                  className="px-4 py-2 text-blue-100 hover:text-white hover:bg-white/10 rounded-lg transition-colors text-sm"
                >
                  나중에
                </button>
                <button
                  onClick={handleInstallApp}
                  className="px-4 py-2 bg-white text-blue-600 font-medium rounded-lg hover:bg-blue-50 transition-colors flex items-center gap-2"
                >
                  <Download size={18} />
                  설치하기
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;