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
  };
  rows: Array<{
    full_name: string;
    employee_code: string;
    attendance_date: string;
    check_in_at?: string | null;
    check_out_at?: string | null;
    worked?: string | null;
    status: string;
  }>;
}

export function generatePdfBlob(data: PdfReportData): Blob {
  const pages: string[] = [];
  const pageWidth = 595.28; // A4 standard width (pt)
  const pageHeight = 841.89; // A4 standard height (pt)
  const margin = 36;
  const contentWidth = pageWidth - (margin * 2);

  const rowsPerPage = 24;
  const numPages = Math.max(1, Math.ceil(data.rows.length / rowsPerPage));
  const dateRangeStr = `${data.from} to ${data.to}`;

  for (let p = 0; p < numPages; p++) {
    const pageRecords = data.rows.slice(p * rowsPerPage, (p + 1) * rowsPerPage);
    let stream = '';

    const text = (x: number, y: number, str: string, font = '/F1', size = 8.5, r = 0.1, g = 0.1, b = 0.1) => {
      const clean = String(str || '').replace(/[\\()]/g, '\\$&');
      stream += `BT ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg ${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${clean}) Tj ET\n`;
    };

    const rect = (x: number, y: number, w: number, h: number, r: number, g: number, b: number, fill = true) => {
      stream += `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} ${fill ? 'rg' : 'RG'} ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${fill ? 'f' : 'S'}\n`;
    };

    // Top Brand Gold Strip
    rect(0, pageHeight - 6, pageWidth, 6, 0.855, 0.686, 0.318, true); // Champagne Gold #DAAF51

    let curY = pageHeight - 40;
    if (p === 0) {
      // Header brand
      text(margin, curY, 'FALCHION XENIAA', '/F2', 13.5, 0.576, 0.075, 0.078); // Deep Saffron #931314
      text(margin + 128, curY, '· WORKFORCE ATTENDANCE REPORT', '/F2', 11.5, 0.067, 0.067, 0.067);
      curY -= 16;
      text(margin, curY, `Reporting Period: ${dateRangeStr}   |   Generated: ${data.generatedAt}   |   Confidential`, '/F1', 8, 0.45, 0.45, 0.45);
      curY -= 14;

      // Summary KPI Grid Box
      rect(margin, curY - 42, contentWidth, 44, 0.965, 0.965, 0.970, true);
      rect(margin, curY - 42, contentWidth, 44, 0.855, 0.686, 0.318, false);

      const kpiW = contentWidth / 4;
      const kpis = [
        ['PRESENT DAYS', data.summary.attended],
        ['ON TIME', data.summary.onTime],
        ['LATE ENTRIES', data.summary.late],
        ['OPEN SHIFTS', data.summary.open]
      ];
      kpis.forEach(([label, val], idx) => {
        text(margin + (idx * kpiW) + 12, curY - 14, String(label), '/F2', 7.5, 0.45, 0.45, 0.45);
        text(margin + (idx * kpiW) + 12, curY - 33, String(val), '/F2', 14, 0.067, 0.067, 0.067);
      });
      curY -= 56;
    } else {
      text(margin, curY, 'FALCHION XENIAA · WORKFORCE ATTENDANCE REGISTER', '/F2', 9.5, 0.576, 0.075, 0.078);
      text(pageWidth - margin - 90, curY, dateRangeStr, '/F1', 8, 0.45, 0.45, 0.45);
      curY -= 18;
    }

    // Table Column Layout
    const cols = [
      { name: 'EMPLOYEE NAME', w: 140 },
      { name: 'CODE', w: 55 },
      { name: 'DATE', w: 65 },
      { name: 'CHECK IN', w: 60 },
      { name: 'CHECK OUT', w: 60 },
      { name: 'WORKED', w: 65 },
      { name: 'STATUS', w: 78 }
    ];

    // Table Header Bar (Obsidian Charcoal)
    rect(margin, curY - 18, contentWidth, 20, 0.067, 0.067, 0.067, true);
    let colX = margin + 6;
    cols.forEach(c => {
      text(colX, curY - 13, c.name, '/F2', 7.5, 0.855, 0.686, 0.318);
      colX += c.w;
    });
    curY -= 20;

    // Table Rows
    if (pageRecords.length === 0) {
      rect(margin, curY - 20, contentWidth, 22, 0.98, 0.98, 0.98, true);
      text(margin + 20, curY - 14, 'No attendance records found in the selected reporting range.', '/F1', 8.5, 0.4, 0.4, 0.4);
    } else {
      pageRecords.forEach((r, idx) => {
        const isAlt = idx % 2 === 1;
        if (isAlt) {
          rect(margin, curY - 16, contentWidth, 18, 0.97, 0.97, 0.98, true);
        }
        rect(margin, curY - 16, contentWidth, 18, 0.90, 0.90, 0.92, false);

        colX = margin + 6;
        text(colX, curY - 11, r.full_name || '—', '/F2', 8, 0.1, 0.1, 0.1); colX += cols[0].w;
        text(colX, curY - 11, r.employee_code || '—', '/F1', 7.5, 0.3, 0.3, 0.3); colX += cols[1].w;
        text(colX, curY - 11, r.attendance_date || '—', '/F1', 7.5, 0.2, 0.2, 0.2); colX += cols[2].w;
        text(colX, curY - 11, r.check_in_at || '—', '/F1', 7.5, 0.2, 0.2, 0.2); colX += cols[3].w;
        text(colX, curY - 11, r.check_out_at || '—', '/F1', 7.5, 0.2, 0.2, 0.2); colX += cols[4].w;
        text(colX, curY - 11, r.worked || '—', '/F1', 7.5, 0.2, 0.2, 0.2); colX += cols[5].w;

        const isLate = r.status === 'LATE_ENTRY';
        const isAbsent = r.status === 'ABSENT';
        const statusR = isLate || isAbsent ? 0.576 : 0.08;
        const statusG = isLate ? 0.075 : isAbsent ? 0.075 : 0.45;
        const statusB = 0.1;
        text(colX, curY - 11, r.status || '—', '/F2', 7.5, statusR, statusG, statusB);
        curY -= 18;
      });
    }

    // Page Footer
    const footerY = 22;
    rect(margin, footerY + 12, contentWidth, 0.5, 0.85, 0.85, 0.85, false);
    text(margin, footerY, 'Falchion Xeniaa HRMS · Internal Payroll & Attendance Register', '/F1', 7.5, 0.5, 0.5, 0.5);
    text(pageWidth - margin - 55, footerY, `Page ${p + 1} of ${numPages}`, '/F2', 7.5, 0.5, 0.5, 0.5);

    pages.push(stream);
  }

  // Construct PDF Document
  let out = '%PDF-1.4\n%âãÏÓ\n';
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
  a.download = filename || `falchion-attendance-${data.from}-${data.to}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
