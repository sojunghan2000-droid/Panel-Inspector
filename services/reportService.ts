import { InspectionRecord, ReportHistory } from '../types';

const STORAGE_KEY = 'safetyguard_reports';

// Save report to localStorage
const saveReport = (record: InspectionRecord, htmlContent: string): void => {
  const reports: ReportHistory[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const newReport: ReportHistory = {
    id: `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    reportId: `RPT-${record.id}-${new Date().toISOString().split('T')[0]}`,
    boardId: record.id,
    generatedAt: new Date().toISOString(),
    status: record.status,
    htmlContent: htmlContent
  };
  reports.unshift(newReport); // Add to beginning
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
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

// Reports 데이터 마이그레이션
const migrateReports = (reports: ReportHistory[]): ReportHistory[] => {
  return reports.map(report => {
    const migrated: ReportHistory = { ...report };
    
    // boardId 마이그레이션
    if (migrated.boardId) {
      migrated.boardId = migrateIdFloor(migrated.boardId);
    }
    
    // reportId 마이그레이션 (RPT-DB-1st-001-2026-01-23 형식)
    if (migrated.reportId && migrated.reportId.includes('1st')) {
      migrated.reportId = migrateIdFloor(migrated.reportId);
    }
    
    // htmlContent 내부의 ID도 마이그레이션
    if (migrated.htmlContent && migrated.htmlContent.includes('1st')) {
      migrated.htmlContent = migrated.htmlContent.replace(/DB-1st-/g, 'DB-F1-');
    }
    
    return migrated;
  });
};

// Get all saved reports
export const getSavedReports = (): ReportHistory[] => {
  const reports = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const migrated = migrateReports(reports);
  
  // 마이그레이션된 데이터를 localStorage에 저장
  if (JSON.stringify(reports) !== JSON.stringify(migrated)) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    } catch (e) {
      console.error('Failed to save migrated reports to localStorage:', e);
    }
  }
  
  return migrated;
};

// Get report by ID
export const getReportById = (id: string): ReportHistory | null => {
  const reports = getSavedReports();
  return reports.find(r => r.id === id) || null;
};

// Delete report
export const deleteReport = (id: string): void => {
  const reports = getSavedReports();
  const filtered = reports.filter(r => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
};

export const generateReport = (record: InspectionRecord): void => {
  // In Progress 상태는 리포트 생성하지 않음
  if (record.status === 'In Progress') {
    return;
  }

  const reportDate = new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const connectedLoads = Object.entries(record.loads)
    .filter(([_, connected]) => connected)
    .map(([key, _]) => {
      const labels: Record<string, string> = {
        welder: 'Welder',
        grinder: 'Grinder',
        light: 'Temporary Light',
        pump: 'Water Pump'
      };
      return labels[key] || key;
    })
    .join(', ') || 'None';

  const statusColors: Record<string, string> = {
    'Complete': '#10b981',
    'In Progress': '#3b82f6',
    'Pending': '#94a3b8'
  };

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Inspection Report - ${record.id}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Inter', sans-serif;
      background: #f3f4f6;
      padding: 40px 20px;
      color: #1f2937;
    }
    .report-container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
      color: white;
      padding: 40px;
      text-align: center;
    }
    .header h1 {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .header .subtitle {
      font-size: 14px;
      opacity: 0.9;
      font-weight: 400;
    }
    .content {
      padding: 40px;
    }
    .section {
      margin-bottom: 32px;
    }
    .section:last-child {
      margin-bottom: 0;
    }
    .section-title {
      font-size: 18px;
      font-weight: 600;
      color: #1e293b;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 2px solid #e2e8f0;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 24px;
    }
    .info-item {
      display: flex;
      flex-direction: column;
    }
    .info-label {
      font-size: 12px;
      font-weight: 500;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .info-value {
      font-size: 16px;
      font-weight: 600;
      color: #1e293b;
    }
    .status-badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      color: white;
    }
    .loads-list {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    .load-item {
      display: flex;
      align-items: center;
      padding: 12px;
      background: #f8fafc;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
    }
    .load-item.connected {
      background: #eff6ff;
      border-color: #3b82f6;
    }
    .load-check {
      width: 20px;
      height: 20px;
      border-radius: 4px;
      background: #cbd5e1;
      margin-right: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .load-item.connected .load-check {
      background: #3b82f6;
    }
    .load-check::after {
      content: '✓';
      color: white;
      font-size: 14px;
      font-weight: bold;
      display: none;
    }
    .load-item.connected .load-check::after {
      display: block;
    }
    .photo-section {
      margin-top: 16px;
    }
    .photo-container {
      width: 100%;
      max-height: 400px;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #e2e8f0;
      margin-top: 12px;
    }
    .photo-container img {
      width: 100%;
      height: auto;
      display: block;
    }
    .memo-section {
      background: #f8fafc;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #3b82f6;
    }
    .memo-text {
      font-size: 14px;
      line-height: 1.6;
      color: #475569;
      white-space: pre-wrap;
    }
    .footer {
      background: #f8fafc;
      padding: 24px 40px;
      text-align: center;
      border-top: 1px solid #e2e8f0;
      color: #64748b;
      font-size: 12px;
    }
    @media print {
      body {
        padding: 0;
        background: white;
      }
      .report-container {
        box-shadow: none;
      }
    }
  </style>
</head>
<body>
  <div class="report-container">
    <div class="header">
      <h1>SafetyGuard Pro</h1>
      <div class="subtitle">Distribution Board Inspection Report</div>
    </div>
    
    <div class="content">
      <div class="section">
        <div class="info-grid">
          <div class="info-item">
            <div class="info-label">Distribution Board ID</div>
            <div class="info-value">${record.id}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Inspection Status</div>
            <div>
              <span class="status-badge" style="background-color: ${statusColors[record.status]}">
                ${record.status}
              </span>
            </div>
          </div>
          <div class="info-item">
            <div class="info-label">Last Inspection Date</div>
            <div class="info-value">${record.lastInspectionDate}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Report Generated</div>
            <div class="info-value">${reportDate}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Connected Loads</div>
        <div class="loads-list">
          <div class="load-item ${record.loads.welder ? 'connected' : ''}">
            <div class="load-check"></div>
            <span>Welder</span>
          </div>
          <div class="load-item ${record.loads.grinder ? 'connected' : ''}">
            <div class="load-check"></div>
            <span>Grinder</span>
          </div>
          <div class="load-item ${record.loads.light ? 'connected' : ''}">
            <div class="load-check"></div>
            <span>Temporary Light</span>
          </div>
          <div class="load-item ${record.loads.pump ? 'connected' : ''}">
            <div class="load-check"></div>
            <span>Water Pump</span>
          </div>
        </div>
        <div style="margin-top: 12px; font-size: 14px; color: #64748b;">
          <strong>Active Loads:</strong> ${connectedLoads}
        </div>
      </div>

      ${record.photoUrl ? `
      <div class="section photo-section">
        <div class="section-title">Site Photo</div>
        <div class="photo-container">
          <img src="${record.photoUrl}" alt="Inspection Site Photo" />
        </div>
      </div>
      ` : ''}

      ${record.memo ? `
      <div class="section">
        <div class="section-title">Observations & Actions</div>
        <div class="memo-section">
          <div class="memo-text">${record.memo}</div>
        </div>
      </div>
      ` : ''}
    </div>

    <div class="footer">
      <p>This report was generated by SafetyGuard Pro Inspection System</p>
      <p style="margin-top: 4px;">© ${new Date().getFullYear()} SafetyGuard Pro. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;

  // Save report to localStorage
  saveReport(record, htmlContent);

  // Open report in new window (no auto-download, no auto-print)
  const reportWindow = window.open('', '_blank');
  if (reportWindow) {
    reportWindow.document.write(htmlContent);
    reportWindow.document.close();
  }
};

// View report in new window
export const viewReport = (report: ReportHistory): void => {
  const viewWindow = window.open('', '_blank');
  if (viewWindow) {
    viewWindow.document.write(report.htmlContent);
    viewWindow.document.close();
  }
};
