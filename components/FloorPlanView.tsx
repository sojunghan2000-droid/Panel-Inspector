import React, { useState, useEffect, useMemo, useRef } from 'react';
import { InspectionRecord, QRCodeData } from '../types';
import { CheckCircle2, Clock, AlertCircle, X, QrCode, Edit2, Save, MapPin } from 'lucide-react';

interface FloorPlanViewProps {
  inspections: InspectionRecord[];
  onSelectInspection?: (inspection: InspectionRecord) => void;
  onUpdateInspections?: (inspections: InspectionRecord[]) => void;
  selectedInspectionId?: string | null;
  onSelectionChange?: (id: string | null) => void;
  selectedFloor?: 'F1' | 'B1';
  onFloorChange?: (floor: 'F1' | 'B1') => void;
}

interface QRLocation {
  id: string;
  location: string;
  floor: string;
  position: { x: number; y: number };
  qrId: string;
}

const FloorPlanView: React.FC<FloorPlanViewProps> = ({ 
  inspections, 
  onSelectInspection, 
  onUpdateInspections,
  selectedInspectionId,
  onSelectionChange,
  selectedFloor: propSelectedFloor,
  onFloorChange
}) => {
  const [selectedInspection, setSelectedInspection] = useState<InspectionRecord | null>(null);
  const [hoveredInspection, setHoveredInspection] = useState<InspectionRecord | null>(null);
  const [qrLocations, setQRLocations] = useState<QRLocation[]>([]);
  const [isEditingInspectionPosition, setIsEditingInspectionPosition] = useState(false);
  const [editingPosition, setEditingPosition] = useState({ x: 0, y: 0 });
  const [panelPosition, setPanelPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [internalSelectedFloor, setInternalSelectedFloor] = useState<'F1' | 'B1'>('F1');
  const panelRef = useRef<HTMLDivElement>(null);
  
  // prop으로 전달된 층수가 있으면 사용, 없으면 내부 상태 사용
  const selectedFloor = propSelectedFloor ?? internalSelectedFloor;
  
  const handleFloorChange = (floor: 'F1' | 'B1') => {
    if (onFloorChange) {
      onFloorChange(floor);
    } else {
      setInternalSelectedFloor(floor);
    }
  };

  // selectedInspectionId가 변경되면 해당 InspectionRecord 선택
  useEffect(() => {
    if (selectedInspectionId) {
      const inspection = inspections.find(i => i.id === selectedInspectionId);
      if (inspection) {
        setSelectedInspection(inspection);
        // 패널 위치 초기화
        setPanelPosition({ x: 0, y: 0 });
        // 마커로 스크롤 (간단한 방법으로 처리)
        setTimeout(() => {
          const markerElement = document.querySelector(`[data-marker-id="${inspection.id}"]`);
          if (markerElement) {
            markerElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 100);
      }
    } else {
      setSelectedInspection(null);
    }
  }, [selectedInspectionId, inspections]);

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
        
        // 화면 경계 내에서만 이동
        const maxX = window.innerWidth - 400; // 패널 너비 고려
        const maxY = window.innerHeight - 400; // 패널 높이 고려
        
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

  // Load QR mapping data from localStorage
  useEffect(() => {
    loadQRMappings();
  }, []);

  const loadQRMappings = () => {
    try {
      // Load dashboard mapping
      const mappingData = localStorage.getItem('dashboard_qr_mapping');
      if (mappingData) {
        const mapping = JSON.parse(mappingData);
        
        // Parse position from QR data
        let position = { x: 50, y: 50 }; // default
        try {
          const qrData = JSON.parse(mapping.qrData);
          // Try to parse position from position object
          if (qrData.position) {
            if (typeof qrData.position === 'object' && qrData.position.x !== undefined && qrData.position.y !== undefined) {
              position = { x: qrData.position.x, y: qrData.position.y };
            } else if (typeof qrData.position === 'string') {
              const match = qrData.position.match(/x[:\s]*(\d+)[,\s]*y[:\s]*(\d+)/i);
              if (match) {
                position = { x: parseFloat(match[1]), y: parseFloat(match[2]) };
              }
            }
          }
        } catch (e) {
          console.error('Failed to parse QR position:', e);
        }

        const qrLocation: QRLocation = {
          id: `qr-${mapping.qrId}`,
          location: mapping.location,
          floor: mapping.floor,
          position: position,
          qrId: mapping.qrId
        };

        setQRLocations([qrLocation]);
      }

      // Also load all saved QR codes and try to extract position info
      const savedQRCodes = JSON.parse(localStorage.getItem('safetyguard_qrcodes') || '[]');
      const additionalLocations: QRLocation[] = savedQRCodes
        .map((qr: QRCodeData) => {
          try {
            const qrData = JSON.parse(qr.qrData);
            let position = { x: 50, y: 50 };
            
            if (qrData.position) {
              if (typeof qrData.position === 'object' && qrData.position.x !== undefined && qrData.position.y !== undefined) {
                position = { x: qrData.position.x, y: qrData.position.y };
              } else if (typeof qrData.position === 'string') {
                const match = qrData.position.match(/x[:\s]*(\d+)[,\s]*y[:\s]*(\d+)/i);
                if (match) {
                  position = { x: parseFloat(match[1]), y: parseFloat(match[2]) };
                }
              }
            }

            // Only include if position coordinates are valid
            if (position.x >= 0 && position.x <= 100 && position.y >= 0 && position.y <= 100) {
              return {
                id: `qr-${qr.id}`,
                location: qr.location,
                floor: qr.floor,
                position: position,
                qrId: qr.id
              };
            }
            return null;
          } catch (e) {
            return null;
          }
        })
        .filter((loc: QRLocation | null) => loc !== null);

      // Merge with existing locations, avoiding duplicates
      setQRLocations(prev => {
        const merged = [...prev];
        additionalLocations.forEach(newLoc => {
          if (!merged.find(loc => loc.qrId === newLoc.qrId)) {
            merged.push(newLoc);
          }
        });
        return merged;
      });
    } catch (error) {
      console.error('Failed to load QR mappings:', error);
    }
  };

  // Refresh QR locations when component mounts or when storage changes
  useEffect(() => {
    const interval = setInterval(() => {
      loadQRMappings();
    }, 2000); // Check every 2 seconds

    return () => clearInterval(interval);
  }, []);

  const handleSaveInspectionPosition = () => {
    if (!selectedInspection || !onUpdateInspections) return;

    try {
      // InspectionRecord 위치 정보 업데이트
      const updatedInspections = inspections.map(inspection => 
        inspection.id === selectedInspection.id
          ? { ...inspection, position: { x: editingPosition.x, y: editingPosition.y } }
          : inspection
      );

      onUpdateInspections(updatedInspections);

      // 화면에 반영
      setSelectedInspection(prev => 
        prev ? { ...prev, position: { x: editingPosition.x, y: editingPosition.y } } : null
      );

      setIsEditingInspectionPosition(false);
      alert('위치가 저장되었습니다.');
    } catch (error) {
      console.error('Failed to save inspection position:', error);
      alert('위치 저장에 실패했습니다.');
    }
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
    setSelectedInspection(inspection);
    if (onSelectionChange) {
      onSelectionChange(inspection.id);
    }
    if (onSelectInspection) {
      onSelectInspection(inspection);
    }
  };

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 마커 클릭은 제외
    const target = e.target as HTMLElement;
    if (target.closest('[data-marker-id]')) {
      return;
    }

    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const img = container.querySelector('img');
    
    if (!img) return;

    // 이미지의 실제 표시 영역 계산 (object-contain 고려)
    const imgRect = img.getBoundingClientRect();
    const imgNaturalWidth = img.naturalWidth;
    const imgNaturalHeight = img.naturalHeight;
    
    if (imgNaturalWidth === 0 || imgNaturalHeight === 0) return;

    // 이미지의 실제 표시 크기 계산
    const containerAspect = rect.width / rect.height;
    const imageAspect = imgNaturalWidth / imgNaturalHeight;
    
    let displayWidth: number;
    let displayHeight: number;
    let offsetX: number;
    let offsetY: number;

    if (imageAspect > containerAspect) {
      // 이미지가 컨테이너보다 넓음 (좌우 여백)
      displayWidth = rect.width;
      displayHeight = rect.width / imageAspect;
      offsetX = 0;
      offsetY = (rect.height - displayHeight) / 2;
    } else {
      // 이미지가 컨테이너보다 높음 (상하 여백)
      displayWidth = rect.height * imageAspect;
      displayHeight = rect.height;
      offsetX = (rect.width - displayWidth) / 2;
      offsetY = 0;
    }

    // 클릭한 위치를 이미지 기준으로 계산
    const clickX = e.clientX - rect.left - offsetX;
    const clickY = e.clientY - rect.top - offsetY;
    
    // 이미지 영역 내부인지 확인
    if (clickX < 0 || clickX > displayWidth || clickY < 0 || clickY > displayHeight) {
      return; // 이미지 영역 밖 클릭은 무시
    }
    
    // 퍼센트 좌표로 변환
    const x = (clickX / displayWidth) * 100;
    const y = (clickY / displayHeight) * 100;
    
    // 좌표를 0-100 범위로 제한
    const clampedX = Math.max(0, Math.min(100, x));
    const clampedY = Math.max(0, Math.min(100, y));

    // 선택된 inspection이 있으면 위치 업데이트
    if (selectedInspection && onUpdateInspections) {
      const updatedInspections = inspections.map(inspection => 
        inspection.id === selectedInspection.id
          ? { ...inspection, position: { x: clampedX, y: clampedY } }
          : inspection
      );

      onUpdateInspections(updatedInspections);
      
      // 화면에 반영
      setSelectedInspection(prev => 
        prev ? { ...prev, position: { x: clampedX, y: clampedY } } : null
      );
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
            inspection.id === nearestInspection.id
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

  // Filter inspections that have position data
  const positionedInspections = inspections.filter(inspection => inspection.position);

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

    // QR 코드 데이터에서 ID 매핑 생성
    const qrMapByInspectionId = new Map<string, QRLocation>();
    qrLocations.forEach(qrLoc => {
      try {
        // QR 코드 데이터에서 InspectionRecord ID 찾기
        const savedQRCodes = JSON.parse(localStorage.getItem('safetyguard_qrcodes') || '[]');
        const qrCode = savedQRCodes.find((qr: QRCodeData) => qr.id === qrLoc.qrId);
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
        const qrLocation = qrMapByInspectionId.get(inspection.id);
        
        // 층수 필터링: QR 코드의 층수 정보와 선택된 층이 일치하는 경우만 표시
        let shouldShow = false;
        let markerFloor: string | null = null;
        
        if (qrLocation) {
          // QR 코드에 층수 정보가 있으면 그것을 사용
          markerFloor = qrLocation.floor;
        } else {
          // QR 코드 정보가 없으면 savedQRCodes에서 직접 확인
          try {
            const savedQRCodes = JSON.parse(localStorage.getItem('safetyguard_qrcodes') || '[]');
            const qrCode = savedQRCodes.find((qr: QRCodeData) => {
              try {
                const qrData = JSON.parse(qr.qrData);
                return qrData.id === inspection.id;
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
        
        // QR 코드에 층수 정보가 없으면 ID에서 추출 (형식: DB-층수-위치)
        if (!markerFloor && inspection.id) {
          const idParts = inspection.id.split('-');
          if (idParts.length >= 3) {
            // DB-층수-위치 형식에서 층수 추출 (idParts[1]이 층수)
            const floorFromId = idParts[1] || '';
            // 층수 매핑: A -> F1, B -> B1 등
            const floorMap: { [key: string]: string } = {
              'A': 'F1',
              'B': 'B1',
              '1': 'F1',
              'F1': 'F1',
              '1st': 'F1',
              'B1': 'B1'
            };
            markerFloor = floorMap[floorFromId.toUpperCase()] || floorFromId;
          }
        }
        
        // 층수 일치 확인
        if (markerFloor && markerFloor === selectedFloor) {
          shouldShow = true;
        }
        
        // 층수에 맞는 마커만 추가
        if (shouldShow) {
          markers.push({
            id: inspection.id,
            type: 'inspection',
            position: inspection.position,
            data: inspection,
            qrLocation: qrLocation
          });
        }
      }
    });
    
    // 디버깅: 마커 개수 확인
    console.log('Total markers for floor', selectedFloor, ':', markers.length, 'Positioned inspections:', positionedInspections.length);

    return markers;
  }, [positionedInspections, qrLocations, selectedFloor]);

  // 층에 따른 이미지 경로 결정
  const floorImagePath = selectedFloor === 'F1' ? '/1st Floor.jpg' : '/Basement.jpg';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">Distribution Board Locations</h3>
          <p className="text-sm text-slate-600 mt-1">
            {allMarkers.length} board{allMarkers.length !== 1 ? 's' : ''} mapped on floor plan
            {allMarkers.length === 0 && (
              <span className="text-red-600 font-bold ml-2">⚠️ 위젯이 표시되지 않습니다. 위치 정보가 있는 검사 항목이 없습니다.</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700">층 선택:</label>
          <select
            value={selectedFloor}
            onChange={(e) => handleFloorChange(e.target.value as 'F1' | 'B1')}
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none cursor-pointer"
          >
            <option value="F1">F1</option>
            <option value="B1">B1</option>
          </select>
        </div>
      </div>

      <div className="relative bg-slate-100" style={{ minHeight: '600px' }}>
        {/* Floor Plan Image - 숨김 처리, 위젯만 표시 */}
        <div 
          className="relative w-full h-full cursor-crosshair" 
          style={{ minHeight: '600px' }}
          onClick={handleImageClick}
        >
          {/* Floor Plan Image - 낮은 해상도, 최하위 z-index */}
          <img
            src={floorImagePath}
            alt={`${selectedFloor === 'F1' ? 'F1' : 'B1'} Floor Plan`}
            className="w-full h-auto object-contain pointer-events-none"
            style={{ 
              minHeight: '600px', 
              objectFit: 'contain',
              imageRendering: 'pixelated', // 해상도 낮춤
              opacity: 0.7, // 약간 투명하게
              zIndex: 0, // 최하위
            }}
            onError={(e) => {
              // Fallback if image fails to load
              const img = e.currentTarget as HTMLImageElement;
              img.src = 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&h=800&fit=crop';
            }}
          />

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
            const qrLocation = marker.qrLocation;
            
            const statusColor = getStatusColor(inspection.status);
            const isSelected = selectedInspection?.id === marker.id;
            const isHovered = hoveredInspection?.id === marker.id;
            
            // 위젯 색상을 상태 색상으로 설정
            const widgetColor = statusColor;

            return (
              <div
                key={marker.id}
                data-marker-id={marker.id}
                className="absolute transform -translate-x-1/2 -translate-y-1/2 transition-all"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  padding: '8px', // hover 영역 확장
                  cursor: 'default', // 기본 커서
                  zIndex: 100, // 위젯을 최상위로
                }}
                onClick={() => {
                  handleMarkerClick(inspection);
                }}
                onMouseEnter={() => {
                  setHoveredInspection(inspection);
                }}
                onMouseLeave={() => {
                  setHoveredInspection(null);
                }}
              >
                {/* 위젯 위치 표시 - 배경 하이라이트 */}
                <div
                  className="absolute transform -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    width: '60px',
                    height: '60px',
                    backgroundColor: `${widgetColor}20`,
                    border: `3px dashed ${widgetColor}`,
                    left: '50%',
                    top: '50%',
                    zIndex: 0,
                    animation: 'pulse-ring 2s ease-in-out infinite',
                  }}
                />
                {/* 위치 표시 십자가 */}
                <div
                  className="absolute transform -translate-x-1/2 -translate-y-1/2"
                  style={{
                    left: '50%',
                    top: '50%',
                    width: '2px',
                    height: '40px',
                    backgroundColor: widgetColor,
                    zIndex: 1,
                    opacity: 0.6,
                  }}
                />
                <div
                  className="absolute transform -translate-x-1/2 -translate-y-1/2"
                  style={{
                    left: '50%',
                    top: '50%',
                    width: '40px',
                    height: '2px',
                    backgroundColor: widgetColor,
                    zIndex: 1,
                    opacity: 0.6,
                  }}
                />
                {/* 위치 번호 표시 */}
                <div
                  className="absolute transform -translate-x-1/2"
                  style={{
                    left: '50%',
                    top: '-30px',
                    backgroundColor: widgetColor,
                    color: 'white',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '10px',
                    fontWeight: 'bold',
                    whiteSpace: 'nowrap',
                    zIndex: 1,
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                  }}
                >
                  {inspection.id}
                </div>
                {/* Marker */}
                <div
                  className="relative"
                  style={{
                    transform: isSelected || isHovered ? 'scale(1.3)' : 'scale(1)',
                    transition: 'transform 0.2s',
                  }}
                >
                  {/* Pulse animation for active markers */}
                  {(isSelected || isHovered) && (
                    <div
                      className="absolute inset-0 rounded-full animate-ping opacity-75"
                      style={{
                        backgroundColor: statusColor,
                        width: '32px',
                        height: '32px',
                        marginLeft: '-16px',
                        marginTop: '-16px',
                      }}
                    />
                  )}

                  {/* Main marker - 빨간색 위젯 */}
                  <div
                    className="relative"
                    style={{
                      width: '25px',
                      height: '15px',
                      cursor: 'pointer',
                      zIndex: 40,
                      position: 'relative',
                      pointerEvents: 'auto',
                      display: 'block !important',
                      visibility: 'visible !important',
                      opacity: '1 !important',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.cursor = 'pointer';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.cursor = 'default';
                    }}
                  >
                    {/* 외곽 글로우 링 - 빨간색 */}
                    <div
                      className="absolute rounded-full"
                      style={{
                        boxShadow: `0 0 0 2px ${widgetColor}, 0 0 8px ${widgetColor}, 0 0 16px ${widgetColor}CC`,
                        animation: 'pulse-glow 1.5s ease-in-out infinite',
                        zIndex: 1,
                        width: '30px',
                        height: '18px',
                        left: '50%',
                        top: '50%',
                        transform: 'translate(-50%, -50%)',
                        position: 'absolute',
                        pointerEvents: 'none',
                      }}
                    />
                    
                    {/* 메인 위젯 컨테이너 - 빨간색 */}
                    <div
                      className="relative rounded-lg overflow-visible"
                      style={{
                        width: '25px',
                        height: '15px',
                        border: `0.5px solid ${widgetColor}`,
                        backgroundColor: widgetColor,
                        boxShadow: `0 0 0 0.5px white`,
                        zIndex: 40,
                        position: 'relative',
                        pointerEvents: 'auto',
                        display: 'block !important',
                        visibility: 'visible !important',
                        opacity: '1 !important',
                      }}
                    >
                      {/* 빨간색 배경 */}
                      <div
                        className="absolute inset-0"
                        style={{
                          backgroundColor: widgetColor,
                          zIndex: 1,
                        }}
                      />
                      
                    </div>
                    
                    {/* 선택/호버 시 추가 효과 - 빨간색 */}
                    {(isSelected || isHovered) && (
                      <div
                        className="absolute rounded-full animate-ping"
                        style={{
                          backgroundColor: widgetColor,
                          opacity: 0.5,
                          zIndex: 0,
                          width: '30px',
                          height: '18px',
                          left: '50%',
                          top: '50%',
                          transform: 'translate(-50%, -50%)',
                          position: 'absolute',
                        }}
                      />
                    )}
                  </div>

                  {/* 좌표 표시 - 선택된 마커에만 표시 */}
                  {isSelected && (
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-2 py-1 bg-slate-900 text-white text-xs rounded shadow-lg whitespace-nowrap z-20">
                      <div className="font-semibold">X: {x.toFixed(1)}%</div>
                      <div className="font-semibold">Y: {y.toFixed(1)}%</div>
                      <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-full">
                        <div className="border-4 border-transparent border-b-slate-900"></div>
                      </div>
                    </div>
                  )}

                  {/* Tooltip on hover */}
                  {isHovered && !isSelected && (
                    <div 
                      className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-slate-900 text-white text-xs rounded-lg shadow-xl whitespace-nowrap z-30 pointer-events-none"
                      onMouseEnter={() => {
                        setHoveredInspection(inspection);
                      }}
                      onMouseLeave={() => {
                        setHoveredInspection(null);
                      }}
                    >
                      <div className="font-semibold mb-1">{inspection.id}</div>
                      <div className="text-slate-300">{inspection.status}</div>
                      {qrLocation && (
                        <div className="text-purple-300 mt-1">QR: {qrLocation.location}</div>
                      )}
                      <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-full">
                        <div className="border-4 border-transparent border-t-slate-900"></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected Inspection Details Panel */}
        {selectedInspection && (() => {
          // QR 정보 찾기
          const qrLocation = allMarkers.find(m => m.id === selectedInspection.id)?.qrLocation;
          
          return (
          <>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 bg-black bg-opacity-30 z-40"
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
              className={`fixed bg-white rounded-xl shadow-2xl border border-slate-200 p-6 max-w-md ${isDragging ? 'cursor-grabbing' : 'cursor-move'}`}
              style={{
                left: panelPosition.x === 0 ? '50%' : `${panelPosition.x}px`,
                top: panelPosition.y === 0 ? '50%' : `${panelPosition.y}px`,
                transform: panelPosition.x === 0 && panelPosition.y === 0 ? 'translate(-50%, -50%)' : 'none',
                zIndex: 100,
              }}
              onMouseDown={handleMouseDown}
            >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h4 className="font-bold text-slate-800 text-lg mb-0.5">{selectedInspection.id}</h4>
                <p className="text-sm text-slate-600">Distribution Board</p>
                {qrLocation && (
                  <p className="text-xs text-purple-600 mt-1 flex items-center gap-1">
                    <QrCode size={12} />
                    QR: {qrLocation.location} ({qrLocation.floor})
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                {!isEditingInspectionPosition ? (
                  <button
                    onClick={() => {
                      setIsEditingInspectionPosition(true);
                      setEditingPosition({ 
                        x: selectedInspection.position?.x || 50, 
                        y: selectedInspection.position?.y || 50 
                      });
                    }}
                    className="p-1 hover:bg-blue-50 rounded text-slate-400 hover:text-blue-600 transition-colors"
                    title="위치 수정"
                  >
                    <Edit2 size={18} />
                  </button>
                ) : (
                  <button
                    onClick={handleSaveInspectionPosition}
                    className="p-1 hover:bg-emerald-50 rounded text-slate-400 hover:text-emerald-600 transition-colors"
                    title="저장"
                  >
                    <Save size={18} />
                  </button>
                )}
                <button
                  onClick={() => {
                    setSelectedInspection(null);
                    setIsEditingInspectionPosition(false);
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


        {/* Legend */}
        <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg border border-slate-200 p-3 z-20">
          <p className="text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">Legend</p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#10b981' }}></div>
              <span className="text-xs text-slate-600">Complete</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#3b82f6' }}></div>
              <span className="text-xs text-slate-600">In Progress</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#94a3b8' }}></div>
              <span className="text-xs text-slate-600">Pending</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FloorPlanView;
