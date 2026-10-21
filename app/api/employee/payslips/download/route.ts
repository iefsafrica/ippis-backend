import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticateEmployee } from "@/lib/employee-auth";
import { payslipsFor } from "@/lib/employee-payroll";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const naira = (n: number) => `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ?payment_id=  The payslip as a printable HTML file (print or save as PDF from the browser)
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateEmployee(req);
    if (!auth.ok) return auth.response;
    const { employee } = auth.ctx;

    const paymentId = new URL(req.url).searchParams.get("payment_id");
    if (!paymentId) return withCors(req, { success: false, error: "payment_id is required" }, 400);

    const [p] = await payslipsFor(employee.id, { paymentId });
    if (!p) return withCors(req, { success: false, error: "Payslip not found" }, 404);

    const rows = (items: { item: string; amount: number }[]) =>
      items.map((i) => `<tr><td>${esc(i.item)}</td><td class="n">${naira(i.amount)}</td></tr>`).join("") ||
      `<tr><td colspan="2" class="muted">No breakdown recorded</td></tr>`;

    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Payslip ${esc(p.paymentId)}</title>
<style>
  body { font-family: Arial, sans-serif; color: #111; max-width: 720px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 20px; margin: 0 0 4px; } .muted { color: #666; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ddd; } .n { text-align: right; }
  .total td { font-weight: bold; border-top: 2px solid #111; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; font-size: 14px; }
  @media print { body { margin: 0; } }
</style></head>
<body>
  <h1>IPPIS Payslip</h1>
  <p class="muted">Payment ${esc(p.paymentId)} &middot; ${esc(p.paymentDate)} &middot; ${esc(p.type ?? "salary")} &middot; ${esc(p.status)}</p>
  <div class="grid">
    <div><strong>Employee:</strong> ${esc(employee.name)}</div><div><strong>Staff ID:</strong> ${esc(employee.id)}</div>
    <div><strong>Department:</strong> ${esc(employee.department ?? "")}</div><div><strong>Position:</strong> ${esc(employee.position ?? "")}</div>
  </div>
  <h2>Earnings</h2>
  <table>${rows(p.earnings)}<tr class="total"><td>Gross pay</td><td class="n">${naira(p.gross)}</td></tr></table>
  <h2>Deductions</h2>
  <table>${rows(p.deductions)}<tr class="total"><td>Total deductions</td><td class="n">${naira(p.totalDeductions)}</td></tr></table>
  <table><tr class="total"><td>Amount paid</td><td class="n">${naira(p.amountPaid)}</td></tr></table>
  <p class="muted">Generated ${esc(new Date().toISOString().slice(0, 10))}. Report any discrepancy to HR through the employee portal.</p>
</body></html>`;

    const response = new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="payslip-${p.paymentId.replace(/[^\w.-]+/g, "_")}.html"`,
        "Cache-Control": "no-store",
      },
    });
    // Same CORS headers as every other portal response
    const cors = withCors(req, {});
    cors.headers.forEach((value, key) => {
      if (key.toLowerCase().startsWith("access-control-")) response.headers.set(key, value);
    });
    return response;
  } catch (error) {
    console.error("EMPLOYEE PAYSLIP DOWNLOAD ERROR:", error);
    return withCors(req, { success: false, error: "Failed to prepare the payslip" }, 500);
  }
}
