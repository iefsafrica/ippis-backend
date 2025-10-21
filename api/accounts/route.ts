import { NextResponse } from "next/server";
import { PrismaClient } from "@/lib/generated/prisma";

const prisma = new PrismaClient();

type AccountPayload = {
  accountName: string;
  accountNumber: string;
  bankName: string;
  accountType: string;
  currency: string;
  balance: number;
  openingDate?: string;
  status?: string;
  branchCode?: string;
  swiftCode?: string;
  description?: string;
};

export async function GET() {
  try {
    console.log("Fetching accounts...");
    const accounts = await prisma.account.findMany({
      orderBy: { createdAt: "desc" },
    });
    console.log("Fetched accounts:", accounts);
    return NextResponse.json(accounts);
  } catch (error: any) {
    console.error("GET /api/accounts error:", error?.message || error);
    return NextResponse.json(
      { error: "Failed to fetch accounts", message: error?.message },
      { status: 500 }
    );
  }
}
export async function POST(req: Request) {
  try {
    const body: AccountPayload = await req.json();
    console.log("POST body:", body);

    const newAccount = await prisma.account.create({
      data: {
        accountName: body.accountName ?? "Untitled Account",
        accountNumber: body.accountNumber ?? "",
        bankName: body.bankName ?? "",
        accountType: body.accountType ?? "checking",
        currency: body.currency ?? "NGN",
        balance: Number(body.balance ?? 0),
        openingDate: new Date(body.openingDate || new Date()),
        status: body.status ?? "active",
        branchCode: body.branchCode ?? "",
        swiftCode: body.swiftCode ?? "",
        description: body.description ?? "",
      },
    });

    return NextResponse.json(newAccount);
  } catch (error: any) {
    console.error("POST /api/accounts error:", error?.message || error);
    return NextResponse.json(
      { error: "Failed to create account", message: error?.message },
      { status: 500 }
    );
  }
}
