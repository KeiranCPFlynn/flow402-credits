import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

// Validate input
const Body = z.object({
    userId: z.string().uuid(),
    amount_credits: z.number().int().positive(),
});

const tenantId = process.env.FLOW402_TENANT_ID;

export async function POST(req: NextRequest) {
    // DEBUG - Must be FIRST thing in the function
    console.log("=== TOPUP API CALLED ===");
    console.log("ENV check:", {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        serviceKeyLength: process.env.SUPABASE_SERVICE_ROLE_KEY?.length,
        allEnvKeys: Object.keys(process.env).filter(k => k.includes('SUPABASE'))
    });

    if (!tenantId) {
        console.error("FLOW402_TENANT_ID missing for top-up mock route");
        return NextResponse.json(
            { ok: false, error: "tenant_not_configured" },
            { status: 500 }
        );
    }

    try {
        const { userId, amount_credits } = Body.parse(await req.json());

        console.log("Creating Supabase client...");

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Call your SQL function to increment balance
        const { error } = await supabase.rpc("increment_balance", {
            p_tenant: tenantId,
            p_user: userId,
            p_amount: amount_credits,
            p_kind: "topup",
            p_ref: `dashboard_topup_${Date.now()}`,
        });

        if (error) throw error;

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        console.error("Mock top-up error:", e);
        return NextResponse.json({ ok: false, error: String(e) }, { status: 400 });
    }
}
