import { NextResponse } from "next/server";
import { z } from "zod";

const Body = z.object({
    userId: z.string().uuid().optional(),
});

const vendorDemoUrl = process.env.VENDOR_DEMO_URL;
const demoUserId =
    process.env.DEMO_USER_ID || "9c0383a1-0887-4c0f-98ca-cb71ffc4e76c";

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

        const response = await fetch(endpoint, {
            method: "GET",
            headers: {
                "x-user-id": userId,
                "x-debug": "true",
            },
        });

        traceStep(`[Next] Vendor responded with status ${response.status}`);

        const text = await response.text();
        let payload: unknown;
        try {
            payload = JSON.parse(text);
        } catch {
            payload = text;
            traceStep("[Next] Vendor response is not JSON");
        }

        let vendorLogs: string[] = [];
        let cleanedBody = payload;
        if (
            payload &&
            typeof payload === "object" &&
            !Array.isArray(payload) &&
            "debug" in payload
        ) {
            const { debug, ...rest } = payload as Record<string, unknown>;
            if (Array.isArray(debug)) {
                vendorLogs = debug.map((line) => `[Vendor] ${line}`);
            } else if (typeof debug === "string") {
                vendorLogs = [`[Vendor] ${debug}`];
            }
            cleanedBody = rest;
        }

        traceStep("[Next] Charge simulation completed");

        return NextResponse.json({
            ok: response.status === 200,
            status: response.status,
            body: cleanedBody,
            logs: [...trace, ...vendorLogs],
        });
    } catch (error) {
        console.error("Demo charge route error:", error);
        traceStep(`[Next] Error while calling vendor demo: ${String(error)}`);
        return NextResponse.json(
            { ok: false, error: "unexpected_error", logs: trace },
            { status: 500 }
        );
    }
}
