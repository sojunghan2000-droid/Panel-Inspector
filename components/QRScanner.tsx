import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, CheckCircle2, AlertCircle } from 'lucide-react';

interface QRScannerProps {
  onScanSuccess: (data: string) => void;
  onClose: () => void;
}

const QRScanner: React.FC<QRScannerProps> = ({ onScanSuccess, onClose }) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannedData, setScannedData] = useState<string | null>(null);
  const scannerId = 'qr-scanner';

  useEffect(() => {
    let isMounted = true;
    
    const startScanning = async () => {
      // 기존 스캐너가 있으면 먼저 정리
      if (scannerRef.current) {
        try {
          await scannerRef.current.stop();
          await scannerRef.current.clear();
        } catch (e) {
          console.log('Error cleaning up previous scanner:', e);
        }
        scannerRef.current = null;
      }

      try {
        const html5QrCode = new Html5Qrcode(scannerId);
        scannerRef.current = html5QrCode;

        // 카메라 장치 목록 가져오기 시도
        let cameraId: string | null = null;
        try {
          const devices = await Html5Qrcode.getCameras();
          if (devices && devices.length > 0) {
            // 후면 카메라 우선 선택
            const backCamera = devices.find(device => 
              device.label.toLowerCase().includes('back') || 
              device.label.toLowerCase().includes('rear') ||
              device.label.toLowerCase().includes('environment')
            );
            cameraId = backCamera ? backCamera.id : devices[0].id;
          }
        } catch (deviceError) {
          console.log('Could not enumerate cameras, using default:', deviceError);
        }

        const config = {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        };

        await html5QrCode.start(
          cameraId || { facingMode: 'environment' },
          config,
          (decodedText) => {
            // QR 코드 스캔 성공
            if (isMounted) {
              setScannedData(decodedText);
              setIsScanning(false);
              onScanSuccessRef.current(decodedText);
              
              // 스캔 후 자동으로 정리
              if (scannerRef.current) {
                scannerRef.current.stop().then(() => {
                  if (scannerRef.current) {
                    scannerRef.current.clear().catch(() => {});
                    scannerRef.current = null;
                  }
                }).catch(() => {});
              }
            }
          },
          (errorMessage) => {
            // 스캔 중 에러 (무시 - 계속 스캔)
            // console.log('Scanning error (ignored):', errorMessage);
          }
        );
        
        if (isMounted) {
          setIsScanning(true);
          setError(null);
        }
      } catch (err: any) {
        console.error('QR Scanner error:', err);
        
        if (!isMounted) return;
        
        let errorMessage = '카메라에 접근할 수 없습니다.';
        
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          errorMessage = '카메라 접근 권한이 거부되었습니다. 브라우저 설정에서 카메라 권한을 허용해주세요.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          errorMessage = '카메라를 찾을 수 없습니다. 카메라가 연결되어 있는지 확인해주세요.';
        } else if (err.message) {
          errorMessage = err.message;
        }
        
        setError(errorMessage);
        setIsScanning(false);
      }
    };

    // 약간의 지연을 두고 시작 (DOM이 완전히 렌더링된 후)
    const timer = setTimeout(() => {
      startScanning();
    }, 100);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current.clear().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, []); // onScanSuccess를 dependency에서 제거하여 불필요한 재실행 방지

  const handleClose = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        await scannerRef.current.clear();
      } catch (err) {
        console.error('Error stopping scanner:', err);
      }
      scannerRef.current = null;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-fade-in-up">
        <div className="bg-slate-900 p-6 flex justify-between items-start text-white">
          <div>
            <h3 className="text-xl font-bold">QR Scanner</h3>
            <p className="text-slate-400 text-sm mt-1">QR 코드를 카메라에 맞춰주세요</p>
          </div>
          <button 
            onClick={handleClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <div className="relative bg-black">
          {/* QR Scanner Container */}
          <div id={scannerId} className="w-full" style={{ minHeight: '300px' }}></div>

          {/* Scanning Indicator */}
          {isScanning && !scannedData && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-64 border-2 border-blue-500 rounded-lg relative">
                <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-blue-500 -mt-1 -ml-1"></div>
                <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-blue-500 -mt-1 -mr-1"></div>
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-blue-500 -mb-1 -ml-1"></div>
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-blue-500 -mb-1 -mr-1"></div>
                <div className="w-full h-0.5 bg-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.8)]"></div>
              </div>
            </div>
          )}

          {/* Success Message */}
          {scannedData && (
            <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
              <div className="bg-white rounded-xl p-6 max-w-sm mx-4 text-center">
                <CheckCircle2 size={48} className="text-emerald-600 mx-auto mb-4" />
                <h4 className="text-lg font-bold text-slate-800 mb-2">QR 코드 스캔 완료!</h4>
                <p className="text-sm text-slate-600 mb-4 break-all">{scannedData}</p>
                <button
                  onClick={handleClose}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  확인
                </button>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
              <div className="bg-white rounded-xl p-6 max-w-sm mx-4 text-center">
                <AlertCircle size={48} className="text-red-600 mx-auto mb-4" />
                <h4 className="text-lg font-bold text-slate-800 mb-2">스캔 오류</h4>
                <p className="text-sm text-slate-600 mb-4">{error}</p>
                <button
                  onClick={handleClose}
                  className="w-full bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  닫기
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 bg-slate-50 text-center text-xs text-slate-500">
          QR 코드를 카메라 중앙에 맞춰주세요
        </div>
      </div>
    </div>
  );
};

export default QRScanner;
