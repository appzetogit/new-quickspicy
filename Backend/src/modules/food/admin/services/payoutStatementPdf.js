import PDFDocument from 'pdfkit';

/**
 * A weekly payout statement as a PDF: the rider's payslip, or the restaurant's
 * settlement statement.
 *
 * Uses pdfkit's built-in Helvetica, which has no ₹ glyph, so amounts print as
 * "Rs." rather than a missing-character box.
 */

const BRAND = '#E64100';
const INK = '#1F2937';
const MUTED = '#6B7280';

const rs = (n) => {
    const v = Number(n) || 0;
    const sign = v < 0 ? '-' : '';
    return `${sign}Rs. ${Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const istDate = (d) =>
    new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

/** @returns {Promise<Buffer>} */
export function renderStatementPdf(statement) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: 'Quick Spicy payout statement' } });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const isRider = statement.entityType === 'rider';
        const left = doc.page.margins.left;
        const width = doc.page.width - left - doc.page.margins.right;

        // Header band.
        doc.rect(0, 0, doc.page.width, 84).fill(BRAND);
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(22).text('Quick Spicy', left, 26);
        doc.font('Helvetica').fontSize(11)
            .text(isRider ? 'Rider weekly payslip' : 'Restaurant weekly settlement statement', left, 54);

        doc.fillColor(INK).moveDown(3);
        doc.y = 108;
        doc.font('Helvetica-Bold').fontSize(14).text(statement.name || (isRider ? 'Rider' : 'Restaurant'), left);
        doc.font('Helvetica').fontSize(10).fillColor(MUTED)
            .text(`${statement.phone ? `${statement.phone}  ·  ` : ''}ID ${statement.entityId}`)
            .text(`Week: ${istDate(statement.periodStart)} to ${istDate(statement.periodEnd)}`)
            .text(`Statement ${statement.id}  ·  Status: ${String(statement.status).toUpperCase()}`
                + (statement.paidAt ? `  ·  Paid ${istDate(statement.paidAt)}` : '')
                + (statement.payoutRef ? `  ·  Ref ${statement.payoutRef}` : ''));

        // Summary table.
        doc.moveDown(1.2);
        const rows = isRider
            ? [
                  ['Deliveries', String(statement.orders)],
                  ['Delivery earnings (incl. tips)', rs(statement.earnings)],
                  ['Incentives and bonuses', rs(statement.incentives)],
                  ['Cash collected from customers', rs(statement.cashCollected)],
                  ['Cash deposited back', rs(statement.cashDeposited)],
                  ['Cash still in hand (deducted)', rs(-statement.cashInHand)],
              ]
            : [
                  ['Orders', String(statement.orders)],
                  ['Item sales', rs(statement.grossSales)],
                  ['Platform commission', rs(-statement.commission)],
                  ['Restaurant share', rs(statement.earnings)],
              ];
        if (Number(statement.adjustments)) {
            rows.push([`Adjustment${statement.adjustmentNote ? ` (${statement.adjustmentNote})` : ''}`, rs(statement.adjustments)]);
        }

        const rowH = 22;
        let y = doc.y;
        doc.fontSize(10.5);
        rows.forEach(([label, value], i) => {
            if (i % 2 === 0) doc.rect(left, y - 5, width, rowH).fill('#FFF4EC');
            doc.fillColor(INK).font('Helvetica').text(label, left + 10, y, { width: width * 0.65 });
            doc.text(value, left, y, { width: width - 10, align: 'right' });
            y += rowH;
        });
        doc.rect(left, y - 3, width, 28).fill(BRAND);
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(12)
            .text(Number(statement.net) < 0 ? 'Net (owed to Quick Spicy)' : 'Net payout', left + 10, y + 5)
            .text(rs(statement.net), left, y + 5, { width: width - 10, align: 'right' });
        doc.y = y + 44;

        // Orders.
        const lines = Array.isArray(statement.lines) ? statement.lines : [];
        if (lines.length) {
            doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text('Orders', left);
            doc.moveDown(0.4);
            const cols = isRider
                ? [['Date', 0.22], ['Order', 0.34], ['Payment', 0.16], ['Cash', 0.14], ['Earning', 0.14]]
                : [['Date', 0.2], ['Order', 0.3], ['Sales', 0.17], ['Commission', 0.17], ['Share', 0.16]];
            const drawHeader = () => {
                let x = left;
                doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED);
                const hy = doc.y;
                cols.forEach(([h, w], i) => {
                    doc.text(h, x, hy, { width: width * w - 4, align: i >= 2 ? 'right' : 'left' });
                    x += width * w;
                });
                doc.y = hy + 14;
            };
            drawHeader();
            doc.font('Helvetica').fontSize(9).fillColor(INK);
            for (const line of lines) {
                if (doc.y > doc.page.height - doc.page.margins.bottom - 20) {
                    doc.addPage();
                    drawHeader();
                    doc.font('Helvetica').fontSize(9).fillColor(INK);
                }
                const values = isRider
                    ? [istDate(line.date), String(line.displayId), String(line.paymentMethod || ''), rs(line.cash), rs(line.amount)]
                    : [istDate(line.date), String(line.displayId), rs(line.sales), rs(line.commission), rs(line.amount)];
                let x = left;
                const ly = doc.y;
                cols.forEach(([, w], i) => {
                    doc.text(values[i], x, ly, { width: width * w - 4, align: i >= 2 ? 'right' : 'left', lineBreak: false });
                    x += width * w;
                });
                doc.y = ly + 13;
            }
            if (statement.lineCount >= 500) {
                doc.moveDown(0.5).fillColor(MUTED).text('Only the first 500 orders are listed.');
            }
        }

        doc.moveDown(1.5).fillColor(MUTED).font('Helvetica').fontSize(8.5).text(
            'This statement is generated by Quick Spicy from the order ledger for the week shown (Monday to Sunday, '
                + 'India time). Contact support if anything looks wrong.',
            left,
            doc.y,
            { width },
        );
        doc.end();
    });
}
