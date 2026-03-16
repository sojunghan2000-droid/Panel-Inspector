import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { InspectionRecord, QRCodeData } from '../types';
import { CheckCircle2, Clock, AlertCircle, X, QrCode, Edit2, Save, MapPin, Upload, Image as ImageIcon, ChevronLeft, ZoomOut } from 'lucide-react';
import { getFloorPlanImageAsDataURL, saveFloorPlanImage, dataURLToBlob } from '../services/indexedDBService';

interface FloorPlanViewProps {
  inspections: InspectionRecord[];
  /** QR 코드 목록 (동적 데이터) */
  qrCodes?: QRCodeData[];
  onSelectInspection?: (inspection: InspectionRecord) => void;
  onUpdateInspections?: (inspections: InspectionRecord[]) => void;
  selectedInspectionId?: string | null;
  onSelectionChange?: (id: string | null) => void;
  selectedFloor?: string;
  onFloorChange?: (floor: string) => void;
  /** false면 마커 클릭/선택 시 상세 패널(모달)을 띄우지 않음 */
  showDetailPanel?: boolean;
  /** true면 상세 패널이 열릴 때 위치 수정 모드로 열림 */
  startInEditMode?: boolean;
  /** 모드: 'dashboard' = 읽기 전용 + InspectionDetail Modal, 'panel-master' = 기존 편집 모드 */
  mode?: 'dashboard' | 'panel-master';
  /** true = 위치 편집 불가 (Dashboard용) */
  readOnly?: boolean;
  /** Dashboard 모드에서 위젯 클릭 시 InspectionDetail Modal 표시 */
  onShowInspectionModal?: (inspection: InspectionRecord) => void;
}

/** MOCK_DATA와 동일: 1=F1, 2=F2, …, 6=F6, 7=B1, 8=B2. F1 탭에 1~6층, B1 탭에 7~8층 표시 */
const UPPER_FLOORS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'];
const BASEMENT_FLOORS = ['B1', 'B2'];
/** 층별 현황판 표시용 라벨 */
const FLOOR_DISPLAY_LABELS: Record<string, string> = {
  'F6': '지상6층', 'F5': '지상5층', 'F4': '지상4층',
  'F3': '지상3층', 'F2': '지상2층', 'F1': '지상1층',
  'B1': '지하1층', 'B2': '지하2층',
};
const FLOOR_LABEL_MAP: Record<string, string> = {
  '1': 'F1', '2': 'F2', '3': 'F3', '4': 'F4', '5': 'F5', '6': 'F6',
  '7': 'B1', '8': 'B2',
  'F1': 'F1', 'F2': 'F2', 'F3': 'F3', 'F4': 'F4', 'F5': 'F5', 'F6': 'F6',
  'B1': 'B1', 'B2': 'B2',
};
/** QR/검사 데이터의 층 값(숫자 '1','7' 또는 레이블 'F1','B1')을 표준 레이블로 통일 */
const toFloorLabel = (floor: string | null): string | null => {
  if (!floor) return null;
  const key = String(floor).trim().toUpperCase();
  return FLOOR_LABEL_MAP[key] ?? floor;
};
const ALL_FLOORS = [...UPPER_FLOORS, ...BASEMENT_FLOORS];

interface QRLocation {
  id: string;
  location: string;
  floor: string;
  position: { x: number; y: number };
  qrId: string;
}

const FloorPlanView: React.FC<FloorPlanViewProps> = ({
  inspections,
  qrCodes: propQrCodes = [],
  onSelectInspection,
  onUpdateInspections,
  selectedInspectionId,
  onSelectionChange,
  selectedFloor: propSelectedFloor,
  onFloorChange,
  showDetailPanel = true,
  startInEditMode = false,
  mode = 'panel-master',
  readOnly = false,
  onShowInspectionModal
}) => {
  const [selectedInspection, setSelectedInspection] = useState<InspectionRecord | null>(null);
  const [hoveredInspection, setHoveredInspection] = useState<InspectionRecord | null>(null);
  // qrCodes prop → qrLocations (동적 데이터)
  const qrLocations = useMemo(() => {
    const locations: QRLocation[] = [];
    propQrCodes.forEach((qr: QRCodeData) => {
      try {
        const qrData = JSON.parse(qr.qrData);
        let position = { x: 50, y: 50 };
        if (qrData.position && typeof qrData.position === 'object' && qrData.position.x != null && qrData.position.y != null) {
          position = { x: qrData.position.x, y: qrData.position.y };
        }
        if (position.x >= 0 && position.x <= 100 && position.y >= 0 && position.y <= 100) {
          locations.push({
            id: `qr-${qr.id}`,
            location: qr.location,
            floor: qr.floor,
            position,
            qrId: qr.id
          });
        }
      } catch {
        // skip
      }
    });
    return locations;
  }, [propQrCodes]);
  const savedQRCodesForMarkers = propQrCodes;
  const [isEditingInspectionPosition, setIsEditingInspectionPosition] = useState(false);
  const [editingPosition, setEditingPosition] = useState({ x: 0, y: 0 });
  const [editingFloor, setEditingFloor] = useState<string>('');
  const [panelPosition, setPanelPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [internalSelectedFloor, setInternalSelectedFloor] = useState<string>('F1');
  // 줌 기능 상태
  const [zoomLevel, setZoomLevel] = useState(1);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 });
  // 클릭 후 포커스 상태 (클릭해야 스크롤 줌 활성화)
  const [isZoomFocused, setIsZoomFocused] = useState(false);
  // 팬(이동) 기능 상태
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const didPanRef = useRef(false); // 팬 동작이 발생했으면 클릭 이벤트 무시
  const panStartRef = useRef({ x: 0, y: 0 });
  const panOffsetStartRef = useRef({ x: 0, y: 0 });
  const zoomContainerRef = useRef<HTMLDivElement>(null);
  const zoomInnerRef = useRef<HTMLDivElement>(null);
  const lastTouchDistanceRef = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** 리스트/마커에서 다른 검사 항목을 선택했을 때만 층 동기화. 드롭다운으로 층만 바꾼 경우에는 덮어쓰지 않음 */
  const prevSelectedInspectionIdRef = useRef<string | null>(null);
  /** 내부 마커 클릭 추적: true면 scrollToMarker 호출 생략 (스크롤 초기화 방지) */
  const isInternalSelectionRef = useRef(false);

  // 배경 이미지 관련 state (8개 층 전체)
  const [floorPlanImages, setFloorPlanImages] = useState<Record<string, string | null>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // prop으로 전달된 층수가 있으면 사용, 없으면 내부 상태 사용
  const selectedFloor = propSelectedFloor ?? internalSelectedFloor;

  // IndexedDB에서 배경 이미지 로드 (8개 층 전체)
  useEffect(() => {
    const loadAllFloorPlanImages = async () => {
      try {
        const images: Record<string, string | null> = {};
        for (const floor of ALL_FLOORS) {
          const img = await getFloorPlanImageAsDataURL(floor);
          images[floor] = img;
        }
        setFloorPlanImages(images);
      } catch (error) {
        console.error('배경 이미지 로드 오류:', error);
      }
    };
    loadAllFloorPlanImages();
  }, []);

  // 배경 이미지 업로드 핸들러
  const handleFloorPlanImageUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      // 파일을 Data URL로 읽기
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        if (!dataUrl) return;

        // Data URL을 Blob으로 변환하여 IndexedDB에 저장
        const blob = dataURLToBlob(dataUrl);
        await saveFloorPlanImage(selectedFloor, blob);

        // state 업데이트
        setFloorPlanImages(prev => ({ ...prev, [selectedFloor]: dataUrl }));

        alert(`${selectedFloor} 층 배경 이미지가 저장되었습니다.`);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('배경 이미지 업로드 오류:', error);
      alert('배경 이미지 업로드 중 오류가 발생했습니다.');
    }

    // 파일 입력 초기화
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [selectedFloor]);

  const handleFloorChange = (floor: string) => {
    if (onFloorChange) {
      onFloorChange(floor);
    } else {
      setInternalSelectedFloor(floor);
    }
  };

  // selectedInspectionId가 **다른 검사 항목으로** 변경될 때만 층 동기화 및 스크롤 (드롭다운으로 층만 바꾼 경우에는 유지)
  useEffect(() => {
    if (selectedInspectionId) {
      const inspection = inspections.find(i => i.panelNo === selectedInspectionId);
      if (inspection) {
        const selectionChanged = prevSelectedInspectionIdRef.current !== selectedInspectionId;
        prevSelectedInspectionIdRef.current = selectedInspectionId;

        if (selectionChanged) {
          // 내부 마커 클릭이면 스크롤 생략 (스크롤 초기화 방지)
          const shouldScroll = !isInternalSelectionRef.current;

          // 층수 결정: inspection.floor 필드 우선, 없으면 panelNo에서 추출
          let inspectionFloor: string = 'F1';
          if (inspection.floor) {
            // inspection에 floor가 명시적으로 저장되어 있으면 그대로 사용
            inspectionFloor = toFloorLabel(inspection.floor) || inspection.floor;
          } else {
            // floor가 없으면 panelNo에서 추출 (fallback)
            const idParts = inspection.panelNo.trim().split('-').map((p: string) => p.trim());
            const floorMap: { [key: string]: string } = {
              '1': 'F1', '2': 'F2', '3': 'F3', '4': 'F4', '5': 'F5', '6': 'F6',
              '7': 'B1', '8': 'B2',
            };
            if (idParts.length >= 1 && idParts[0]) {
              inspectionFloor = floorMap[idParts[0]] || 'F1';
            }
          }
          const targetFloor = toFloorLabel(inspectionFloor) || inspectionFloor;
          if (targetFloor !== selectedFloor) {
            handleFloorChange(targetFloor);
            if (shouldScroll) {
              setTimeout(() => scrollToMarker(inspection), 300);
            } else {
              setSelectedInspection(inspection);
              setPanelPosition({ x: 0, y: 0 });
            }
          } else {
            if (shouldScroll) {
              scrollToMarker(inspection);
            } else {
              setSelectedInspection(inspection);
              setPanelPosition({ x: 0, y: 0 });
            }
          }
        }
      }
    } else {
      prevSelectedInspectionIdRef.current = null;
      setSelectedInspection(null);
    }
  }, [selectedInspectionId, inspections, selectedFloor]);

  // startInEditMode일 때 상세 패널이 열리면 위치 수정 모드로 시작
  useEffect(() => {
    if (startInEditMode && selectedInspection && onUpdateInspections) {
      setIsEditingInspectionPosition(true);
      setEditingPosition({
        x: selectedInspection.position?.x ?? 50,
        y: selectedInspection.position?.y ?? 50
      });
      setEditingFloor(selectedInspection.floor || selectedFloor);
    }
  }, [startInEditMode, selectedInspection?.panelNo]);

  // 마커로 스크롤하는 헬퍼 함수
  const scrollToMarker = (inspection: InspectionRecord) => {
    // QRGenerator와 연동: 마커 선택 상태 동기화 및 Modal 표시
    setSelectedInspection(inspection);
    // 패널 위치 초기화
    setPanelPosition({ x: 0, y: 0 });
    
    // 마커로 스크롤 수행 (여러 번 시도하여 확실하게)
    const attemptScroll = (attempts: number = 0) => {
      if (attempts > 5) return; // 최대 5번 시도
      
      setTimeout(() => {
        const markerElement = document.querySelector(`[data-marker-id="${inspection.panelNo}"]`) as HTMLElement;
        if (markerElement) {
          // 마커가 보이는지 확인
          const rect = markerElement.getBoundingClientRect();
          const isVisible = rect.top >= 0 && rect.left >= 0 && 
                           rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                           rect.right <= (window.innerWidth || document.documentElement.clientWidth);
          
          if (!isVisible || attempts === 0) {
            // scrollIntoView 사용 (가장 확실한 방법)
            markerElement.scrollIntoView({ 
              behavior: 'smooth', 
              block: 'center', 
              inline: 'center' 
            });
          }
        } else if (attempts < 5) {
          // 마커가 아직 렌더링되지 않았으면 재시도
          attemptScroll(attempts + 1);
        }
        
        // QRGenerator 왼쪽 패널 내에서만 스크롤 (main 스크롤 방지)
        const inspectionItem = document.querySelector(`[data-inspection-id="${inspection.panelNo}"]`) as HTMLElement;
        if (inspectionItem) {
          const scrollParent = inspectionItem.closest('.overflow-y-auto');
          if (scrollParent) {
            const parent = scrollParent as HTMLElement;
            const itemTop = inspectionItem.offsetTop;
            const itemHeight = inspectionItem.offsetHeight;
            const parentHeight = parent.clientHeight;
            const targetScroll = itemTop - parentHeight / 2 + itemHeight / 2;
            parent.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
          } else {
            inspectionItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      }, attempts === 0 ? 100 : 200); // 첫 시도는 100ms, 재시도는 200ms
    };
    
    attemptScroll(0);
  };

  // 패널 외부 클릭 감지
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        // 마커 클릭은 제외
        const target = event.target as HTMLElement;
        if (!target.closest('[data-marker-id]')) {
          setSelectedInspection(null);
          if (onSelectionChange) {
            onSelectionChange(null);
          }
        }
      }
    };

    if (selectedInspection) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [selectedInspection, onSelectionChange]);

  // 도면 외부 클릭 시 줌 포커스 해제
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const el = zoomContainerRef.current;
      if (el && !el.contains(e.target as Node)) {
        setIsZoomFocused(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // 줌: 마우스 휠 핸들러 (포커스 상태일 때만 동작)
  const isZoomFocusedRef = useRef(false);
  useEffect(() => { isZoomFocusedRef.current = isZoomFocused; }, [isZoomFocused]);

  const handleWheel = useCallback((e: WheelEvent) => {
    if (!isZoomFocusedRef.current) return; // 클릭 전에는 스크롤 패스스루
    e.preventDefault();
    const container = zoomContainerRef.current;
    if (!container) return;

    // 줌 origin은 inner(transform) div 기준으로 계산 — 패딩 영역에서도 올바르게 동작
    const inner = zoomInnerRef.current;
    const rect = inner ? inner.getBoundingClientRect() : container.getBoundingClientRect();
    const originX = ((e.clientX - rect.left) / rect.width) * 100;
    const originY = ((e.clientY - rect.top) / rect.height) * 100;

    setZoomOrigin({ x: originX, y: originY });
    setZoomLevel(prev => {
      const delta = e.deltaY > 0 ? -0.2 : 0.2;
      const next = Math.max(1, Math.min(5, +(prev + delta).toFixed(1)));
      if (next <= 1) setPanOffset({ x: 0, y: 0 });
      return next;
    });
  }, []);

  // 줌: 모바일 핀치 줌 + 1손가락 팬 핸들러
  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length === 1 && zoomLevel > 1) {
      // 줌 상태에서 1손가락 터치 → 팬 시작
      isPanningRef.current = true;
      didPanRef.current = false;
      panStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      panOffsetStartRef.current = { ...panOffset };
    }
    if (e.touches.length === 2) {
      // 2손가락 → 핀치 줌 (팬 중단)
      isPanningRef.current = false;
    }
  }, [zoomLevel, panOffset]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      isPanningRef.current = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (lastTouchDistanceRef.current !== null) {
        const delta = (distance - lastTouchDistanceRef.current) * 0.01;
        setZoomLevel(prev => {
          const next = Math.max(1, Math.min(5, +(prev + delta).toFixed(1)));
          if (next <= 1) setPanOffset({ x: 0, y: 0 });
          return next;
        });
      }
      lastTouchDistanceRef.current = distance;
    } else if (e.touches.length === 1 && isPanningRef.current && zoomLevel > 1) {
      e.preventDefault();
      const dx = e.touches[0].clientX - panStartRef.current.x;
      const dy = e.touches[0].clientY - panStartRef.current.y;
      // 5px 이상 이동해야 팬으로 인식 (탭과 구분)
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        didPanRef.current = true;
      }
      setPanOffset({
        x: panOffsetStartRef.current.x + dx,
        y: panOffsetStartRef.current.y + dy,
      });
    }
  }, [zoomLevel]);

  const handleTouchEnd = useCallback(() => {
    lastTouchDistanceRef.current = null;
    isPanningRef.current = false;
  }, []);

  // 데스크톱 마우스 드래그 팬 (줌 상태에서만)
  const handleZoomMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoomLevel <= 1) return;
    // 버튼/입력 필드 클릭은 제외
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('[data-marker-id]')) return;
    e.preventDefault();
    isPanningRef.current = true;
    didPanRef.current = false;
    panStartRef.current = { x: e.clientX, y: e.clientY };
    panOffsetStartRef.current = { ...panOffset };

    const handleMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - panStartRef.current.x;
      const dy = ev.clientY - panStartRef.current.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        didPanRef.current = true;
      }
      setPanOffset({
        x: panOffsetStartRef.current.x + dx,
        y: panOffsetStartRef.current.y + dy,
      });
    };
    const handleMouseUp = () => {
      isPanningRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [zoomLevel, panOffset]);

  // 줌 & 팬: 이벤트 리스너 등록
  useEffect(() => {
    const el = zoomContainerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd);
    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleWheel, handleTouchStart, handleTouchMove, handleTouchEnd]);

  // 드래그 핸들러
  const handleMouseDown = (e: React.MouseEvent) => {
    // 버튼이나 입력 필드 클릭은 드래그로 처리하지 않음
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('textarea')) {
      return;
    }
    setIsDragging(true);
    setDragStart({
      x: e.clientX - panelPosition.x,
      y: e.clientY - panelPosition.y
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newX = e.clientX - dragStart.x;
        const newY = e.clientY - dragStart.y;
        
        // 화면 경계 내에서만 이동 (모바일 대응)
        const panelWidth = Math.min(400, window.innerWidth - 24);
        const panelHeight = Math.min(400, window.innerHeight - 100);
        const maxX = window.innerWidth - panelWidth;
        const maxY = window.innerHeight - panelHeight;
        
        setPanelPosition({
          x: Math.max(0, Math.min(newX, maxX)),
          y: Math.max(0, Math.min(newY, maxY))
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragStart, panelPosition]);

  const handleSaveInspectionPosition = () => {
    if (!selectedInspection || !onUpdateInspections) return;

    try {
      const floorChanged = editingFloor && editingFloor !== (selectedInspection.floor || selectedFloor);

      // InspectionRecord 위치 + 층 정보 업데이트
      const updatedInspections = inspections.map(inspection =>
        inspection.panelNo === selectedInspection.panelNo
          ? {
              ...inspection,
              position: { x: editingPosition.x, y: editingPosition.y },
              ...(editingFloor ? { floor: editingFloor } : {})
            }
          : inspection
      );

      onUpdateInspections(updatedInspections);

      // 화면에 반영
      setSelectedInspection(prev =>
        prev ? {
          ...prev,
          position: { x: editingPosition.x, y: editingPosition.y },
          ...(editingFloor ? { floor: editingFloor } : {})
        } : null
      );

      setIsEditingInspectionPosition(false);
      setSelectedInspection(null);

      // 부모(QRGenerator)의 openDetailPanelForMapping 리셋 → 다음 마커 클릭 시 간편 이동 모드
      if (onSelectionChange) {
        onSelectionChange(null);
      }

      // 층이 변경되었으면 해당 층으로 이동
      if (floorChanged && editingFloor) {
        handleFloorChange(editingFloor);
      }
    } catch (error) {
      console.error('Failed to save inspection position:', error);
      alert('위치 저장에 실패했습니다.');
    }
  };


  /** TR 기준 색상 반환: TR-1 (A) = 파란색, TR-2 (B) = 주황색 */
  const getTRColor = (panelNo: string, qrCodes: QRCodeData[], inspection?: InspectionRecord): string => {
    // 1. inspection.tr 필드 우선 확인 (명시적 TR 값)
    if (inspection?.tr === 'A') return '#3b82f6'; // TR-1 파란색
    if (inspection?.tr === 'B') return '#f97316'; // TR-2 주황색

    // 2. QR 코드에서 location 확인
    const matchingQR = qrCodes.find(qr => {
      try { return JSON.parse(qr.qrData).id === panelNo; } catch { return false; }
    });
    if (matchingQR) {
      const loc = matchingQR.location?.toUpperCase();
      if (loc === 'A' || loc === '1') return '#3b82f6';
      if (loc === 'B' || loc === '2') return '#f97316';
    }

    return '#94a3b8'; // 기본 회색
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Complete':
        return '#10b981'; // emerald
      case 'In Progress':
        return '#3b82f6'; // blue
      case 'Pending':
        return '#94a3b8'; // slate
      default:
        return '#94a3b8';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Complete':
        return <CheckCircle2 size={16} className="text-white" />;
      case 'In Progress':
        return <Clock size={16} className="text-white" />;
      default:
        return <AlertCircle size={16} className="text-white" />;
    }
  };

  const handleMarkerClick = (inspection: InspectionRecord) => {
    // Dashboard 모드: InspectionDetail Modal 표시
    if (mode === 'dashboard' && onShowInspectionModal) {
      onShowInspectionModal(inspection);
      return;
    }

    // Panel Master 모드: 기존 동작
    // 이미 선택된 마커 재클릭 → deselect (위치 편집 종료)
    if (mode !== 'dashboard' && selectedInspection?.panelNo === inspection.panelNo) {
      setSelectedInspection(null);
      if (onSelectionChange) onSelectionChange(null);
      return;
    }

    // 내부 클릭 플래그 설정: scrollToMarker 호출 방지
    isInternalSelectionRef.current = true;
    setSelectedInspection(inspection);
    // QRGenerator와 연동: ID를 통해 양방향 동기화
    if (onSelectionChange) {
      onSelectionChange(inspection.panelNo);
    }
    if (onSelectInspection) {
      onSelectInspection(inspection);
    }
    // 100ms 후 플래그 리셋
    setTimeout(() => {
      isInternalSelectionRef.current = false;
    }, 100);
  };

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 팬(이동) 동작 후 클릭은 무시
    if (didPanRef.current) {
      didPanRef.current = false;
      return;
    }
    // 마커 클릭은 제외
    const target = e.target as HTMLElement;
    if (target.closest('[data-marker-id]')) {
      return;
    }

    // 읽기 전용 모드에서는 클릭으로 새 위치 지정 불가
    if (readOnly) {
      return;
    }

    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();

    // 컨테이너 기준 퍼센트 좌표 계산 (마커 렌더링/그리드 눈금과 동일한 좌표계)
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const x = (clickX / rect.width) * 100;
    const y = (clickY / rect.height) * 100;
    
    // 좌표를 0-100 범위로 제한
    const clampedX = Math.max(0, Math.min(100, x));
    const clampedY = Math.max(0, Math.min(100, y));

    // 선택된 inspection이 있으면 위치 업데이트 → 자동 저장 → 선택 해제
    if (selectedInspection && onUpdateInspections) {
      const updatedInspections = inspections.map(inspection =>
        inspection.panelNo === selectedInspection.panelNo
          ? { ...inspection, position: { x: clampedX, y: clampedY } }
          : inspection
      );

      onUpdateInspections(updatedInspections);

      // 선택 유지: 마커를 계속 이동할 수 있도록 selectedInspection을 새 위치로 업데이트
      // (deselect 하려면 마커 재클릭)
      const movedInspection = { ...selectedInspection, position: { x: clampedX, y: clampedY } };
      setSelectedInspection(movedInspection);
    } else {
      // 선택된 inspection이 없으면 가장 가까운 inspection 선택하거나 새로 생성
      // 여기서는 가장 가까운 inspection을 찾아서 선택
      const nearestInspection = inspections.find(inspection => {
        if (!inspection.position) return false;
        const dx = Math.abs(inspection.position.x - clampedX);
        const dy = Math.abs(inspection.position.y - clampedY);
        return dx < 5 && dy < 5; // 5% 이내에 있으면 선택
      });

      if (nearestInspection) {
        handleMarkerClick(nearestInspection);
        // 위치 업데이트
        if (onUpdateInspections) {
          const updatedInspections = inspections.map(inspection => 
            inspection.panelNo === nearestInspection.panelNo
              ? { ...inspection, position: { x: clampedX, y: clampedY } }
              : inspection
          );
          onUpdateInspections(updatedInspections);
        }
      }
    }
  };

  const getConnectedLoadsCount = (loads: InspectionRecord['loads']) => {
    return Object.values(loads).filter(Boolean).length;
  };

  const getConnectedLoadsText = (loads: InspectionRecord['loads']) => {
    const connected = [];
    if (loads.welder) connected.push('Welder');
    if (loads.grinder) connected.push('Grinder');
    if (loads.light) connected.push('Light');
    if (loads.pump) connected.push('Pump');
    return connected.length > 0 ? connected.join(', ') : 'None';
  };

  // Filter inspections that have position data and remove duplicates by panelNo
  const positionedInspections = useMemo(() => {
    const seen = new Set<string>();
    return inspections.filter(inspection => {
      if (!inspection.position) return false;
      if (seen.has(inspection.panelNo)) {
        return false;
      }
      seen.add(inspection.panelNo);
      return true;
    });
  }, [inspections]);

  // 미지정 위치 패널 필터링
  const unpositionedInspections = useMemo(() => {
    return inspections.filter(i => !i.position);
  }, [inspections]);

  // Combine inspections and QR locations for display
  // QR과 ID는 하나의 객체이므로 ID로 매칭하여 통합
  const allMarkers = useMemo(() => {
    const markers: Array<{
      id: string;
      type: 'inspection';
      position: { x: number; y: number };
      data: InspectionRecord;
      qrLocation?: QRLocation;
    }> = [];
    
    // ID 기준으로 중복 제거를 위한 Set
    const seenMarkerIds = new Set<string>();

    // QR 코드 데이터에서 ID 매핑 생성 (동적 데이터: propQrCodes)
    const qrMapByInspectionId = new Map<string, QRLocation>();
    qrLocations.forEach(qrLoc => {
      try {
        const qrCode = propQrCodes.find((qr: QRCodeData) => qr.id === qrLoc.qrId);
        if (qrCode) {
          const qrData = JSON.parse(qrCode.qrData);
          if (qrData.id) {
            qrMapByInspectionId.set(qrData.id, qrLoc);
          }
        }
      } catch (e) {
        // 무시
      }
    });

    // InspectionRecord를 기준으로 마커 생성 (QR 정보 포함)
    positionedInspections.forEach(inspection => {
      if (inspection.position) {
        const qrLocation = qrMapByInspectionId.get(inspection.panelNo);
        
        // 층수 필터링: inspection.floor → QR floor → panelNo 추출 순서
        let shouldShow = false;
        let markerFloor: string | null = null;

        // 1. inspection.floor 명시적 필드 우선
        if (inspection.floor) {
          markerFloor = inspection.floor;
        } else if (qrLocation) {
          // 2. QR 코드에 층수 정보가 있으면 사용
          markerFloor = qrLocation.floor;
        } else {
          // QR 코드 정보가 없으면 propQrCodes에서 직접 확인
          try {
            const qrCode = propQrCodes.find((qr: QRCodeData) => {
              try {
                const qrData = JSON.parse(qr.qrData);
                return qrData.id === inspection.panelNo;
              } catch {
                return false;
              }
            });
            
            if (qrCode) {
              markerFloor = qrCode.floor;
            }
          } catch (e) {
            // 무시
          }
        }
        
        // QR 코드에 층수 정보가 없으면 PNL NO.에서 추출 (형식: 1, 2, 1-1, 2-1, 3-1-1 → 1=F1, 2=B1)
        if (!markerFloor && inspection.panelNo) {
          const idParts = inspection.panelNo.trim().split('-').map((p: string) => p.trim());
          const floorMap: { [key: string]: string } = {
            '1': 'F1', '2': 'F2', '3': 'F3', '4': 'F4', '5': 'F5', '6': 'F6',
            '7': 'B1', '8': 'B2',
            'A': 'F1', 'B': 'B1', 'F1': 'F1', 'B1': 'B1',
            'F2': 'F2', 'F3': 'F3', 'F4': 'F4', 'F5': 'F5', 'F6': 'F6', 'B2': 'B2',
          };
          if (idParts.length === 1 && idParts[0]) {
            markerFloor = floorMap[idParts[0].toUpperCase()] || 'F1';
          } else if (idParts.length >= 2) {
            const first = idParts[0]?.toUpperCase() || '';
            const second = idParts[1]?.toUpperCase() || '';
            markerFloor = floorMap[first] || (idParts.length >= 3 ? (floorMap[second] || 'F1') : 'F1');
          }
        }
        
        // 층수 정확 일치: 선택된 층과 동일한 마커만 표시
        const normalizedFloor = toFloorLabel(markerFloor);
        if (!normalizedFloor) {
          shouldShow = true;
        } else if (normalizedFloor === selectedFloor) {
          shouldShow = true;
        }
        
        // 층에 맞는 마커만 추가 (panelNo 중복 체크)
        if (shouldShow && !seenMarkerIds.has(inspection.panelNo)) {
          seenMarkerIds.add(inspection.panelNo);
          markers.push({
            id: inspection.panelNo,
            type: 'inspection',
            position: inspection.position,
            data: inspection,
            qrLocation: qrLocation
          });
        }
      }
    });
    
    // 디버깅: 마커 개수 확인
    console.log('Total markers for floor', selectedFloor, ':', markers.length, 'Positioned inspections:', positionedInspections.length, 'Unique IDs:', seenMarkerIds.size);

    return markers;
  }, [positionedInspections, qrLocations, selectedFloor]);

  // 층별 위젯 개수 현황 (전체 층)
  const floorStats = useMemo(() => {
    const stats: Record<string, number> = {};
    [...UPPER_FLOORS, ...BASEMENT_FLOORS].forEach(f => stats[f] = 0);

    inspections.forEach(insp => {
      if (!insp.position) return;
      const floor = toFloorLabel(insp.floor || 'F1') || 'F1';
      if (stats.hasOwnProperty(floor)) stats[floor]++;
    });

    return { stats, total: Object.values(stats).reduce((a, b) => a + b, 0) };
  }, [inspections]);

  // 층에 따른 이미지 경로 결정 (IndexedDB에 저장된 이미지가 있으면 사용, 없으면 null)
  const floorImagePath = useMemo(() => {
    return floorPlanImages[selectedFloor] || null;
  }, [selectedFloor, floorPlanImages]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      {selectedInspectionId && (
        <button
          onClick={() => {
            setSelectedInspection(null);
            setIsEditingInspectionPosition(false);
          }}
          className="ml-1 px-2 py-0.5 bg-white/20 hover:bg-white/30 rounded text-xs transition-colors flex items-center gap-2"
        >
          <ChevronLeft size={16} />
          전체 보기
        </button>
      )}
      <div className="p-3 md:p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base md:text-lg font-semibold text-slate-800 truncate">Distribution Board Locations</h3>
          <p className="text-sm text-slate-600 mt-1">
            {allMarkers.length} board{allMarkers.length !== 1 ? 's' : ''} mapped on floor plan
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700">층 선택:</label>
          <select
            value={selectedFloor}
            onChange={(e) => handleFloorChange(e.target.value)}
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none cursor-pointer"
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
          {/* 배경 이미지 업로드 버튼 */}
          <label className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer text-sm font-medium transition-colors">
            <Upload size={16} />
            <span className="hidden sm:inline">{selectedFloor} 배경</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFloorPlanImageUpload}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* 층별 현황 + Legend - 사진 영역 위에 가로 배치 */}
      <div className="px-4 py-3 border-b border-slate-200 bg-white flex flex-wrap justify-between items-start gap-4">
        {/* 층별 현황판 */}
        <div className="flex-1 min-w-[200px]">
          <div className="text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">층별 현황</div>
          <div className="grid grid-cols-4 gap-x-2 gap-y-1 text-[10px] sm:text-xs">
            {['F6', 'F5', 'F4', 'F3', 'F2', 'F1', 'B1', 'B2'].map(floor => (
              <div key={floor} className="flex justify-between gap-0.5 whitespace-nowrap">
                <span className="text-slate-500">{FLOOR_DISPLAY_LABELS[floor]}:</span>
                <span className={`font-medium ${floorStats.stats[floor] > 0 ? (floor.startsWith('B') ? 'text-orange-600' : 'text-blue-600') : 'text-slate-400'}`}>
                  {floorStats.stats[floor] > 0 ? `${floorStats.stats[floor]}면` : '-'}
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-2 pt-2 border-t border-slate-100 text-xs font-semibold">
            <span className="text-slate-700">총:</span>
            <span className="text-emerald-600">{floorStats.total}면</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex-shrink-0">
          <div className="text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">Legend (TR)</div>
          <div className="flex flex-wrap gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#3b82f6' }}></div>
              <span className="text-slate-600">TR-1 900KVA</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#f97316' }}></div>
              <span className="text-slate-600">TR-2 950KVA</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#94a3b8' }}></div>
              <span className="text-slate-600">미지정</span>
            </div>
          </div>
        </div>
      </div>

      <div
        ref={zoomContainerRef}
        className="relative bg-slate-100 min-h-[40vh] md:min-h-[600px] p-6 overflow-hidden"
        onClick={() => setIsZoomFocused(true)}
      >
        {/* 포커스 전 오버레이 힌트 */}
        {!isZoomFocused && (
          <div className="absolute inset-0 z-50 pointer-events-none flex items-end justify-center pb-4">
            <div className="bg-black/50 text-white text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5 backdrop-blur-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 9V5h4M19 9V5h-4M5 15v4h4M19 15v4h-4"/></svg>
              클릭 후 스크롤로 확대/축소
            </div>
          </div>
        )}
        {/* 포커스 활성 표시 테두리 */}
        {isZoomFocused && (
          <div className="absolute inset-0 z-50 pointer-events-none ring-2 ring-blue-400 ring-inset rounded" />
        )}

        {/* Floor Plan Image or Empty Message */}
        {!floorImagePath ? (
          <div className="relative w-full h-full min-h-[40vh] md:min-h-[600px] flex items-center justify-center bg-slate-100 cursor-crosshair touch-none"
            onClick={handleImageClick}
          >
            <div className="text-center p-8">
              <ImageIcon size={48} className="mx-auto mb-4 text-slate-300" />
              <p className="text-lg font-medium text-slate-500">Plan DWG을 반영해주세요</p>
              <p className="text-sm text-slate-400 mt-2">{selectedFloor} ({FLOOR_DISPLAY_LABELS[selectedFloor] || selectedFloor}) 층의 배경 이미지가 없습니다</p>
              <p className="text-xs text-slate-400 mt-1">상단 배경 업로드 버튼을 눌러 이미지를 추가하세요</p>
            </div>
          </div>
        ) : (
        <div
          ref={zoomInnerRef}
          className={`relative w-full h-full min-h-[40vh] md:min-h-[600px] touch-none ${zoomLevel > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
          onClick={handleImageClick}
          onMouseDown={handleZoomMouseDown}
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
            transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`,
            transition: isPanningRef.current ? 'none' : 'transform 0.15s ease-out',
          }}
        >
          {/* Floor Plan Image - 낮은 해상도, 최하위 z-index */}
          <img
            src={floorImagePath}
            alt={`${selectedFloor} Floor Plan`}
            className="w-full h-full object-fill pointer-events-none min-h-[40vh] md:min-h-[600px]"
            style={{
              objectFit: 'fill',
              imageRendering: 'pixelated',
              opacity: 0.7,
              zIndex: 0,
            }}
          />

          {/* Scale Grid Overlay (0, 25, 50, 75, 100) */}
          <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }}>
            {/* 세로 그리드선 (x축) */}
            {[0, 25, 50, 75, 100].map(val => (
              <div
                key={`v-${val}`}
                className="absolute top-0 bottom-0"
                style={{
                  left: `${val}%`,
                  borderLeft: '1px dashed rgba(148, 163, 184, 0.4)',
                }}
              >
                <span
                  className="absolute text-[10px] text-slate-400 font-mono select-none"
                  style={{ top: '-18px', left: '50%', transform: 'translateX(-50%)' }}
                >
                  {val}
                </span>
              </div>
            ))}
            {/* 가로 그리드선 (y축) */}
            {[0, 25, 50, 75, 100].map(val => (
              <div
                key={`h-${val}`}
                className="absolute left-0 right-0"
                style={{
                  top: `${val}%`,
                  borderTop: '1px dashed rgba(148, 163, 184, 0.4)',
                }}
              >
                <span
                  className="absolute text-[10px] text-slate-400 font-mono select-none"
                  style={{ left: '-24px', top: '50%', transform: 'translateY(-50%)' }}
                >
                  {val}
                </span>
              </div>
            ))}
          </div>

          {/* Markers */}
          {allMarkers.length === 0 && (
            <div className="absolute top-4 left-4 bg-red-500 text-white p-4 rounded-lg shadow-xl z-50">
              <p className="font-bold">⚠️ 위젯이 없습니다!</p>
              <p className="text-sm mt-1">위치 정보가 있는 검사 항목: {positionedInspections.length}개</p>
              <p className="text-sm">표시할 마커: {allMarkers.length}개</p>
            </div>
          )}
          {allMarkers.map((marker) => {
            const { x, y } = marker.position;
            const inspection = marker.data;
            // TR 기준 색상 사용 (TR-1 = 파란색, TR-2 = 주황색)
            const trColor = getTRColor(inspection.panelNo, propQrCodes, inspection);
            const isSelected = selectedInspection?.panelNo === marker.id;
            const isHovered = hoveredInspection?.panelNo === marker.id;
            // Panel Master: 패널 선택 시 선택된 마커만 표시, 나머지 숨김
            const isHiddenByPanelMaster = mode !== 'dashboard' && !!selectedInspection && !isSelected;

            return (
              <div
                key={marker.id}
                data-marker-id={marker.id}
                data-inspection-id={inspection.panelNo}
                data-selected={isSelected ? 'true' : 'false'}
                className="absolute transform -translate-x-1/2 -translate-y-1/2 transition-transform cursor-pointer"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  padding: '6px',
                  zIndex: 10,
                  opacity: isHiddenByPanelMaster ? 0 : 1,
                  pointerEvents: isHiddenByPanelMaster ? 'none' : 'auto',
                  transition: 'opacity 0.2s ease',
                }}
                onClick={() => handleMarkerClick(inspection)}
                onMouseEnter={() => setHoveredInspection(inspection)}
                onMouseLeave={() => setHoveredInspection(null)}
              >
                {/* panelNo 라벨 (점 위쪽) */}
                <div
                  className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm"
                  style={{
                    bottom: '100%',
                    marginBottom: '4px',
                    backgroundColor: trColor,
                  }}
                >
                  {inspection.panelNo}
                </div>
                {/* 작은 점/원 */}
                <div
                  className="rounded-full transition-transform"
                  style={{
                    width: isSelected || isHovered ? '14px' : '10px',
                    height: isSelected || isHovered ? '14px' : '10px',
                    backgroundColor: trColor,
                    border: '2px solid white',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                  }}
                />
              </div>
            );
          })}
        </div>
        )}

        {/* 미지정 위치 패널 목록 */}
        {unpositionedInspections.length > 0 && (
          <div className="bg-slate-50 border-t border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-400 font-medium mb-2">
              미지정 위치 ({unpositionedInspections.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {unpositionedInspections.map(item => (
                <button
                  key={item.panelNo}
                  onClick={() => handleMarkerClick(item)}
                  className={`flex items-center gap-1.5 px-2 py-1 bg-white border rounded text-xs transition-colors ${
                    selectedInspection?.panelNo === item.panelNo
                      ? 'border-blue-400 text-blue-600 bg-blue-50'
                      : 'border-slate-200 text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  <div className="w-2 h-2 rounded-full bg-slate-400" />
                  {item.panelNo}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Selected Inspection Details Panel — startInEditMode(Dashboard에 위치 매핑 경로)일 때만 표시 */}
        {showDetailPanel && startInEditMode && mode !== 'dashboard' && selectedInspection && (() => {
          // QR 정보 찾기
          const qrLocation = allMarkers.find(m => m.id === selectedInspection.panelNo)?.qrLocation;
          
          return (
          <>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 bg-black bg-opacity-30 z-20"
              onClick={() => {
                setSelectedInspection(null);
                if (onSelectionChange) {
                  onSelectionChange(null);
                }
              }}
            />
            {/* Popup Panel */}
            <div 
              ref={panelRef}
              className={`fixed bg-white rounded-xl shadow-2xl border border-slate-200 p-4 md:p-6 max-w-[calc(100vw-24px)] md:max-w-md w-[calc(100vw-24px)] md:w-auto max-h-[85vh] overflow-y-auto ${isDragging ? 'cursor-grabbing' : 'cursor-move'}`}
              style={{
                left: panelPosition.x === 0 ? '50%' : `${panelPosition.x}px`,
                top: panelPosition.y === 0 ? '50%' : `${panelPosition.y}px`,
                transform: panelPosition.x === 0 && panelPosition.y === 0 ? 'translate(-50%, -50%)' : 'none',
                zIndex: 30,
              }}
              onMouseDown={handleMouseDown}
            >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h4 className="font-bold text-slate-800 text-lg mb-0.5">{selectedInspection.panelNo}</h4>
                <p className="text-sm text-slate-600">Distribution Board</p>
                {qrLocation && !isEditingInspectionPosition && (
                  <p className="text-xs text-purple-600 mt-1 flex items-center gap-1">
                    <QrCode size={12} />
                    QR: {qrLocation.location} ({qrLocation.floor})
                  </p>
                )}
                {isEditingInspectionPosition && (
                  <div className="mt-1 flex items-center gap-2">
                    <QrCode size={12} className="text-purple-600 shrink-0" />
                    <select
                      value={editingFloor}
                      onChange={(e) => setEditingFloor(e.target.value)}
                      className="text-xs px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
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
                )}
              </div>
              <div className="flex items-center gap-1">
                {!isEditingInspectionPosition && !readOnly ? (
                  <button
                    onClick={() => {
                      setIsEditingInspectionPosition(true);
                      setEditingPosition({
                        x: selectedInspection.position?.x || 50,
                        y: selectedInspection.position?.y || 50
                      });
                      setEditingFloor(selectedInspection.floor || selectedFloor);
                    }}
                    className="p-1 hover:bg-blue-50 rounded text-slate-400 hover:text-blue-600 transition-colors"
                    title="위치 수정"
                  >
                    <Edit2 size={18} />
                  </button>
                ) : isEditingInspectionPosition ? (
                  <button
                    onClick={handleSaveInspectionPosition}
                    className="p-1 hover:bg-emerald-50 rounded text-slate-400 hover:text-emerald-600 transition-colors"
                    title="저장"
                  >
                    <Save size={18} />
                  </button>
                ) : null}
                <button
                  onClick={() => {
                    setSelectedInspection(null);
                    setIsEditingInspectionPosition(false);
                    // 부모(QRGenerator)의 openDetailPanelForMapping 리셋
                    if (onSelectionChange) {
                      onSelectionChange(null);
                    }
                  }}
                  className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {/* Status */}
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Status</p>
                <div className="flex items-center gap-2">
                  {getStatusIcon(selectedInspection.status)}
                  <span className="text-sm text-slate-800 font-medium">{selectedInspection.status}</span>
                </div>
              </div>

              {/* Last Inspection */}
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Last Inspection</p>
                <p className="text-sm text-slate-800 font-medium">
                  {selectedInspection.lastInspectionDate !== '-'
                    ? new Date(selectedInspection.lastInspectionDate).toLocaleString()
                    : 'Not inspected'}
                </p>
              </div>

              {/* Connected Loads */}
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Connected Loads</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: 'welder', label: 'Welder', connected: selectedInspection.loads.welder },
                    { key: 'grinder', label: 'Grinder', connected: selectedInspection.loads.grinder },
                    { key: 'light', label: 'Light', connected: selectedInspection.loads.light },
                    { key: 'pump', label: 'Pump', connected: selectedInspection.loads.pump },
                  ].map((load) => (
                    <span
                      key={load.key}
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        load.connected
                          ? 'bg-blue-100 text-blue-700 border border-blue-200'
                          : 'bg-slate-100 text-slate-500 border border-slate-200'
                      }`}
                    >
                      {load.label}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Active: {getConnectedLoadsCount(selectedInspection.loads)} / 4
                </p>
              </div>

              {/* Position */}
              {selectedInspection.position && (
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide mb-1 flex items-center gap-2">
                    <MapPin size={12} />
                    Position
                  </p>
                  {isEditingInspectionPosition ? (
                    <div className="grid grid-cols-2 gap-3 mt-2">
                      <div>
                        <label className="block text-xs text-slate-600 mb-1">X 좌표 (%)</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={editingPosition.x}
                          onChange={(e) => setEditingPosition(prev => ({ ...prev, x: parseFloat(e.target.value) || 0 }))}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-600 mb-1">Y 좌표 (%)</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={editingPosition.y}
                          onChange={(e) => setEditingPosition(prev => ({ ...prev, y: parseFloat(e.target.value) || 0 }))}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        />
                      </div>
                      <div className="col-span-2 flex gap-2 mt-2">
                        <button
                          onClick={handleSaveInspectionPosition}
                          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                        >
                          <Save size={14} />
                          저장
                        </button>
                        <button
                          onClick={() => {
                            setIsEditingInspectionPosition(false);
                            setEditingPosition({ 
                              x: selectedInspection.position?.x || 50, 
                              y: selectedInspection.position?.y || 50 
                            });
                          }}
                          className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-800 font-medium">
                      X: {selectedInspection.position.x}%, Y: {selectedInspection.position.y}%
                    </p>
                  )}
                </div>
              )}

              {/* Memo */}
              {selectedInspection.memo && (
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-sm text-slate-700 bg-slate-50 p-2 rounded border border-slate-200">
                    {selectedInspection.memo}
                  </p>
                </div>
              )}
             </div>
           </div>
           </>
           );
         })()}

        {/* 위젯 선택 시 하단 안내 바 (일반 마커 클릭 = 위치 이동 모드) */}
        {selectedInspection && !startInEditMode && mode !== 'dashboard' && !readOnly && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 bg-blue-600 text-white px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-3 text-sm font-medium animate-fade-in">
            <span className="inline-flex items-center gap-1.5">
              <MapPin size={14} />
              <strong>{selectedInspection.panelNo}</strong> 선택됨 — 도면을 클릭하면 위치가 이동됩니다
            </span>
            <button
              onClick={() => {
                setSelectedInspection(null);
                setIsEditingInspectionPosition(false);
              }}
              className="ml-1 px-2 py-0.5 bg-white/20 hover:bg-white/30 rounded text-xs transition-colors flex items-center gap-2"
            >
              확인
            </button>
          </div>
        )}

        {/* 줌 리셋 버튼 */}
        {zoomLevel > 1 && (
          <button
            onClick={() => { setZoomLevel(1); setZoomOrigin({ x: 50, y: 50 }); setPanOffset({ x: 0, y: 0 }); }}
            className="absolute bottom-3 right-3 z-20 bg-white/90 hover:bg-white rounded-lg px-3 py-1.5 shadow-md text-xs font-medium text-slate-600 border border-slate-200 flex items-center gap-1.5"
          >
            <ZoomOut size={14} />
            줌 리셋 ({zoomLevel}x)
          </button>
        )}
      </div>
    </div>
  );
};

export default FloorPlanView;
