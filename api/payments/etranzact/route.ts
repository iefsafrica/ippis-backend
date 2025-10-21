import { NextRequest, NextResponse } from "next/server";
import CryptoJS from "crypto-js";

const secretKey = process.env.ETRANZACT_SECRET_KEY as string;
const apiUrl = process.env.ETRANZACT_API_URL as string;
const apiKey = process.env.ETRANZACT_API_KEY as string;

function encryptAES256(plainData: object): string {
  const dataString = JSON.stringify(plainData);
  const key = CryptoJS.enc.Utf8.parse(secretKey);
  const iv = CryptoJS.enc.Utf8.parse(secretKey.substring(0, 16)); // 16-byte IV
  const encrypted = CryptoJS.AES.encrypt(dataString, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return encrypted.toString();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const plainPayload = {
      amount: body.amount,
      clientReference: body.clientReference,
      currency: "NGN",
      narration: "Employee salary payment",
      transactionReference: body.transactionReference,
      channel: 11,
      initiatorDetails: {
        initiatorAccountNumber: body.initiatorAccountNumber,
        initiatorInstitutionCode: body.initiatorInstitutionCode,
        initiatorAccountName: body.initiatorAccountName,
        initiatorBVN: body.initiatorBVN,
      },
      beneficiaryDetails: {
        beneficiaryAccountNumber: body.beneficiaryAccountNumber,
        beneficiaryIssuerCode: body.beneficiaryIssuerCode,
      },
    };

    const encryptedBody = {
      data: encryptAES256(plainPayload),
    };

    console.log(" Sending request to:", apiUrl);
    console.log(" Encrypted payload:", encryptedBody);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`, // Remove if not required
      },
      body: JSON.stringify(encryptedBody),
    });

    const contentType = response.headers.get("content-type") || "";
    const rawText = await response.text();

    console.log("📥 Raw response from Etranzact:", rawText);

    let responseData: any;

    if (contentType.includes("application/json")) {
      try {
        responseData = JSON.parse(rawText);
      } catch (parseError) {
        return NextResponse.json(
          {
            success: false,
            error: "Failed to parse JSON from Etranzact",
            raw: rawText,
          },
          { status: 502 }
        );
      }
    } else {
      return NextResponse.json(
        {
          success: false,
          error: "Non-JSON response from Etranzact",
          raw: rawText,
        },
        { status: 502 }
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: responseData?.message || "Failed to process payment",
          status: response.status,
        },
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true, data: responseData });
  } catch (error: any) {
    console.error(" ETRANZACT error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
