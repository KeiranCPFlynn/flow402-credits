import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const Body = z.object({
    userId: z.string().uuid().optional(),
});

const vendorDemoUrl = process.env.VENDOR_DEMO_URL;
const demoUserId =
    process.env.DEMO_USER_ID || "9c0383a1-0887-4c0f-98ca-cb71ffc4e76c";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const autoTopupCredits = Number(process.env.DEMO_TOPUP_CENTS ?? 500);

type VendorCall = {
    status: number;
    ok: boolean;
    body: unknown;
    logs: string[];
};

async function callVendor(
    endpoint: string,
    userId: string,
    attempt: number
): Promise<VendorCall> {
    const response = await fetch(endpoint, {
        method: "GET",
        headers: {
            "x-user-id": userId,
            "x-debug": "true",
        },
    });

    const text = await response.text();
    let payload: unknown;
    let vendorLogs: string[] = [];
    try {
        payload = JSON.parse(text);
    } catch {
        payload = text;
        vendorLogs.push(`[Vendor attempt ${attempt}] Response is not JSON`);
    }

    if (
        payload &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        "debug" in payload
    ) {
        const { debug, ...rest } = payload as Record<string, unknown>;
        payload = rest;

        if (Array.isArray(debug)) {
            vendorLogs = debug.map(
                (line) => `[Vendor attempt ${attempt}] ${line}`
            );
        } else if (typeof debug === "string") {
            vendorLogs = [`[Vendor attempt ${attempt}] ${debug}`];
        }
    }

    return {
        status: response.status,
        ok: response.status === 200,
        body: payload,
        logs: vendorLogs,
    };
}

export async function POST(request: Request) {
    if (!vendorDemoUrl) {
        return NextResponse.json(
            {
                ok: false,
                error: "vendor_demo_url_missing",
                logs: ["[Next] Missing VENDOR_DEMO_URL environment variable"],
            },
            { status: 500 }
        );
    }

    const trace: string[] = [];
    const traceStep = (message: string) => {
        trace.push(message);
    };

    try {
        const body = Body.parse(await request.json().catch(() => ({})));
        const userId = body.userId ?? demoUserId;
        traceStep(`[Next] Simulating charge for user ${userId}`);

        const endpoint = `${vendorDemoUrl.replace(/\/$/, "")}/demo/screenshot`;
        traceStep(`[Next] Calling vendor demo: GET ${endpoint}`);

        const firstCall = await callVendor(endpoint, userId, 1);
        traceStep(`[Next] Vendor responded with status ${firstCall.status}`);

        if (firstCall.status === 402) {
            traceStep("[Next] Auto top-up triggered after 402 response");
            const supabase = createClient(supabaseUrl, supabaseServiceKey);
            const { error: topupError } = await supabase.rpc("increment_balance", {
                p_user: userId,
                p_amount: autoTopupCredits,
            });

            if (topupError) {
                traceStep(
                    `[Next] Auto top-up failed: ${
                        topupError instanceof Error
                            ? topupError.message
                            : JSON.stringify(topupError)
                    }`
                );
                return NextResponse.json(
                    {
                        ok: false,
                        status: firstCall.status,
                        body: firstCall.body,
                        logs: [...trace, ...firstCall.logs],
                        error: "auto_topup_failed",
                    },
                    { status: 500 }
                );
            }

            traceStep(
                `[Next] Auto top-up added ${autoTopupCredits.toLocaleString()} credits (~$${(
                    autoTopupCredits / 100
                ).toFixed(2)})`
            );
            traceStep("[Next] Retrying vendor demo after top-up");

            const secondCall = await callVendor(endpoint, userId, 2);
            traceStep(`[Next] Retry responded with status ${secondCall.status}`);

            traceStep("[Next] Charge simulation completed");

            return NextResponse.json(
                {
                    ok: secondCall.ok,
                    status: secondCall.status,
                    body: secondCall.body,
                    logs: [...trace, ...firstCall.logs, ...secondCall.logs],
                },
                { status: secondCall.status }
            );
        }

        traceStep("[Next] Charge simulation completed");

        return NextResponse.json(
            {
                ok: firstCall.ok,
                status: firstCall.status,
                body: firstCall.body,
                logs: [...trace, ...firstCall.logs],
            },
            { status: firstCall.status }
        );
    } catch (error) {
        console.error("Demo charge route error:", error);
        traceStep(`[Next] Error while calling vendor demo: ${String(error)}`);
        return NextResponse.json(
            { ok: false, error: "unexpected_error", logs: trace },
            { status: 500 }
        );
    }
}
