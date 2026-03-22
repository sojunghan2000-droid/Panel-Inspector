import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import { QrCode, Download, Printer, MapPin, Building2, FileText, Calendar, Trash2, Eye, Edit2, X, Save, Search, Hash, Zap, GitBranch, ChevronLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { InspectionRecord, getTrLetter } from '../types';
import FloorPlanView from './FloorPlanView';
import TRSystemModal from './TRSystemModal';
import { exportQRBatchToExcel } from '../services/excelService';

/** PNL NO. 형식: 층 1=F1, 2=F2, …, 6=F6, 7=B1, 8=B2 / TR letter A,B → 1,2 */
const FLOOR_TO_NUM: Record<string, string> = { F1: '1', F2: '2', F3: '3', F4: '4', F5: '5', F6: '6', B1: '7', B2: '8' };
const NUM_TO_FLOOR: Record<string, string> = {
  '1': 'F1', '2': 'F2', '3': 'F3', '4': 'F4', '5': 'F5', '6': 'F6', '7': 'B1', '8': 'B2',
};
const TR_TO_NUM: Record<string, string> = { A: '1', B: '2' };
const NUM_TO_TR: Record<string, string> = { '1': 'A', '2': 'B' };

/** TR full string 또는 letter가 유효한 TR 계통인지 확인 */
function isValidTR(v: string): boolean {
  const letter = getTrLetter(v) || v?.toUpperCase();
  return letter === 'A' || letter === 'B';
}

/** 층(F1/B1) + TR full string or letter → PNL NO.(1-1, 2-1 등) */
function toPnlNo(floor: string, location: string): string {
  const f = FLOOR_TO_NUM[floor] || floor;
  const letter = getTrLetter(location) || location?.toUpperCase();
  const l = TR_TO_NUM[letter] ?? location;
  return `${f}-${l}`;
}

/** PNL NO.(1, 1-1, 2-1, 3-1-1)에서 층 추출 → F1/B1 */
function pnlNoToFloor(pnlNo: string): string {
  if (!pnlNo || typeof pnlNo !== 'string') return 'F1';
  const parts = pnlNo.trim().split('-');
  const first = parts[0]?.trim() || '';
  return NUM_TO_FLOOR[first] || (first === '1' ? 'F1' : first === '7' ? 'B1' : 'F1');
}

/** 목록 표시용: 층 값(1~8 또는 F1/B1) → F1, F2, … F6, B1, B2 */
const FLOOR_DISPLAY: Record<string, string> = {
  '1': 'F1', '2': 'F2', '3': 'F3', '4': 'F4', '5': 'F5', '6': 'F6',
  '7': 'B1', '8': 'B2',
  'F1': 'F1', 'F2': 'F2', 'F3': 'F3', 'F4': 'F4', 'F5': 'F5', 'F6': 'F6',
  'B1': 'B1', 'B2': 'B2',
};
function floorToDisplayLabel(floor: string): string {
  if (!floor) return '';
  const key = String(floor).trim().toUpperCase();
  return FLOOR_DISPLAY[key] ?? floor;
}

/** InspectionRecord -> QR JSON 문자열 변환 */
const toQRString = (ins: InspectionRecord): string => JSON.stringify({
  id: ins.panelNo,
  location: ins.tr ?? '',
  floor: ins.floor ?? '',
  positionX: String(ins.position?.x ?? 0),
  positionY: String(ins.position?.y ?? 0),
  contractor: ins.contractor ?? '',
  projectName: ins.projectName ?? '',
  nominalCrossSection: ins.nominalCrossSection ?? '',
  breakerCapacity: ins.breakerCapacity ?? '',
});

interface QRData {
  id: string;
  location: string;
  floor: string;
  position: string;
  positionX: string;
  positionY: string;
  contractor: string;
  projectName: string;
  nominalCrossSection: string;
  breakerCapacity: string;
}

interface QRGeneratorProps {
  inspections: InspectionRecord[];
  onSelectInspection?: (inspectionId: string) => void;
  onUpdateInspections?: (inspections: InspectionRecord[]) => void;
  onDeleteInspection?: (panelNo: string) => void;
  /** main 스크롤 유지용 (App의 main ref) */
  mainScrollRef?: React.RefObject<HTMLElement | null>;
  /** Supabase Storage URL 목록 (FloorPlanView에 전달) */
  floorPlanUrls?: { floor: string; url: string }[];
}

const QRGenerator: React.FC<QRGeneratorProps> = ({
  inspections = [],
  onSelectInspection,
  onUpdateInspections,
  onDeleteInspection,
  mainScrollRef,
  floorPlanUrls = []
}) => {

  const [selectedFloor, setSelectedFloor] = useState<string>('F1');
  const [qrData, setQrData] = useState<QRData>({
    id: '', // PNL NO. 자유 입력 (예: 1, 1-1, 1-1-1)
    location: 'TR-1(A) 900KVA',
    floor: 'F1',
    position: '',
    positionX: '',
    positionY: '',
    contractor: '삼성물산',
    projectName: '성수동 K-PJT',
    nominalCrossSection: '', breakerCapacity: ''
  });
  const [generatedQR, setGeneratedQR] = useState<string | null>(null);
  const [savedQRId, setSavedQRId] = useState<string | null>(null);
  const [selectedQR, setSelectedQR] = useState<InspectionRecord | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isSelectFocused, setIsSelectFocused] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  // showForm: 신규 등록 모드 플래그 (selectedQR 없이 폼 표시)
  const [showTRSystemModal, setShowTRSystemModal] = useState(false);
  const [trPanelExpanded, setTrPanelExpanded] = useState(false);
  /** 모바일: 도면보기 모드 (Left→Right 패널 전환) */
  const [showFloorPlanMobile, setShowFloorPlanMobile] = useState(false);
  const [sortField, setSortField] = useState<'panelNo'|'createdAt'|'tr'|'floor'>('panelNo');
  const [sortDirection, setSortDirection] = useState<'asc'|'desc'>('asc');
  const [searchText, setSearchText] = useState('');
  /** true일 때만 FloorPlanView 상세 패널(모달) 표시 - "Dashboard에 위치 매핑" 클릭 시 true */
  const [openDetailPanelForMapping, setOpenDetailPanelForMapping] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteInspectionConfirmId, setDeleteInspectionConfirmId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [selectedPanelNos, setSelectedPanelNos] = useState<Set<string>>(new Set());
  const [isBulkLoading, setIsBulkLoading] = useState(false);
  const [bulkFloor, setBulkFloor] = useState<string>('F1');
  const [bulkTrNo, setBulkTrNo] = useState<string>('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg(msg);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2500);
  };
  const rightPanelScrollRef = useRef<HTMLDivElement>(null);
  const panelDetailSectionRef = useRef<HTMLDivElement>(null);
  const savedMainScrollOnInteractionRef = useRef<number>(0);
  const savedRightScrollOnInteractionRef = useRef<number>(0);
  // 편집 시 dirty 추적용: selectForEdit/handleSelectInspection 호출 시 초기값 저장
  const initialQrDataRef = useRef<QRData | null>(null);
  const inspectionsRef = useRef<InspectionRecord[]>([]);
  useEffect(() => { inspectionsRef.current = inspections; }, [inspections]);

  const restoreMainScrollOnFocus = useCallback(() => {
    // onFocus 시점의 현재 scroll 위치를 캡처하여 복원 (브라우저 포커스 스크롤 방지)
    const snapMain = mainScrollRef?.current?.scrollTop ?? 0;
    const snapRight = rightPanelScrollRef.current?.scrollTop ?? 0;
    const restore = () => {
      if (mainScrollRef?.current != null) {
        mainScrollRef.current.scrollTop = snapMain;
      }
      if (rightPanelScrollRef.current != null) {
        rightPanelScrollRef.current.scrollTop = snapRight;
      }
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(restore);
    });
    setTimeout(restore, 80);
  }, [mainScrollRef]);

  /** 패널 상세 정보 섹션으로 스크롤 */
  const scrollToPanelDetail = useCallback(() => {
    setTimeout(() => {
      if (panelDetailSectionRef.current && rightPanelScrollRef.current) {
        const container = rightPanelScrollRef.current;
        const target = panelDetailSectionRef.current;
        // 컨테이너 기준 상대 offsetTop 계산 후 직접 스크롤 (scrollIntoView는 window 스크롤을 타겟팅할 수 있음)
        const targetOffsetTop = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
        container.scrollTo({ top: targetOffsetTop, behavior: 'smooth' });
      }
    }, 120);
  }, []);

  /** FloorPlanView 위젯(마커)으로 스크롤 */
  const scrollToFloorPlanWidget = useCallback((panelNo: string) => {
    setTimeout(() => {
      // FloorPlanView 내의 해당 마커로 스크롤
      const markerElement = document.querySelector(`[data-marker-id="${panelNo}"]`) as HTMLElement;
      if (markerElement) {
        markerElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        // 마커 강조 효과
        markerElement.style.transform = 'scale(1.5)';
        setTimeout(() => {
          markerElement.style.transform = '';
        }, 1000);
      }
    }, 100);
  }, []);

  /** 버튼 클릭 후 리렌더/alert 등으로 스크롤이 바뀐 뒤 여러 번 복원 (onMouseDown에서 저장된 값 사용) */
  const restoreScrollAfterAction = useCallback(() => {
    const restore = () => {
      if (mainScrollRef?.current != null) {
        mainScrollRef.current.scrollTop = savedMainScrollOnInteractionRef.current;
      }
      if (rightPanelScrollRef.current != null) {
        rightPanelScrollRef.current.scrollTop = savedRightScrollOnInteractionRef.current;
      }
    };
    [120, 280, 450].forEach((ms) => setTimeout(restore, ms));
  }, [mainScrollRef]);

  // (registerAllQRCodesAsInspections, autoGenerateQR 삭제됨 - QR은 InspectionRecord에서 on-the-fly 생성)

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

  // 층수 마이그레이션 함수: "1st" -> "F1"
  const migrateFloorFormat = (data: any): any => {
    if (typeof data === 'string') {
      // ID 형식인지 확인 (DB-로 시작)
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
        if (key === 'id' && typeof data[key] === 'string') {
          // ID 마이그레이션
          migrated[key] = migrateIdFloor(data[key]);
        } else if (key === 'floor' && data[key] === '1st') {
          migrated[key] = 'F1';
        } else if (key === 'qrData' && typeof data[key] === 'string') {
          try {
            const qrData = JSON.parse(data[key]);
            // 신규 형식 (pnl_no 존재) - 변환 불필요
            if (!qrData.pnl_no) {
              if (qrData.id) {
                qrData.id = migrateIdFloor(qrData.id);
              }
              if (qrData.floor === '1st') {
                qrData.floor = 'F1';
              }
            }
            migrated[key] = JSON.stringify(qrData);
          } catch {
            migrated[key] = data[key];
          }
        } else {
          migrated[key] = migrateFloorFormat(data[key]);
        }
      }
      return migrated;
    }
    return data;
  };

  const handleInputChange = (field: keyof QRData, value: string) => {
    setQrData(prev => {
      const updated = {
        ...prev,
        [field]: value
      };
      
      // PNL NO. 입력 시 자동으로 층수와 TR 추출 (형식: 1, 2, 1-1, 2-1, 3-1-1)
      if (field === 'id' && value) {
        const idParts = value.trim().split('-').map((p: string) => p.trim());
        if (idParts.length === 1 && idParts[0]) {
          // 1 또는 2 → 층만
          const floorFromId = NUM_TO_FLOOR[idParts[0]] || '';
          if (floorFromId && (!updated.floor || updated.floor !== floorFromId)) {
            updated.floor = floorFromId;
          }
        } else if (idParts.length >= 2) {
          const floorFromId = NUM_TO_FLOOR[idParts[0]] || '';
          const locationFromId = NUM_TO_TR[idParts[1]] || idParts[1];
          if (floorFromId && (!updated.floor || updated.floor !== floorFromId)) {
            updated.floor = floorFromId;
          }
          if (locationFromId && isValidTR(locationFromId.toUpperCase()) && (!updated.location || updated.location !== locationFromId.toUpperCase())) {
            updated.location = locationFromId.toUpperCase();
          }
        }
      }
      
      // 유효한 층수 목록
      const validFloors = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'B1', 'B2'];

      // 층수 필드 변경 시 selectedFloor 동기화 제거 (스크롤 이동 방지)

      // 층수와 위치가 모두 입력되면 자동으로 QR 생성 (선택된 QR 편집 중일 때는 제외)
      const hasFloor = updated.floor && validFloors.includes(updated.floor);
      const hasLocation = updated.location && updated.location.trim() !== '';
      
      if (hasFloor && hasLocation && !selectedQR) {
        // PNL NO.가 없으면 자동 생성: 1-1, 2-1 형식 (F1/B1 + A/B/C/D)
        if (!updated.id || updated.id.trim() === '') {
          updated.id = toPnlNo(updated.floor, updated.location);
        }
      }
      
      return updated;
    });
  };

  const handleSelectInspection = (ins: InspectionRecord) => {
    setSelectedQR(ins);
    const loc = ins.tr || 'TR-1(A) 900KVA';
    const data: QRData = {
      id: ins.panelNo || '',
      location: loc,
      floor: ins.floor || 'F1',
      position: '',
      positionX: ins.position?.x ? String(ins.position.x) : '',
      positionY: ins.position?.y ? String(ins.position.y) : '',
      contractor: ins.contractor || '삼성물산',
      projectName: ins.projectName || '성수동 K-PJT',
      nominalCrossSection: ins.nominalCrossSection || '',
      breakerCapacity: ins.breakerCapacity || ''
    };
    setQrData(data);
    initialQrDataRef.current = { ...data };
    setIsEditing(false);
  };

  // (findOrCreateInspection 삭제됨 - QR 코드에서 inspection 생성 불필요)

  const selectForEdit = (ins: InspectionRecord) => {
    setSelectedQR(ins);
    setIsEditing(true);
    setShowForm(false);
    const loc = ins.tr || 'TR-1(A) 900KVA';
    const data: QRData = {
      id: ins.panelNo || '',
      location: loc,
      floor: ins.floor || 'F1',
      position: '',
      positionX: ins.position?.x ? String(ins.position.x) : '',
      positionY: ins.position?.y ? String(ins.position.y) : '',
      contractor: ins.contractor || '삼성물산',
      projectName: ins.projectName || '성수동 K-PJT',
      nominalCrossSection: ins.nominalCrossSection || '',
      breakerCapacity: ins.breakerCapacity || ''
    };
    setQrData(data);
    initialQrDataRef.current = data;
    setGeneratedQR(toQRString(ins));
  };

  const handleEditInspection = (ins: InspectionRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).blur();
    const savedRightScroll = rightPanelScrollRef.current?.scrollTop ?? 0;
    const savedMainScroll = mainScrollRef?.current?.scrollTop ?? 0;
    selectForEdit(ins);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (rightPanelScrollRef.current) {
          rightPanelScrollRef.current.scrollTop = savedRightScroll;
        }
        if (mainScrollRef?.current) {
          mainScrollRef.current.scrollTop = savedMainScroll;
        }
      });
    });
  };

  const handleUpdateInspection = () => {
    if (!selectedQR || !qrData.location || !qrData.floor) {
      showToast('모든 필드를 입력해주세요.');
      return;
    }

    const finalId = qrData.id?.trim() || (isValidTR(qrData.location) ? toPnlNo(qrData.floor, qrData.location) : `${FLOOR_TO_NUM[qrData.floor] || qrData.floor}-${qrData.location}`);

    // inspection 직접 업데이트
    if (onUpdateInspections) {
      const currentInspections = inspectionsRef.current;
      const updatedInspections = currentInspections.map(ins => {
        if (ins.panelNo === selectedQR.panelNo) {
          return {
            ...ins,
            floor: qrData.floor,
            tr: qrData.location,
            position: {
              x: qrData.positionX ? parseFloat(qrData.positionX) : (ins.position?.x ?? 0),
              y: qrData.positionY ? parseFloat(qrData.positionY) : (ins.position?.y ?? 0),
            },
            contractor: qrData.contractor || ins.contractor,
            projectName: qrData.projectName || ins.projectName,
            nominalCrossSection: qrData.nominalCrossSection || ins.nominalCrossSection,
            breakerCapacity: qrData.breakerCapacity || ins.breakerCapacity,
            updatedAt: new Date().toISOString(),
          };
        }
        return ins;
      });
      onUpdateInspections(updatedInspections);

      // selectedQR를 업데이트된 inspection으로 교체
      const updatedIns = updatedInspections.find(ins => ins.panelNo === selectedQR.panelNo);
      if (updatedIns) {
        setSelectedQR(updatedIns);
        const newData: QRData = {
          id: updatedIns.panelNo,
          location: updatedIns.tr || qrData.location,
          floor: updatedIns.floor || qrData.floor,
          position: '',
          positionX: updatedIns.position?.x ? String(updatedIns.position.x) : '',
          positionY: updatedIns.position?.y ? String(updatedIns.position.y) : '',
          contractor: updatedIns.contractor || '삼성물산',
          projectName: updatedIns.projectName || '성수동 K-PJT',
          nominalCrossSection: updatedIns.nominalCrossSection || '',
          breakerCapacity: updatedIns.breakerCapacity || ''
        };
        setQrData(newData);
        initialQrDataRef.current = { ...newData };
        setGeneratedQR(toQRString(updatedIns));
      }
    }

    setIsEditing(false);
    setSelectedFloor(qrData.floor);
    showToast('패널 정보가 수정되었습니다.');
    restoreScrollAfterAction();
  };

  const handleDeletePanel = (panelNo: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirmId(panelNo);
  };

  const confirmDeleteQR = () => {
    if (!deleteConfirmId) return;
    // deleteConfirmId는 이제 panelNo
    onDeleteInspection?.(deleteConfirmId);
    if (selectedQR?.panelNo === deleteConfirmId) {
      setSelectedQR(null);
      setGeneratedQR(null);
      setQrData({ id: '', location: 'A', floor: selectedFloor, position: '', positionX: '', positionY: '', contractor: '삼성물산', projectName: '성수동 K-PJT', nominalCrossSection: '', breakerCapacity: '' });
      setIsEditing(false);
    }
    setDeleteConfirmId(null);
    showToast('패널이 삭제되었습니다.');
  };

  const confirmDeleteInspection = () => {
    if (!deleteInspectionConfirmId) return;
    onDeleteInspection?.(deleteInspectionConfirmId);
    setDeleteInspectionConfirmId(null);
    showToast('패널이 삭제되었습니다.');
  };

  const handleMapToDashboard = () => {
    const panelId = selectedQR?.panelNo;
    if (!panelId) {
      showToast('패널 ID를 찾을 수 없습니다. 패널을 다시 선택해주세요.');
      return;
    }
    if (!onSelectInspection) {
      showToast('위치 매핑 기능을 사용할 수 없습니다.');
      return;
    }
    setOpenDetailPanelForMapping(true);
    onSelectInspection(panelId);
    restoreScrollAfterAction();
  };

  const generateQR = () => {
    // ID 기반으로 위치, 층수 정보 자동 설정
    let finalLocation = qrData.location;
    let finalFloor = qrData.floor;

    if (qrData.id && (!finalLocation || !finalFloor)) {
      const idParts = qrData.id.trim().split('-').map((p: string) => p.trim());
      if (idParts.length === 1 && idParts[0]) {
        if (!finalFloor) finalFloor = NUM_TO_FLOOR[idParts[0]] || (idParts[0] === '1' ? 'F1' : idParts[0] === '7' ? 'B1' : '');
      } else if (idParts.length >= 2) {
        if (!finalFloor) finalFloor = NUM_TO_FLOOR[idParts[0]] || (idParts[0] === '1' ? 'F1' : idParts[0] === '7' ? 'B1' : '');
        if (!finalLocation) finalLocation = NUM_TO_TR[idParts[1]] || idParts[1];
      }
      if (!finalFloor) finalFloor = 'F1';
      if (!finalLocation) finalLocation = 'TR-1(A) 900KVA';
    }

    if (!finalLocation || !finalFloor) {
      showToast('PNL NO., 층수를 모두 입력해주세요.');
      return;
    }

    let finalId = qrData.id?.trim() || (isValidTR(finalLocation) ? toPnlNo(finalFloor, finalLocation) : `${FLOOR_TO_NUM[finalFloor] || finalFloor}-${finalLocation}`);

    if (isEditing && selectedQR) {
      handleUpdateInspection();
      return;
    }

    // 새 InspectionRecord 생성
    const newInspection: InspectionRecord = {
      panelNo: finalId,
      status: 'Pending',
      lastInspectionDate: '-',
      loads: { welder: false, grinder: false, light: false, pump: false },
      photoUrl: null,
      memo: '',
      floor: finalFloor,
      tr: finalLocation,
      position: {
        x: qrData.positionX ? parseFloat(qrData.positionX) : 50,
        y: qrData.positionY ? parseFloat(qrData.positionY) : 50,
      },
      contractor: qrData.contractor || '',
      projectName: qrData.projectName || '',
      nominalCrossSection: qrData.nominalCrossSection || '',
      breakerCapacity: qrData.breakerCapacity || '',
      managementNumber: '',
    };

    if (onUpdateInspections) {
      const currentInspections = inspectionsRef.current;
      // 중복 체크
      if (currentInspections.some(ins => ins.panelNo === finalId)) {
        showToast(`PNL NO. ${finalId}가 이미 존재합니다.`);
        return;
      }
      onUpdateInspections([newInspection, ...currentInspections]);
    }

    setGeneratedQR(toQRString(newInspection));
    setSavedQRId(newInspection.panelNo);
    setSelectedQR(newInspection);
    setSelectedFloor(finalFloor);
    setShowForm(false);
    setTimeout(() => {
      showToast('패널이 등록되었습니다!');
    }, 100);
  };

  const handlePrint = () => {
    if (!generatedQR) return;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      const data = JSON.parse(generatedQR);
      
      // QR 코드 SVG를 가져오기
      const svgElement = document.querySelector('#qr-code-svg');
      const svgHTML = svgElement ? svgElement.outerHTML : '';

      const htmlContent = `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QR Code - ${data.location}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Inter', sans-serif;
      padding: 40px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: white;
    }
    .qr-container {
      text-align: center;
      padding: 40px;
      border: 2px solid #1e293b;
      border-radius: 12px;
      background: white;
      max-width: 600px;
    }
    .qr-title {
      font-size: 24px;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 20px;
    }
    .qr-code-wrapper {
      display: flex;
      justify-content: center;
      margin: 30px 0;
      padding: 20px;
      background: #f8fafc;
      border-radius: 8px;
    }
    .qr-code-wrapper svg {
      max-width: 100%;
      height: auto;
    }
    .qr-info {
      margin-top: 30px;
      text-align: left;
    }
    .info-item {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
      padding: 12px;
      background: #f1f5f9;
      border-radius: 8px;
    }
    .info-label {
      font-weight: 600;
      color: #475569;
      min-width: 100px;
    }
    .info-value {
      color: #1e293b;
      font-size: 16px;
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
      color: #64748b;
      font-size: 12px;
    }
    @media print {
      body {
        padding: 20px;
      }
      .qr-container {
        border: 1px solid #1e293b;
      }
    }
  </style>
</head>
<body>
  <div class="qr-container">
    <h1 class="qr-title">Distribution Board QR Code</h1>
    <div class="qr-code-wrapper">
      ${svgHTML}
    </div>
    <div class="qr-info">
      <div class="info-item">
        <span class="info-label">TR:</span>
        <span class="info-value">${data.location}</span>
      </div>
      <div class="info-item">
        <span class="info-label">층수:</span>
        <span class="info-value">${data.floor}</span>
      </div>
      <div class="info-item">
        <span class="info-label">위치 정보:</span>
        <span class="info-value">${data.position}</span>
      </div>
    </div>
    <div class="footer">
      <p>성수동 K-PJT - QR Code Generated</p>
      <p style="margin-top: 4px;">${new Date().toLocaleString('ko-KR')}</p>
    </div>
  </div>
</body>
</html>
      `;
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      
      // 인쇄 대화상자 열기
      setTimeout(() => {
        printWindow.print();
      }, 500);
    }
  };

  const handleDownload = () => {
    if (!generatedQR) return;

    const data = JSON.parse(generatedQR);
    const svgElement = document.querySelector('#qr-code-svg') as SVGSVGElement;
    
    if (svgElement) {
      // SVG를 이미지로 변환
      const svgData = new XMLSerializer().serializeToString(svgElement);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          canvas.toBlob((blob) => {
            if (blob) {
              const downloadUrl = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = downloadUrl;
              link.download = `QR_${data.location}_${data.floor}_${Date.now()}.png`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(downloadUrl);
            }
          }, 'image/png');
        }
        URL.revokeObjectURL(url);
      };
      img.src = url;
    }
  };

  const resetForm = () => {
    initialQrDataRef.current = null;
    setQrData({
      id: '',
      location: 'TR-1(A) 900KVA',
      // @MX:NOTE: 현재 FloorPlanView에서 선택된 층(selectedFloor)을 기본값으로 사용
      floor: selectedFloor,
      position: '',
      positionX: '',
      positionY: '',
      contractor: '삼성물산',
      projectName: '성수동 K-PJT',
      nominalCrossSection: '', breakerCapacity: ''
    });
    setGeneratedQR(null);
    setSelectedQR(null);
    setIsEditing(false);
    setShowForm(false);
    setShowQRModal(false);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // (isInspectionMatchedWithQR 삭제됨 - 별도 QR 상태 불필요)

  // inspections Map (panelNo -> InspectionRecord)
  const inspectionMap = useMemo(() => {
    const map = new Map<string, InspectionRecord>();
    inspections.forEach(ins => {
      if (ins.panelNo) map.set(ins.panelNo, ins);
    });
    return map;
  }, [inspections]);

  // 자연 정렬 비교 함수 (1, 1-1, 1-2, 2, 3, ... 숫자 기반)
  const naturalCompare = useCallback((a: string, b: string): number => {
    const pa = a.split(/[-]/).map(s => { const n = parseInt(s); return isNaN(n) ? s : n; });
    const pb = b.split(/[-]/).map(s => { const n = parseInt(s); return isNaN(n) ? s : n; });
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const va = pa[i] ?? -1, vb = pb[i] ?? -1;
      if (typeof va === 'number' && typeof vb === 'number') { if (va !== vb) return va - vb; }
      else { const cmp = String(va).localeCompare(String(vb)); if (cmp !== 0) return cmp; }
    }
    return 0;
  }, []);

  // 정렬된 inspections
  const sortedInspections = useMemo(() => {
    const deduped = inspections.filter((ins, idx, self) => idx === self.findIndex(i => i.panelNo === ins.panelNo));
    const sorted = [...deduped].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'panelNo': cmp = naturalCompare(a.panelNo, b.panelNo); break;
        case 'createdAt': {
          cmp = (a.updatedAt || '').localeCompare(b.updatedAt || ''); break;
        }
        case 'tr': cmp = (a.tr || '').localeCompare(b.tr || ''); break;
        case 'floor': cmp = (a.floor || '').localeCompare(b.floor || ''); break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [inspections, sortField, sortDirection, naturalCompare]);

  // 검색 필터링된 inspections
  const filteredInspections = useMemo(() => {
    if (!searchText.trim()) return sortedInspections;
    const q = searchText.trim().toLowerCase();
    return sortedInspections.filter(ins =>
      ins.panelNo.toLowerCase().includes(q) ||
      (ins.tr || '').toLowerCase().includes(q) ||
      (ins.floor || '').toLowerCase().includes(q) ||
      (ins.notes || '').toLowerCase().includes(q) ||
      (ins.nominalCrossSection || '').toLowerCase().includes(q) ||
      (ins.tr || '').toLowerCase().includes(q)
    );
  }, [sortedInspections, searchText]);

  // 다중 선택: 사용 가능한 TR 목록 (inspections에서 수집, 없으면 기본값)
  const availableTrNos = useMemo(() => {
    const set = new Set(inspections.map(i => i.tr).filter((v): v is string => !!v));
    if (!set.size) { set.add('TR-1(A) 900KVA'); set.add('TR-2(B) 950KVA'); }
    return Array.from(set);
  }, [inspections]);

  // 다중 선택 핸들러
  const togglePanelSelect = useCallback((panelNo: string) => {
    setSelectedPanelNos(prev => {
      const next = new Set(prev);
      next.has(panelNo) ? next.delete(panelNo) : next.add(panelNo);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedPanelNos(prev => {
      if (prev.size === filteredInspections.length && filteredInspections.length > 0) {
        return new Set();
      }
      return new Set(filteredInspections.map(i => i.panelNo));
    });
  }, [filteredInspections]);

  const handleBulkFloorChange = useCallback(async (floor: string) => {
    if (!selectedPanelNos.size) return;
    setIsBulkLoading(true);
    try {
      const now = new Date().toISOString();
      const updatedInspections = inspections.map(ins =>
        selectedPanelNos.has(ins.panelNo) ? { ...ins, floor, updatedAt: now } : ins
      );
      if (onUpdateInspections) onUpdateInspections(updatedInspections);
      showToast(`${selectedPanelNos.size}개 패널 층수를 ${floor}로 변경했습니다`);
    } finally {
      setIsBulkLoading(false);
    }
  }, [selectedPanelNos, inspections, onUpdateInspections]);

  const handleBulkTRChange = useCallback(async (trNo: string) => {
    if (!selectedPanelNos.size) return;
    setIsBulkLoading(true);
    try {
      const now2 = new Date().toISOString();
      const updatedInspections = inspections.map(ins =>
        selectedPanelNos.has(ins.panelNo) ? { ...ins, tr: trNo, updatedAt: now2 } : ins
      );
      if (onUpdateInspections) onUpdateInspections(updatedInspections);
      showToast(`${selectedPanelNos.size}개 패널 TR을 ${trNo}로 변경했습니다`);
    } finally {
      setIsBulkLoading(false);
    }
  }, [selectedPanelNos, inspections, onUpdateInspections]);

  const handleBulkDelete = useCallback(() => {
    const count = selectedPanelNos.size;
    if (!count) return;
    if (!window.confirm(`선택된 ${count}개 패널을 삭제하시겠습니까?`)) return;
    selectedPanelNos.forEach(panelNo => {
      onDeleteInspection?.(panelNo);
    });
    setSelectedPanelNos(new Set());
    showToast(`${count}개 패널을 삭제했습니다`);
  }, [selectedPanelNos, onDeleteInspection]);

  const handleBulkQRExcel = useCallback(async () => {
    if (!selectedPanelNos.size) return;
    setIsBulkLoading(true);
    try {
      const selectedInspections = inspections.filter(ins => selectedPanelNos.has(ins.panelNo));
      const items: Array<{ inspection: InspectionRecord; imageDataUrl: string }> = [];
      for (const inspection of selectedInspections) {
        const canvas = document.getElementById(`qr-batch-canvas-${inspection.panelNo}`) as HTMLCanvasElement | null;
        const imageDataUrl = canvas?.toDataURL('image/png') ?? '';
        items.push({ inspection, imageDataUrl });
      }
      await exportQRBatchToExcel(items);
      showToast(`${items.length}개 QR 코드를 엑셀로 출력했습니다`);
    } catch (e) {
      console.error('QR 일괄 출력 오류:', e);
      showToast('QR 엑셀 출력 중 오류가 발생했습니다');
    } finally {
      setIsBulkLoading(false);
    }
  }, [selectedPanelNos, inspections]);

  // TR 계통 요약 (인라인 패널용)
  const trSummary = useMemo(() => {
    const trMap: Record<string, InspectionRecord[]> = {};
    inspections.forEach(insp => {
      const tr = insp.tr || '';
      if (!trMap[tr]) trMap[tr] = [];
      trMap[tr].push(insp);
    });
    return Object.entries(trMap)
      .map(([trKey, panels]) => ({
        trKey,
        trLabel: trKey || '미지정',
        panels,
        color: getTrLetter(trKey) === 'A' ? 'bg-blue-500' : getTrLetter(trKey) === 'B' ? 'bg-orange-500' : 'bg-slate-400',
      }))
      .sort((a, b) => a.trKey.localeCompare(b.trKey));
  }, [inspections]);

  // 선택된 QR의 ID 추출 최적화 (panelNo 직접 사용)
  const selectedQRId = useMemo(() => selectedQR?.panelNo || '', [selectedQR]);

  // Select 포커스 시 모든 부모 컨테이너의 overflow를 visible로 변경
  React.useEffect(() => {
    if (isSelectFocused) {
      const selectElement = document.querySelector('select:focus') as HTMLSelectElement;
      if (selectElement) {
        // 모든 부모 요소를 찾아서 overflow를 visible로 변경
        let parent: HTMLElement | null = selectElement.parentElement;
        const originalOverflows: Array<{ element: HTMLElement; overflow: string; overflowX: string; overflowY: string }> = [];
        
        while (parent && parent !== document.body) {
          const computed = window.getComputedStyle(parent);
          const overflow = computed.overflow;
          const overflowX = computed.overflowX;
          const overflowY = computed.overflowY;
          
          if (overflow !== 'visible' && overflow !== 'unset') {
            originalOverflows.push({ element: parent, overflow, overflowX, overflowY });
            (parent as HTMLElement).style.overflow = 'visible';
            (parent as HTMLElement).style.overflowX = 'visible';
            (parent as HTMLElement).style.overflowY = 'visible';
          }
          parent = parent.parentElement;
        }

        // cleanup 함수: blur 시 원래 overflow로 복원
        return () => {
          originalOverflows.forEach(({ element, overflow, overflowX, overflowY }) => {
            element.style.overflow = overflow;
            element.style.overflowX = overflowX;
            element.style.overflowY = overflowY;
          });
        };
      }
    }
  }, [isSelectFocused]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6 h-full min-h-0" style={{ overflow: isSelectFocused ? 'visible' : 'hidden' }}>
      {/* 토스트 알림 */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg animate-fade-in">
          {toastMsg}
        </div>
      )}
      {/* 삭제 확인 모달 */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-5 w-72 flex flex-col gap-4">
            <p className="text-sm text-slate-700 font-medium text-center">이 QR 코드를 삭제하시겠습니까?</p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
              >취소</button>
              <button
                onClick={confirmDeleteQR}
                className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700 transition-colors"
              >삭제</button>
            </div>
          </div>
        </div>
      )}
      {/* 패널 삭제 확인 모달 */}
      {deleteInspectionConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-5 w-72 flex flex-col gap-4">
            <p className="text-sm text-slate-700 font-medium text-center">
              <strong>{deleteInspectionConfirmId}</strong> 패널을 완전히 삭제하시겠습니까?
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteInspectionConfirmId(null)}
                className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors">취소</button>
              <button onClick={confirmDeleteInspection}
                className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700 transition-colors">삭제</button>
            </div>
          </div>
        </div>
      )}
      {/* Left Panel: QR List - 모바일에서는 패널 미선택 시만 표시 */}
      <div className={`
        ${selectedQR || showForm || showFloorPlanMobile ? 'hidden' : 'flex'}
        lg:flex lg:col-span-4 flex-col h-full min-h-0
      `}>
        {/* TR 계통 인라인 패널 (접기/펼치기) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-2 overflow-hidden shrink-0">
          <div
            className="p-3 bg-slate-50 flex items-center justify-between cursor-pointer hover:bg-slate-100 transition-colors"
            onClick={() => setTrPanelExpanded(prev => !prev)}
          >
            <div className="flex items-center gap-2">
              <GitBranch size={14} className="text-slate-600" />
              <span className="font-semibold text-sm text-slate-800">TR 계통</span>
              <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                {trSummary.length}개 TR · {inspections.length}개 PNL
              </span>
            </div>
            <div className="flex items-center gap-1">
              {trPanelExpanded ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
              <button
                onClick={(e) => { e.stopPropagation(); setShowTRSystemModal(true); }}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
              >
                편집
              </button>
            </div>
          </div>
          {trPanelExpanded && (
            <>
              {/* TR 현황 요약 */}
              <div className="px-4 py-2 border-t border-slate-100 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                {trSummary.map(({ trKey, trLabel, panels, color }) => (
                  <span key={trKey} className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${color}`} />
                    {trLabel}: <strong className="text-slate-700">{panels.length}</strong>개
                  </span>
                ))}
                <span className="ml-auto text-slate-600">
                  총 <strong className="text-slate-700">{inspections.length}</strong>개 PNL
                </span>
              </div>
              {/* 간결한 TR 트리 (읽기 전용) */}
              <div className="px-4 py-2 border-t border-slate-100 space-y-2 max-h-[250px] overflow-y-auto text-xs">
                {trSummary.map(({ trKey, trLabel, panels, color }) => (
                  <div key={trKey}>
                    <div className="flex items-center gap-1.5 font-medium text-slate-700 mb-1">
                      <span className={`w-2 h-2 rounded-full ${color}`} />
                      {trLabel} ({panels.length}개)
                    </div>
                    <div className="ml-4 flex flex-wrap gap-1">
                      {panels.map(p => (
                        <span key={p.panelNo} className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px]">
                          {p.panelNo}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 h-full flex flex-col">
        <div className="p-3 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold text-slate-800">등록 분전함</h2>
            <div className="flex items-center gap-2">
              {selectedPanelNos.size > 0 && (
                <button
                  onClick={() => setShowBulkModal(true)}
                  className="text-xs px-2 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {selectedPanelNos.size}개 선택 · 일괄 작업
                </button>
              )}
              <button
                onClick={toggleSelectAll}
                className="text-xs text-blue-600 hover:text-blue-800 underline"
              >
                {selectedPanelNos.size === filteredInspections.length && filteredInspections.length > 0 ? '전체 해제' : '전체 선택'}
              </button>
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">{filteredInspections.length}/{inspections.length}</span>
              <button
                onClick={() => setShowFloorPlanMobile(true)}
                className="lg:hidden flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                도면보기
                <ChevronLeft size={14} className="rotate-180" />
              </button>
            </div>
          </div>
          {/* 정렬 버튼 + 검색 */}
          <div className="flex items-center gap-1 mb-2 flex-wrap">
            {(['panelNo','tr','floor','createdAt'] as const).map(f => (
              <button key={f} onClick={() => { if (sortField === f) setSortDirection(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField(f); setSortDirection('asc'); } }}
                className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${sortField === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'}`}>
                {f === 'panelNo' ? 'PNL NO.' : f === 'tr' ? 'TR' : f === 'floor' ? '층수' : '생성일'}
                {sortField === f && <span className="ml-0.5">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" value={searchText} onChange={e => setSearchText(e.target.value)}
              placeholder="PNL NO., TR, 층수 검색..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
        {filteredInspections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8">
            <QrCode size={48} className="mb-4 opacity-50" />
            <p className="text-sm text-center">{searchText ? '검색 결과가 없습니다' : '등록 분전함이 없습니다'}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredInspections
              .map((inspection, index) => {
              const isSelected = selectedQRId === inspection.panelNo;

              return (
                <div
                  key={`${inspection.panelNo}-${index}`}
                  data-inspection-id={inspection.panelNo}
                  data-selected={isSelected ? 'true' : 'false'}
                  onClick={(e) => {
                    (e.currentTarget as HTMLElement).blur();
                    handleSelectInspection(inspection);
                    if (onSelectInspection) {
                      onSelectInspection(inspection.panelNo);
                    }
                    // 패널 상세 정보 섹션으로 자동 스크롤
                    scrollToPanelDetail();
                  }}
                  className={`px-3 py-2 cursor-pointer transition-colors hover:bg-slate-50 ${
                    isSelected ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 min-w-0">
                    {/* 왼쪽: 체크박스 + 핀 + 패널번호 + 배지들 + 날짜 한 줄 */}
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                      <input
                        type="checkbox"
                        className="w-3.5 h-3.5 flex-shrink-0 cursor-pointer"
                        checked={selectedPanelNos.has(inspection.panelNo)}
                        onChange={() => togglePanelSelect(inspection.panelNo)}
                        onClick={e => e.stopPropagation()}
                      />
                      <MapPin size={12} className={`shrink-0 ${getTrLetter(inspection.tr) === 'A' ? 'text-blue-600' : getTrLetter(inspection.tr) === 'B' ? 'text-orange-500' : 'text-slate-400'}`} />
                      <span className="font-semibold text-xs text-slate-800 shrink-0">
                        {migrateIdFloor(inspection.panelNo)}
                      </span>
                      {inspection.nominalCrossSection && (
                        <span className="text-[9px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded shrink-0">{inspection.nominalCrossSection}</span>
                      )}
                      {inspection.floor && <span className="text-[10px] text-slate-400 shrink-0">{inspection.floor}</span>}
                      {inspection.tr && (
                        <span className={`px-1 py-0.5 rounded text-[9px] font-medium shrink-0 ${getTrLetter(inspection.tr) === 'A' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                          {inspection.tr}
                        </span>
                      )}
                      {inspection.updatedAt && (
                        <span className="flex items-center gap-0.5 text-[10px] text-slate-400 truncate min-w-0">
                          <Calendar size={10} className="shrink-0" />
                          <span className="truncate">{formatDate(inspection.updatedAt)}</span>
                        </span>
                      )}
                    </div>
                    {/* 오른쪽: 버튼 */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditInspection(inspection, e);
                        }}
                        className="p-1 hover:bg-blue-50 rounded text-slate-400 hover:text-blue-600 transition-colors"
                        title="패널 편집"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePanel(inspection.panelNo, e);
                        }}
                        className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-600 transition-colors"
                        title="패널 삭제"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </div>{/* overflow-y-auto flex-1 */}

        </div>
      </div>

      {/* Right Panel: QR Generator & Details - 모바일에서는 패널 선택 시만 표시 */}
      <div
        ref={rightPanelScrollRef}
        className={`
          ${selectedQR || showForm || showFloorPlanMobile ? 'flex' : 'hidden'}
          lg:flex lg:col-span-8 h-full min-h-0 flex-col overflow-hidden
        `}
        style={{ overflowX: 'visible', overflowY: isSelectFocused ? 'visible' : 'auto', position: 'relative' }}
      >
        {/* Floor Plan View - 패널 상세 위에 표시 (order-1) */}
        <div className="order-1">
        {/* 모바일 도면보기 모드: 목록으로 돌아가기 버튼 */}
        {showFloorPlanMobile && (
          <button
            onClick={() => setShowFloorPlanMobile(false)}
            className="lg:hidden flex items-center gap-2 text-slate-600 hover:text-slate-800 mb-2 text-sm font-medium px-2"
          >
            <ChevronLeft size={18} />
            목록으로
          </button>
        )}
        <FloorPlanView
          inspections={filteredInspections}
          onSelectInspection={(inspection) => {
            if (onSelectInspection) {
              onSelectInspection(inspection.panelNo);
            }
          }}
          onUpdateInspections={onUpdateInspections}
          selectedInspectionId={selectedQRId || null}
          onSelectionChange={(id) => {
            if (id) {
              const inspection = inspectionMap.get(id);
              if (inspection) {
                selectForEdit(inspection);
              } else {
                setSelectedQR(null);
              }
            } else {
              setSelectedQR(null);
              setOpenDetailPanelForMapping(false);
            }
          }}
          selectedFloor={selectedFloor}
          onFloorChange={(floor) => {
            // 스크롤 위치 저장
            const savedMainScroll = mainScrollRef?.current?.scrollTop ?? 0;
            const savedRightScroll = rightPanelScrollRef.current?.scrollTop ?? 0;
            setSelectedFloor(floor);
            // React 렌더 후 스크롤 복원
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (mainScrollRef?.current) mainScrollRef.current.scrollTop = savedMainScroll;
                if (rightPanelScrollRef.current) rightPanelScrollRef.current.scrollTop = savedRightScroll;
              });
            });
          }}
          showDetailPanel={openDetailPanelForMapping}
          startInEditMode={openDetailPanelForMapping}
          floorPlanUrls={floorPlanUrls}
        />
        </div>
        {/* 패널 미선택 & 폼 미표시 시 안내 메시지 (order-2) */}
        {!selectedQR && !showForm ? (
          <div className="order-2 h-full flex items-center justify-center text-slate-500">
            <div className="text-center">
              <div className="p-4 bg-slate-100 rounded-full inline-block mb-4">
                <QrCode size={48} className="text-slate-400" />
              </div>
              <p className="text-lg font-medium text-slate-600">패널을 선택해주세요</p>
              <p className="text-sm mt-2 text-slate-500">
                좌측 목록에서 패널을 선택하거나<br/>
                아래 버튼을 클릭하세요
              </p>
              <button
                onClick={() => {
                  resetForm();
                  setShowForm(true);
                  setSelectedQR(null);
                  setIsEditing(false);
                }}
                className="mt-6 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 shadow-md hover:shadow-lg mx-auto"
              >
                <QrCode size={20} />
                패널 신규 등록
              </button>
            </div>
          </div>
        ) : (
        <div
          className="order-2 p-3 md:p-4 space-y-6"
          style={{ overflow: isSelectFocused ? 'visible' : undefined, position: 'relative' }}
          onMouseDown={() => {
            savedMainScrollOnInteractionRef.current = mainScrollRef?.current?.scrollTop ?? 0;
            savedRightScrollOnInteractionRef.current = rightPanelScrollRef.current?.scrollTop ?? 0;
          }}
        >
          {/* Header */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            {/* 모바일: 목록으로 돌아가기 버튼 */}
            <button
              onClick={() => {
                setSelectedQR(null);
                setShowForm(false);
                setShowFloorPlanMobile(false);
                setIsEditing(false);
                resetForm();
              }}
              className="lg:hidden flex items-center gap-2 text-slate-600 hover:text-slate-800 mb-4 text-sm font-medium"
            >
              <ChevronLeft size={18} />
              목록으로
            </button>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-2 bg-blue-100 rounded-lg shrink-0">
                  <QrCode size={20} className="text-blue-600" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-base sm:text-xl font-bold text-slate-800 truncate">
                    {selectedQR ? `패널 상세 정보` : '패널 신규 등록'}
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-600 truncate">
                    {selectedQR ? `PNL NO. ${selectedQRId}` : 'Distribution Board 신규 등록'}
                  </p>
                </div>
              </div>
              {selectedQR ? (
                <button
                  onClick={() => {
                    resetForm();
                    setShowForm(true);
                    setSelectedQR(null);
                    setIsEditing(false);
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1 shadow-md hover:shadow-lg shrink-0 text-xs w-16 text-center leading-tight"
                >
                  <QrCode size={14} />
                  패널 신규 등록
                </button>
              ) : (
                <button
                  onClick={() => {
                    setShowForm(false);
                    setSelectedQR(null);
                    setIsEditing(false);
                    resetForm();
                  }}
                  className="bg-slate-600 hover:bg-slate-700 text-white px-3 sm:px-6 py-2 sm:py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-1 sm:gap-2 shadow-md hover:shadow-lg shrink-0 text-sm whitespace-nowrap"
                >
                  <X size={16} />
                  닫기
                </button>
              )}
            </div>
          </div>

          {/* 통합 패널 상세 정보 / 신규 등록 폼 */}
        {(showForm || (selectedQR && selectedQRId)) && (
            <div ref={panelDetailSectionRef} className={`bg-white rounded-xl shadow-sm border border-slate-200 p-6 border-l-4 ${selectedQR ? 'border-l-blue-500' : 'border-l-emerald-500'}`}>
            <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              {selectedQR ? (
                <>
                  <Eye size={20} className="text-blue-600" />
                  패널 상세 정보 — {qrData.id}
                </>
              ) : (
                <>
                  <QrCode size={20} className="text-emerald-600" />
                  패널 신규 등록
                </>
              )}
            </h2>
            
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                  <FileText size={16} className="text-blue-600" />
                  PNL NO.
                </label>
                <input
                  type="text"
                  value={qrData.id}
                  onChange={(e) => handleInputChange('id', e.target.value)}
                  onFocus={restoreMainScrollOnFocus}
                  placeholder="예: 1-1 또는 2-1"
                  className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>
              
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                  <Building2 size={16} className="text-blue-600" />
                  층수
                </label>
                <select
                  value={qrData.floor || selectedFloor}
                  onChange={(e) => handleInputChange('floor', e.target.value)}
                  onFocus={restoreMainScrollOnFocus}
                  className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white"
                >
                  <option value="B2">B2 (지하2층)</option>
                  <option value="B1">B1 (지하1층)</option>
                  <option value="F1">F1 (지상1층)</option>
                  <option value="F2">F2 (지상2층)</option>
                  <option value="F3">F3 (지상3층)</option>
                  <option value="F4">F4 (지상4층)</option>
                  <option value="F5">F5 (지상5층)</option>
                  <option value="F6">F6 (지상6층)</option>
                </select>
              </div>

              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                  <MapPin size={16} className="text-blue-600" />
                  TR
                </label>
                <select
                  value={qrData.location || ''}
                  onChange={(e) => handleInputChange('location', e.target.value)}
                  onFocus={restoreMainScrollOnFocus}
                  className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white cursor-pointer"
                >
                  {availableTrNos.map(tr => (
                    <option key={tr} value={tr}>{tr}</option>
                  ))}
                </select>
              </div>

              {/* 시공사 */}
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  시공사
                </label>
                <input
                  type="text"
                  value={qrData.contractor}
                  onChange={(e) => handleInputChange('contractor', e.target.value)}
                  onFocus={restoreMainScrollOnFocus}
                  placeholder="시공사 입력"
                  className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>

              {/* PJT명 */}
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  PJT명
                </label>
                <input
                  type="text"
                  value={qrData.projectName}
                  onChange={(e) => handleInputChange('projectName', e.target.value)}
                  onFocus={restoreMainScrollOnFocus}
                  placeholder="PJT명 입력"
                  className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>

              {/* 관리번호 (판넬명) - Key-in */}
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  관리번호 (판넬명)
                </label>
                <input
                  type="text"
                  value={qrData.position}
                  onChange={(e) => handleInputChange('position', e.target.value)}
                  onFocus={restoreMainScrollOnFocus}
                  placeholder="판넬명 입력"
                  className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>

              {/* 공칭 단면적 - Key-in with SQ unit */}
              <div className="grid grid-cols-2 gap-3">
                {/* 공칭 단면적 */}
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    공칭 단면적
                  </label>
                  <div className="flex">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={qrData.nominalCrossSection}
                      onChange={(e) => handleInputChange('nominalCrossSection', e.target.value)}
                      placeholder="입력"
                      onFocus={restoreMainScrollOnFocus}
                      className="flex-1 min-w-0 rounded-l-lg border-slate-300 border px-2 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                    />
                    <span className="bg-slate-200 border border-l-0 border-slate-300 px-2 py-2.5 rounded-r-lg text-slate-600 font-medium text-sm whitespace-nowrap">
                      SQ
                    </span>
                  </div>
                </div>

                {/* 차단기 용량 */}
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    차단기 용량
                  </label>
                  <div className="flex">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={qrData.breakerCapacity}
                      onChange={(e) => handleInputChange('breakerCapacity', e.target.value)}
                      placeholder="입력"
                      onFocus={restoreMainScrollOnFocus}
                      className="flex-1 min-w-0 rounded-l-lg border-slate-300 border px-2 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                    />
                    <span className="bg-slate-200 border border-l-0 border-slate-300 px-2 py-2.5 rounded-r-lg text-slate-600 font-medium text-sm whitespace-nowrap">
                      A
                    </span>
                  </div>
                </div>
              </div>

              {selectedQR && (
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="flex items-center gap-2 mb-3">
                    <Calendar size={16} className="text-blue-600" />
                    <span className="text-sm font-semibold text-slate-700">수정일</span>
                  </div>
                  <p className="text-slate-800 font-medium">{formatDate(selectedQR.updatedAt)}</p>
                </div>
              )}

              <button
                onMouseDown={() => {
                  savedMainScrollOnInteractionRef.current = mainScrollRef?.current?.scrollTop ?? 0;
                  savedRightScrollOnInteractionRef.current = rightPanelScrollRef.current?.scrollTop ?? 0;
                }}
                onClick={selectedQR ? handleUpdateInspection : generateQR}
                onFocus={restoreMainScrollOnFocus}
                disabled={selectedQR
                  ? JSON.stringify(qrData) === JSON.stringify(initialQrDataRef.current)
                  : (!qrData.location || !qrData.floor)}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Save size={18} />
                {selectedQR ? '저장' : 'QR 코드 생성'}
              </button>

              <button
                onMouseDown={() => {
                  savedMainScrollOnInteractionRef.current = mainScrollRef?.current?.scrollTop ?? 0;
                  savedRightScrollOnInteractionRef.current = rightPanelScrollRef.current?.scrollTop ?? 0;
                }}
                onClick={() => {
                  setGeneratedQR(selectedQR ? toQRString(selectedQR) : (generatedQR || ''));
                  setShowQRModal(true);
                  restoreScrollAfterAction();
                }}
                onFocus={restoreMainScrollOnFocus}
                disabled={!selectedQR && !generatedQR}
                className="w-full bg-slate-600 hover:bg-slate-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <QrCode size={18} />
                QR 코드 보기
              </button>

              <button
                onMouseDown={(e) => {
                  e.preventDefault(); // onFocus 스크롤 복원으로 인한 click 이벤트 방해 방지
                  savedMainScrollOnInteractionRef.current = mainScrollRef?.current?.scrollTop ?? 0;
                  savedRightScrollOnInteractionRef.current = rightPanelScrollRef.current?.scrollTop ?? 0;
                  handleMapToDashboard();
                }}
                disabled={!selectedQR && !generatedQR}
                title={(!selectedQR && !generatedQR) ? 'QR 코드를 먼저 선택하세요' : 'Dashboard 도면에서 위치 확인 및 수정'}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <MapPin size={18} />
                Dashboard에 위치 매핑
              </button>
            </div>
            </div>
        )}

        {/* 일괄 QR 출력용 숨김 캔버스 */}
        <div style={{ position: 'absolute', left: '-9999px', top: 0, pointerEvents: 'none' }} aria-hidden="true">
          {inspections.filter(ins => selectedPanelNos.has(ins.panelNo)).map(ins => (
            <QRCodeCanvas
              key={ins.panelNo}
              id={`qr-batch-canvas-${ins.panelNo}`}
              value={toQRString(ins)}
              size={256}
            />
          ))}
        </div>

        {/* 일괄 작업 팝업 모달 */}
        {showBulkModal && createPortal(
          <>
            <div className="fixed inset-0 bg-black bg-opacity-40 z-50" onClick={() => setShowBulkModal(false)} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm" onClick={e => e.stopPropagation()}>
                <div className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-slate-800">일괄 작업</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">{selectedPanelNos.size}개 패널 선택됨</span>
                      <button onClick={() => setShowBulkModal(false)} className="p-1 hover:bg-slate-100 rounded text-slate-400 transition-colors">
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="text-xs font-medium text-slate-600 mb-1 block">층수 변경</label>
                    <div className="flex gap-2">
                      <select value={bulkFloor} onChange={e => setBulkFloor(e.target.value)}
                        className="flex-1 text-sm border border-slate-300 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-blue-500 focus:outline-none">
                        {['F1','F2','F3','F4','F5','F6','B1','B2'].map(f => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                      <button onClick={() => { handleBulkFloorChange(bulkFloor); setShowBulkModal(false); }}
                        disabled={isBulkLoading}
                        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                        변경
                      </button>
                    </div>
                  </div>
                  <div className="mb-4">
                    <label className="text-xs font-medium text-slate-600 mb-1 block">TR 변경</label>
                    <div className="flex gap-2">
                      <select value={bulkTrNo} onChange={e => setBulkTrNo(e.target.value)}
                        className="flex-1 text-sm border border-slate-300 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-blue-500 focus:outline-none">
                        <option value="">TR 선택</option>
                        {availableTrNos.map(tr => (
                          <option key={tr} value={tr}>{tr}</option>
                        ))}
                      </select>
                      <button onClick={() => { if(bulkTrNo){ handleBulkTRChange(bulkTrNo); setShowBulkModal(false); } }}
                        disabled={isBulkLoading || !bulkTrNo}
                        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                        변경
                      </button>
                    </div>
                  </div>
                  <button onClick={() => { setShowBulkModal(false); handleBulkQRExcel(); }}
                    disabled={isBulkLoading}
                    className="w-full py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors mb-2">
                    QR 엑셀 출력
                  </button>
                  <button onClick={() => { handleBulkDelete(); setShowBulkModal(false); }}
                    disabled={isBulkLoading}
                    className="w-full py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">
                    선택 패널 삭제
                  </button>
                  {isBulkLoading && <p className="text-xs text-center text-slate-400 mt-2">처리 중...</p>}
                </div>
              </div>
            </div>
          </>,
          document.body
        )}

        {/* QR Code Modal */}
        {showQRModal && generatedQR && createPortal(
          <React.Fragment>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 bg-black bg-opacity-50 z-50"
              onClick={() => {
                setShowQRModal(false);
                setGeneratedQR(null);
              }}
            />
            {/* Modal */}
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div 
                className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-slate-800">QR 코드</h2>
                    <button
                      onClick={() => {
                        setShowQRModal(false);
                        setGeneratedQR(null);
                      }}
                      className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
                      title="닫기"
                    >
                      <X size={20} />
                    </button>
                  </div>
                  
                  <div className="flex flex-col lg:flex-row gap-6">
                    {/* QR Code */}
                    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="bg-white p-4 rounded-lg shadow-sm">
                        <QRCodeSVG
                          id="qr-code-svg"
                          value={generatedQR}
                          size={256}
                          level="H"
                          includeMargin={true}
                        />
                      </div>
                      <p className="text-xs text-slate-500 mt-4 text-center">
                        QR 코드를 스캔하여 위치 정보를 확인하세요
                      </p>
                    </div>

                    {/* QR Info - Panel Master 연동 */}
                    {(() => {
                      const linkedInsp = inspections.find(i => i.panelNo === qrData.id);
                      const trCode = linkedInsp?.tr || qrData.location;
                      const trLabel = trCode || '-';
                      const floorLabel = linkedInsp?.floor || qrData.floor || '-';
                      const trLetter = getTrLetter(trCode);
                      const trColor = trLetter === 'A' ? '#3b82f6' : trLetter === 'B' ? '#f97316' : '#94a3b8';
                      return (
                    <div className="flex-1 space-y-3">
                      {/* PNL NO. */}
                      <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="flex items-center gap-2 mb-2">
                          <Hash size={16} className="text-slate-600" />
                          <span className="text-sm font-semibold text-slate-700">PNL NO.</span>
                        </div>
                        <p className="text-slate-800 font-bold text-lg">{qrData.id || '-'}</p>
                      </div>

                      {/* TR */}
                      <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="flex items-center gap-2 mb-2">
                          <MapPin size={16} className="text-blue-600" />
                          <span className="text-sm font-semibold text-slate-700">TR</span>
                        </div>
                        <p className="font-medium flex items-center gap-2">
                          <span className="inline-block w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: trColor }} />
                          <span className="text-slate-800">{trLabel}</span>
                        </p>
                      </div>

                      {/* 층수 */}
                      <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="flex items-center gap-2 mb-2">
                          <Building2 size={16} className="text-blue-600" />
                          <span className="text-sm font-semibold text-slate-700">층수</span>
                        </div>
                        <p className="text-slate-800 font-medium">{floorLabel}</p>
                      </div>

                      {/* 공칭 단면적 */}
                      {linkedInsp?.nominalCrossSection && (
                        <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                          <div className="flex items-center gap-2 mb-2">
                            <Zap size={16} className="text-amber-600" />
                            <span className="text-sm font-semibold text-slate-700">공칭 단면적</span>
                          </div>
                          <p className="text-slate-800 font-medium">{linkedInsp.nominalCrossSection} mm²</p>
                        </div>
                      )}

                      {/* 상위 패널 */}
                      {linkedInsp?.parentPanelNo && (
                        <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                          <div className="flex items-center gap-2 mb-2">
                            <GitBranch size={16} className="text-purple-600" />
                            <span className="text-sm font-semibold text-slate-700">상위 패널</span>
                          </div>
                          <p className="text-slate-800 font-medium">{linkedInsp.parentPanelNo}</p>
                        </div>
                      )}

                      {/* 비고 */}
                      {linkedInsp?.notes && (
                        <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                          <div className="flex items-center gap-2 mb-2">
                            <FileText size={16} className="text-slate-600" />
                            <span className="text-sm font-semibold text-slate-700">비고</span>
                          </div>
                          <p className="text-slate-700 font-medium text-sm">{linkedInsp.notes}</p>
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="flex flex-col gap-2 pt-2">
                        <div className="flex gap-2">
                          <button
                            onClick={handlePrint}
                            className="flex-1 bg-slate-600 hover:bg-slate-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                          >
                            <Printer size={18} />
                            인쇄
                          </button>
                          <button
                            onClick={handleDownload}
                            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                          >
                            <Download size={18} />
                            다운로드
                          </button>
                        </div>
                      </div>
                    </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </React.Fragment>,
          document.body
        )}

        </div>
        )}
        </div>

      {/* TR 계통도 Modal */}
      <TRSystemModal
        isOpen={showTRSystemModal}
        onClose={() => setShowTRSystemModal(false)}
        inspections={inspections}
        onApply={(updatedPanels) => {
          if (onUpdateInspections) {
            onUpdateInspections(updatedPanels);
          }
        }}
      />
    </div>
  );
};

export default QRGenerator;
