import { useEffect, useRef } from 'react';

// @MX:NOTE: Phase 3 - 활동 감지 및 배터리 상태 모니터링

export interface ActivityState {
  isActive: boolean;              // 사용자 활동 여부 (3분 이내)
  isTabVisible: boolean;          // 현재 탭이 보이는 중
  batteryLevel: number | null;    // 배터리 레벨 (0-100%) 또는 null
  isCharging: boolean | null;     // 충전 중 여부
  lastActivityTime: number;       // 마지막 활동 시간 (ms)
  idleThresholdMs: number;        // 유휴 상태 판정 시간 (ms)
}

type ActivityCallback = (state: ActivityState) => void;

/**
 * 사용자 활동, 배터리 상태, 탭 가시성을 감지하는 Hook
 * - 마우스 이동, 키보드 입력, 터치 이벤트 감지
 * - Battery Status API를 통한 배터리 모니터링
 * - Page Visibility API를 통한 탭 가시성 감지
 * - 3분 이상 무활동 시 유휴 상태 판정
 *
 * @MX:WARN: onActivityStateChange를 deps에 포함 시 콜백 참조 변경 → 모든 effect 재실행 루프 유발
 * @MX:REASON: 콜백은 callbackRef 패턴으로 안정화. 외부에서는 반드시 useCallback으로 감싸야 함
 */
export function useActivityDetector(onActivityStateChange?: ActivityCallback): ActivityState {
  const stateRef = useRef<ActivityState>({
    isActive: true,
    isTabVisible: !document.hidden,
    batteryLevel: null,
    isCharging: null,
    lastActivityTime: Date.now(),
    idleThresholdMs: 3 * 60 * 1000, // 3분
  });

  // @MX:NOTE: callbackRef 패턴 - 콜백을 ref에 저장하여 useEffect deps에서 제외
  // effect가 콜백 참조 변경에 반응하지 않으면서 항상 최신 콜백을 호출
  const callbackRef = useRef<ActivityCallback | undefined>(onActivityStateChange);
  useEffect(() => {
    callbackRef.current = onActivityStateChange;
  });

  const idleCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 배터리 상태 초기화 및 모니터링 (마운트 시 1회만 실행)
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    const initBattery = async () => {
      try {
        // @ts-ignore - Battery Status API는 아직 표준화되지 않음
        if (navigator.getBattery) {
          // @ts-ignore
          const battery = await navigator.getBattery();

          const updateBatteryState = () => {
            stateRef.current.batteryLevel = battery.level * 100;
            stateRef.current.isCharging = battery.charging;
            // callbackRef를 통해 항상 최신 콜백 호출 (참조 안정)
            callbackRef.current?.(stateRef.current);
          };

          // @MX:NOTE: 초기 배터리 상태 읽기만 수행 (콜백 즉시 호출 제거 → 렌더 루프 방지)
          stateRef.current.batteryLevel = battery.level * 100;
          stateRef.current.isCharging = battery.charging;

          battery.addEventListener('levelchange', updateBatteryState);
          battery.addEventListener('chargingchange', updateBatteryState);

          cleanup = () => {
            battery.removeEventListener('levelchange', updateBatteryState);
            battery.removeEventListener('chargingchange', updateBatteryState);
          };
        }
      } catch {
        // Battery API 미지원 환경에서는 null로 유지
        stateRef.current.batteryLevel = null;
        stateRef.current.isCharging = null;
      }
    };

    initBattery();

    return () => cleanup?.();
  }, []); // 빈 deps: 마운트 시 1회만 실행 (콜백 변경에 재실행 금지)

  // 활동 감지 (mousemove, keydown, touchstart) - 마운트 시 1회만 등록
  useEffect(() => {
    const recordActivity = () => {
      stateRef.current.lastActivityTime = Date.now();
      stateRef.current.isActive = true;
      callbackRef.current?.(stateRef.current);
    };

    // 이벤트 리스너 등록
    document.addEventListener('mousemove', recordActivity, { passive: true });
    document.addEventListener('keydown', recordActivity, { passive: true });
    document.addEventListener('touchstart', recordActivity, { passive: true });

    return () => {
      document.removeEventListener('mousemove', recordActivity);
      document.removeEventListener('keydown', recordActivity);
      document.removeEventListener('touchstart', recordActivity);
    };
  }, []); // 빈 deps: 콜백 변경에 재등록 금지 (callbackRef로 최신 콜백 참조)

  // 탭 가시성 감지 - 마운트 시 1회만 등록
  useEffect(() => {
    const handleVisibilityChange = () => {
      stateRef.current.isTabVisible = !document.hidden;
      callbackRef.current?.(stateRef.current);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []); // 빈 deps: 콜백 변경에 재등록 금지

  // 유휴 상태 주기적 확인 (1분마다) - 마운트 시 1회만 등록
  useEffect(() => {
    idleCheckIntervalRef.current = setInterval(() => {
      const now = Date.now();
      const timeSinceLastActivity = now - stateRef.current.lastActivityTime;
      const wasActive = stateRef.current.isActive;

      if (timeSinceLastActivity > stateRef.current.idleThresholdMs) {
        stateRef.current.isActive = false;
      } else {
        stateRef.current.isActive = true;
      }

      // 상태 변경 시에만 콜백 호출
      if (wasActive !== stateRef.current.isActive) {
        callbackRef.current?.(stateRef.current);
      }
    }, 60 * 1000); // 1분마다 확인

    return () => {
      if (idleCheckIntervalRef.current) {
        clearInterval(idleCheckIntervalRef.current);
      }
    };
  }, []); // 빈 deps: 콜백 변경에 재등록 금지

  return stateRef.current;
}

/**
 * 자동 동기화 실행 가능 여부를 판정하는 헬퍼 함수
 * @param activityState 활동 상태
 * @param minBatteryLevel 최소 배터리 레벨 (%)
 * @returns true = 자동 동기화 가능, false = 자동 동기화 불가
 */
export function canAutoSync(
  activityState: ActivityState,
  minBatteryLevel: number = 20
): boolean {
  // 조건: 탭이 보이고, 활동 중 (또는 초기 상태), 배터리 충분
  const tabVisible = activityState.isTabVisible;
  const isActive = activityState.isActive;

  // 배터리 상태 확인
  let batteryOK = true;
  if (activityState.batteryLevel !== null) {
    // 충전 중이거나 배터리 충분하면 OK
    batteryOK = activityState.isCharging === true ||
                activityState.batteryLevel >= minBatteryLevel;
  }

  return tabVisible && isActive && batteryOK;
}
