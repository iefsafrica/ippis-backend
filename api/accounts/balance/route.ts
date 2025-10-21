import { NextResponse } from "next/server";
import { PrismaClient } from "@/lib/generated/prisma";

const prisma = new PrismaClient();

export async function GET() {
  try {
    const accounts = await prisma.account.findMany({
      select: {
        id: true,
        accountName: true,
        accountNumber: true,
        bankName: true,
        currency: true,
        balance: true,
        previousBalance: true,
        updatedAt: true,
      },
    });
    console.log("Fetched accounts:", accounts);
    const formattedAccounts = accounts.map(
      (acc: {
        id: string;
        accountName: string;
        accountNumber: string;
        bankName: string;
        currency: string;
        balance: number;
        previousBalance: number | null;
        updatedAt: Date;
      }) => {
        const currentBalance = acc.balance;
        const previousBalance = acc.previousBalance ?? 0;
        const change = currentBalance - previousBalance;
        const changePercentage =
          previousBalance !== 0 ? (change / previousBalance) * 100 : 0;

        return {
          id: acc.id,
          accountName: acc.accountName,
          accountNumber: acc.accountNumber,
          bankName: acc.bankName,
          currency: acc.currency,
          currentBalance,
          previousBalance,
          change,
          changePercentage,
          lastUpdated: acc.updatedAt,
        };
      }
    );

    return NextResponse.json(formattedAccounts);
  } catch (error) {
    console.error("Error fetching balances:", error);
    return NextResponse.json(
      { error: "Failed to fetch account balances" },
      { status: 500 }
    );
  }
}

// import { PrismaClient } from "@/lib/generated/prisma";

// const prisma = new PrismaClient();

// export async function GET() {
//   try {
//     const accounts = await prisma.account.findMany({
//       select: {
//         id: true,
//         accountName: true,
//         accountNumber: true,
//         bankName: true,
//         currency: true,
//         balance: true,
//         previousBalance: true,
//         updatedAt: true,
//       },
//     });
//     const formattedAccounts = accounts.map((acc: any) => {
//       const currentBalance = acc.balance;
//       const previousBalance = acc.previousBalance ?? 0;
//       const change = currentBalance - previousBalance;
//       const changePercentage =
//         previousBalance !== 0 ? (change / previousBalance) * 100 : 0;

//       return {
//         id: acc.id,
//         accountName: acc.accountName,
//         accountNumber: acc.accountNumber,
//         bankName: acc.bankName,
//         currency: acc.currency,
//         currentBalance,
//         previousBalance,
//         change,
//         changePercentage,
//         lastUpdated: acc.updatedAt,
//       };
//     });

//     return NextResponse.json(formattedAccounts);
//   } catch (error) {
//     console.error("Error fetching balances:", error);
//     return NextResponse.json(
//       { error: "Failed to fetch account balances" },
//       { status: 500 }
//     );
//   }
// }
