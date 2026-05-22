import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as any;
    const { amount, currency, email, reference } = body;

    if (!amount || !email) {
      return withCors(req, { success: false, error: "Missing required fields: amount, email" }, 400);
    }

    // This is a placeholder for Uverus Pay integration
    // In a real scenario, you would call Uverus API here
    console.log(`Processing Uverus Pay for ${email}: ${amount} ${currency || "NGN"}`);

    // Mock response
    return withCors(req, {
      success: true,
      message: "Uverus Pay initialization successful",
      data: {
        payment_url: `https://checkout.uverus.com/pay/${reference || Math.random().toString(36).substring(7)}`,
        reference: reference || `UV-${Date.now()}`,
      }
    });
  } catch (error: any) {
    return withCors(req, { success: false, error: error?.message || "Uverus Pay failed" }, 500);
  }
}
