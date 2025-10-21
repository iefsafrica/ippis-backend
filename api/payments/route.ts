import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma"; 

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (Array.isArray(body)) {
      // Bulk submission
      const results = await prisma.employeePayment.createMany({
        data: body.map((payment) => ({
          employeeId: payment.employeeId,
          paymentType: payment.paymentType,
          paymentMethod: payment.paymentMethod,
          paymentDate: new Date(payment.paymentDate),
          basicSalary: Number(payment.basicSalary ?? 0),
          houseRentAllowance: Number(payment.houseRentAllowance ?? 0),
          medicalAllowance: Number(payment.medicalAllowance ?? 0),
          travelAllowance: Number(payment.travelAllowance ?? 0),
          dearnessAllowance: Number(payment.dearnessAllowance ?? 0),
          providentFund: Number(payment.providentFund ?? 0),
          incomeTax: Number(payment.incomeTax ?? 0),
          healthInsurance: Number(payment.healthInsurance ?? 0),
          loanDeduction: Number(payment.loanDeduction ?? 0),
          comments: payment.comments ?? "",
        })),
      });

      return NextResponse.json({ success: true, count: results.count });
    } else {
      // Individual submission
      const payment = await prisma.employeePayment.create({
        data: {
          employeeId: body.employeeId,
          paymentType: body.paymentType,
          paymentMethod: body.paymentMethod,
          paymentDate: new Date(body.paymentDate),
          basicSalary: Number(body.basicSalary ?? 0),
          houseRentAllowance: Number(body.houseRentAllowance ?? 0),
          medicalAllowance: Number(body.medicalAllowance ?? 0),
          travelAllowance: Number(body.travelAllowance ?? 0),
          dearnessAllowance: Number(body.dearnessAllowance ?? 0),
          providentFund: Number(body.providentFund ?? 0),
          incomeTax: Number(body.incomeTax ?? 0),
          healthInsurance: Number(body.healthInsurance ?? 0),
          loanDeduction: Number(body.loanDeduction ?? 0),
          comments: body.comments ?? "",
        },
      });

      return NextResponse.json(payment);
    }
  } catch (error) {
    console.error("POST /api/payments error:", error);
    return NextResponse.json({ error: "Failed to process payment" }, { status: 500 });
  }
  
}
