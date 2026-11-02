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

// Official Falchion Xeniaa Company Logo (JPEG 510x74)
const FALCHION_LOGO_JPEG_BASE64 = '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';

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
    { name: 'EMPLOYEE NAME', w: 122, align: 'left' },
    { name: 'CODE', w: 48, align: 'left' },
    { name: 'ON-TIME', w: 46, align: 'center' },
    { name: 'LATE', w: 42, align: 'center' },
    { name: 'PRESENT', w: 48, align: 'center' },
    { name: 'ABSENT', w: 44, align: 'center' },
    { name: 'LEAVES REQ', w: 54, align: 'center' },
    { name: 'GRANTED', w: 56, align: 'center' },
    { name: 'ATTENDANCE', w: 71, align: 'center' }
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
          absentDays: 0,
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
      } else if (r.status === 'ABSENT') {
        item.absentDays = (item.absentDays || 0) + 1;
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
    absentDays: acc.absentDays + (curr.absentDays || 0),
    totalLeaves: acc.totalLeaves + curr.totalLeaves,
    leavesGranted: acc.leavesGranted + curr.leavesGranted
  }), { onTime: 0, late: 0, totalPresent: 0, absentDays: 0, totalLeaves: 0, leavesGranted: 0 });

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

    let curY = pageHeight - 34;
    if (p === 0) {
      // 1. Draw Official Falchion Xeniaa Company Logo (510x74 native ratio)
      const logoW = 135;
      const logoH = 19.6;
      stream += `q\n${logoW.toFixed(2)} 0 0 ${logoH.toFixed(2)} ${margin.toFixed(2)} ${(curY - logoH + 2).toFixed(2)} cm\n/Logo Do\nQ\n`;

      // 2. Company & Document Title Block
      text(margin + logoW + 14, curY - 11, '| WORKFORCE ATTENDANCE & LEAVE SUMMARY', '/F2', 10.5, 0.067, 0.067, 0.067);
      curY -= 26;
      text(margin, curY, `Falchion Xeniaa Co-works & Enterprise   |   Reporting Period: ${dateRangeStr}   |   Generated: ${data.generatedAt} IST`, '/F1', 7.5, 0.45, 0.45, 0.45);
      curY -= 12;

      // 6-Column Executive KPI Summary Grid Box
      rect(margin, curY - 44, contentWidth, 46, 0.965, 0.965, 0.970, true);
      rect(margin, curY - 44, contentWidth, 46, 0.855, 0.686, 0.318, false);

      const kpiW = contentWidth / 6;
      const kpis = [
        ['ACTIVE STAFF', finalSummaries.length],
        ['TOTAL PRESENT', grandTotals.totalPresent || data.summary.attended || 0],
        ['ON TIME', grandTotals.onTime || data.summary.onTime || 0],
        ['LATE ENTRIES', grandTotals.late || data.summary.late || 0],
        ['ABSENT DAYS', grandTotals.absentDays || data.summary.absent || 0],
        ['LEAVES GRANTED', grandTotals.leavesGranted ?? (data.summary.approvedLeaveDays || data.summary.onLeave || 0)]
      ];

      kpis.forEach(([label, val], idx) => {
        text(margin + (idx * kpiW) + 8, curY - 14, String(label), '/F2', 7, 0.45, 0.45, 0.45);
        text(margin + (idx * kpiW) + 8, curY - 34, String(val), '/F2', 13.5, 0.067, 0.067, 0.067);
      });
      curY -= 58;
    } else {
      // Subsequent Pages Header with compact logo
      const logoW = 85;
      const logoH = 12.3;
      stream += `q\n${logoW.toFixed(2)} 0 0 ${logoH.toFixed(2)} ${margin.toFixed(2)} ${(curY - logoH + 2).toFixed(2)} cm\n/Logo Do\nQ\n`;
      text(margin + logoW + 8, curY - 8, '| WORKFORCE ATTENDANCE & LEAVE SUMMARY', '/F2', 8.5, 0.067, 0.067, 0.067);
      text(pageWidth - margin - 100, curY - 8, dateRangeStr, '/F1', 8, 0.45, 0.45, 0.45);
      curY -= 20;
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
        text(colX + 14, curY - 12, String(r.onTimePresent), '/F2', 8.5, 0.08, 0.45, 0.15); // Emerald Green
        colX += cols[2].w;

        // 4. Late Present
        text(colX + 12, curY - 12, String(r.latePresent), '/F2', 8.5, r.latePresent > 0 ? 0.75 : 0.4, 0.2, 0.1); // Warm Rose
        colX += cols[3].w;

        // 5. Total Present
        text(colX + 16, curY - 12, String(r.totalPresent), '/F2', 9, 0.05, 0.05, 0.05); // Bold Obsidian
        colX += cols[4].w;

        // 6. Absent Days
        const absVal = r.absentDays || 0;
        text(colX + 14, curY - 12, String(absVal), '/F2', 8.5, absVal > 0 ? 0.82 : 0.4, absVal > 0 ? 0.15 : 0.4, absVal > 0 ? 0.15 : 0.4); // Crimson if absent
        colX += cols[5].w;

        // 7. Total Leaves Requested
        text(colX + 16, curY - 12, String(r.totalLeaves), '/F1', 8.5, 0.35, 0.35, 0.35);
        colX += cols[6].w;

        // 8. Leaves Granted
        text(colX + 18, curY - 12, String(r.leavesGranted), '/F2', 8.5, r.leavesGranted > 0 ? 0.72 : 0.35, r.leavesGranted > 0 ? 0.45 : 0.35, 0.1); // Amber / Slate
        colX += cols[7].w;

        // 9. Attendance Rate
        const rateStr = r.attendanceRate !== undefined ? `${r.attendanceRate}%` : '-';
        text(colX + 18, curY - 12, rateStr, '/F2', 8, 0.2, 0.2, 0.2);

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

        text(colX + 14, curY - 13, String(grandTotals.onTime), '/F2', 8.5, 0.08, 0.45, 0.15);
        colX += cols[2].w;

        text(colX + 12, curY - 13, String(grandTotals.late), '/F2', 8.5, 0.75, 0.2, 0.1);
        colX += cols[3].w;

        text(colX + 16, curY - 13, String(grandTotals.totalPresent), '/F2', 9, 0.067, 0.067, 0.067);
        colX += cols[4].w;

        text(colX + 14, curY - 13, String(grandTotals.absentDays), '/F2', 8.5, grandTotals.absentDays > 0 ? 0.82 : 0.4, 0.15, 0.15);
        colX += cols[5].w;

        text(colX + 16, curY - 13, String(grandTotals.totalLeaves), '/F2', 8.5, 0.3, 0.3, 0.3);
        colX += cols[6].w;

        text(colX + 18, curY - 13, String(grandTotals.leavesGranted), '/F2', 8.5, 0.72, 0.45, 0.1);
        colX += cols[7].w;

        const totalWork = grandTotals.totalPresent + grandTotals.absentDays;
        const overallRate = totalWork > 0 
          ? Math.round((grandTotals.totalPresent / totalWork) * 100) 
          : 100;
        text(colX + 18, curY - 13, `${overallRate}%`, '/F2', 8.5, 0.067, 0.067, 0.067);

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

  // Construct Binary PDF Document with Embedded Official Company Logo XObject
  const logoBytes = Uint8Array.from(atob(FALCHION_LOGO_JPEG_BASE64), c => c.charCodeAt(0));
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let curOffset = 0;

  const appendStr = (str: string) => {
    const encoded = new TextEncoder().encode(str);
    parts.push(encoded);
    curOffset += encoded.length;
  };

  const appendBytes = (bytes: Uint8Array) => {
    parts.push(bytes);
    curOffset += bytes.length;
  };

  const addObj = (objContent: string) => {
    offsets.push(curOffset);
    appendStr(objContent + '\n');
  };

  appendStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  // Object 1: Catalog
  addObj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');

  // Object 2: Pages
  const pageObjIds = pages.map((_, i) => 5 + i * 2);
  const kidsStr = pageObjIds.map(id => `${id} 0 R`).join(' ');
  addObj(`2 0 obj\n<< /Type /Pages /Kids [ ${kidsStr} ] /Count ${pages.length} >>\nendobj`);

  // Object 3: Standard Fonts
  addObj('3 0 obj\n<< /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >>\nendobj');

  // Object 4: Official Company Logo Image XObject
  offsets.push(curOffset);
  appendStr(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width 510 /Height 74 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoBytes.length} >>\nstream\n`);
  appendBytes(logoBytes);
  appendStr('\nendstream\nendobj\n');

  // Page Objects and Content Streams
  pages.forEach((streamData, idx) => {
    const pageId = 5 + idx * 2;
    const streamId = 6 + idx * 2;
    const streamEncoded = new TextEncoder().encode(streamData);

    addObj(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 595.28 841.89 ] /Resources << /Font 3 0 R /XObject << /Logo 4 0 R >> >> /Contents ${streamId} 0 R >>\nendobj`);

    offsets.push(curOffset);
    appendStr(`${streamId} 0 obj\n<< /Length ${streamEncoded.length} >>\nstream\n`);
    appendBytes(streamEncoded);
    appendStr('\nendstream\nendobj\n');
  });

  // Cross-reference Table
  const startxref = curOffset;
  appendStr(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`);
  offsets.forEach(off => {
    appendStr(String(off).padStart(10, '0') + ' 00000 n \n');
  });
  appendStr(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);

  return new Blob(parts, { type: 'application/pdf' });
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
