export interface EmployeeAttendanceSummary {
  full_name: string;
  employee_code: string;
  user_type?: string;
  onTimePresent: number;
  latePresent: number;
  totalPresent: number;
  totalLeaves: number;
  leavesGranted: number;
  wfhDays?: number;
  absentDays?: number;
  attendanceRate?: number;
}

export interface PdfReportData {
  title?: string;
  from: string;
  to: string;
  generatedAt: string;
  summary: {
    attended: number;
    onTime: number;
    late: number;
    open: number;
    absent?: number;
    onLeave?: number;
    wfh?: number;
    total: number;
    employeesCount?: number;
    approvedLeaveDays?: number;
  };
  employeeSummaries?: EmployeeAttendanceSummary[];
  rows?: Array<{
    full_name: string;
    employee_code: string;
    attendance_date: string;
    check_in_at?: string | null;
    check_out_at?: string | null;
    worked?: string | null;
    status: string;
  }>;
}

function sanitizeText(str: string): string {
  return String(str ?? '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2022\u00B7]/g, '|')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\\()]/g, '\\$&');
}

export function generatePdfBlob(data: PdfReportData): Blob {
  const pages: string[] = [];
  const pageWidth = 595.28; // A4 standard width (pt)
  const pageHeight = 841.89; // A4 standard height (pt)
  const margin = 32;
  const contentWidth = pageWidth - (margin * 2); // 531.28 pt

  // If employeeSummaries is provided, generate the executive summarized report
  const summaries: EmployeeAttendanceSummary[] = data.employeeSummaries || [];
  const dateRangeStr = `${data.from} to ${data.to}`;

  // Layout Constants for Summarized Report
  const cols = [
    { name: 'EMPLOYEE NAME', w: 135, align: 'left' },
    { name: 'CODE', w: 52, align: 'left' },
    { name: 'ON-TIME', w: 50, align: 'center' },
    { name: 'LATE', w: 48, align: 'center' },
    { name: 'TOTAL PRESENT', w: 68, align: 'center' },
    { name: 'TOTAL LEAVES', w: 58, align: 'center' },
    { name: 'LEAVES GRANTED', w: 66, align: 'center' },
    { name: 'ATTENDANCE', w: 54, align: 'center' }
  ];

  // If no summaries provided but rows exist, derive summaries on the fly
  let finalSummaries = summaries;
  if (finalSummaries.length === 0 && data.rows && data.rows.length > 0) {
    const map = new Map<string, EmployeeAttendanceSummary>();
    for (const r of data.rows) {
      const key = r.employee_code || r.full_name;
      if (!map.has(key)) {
        map.set(key, {
          full_name: r.full_name || 'Unknown',
          employee_code: r.employee_code || '-',
          onTimePresent: 0,
          latePresent: 0,
          totalPresent: 0,
          totalLeaves: 0,
          leavesGranted: 0
        });
      }
      const item = map.get(key)!;
      if (r.status === 'ON_TIME') {
        item.onTimePresent++;
        item.totalPresent++;
      } else if (r.status === 'LATE_ENTRY') {
        item.latePresent++;
        item.totalPresent++;
      } else if (r.status === 'ON_LEAVE') {
        item.totalLeaves++;
        item.leavesGranted++;
      }
    }
    finalSummaries = Array.from(map.values()).sort((a, b) => a.full_name.localeCompare(b.full_name));
  }

  const rowsPerPage = 22;
  const numPages = Math.max(1, Math.ceil(finalSummaries.length / rowsPerPage));

  // Compute Grand Totals across all employees
  const grandTotals = finalSummaries.reduce((acc, curr) => ({
    onTime: acc.onTime + curr.onTimePresent,
    late: acc.late + curr.latePresent,
    totalPresent: acc.totalPresent + curr.totalPresent,
    totalLeaves: acc.totalLeaves + curr.totalLeaves,
    leavesGranted: acc.leavesGranted + curr.leavesGranted
  }), { onTime: 0, late: 0, totalPresent: 0, totalLeaves: 0, leavesGranted: 0 });

  for (let p = 0; p < numPages; p++) {
    const pageRecords = finalSummaries.slice(p * rowsPerPage, (p + 1) * rowsPerPage);
    const isLastPage = p === numPages - 1;
    let stream = '';

    const text = (x: number, y: number, str: string, font = '/F1', size = 8.5, r = 0.1, g = 0.1, b = 0.1) => {
      const clean = sanitizeText(str);
      stream += `BT ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg ${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${clean}) Tj ET\n`;
    };

    const rect = (x: number, y: number, w: number, h: number, r: number, g: number, b: number, fill = true) => {
      stream += `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} ${fill ? 'rg' : 'RG'} ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${fill ? 'f' : 'S'}\n`;
    };

    // Top Brand Gold Strip
    rect(0, pageHeight - 6, pageWidth, 6, 0.855, 0.686, 0.318, true); // Champagne Gold #DAAF51

    let curY = pageHeight - 38;
    if (p === 0) {
      // Header brand
      text(margin, curY, 'FALCHION XENIAA', '/F2', 13.5, 0.576, 0.075, 0.078); // Deep Saffron #931314
      text(margin + 126, curY, '| WORKFORCE ATTENDANCE & LEAVE SUMMARY', '/F2', 11.5, 0.067, 0.067, 0.067);
      curY -= 15;
      text(margin, curY, `Reporting Period: ${dateRangeStr}   |   Generated: ${data.generatedAt}   |   Executive HR & Payroll Summary`, '/F1', 8, 0.45, 0.45, 0.45);
      curY -= 14;

      // 5-Column Executive KPI Summary Grid Box
      rect(margin, curY - 44, contentWidth, 46, 0.965, 0.965, 0.970, true);
      rect(margin, curY - 44, contentWidth, 46, 0.855, 0.686, 0.318, false);

      const kpiW = contentWidth / 5;
      const kpis = [
        ['ACTIVE STAFF', finalSummaries.length],
        ['ON TIME', grandTotals.onTime || data.summary.onTime || 0],
        ['LATE ENTRIES', grandTotals.late || data.summary.late || 0],
        ['TOTAL PRESENT', grandTotals.totalPresent || data.summary.attended || 0],
        ['LEAVES GRANTED', grandTotals.leavesGranted ?? (data.summary.approvedLeaveDays || data.summary.onLeave || 0)]
      ];

      kpis.forEach(([label, val], idx) => {
        text(margin + (idx * kpiW) + 10, curY - 14, String(label), '/F2', 7.5, 0.45, 0.45, 0.45);
        text(margin + (idx * kpiW) + 10, curY - 34, String(val), '/F2', 14, 0.067, 0.067, 0.067);
      });
      curY -= 58;
    } else {
      text(margin, curY, 'FALCHION XENIAA | WORKFORCE ATTENDANCE & LEAVE SUMMARY', '/F2', 9.5, 0.576, 0.075, 0.078);
      text(pageWidth - margin - 100, curY, dateRangeStr, '/F1', 8, 0.45, 0.45, 0.45);
      curY -= 18;
    }

    // Table Header Bar (Deep Obsidian Charcoal)
    rect(margin, curY - 20, contentWidth, 22, 0.067, 0.067, 0.067, true);
    let colX = margin + 6;
    cols.forEach(c => {
      text(colX, curY - 14, c.name, '/F2', 7.5, 0.855, 0.686, 0.318);
      colX += c.w;
    });
    curY -= 22;

    // Table Rows
    if (pageRecords.length === 0) {
      rect(margin, curY - 22, contentWidth, 24, 0.98, 0.98, 0.98, true);
      text(margin + 20, curY - 15, 'No workforce records found in the selected reporting range.', '/F1', 8.5, 0.4, 0.4, 0.4);
      curY -= 24;
    } else {
      pageRecords.forEach((r, idx) => {
        const rowHeight = 22;
        const isAlt = idx % 2 === 1;
        if (isAlt) {
          rect(margin, curY - rowHeight + 4, contentWidth, rowHeight, 0.965, 0.965, 0.975, true);
        }
        rect(margin, curY - rowHeight + 4, contentWidth, rowHeight, 0.88, 0.88, 0.90, false);

        colX = margin + 6;

        // 1. Employee Name
        text(colX, curY - 12, r.full_name || '-', '/F2', 8.5, 0.1, 0.1, 0.1);
        colX += cols[0].w;

        // 2. Code
        text(colX, curY - 12, r.employee_code || '-', '/F1', 8, 0.35, 0.35, 0.35);
        colX += cols[1].w;

        // 3. On-time Present
        text(colX + 16, curY - 12, String(r.onTimePresent), '/F2', 8.5, 0.08, 0.45, 0.15); // Emerald Green
        colX += cols[2].w;

        // 4. Late Present
        text(colX + 14, curY - 12, String(r.latePresent), '/F2', 8.5, r.latePresent > 0 ? 0.65 : 0.4, 0.1, 0.1); // Warm Rose
        colX += cols[3].w;

        // 5. Total Present
        text(colX + 20, curY - 12, String(r.totalPresent), '/F2', 9, 0.05, 0.05, 0.05); // Bold Obsidian
        colX += cols[4].w;

        // 6. Total Leaves Requested
        text(colX + 16, curY - 12, String(r.totalLeaves), '/F1', 8.5, 0.35, 0.35, 0.35);
        colX += cols[5].w;

        // 7. Leaves Granted
        text(colX + 18, curY - 12, String(r.leavesGranted), '/F2', 8.5, r.leavesGranted > 0 ? 0.72 : 0.35, r.leavesGranted > 0 ? 0.45 : 0.35, 0.1); // Amber / Slate
        colX += cols[6].w;

        // 8. Attendance Rate
        const rateStr = r.attendanceRate !== undefined ? `${r.attendanceRate}%` : '-';
        text(colX + 12, curY - 12, rateStr, '/F2', 8, 0.2, 0.2, 0.2);

        curY -= rowHeight;
      });

      // Add Company Totals Row on the Last Page
      if (isLastPage) {
        const totalsHeight = 24;
        rect(margin, curY - totalsHeight + 4, contentWidth, totalsHeight, 0.93, 0.93, 0.94, true);
        rect(margin, curY - totalsHeight + 4, contentWidth, totalsHeight, 0.855, 0.686, 0.318, false);

        colX = margin + 6;
        text(colX, curY - 13, `TOTALS (${finalSummaries.length} EMPLOYEES)`, '/F2', 8.5, 0.067, 0.067, 0.067);
        colX += cols[0].w;

        text(colX, curY - 13, '-', '/F1', 8, 0.5, 0.5, 0.5);
        colX += cols[1].w;

        text(colX + 16, curY - 13, String(grandTotals.onTime), '/F2', 8.5, 0.08, 0.45, 0.15);
        colX += cols[2].w;

        text(colX + 14, curY - 13, String(grandTotals.late), '/F2', 8.5, 0.65, 0.1, 0.1);
        colX += cols[3].w;

        text(colX + 20, curY - 13, String(grandTotals.totalPresent), '/F2', 9, 0.067, 0.067, 0.067);
        colX += cols[4].w;

        text(colX + 16, curY - 13, String(grandTotals.totalLeaves), '/F2', 8.5, 0.3, 0.3, 0.3);
        colX += cols[5].w;

        text(colX + 18, curY - 13, String(grandTotals.leavesGranted), '/F2', 8.5, 0.72, 0.45, 0.1);
        colX += cols[6].w;

        const overallRate = grandTotals.totalPresent + grandTotals.leavesGranted > 0 
          ? Math.round((grandTotals.totalPresent / (grandTotals.totalPresent + grandTotals.leavesGranted)) * 100) 
          : 0;
        text(colX + 12, curY - 13, `${overallRate}%`, '/F2', 8.5, 0.067, 0.067, 0.067);

        curY -= totalsHeight;
      }
    }

    // Page Footer
    const footerY = 22;
    rect(margin, footerY + 12, contentWidth, 0.5, 0.85, 0.85, 0.85, false);
    text(margin, footerY, 'Falchion Xeniaa HRMS | Confidential Workforce Attendance & Leave Summary', '/F1', 7.5, 0.5, 0.5, 0.5);
    text(pageWidth - margin - 55, footerY, `Page ${p + 1} of ${numPages}`, '/F2', 7.5, 0.5, 0.5, 0.5);

    pages.push(stream);
  }

  // Construct PDF Document
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];

  const addObj = (str: string) => {
    offsets.push(new TextEncoder().encode(out).length);
    out += str + '\n';
  };

  addObj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');

  const pageObjIds = pages.map((_, i) => 4 + i * 2);
  const kidsStr = pageObjIds.map(id => `${id} 0 R`).join(' ');
  addObj(`2 0 obj\n<< /Type /Pages /Kids [ ${kidsStr} ] /Count ${pages.length} >>\nendobj`);

  addObj('3 0 obj\n<< /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >>\nendobj');

  pages.forEach((streamData, idx) => {
    const pageId = 4 + idx * 2;
    const streamId = 5 + idx * 2;
    const streamBytes = new TextEncoder().encode(streamData).length;

    addObj(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 595.28 841.89 ] /Resources << /Font 3 0 R >> /Contents ${streamId} 0 R >>\nendobj`);
    addObj(`${streamId} 0 obj\n<< /Length ${streamBytes} >>\nstream\n${streamData}endstream\nendobj`);
  });

  const startxref = new TextEncoder().encode(out).length;
  out += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(off => {
    out += String(off).padStart(10, '0') + ' 00000 n \n';
  });
  out += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  return new Blob([new TextEncoder().encode(out)], { type: 'application/pdf' });
}

export function downloadPdfReport(data: PdfReportData, filename?: string): void {
  const blob = generatePdfBlob(data);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `falchion-attendance-summary-${data.from}-${data.to}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
